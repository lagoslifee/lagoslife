import { FUEL, FUEL_STATIONS, fuelSpec, fuelStationById, getVehicleModel, usesFuel, type FuelStationState } from "@lagos-living/shared";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, withTransaction } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";
import { liveVehicles } from "./vehicle-events.js";

type StationRow = { id: string; owner_user_id: string | null; owner_name: string | null; price: number; litres_sold: number; earned: string };

async function stationRows() {
  const rows = await pool.query<StationRow>(
    `SELECT station.*, COALESCE("user".username, "user".name) AS owner_name
     FROM fuel_station station LEFT JOIN "user" ON "user".id = station.owner_user_id`,
  );
  return new Map(rows.rows.map((row) => [row.id, row]));
}

function stationView(id: string, row: StationRow | undefined, userId: string): FuelStationState {
  const site = fuelStationById.get(id)!;
  const owned = Boolean(row?.owner_user_id);
  return {
    id,
    name: site.name,
    brand: site.brand,
    price: owned ? Number(row!.price) : FUEL.marketerPrice,
    owner: owned ? (row!.owner_name ?? "A resident") : null,
    mine: owned && row!.owner_user_id === userId,
    litresSold: owned ? Math.round(Number(row!.litres_sold)) : 0,
    earned: owned ? Number(row!.earned) : 0,
  };
}

export async function fuelStations(userId: string) {
  const rows = await stationRows();
  return FUEL_STATIONS.map((site) => stationView(site.id, rows.get(site.id), userId));
}

function requireAtPumps(userId: string, stationId: string) {
  const site = fuelStationById.get(stationId);
  if (!site) throw new EconomyError("Unknown filling station.", 404);
  const here = getPlayerPosition(userId);
  if (!here || here.location !== "street" || Math.hypot(here.x - site.point[0], here.z - site.point[1]) > FUEL.pumpRange + 3) {
    throw new EconomyError(`Pull up at the pumps of ${site.name} first.`, 409);
  }
  return site;
}

/**
 * The attendant fills the tank: the resident pays the agreed pump price by card, the car gets the litres (never more
 * than the tank has room for), and a station a resident owns pays them its margin over the depot price.
 */
export async function buyFuel(userId: string, input: { stationId: string; vehicleId: string; litres: number; price: number; idempotencyKey: string }) {
  const site = requireAtPumps(userId, input.stationId);
  const vehicle = await pool.query<{ model_id: string; fuel_l: number | null }>(`SELECT model_id, fuel_l FROM player_vehicle WHERE id = $1 AND owner_user_id = $2`, [input.vehicleId, userId]);
  if (!vehicle.rowCount) throw new EconomyError("That is not your vehicle.", 404);
  const model = getVehicleModel(vehicle.rows[0]!.model_id);
  if (!usesFuel(model)) throw new EconomyError("Bicycles run on legs, not petrol.");
  const live = liveVehicles.fuel?.(input.vehicleId);
  if (live && Math.hypot(live.x - site.point[0], live.z - site.point[1]) > FUEL.pumpRange + 4) throw new EconomyError("Bring the car up to the pumps.", 409);
  const tank = fuelSpec(model).tank;
  const current = live?.litres ?? (vehicle.rows[0]!.fuel_l == null ? tank : Number(vehicle.rows[0]!.fuel_l));
  const litres = Math.min(input.litres, Math.floor(tank - current));
  if (litres < 1) throw new EconomyError("The tank is already full.", 409);
  const result = await withTransaction(async (client) => {
    const replay = await client.query(`SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, input.idempotencyKey]);
    if (replay.rowCount) return { balance: Number(replay.rows[0].balance_after), litres: 0, paid: 0, replayed: true };
    const row = (await client.query<StationRow>(`SELECT *, NULL AS owner_name FROM fuel_station WHERE id = $1 FOR UPDATE`, [site.id])).rows[0];
    const price = row?.owner_user_id ? Number(row.price) : FUEL.marketerPrice;
    if (price !== input.price) throw new EconomyError(`The pump price is now ₦${price.toLocaleString("en-NG")}/L.`, 409);
    const paid = litres * price;
    const balance = await debitWallet(client, userId, paid, "fuel_purchase", `${site.name} · ${litres} L @ ₦${price.toLocaleString("en-NG")}`, input.idempotencyKey, { stationId: site.id, vehicleId: input.vehicleId, litres });
    if (row?.owner_user_id) {
      const margin = litres * (price - FUEL.depotPrice);
      if (margin > 0 && row.owner_user_id !== userId) {
        await creditWallet(client, row.owner_user_id, margin, "fuel_sale", `${site.name} · sold ${litres} L`, `${input.idempotencyKey}:station`);
      }
      await client.query(`UPDATE fuel_station SET litres_sold = litres_sold + $2, earned = earned + $3, updated_at = NOW() WHERE id = $1`, [site.id, litres, Math.max(0, margin)]);
    }
    await client.query(`UPDATE player_vehicle SET fuel_l = LEAST($3, COALESCE(fuel_l, $3) + $2), updated_at = NOW() WHERE id = $1`, [input.vehicleId, litres, tank]);
    return { balance, litres, paid, replayed: false };
  });
  if (!result.replayed) liveVehicles.refuel?.(input.vehicleId, result.litres);
  return { ...result, fuel: Math.min(tank, current + result.litres), tank };
}

/** Buys a station off its oil marketer. Only stations still run by the marketer are for sale. */
export async function buyStation(userId: string, stationId: string, idempotencyKey: string) {
  const site = fuelStationById.get(stationId);
  if (!site) throw new EconomyError("Unknown filling station.", 404);
  return withTransaction(async (client) => {
    await client.query(`INSERT INTO fuel_station (id, price) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [site.id, FUEL.marketerPrice]);
    const row = (await client.query<StationRow>(`SELECT *, NULL AS owner_name FROM fuel_station WHERE id = $1 FOR UPDATE`, [site.id])).rows[0]!;
    if (row.owner_user_id === userId) throw new EconomyError("You already own this station.", 409);
    if (row.owner_user_id) throw new EconomyError("Another resident owns this station.", 409);
    const balance = await debitWallet(client, userId, FUEL.stationPrice, "station_purchase", `${site.name} · bought from ${site.brand}`, idempotencyKey, { stationId: site.id });
    await client.query(
      `UPDATE fuel_station SET owner_user_id = $2, price = $3, litres_sold = 0, earned = 0, bought_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [site.id, userId, FUEL.marketerPrice],
    );
    return { balance };
  });
}

export async function setStationPrice(userId: string, stationId: string, price: number) {
  const updated = await pool.query(`UPDATE fuel_station SET price = $3, updated_at = NOW() WHERE id = $1 AND owner_user_id = $2`, [stationId, userId, price]);
  if (!updated.rowCount) throw new EconomyError("Only the station's owner can change its pump price.", 403);
  return { price };
}
