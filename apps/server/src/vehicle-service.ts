import {
  VEHICLE_MODELS,
  getPlace,
  getVehicleModel,
  walkable,
  insurancePremium,
  kerbSlot,
  propertyPlace,
  plotForHome,
  builtHomePlace,
  repairCost,
  dentQuote,
  VEHICLE_RULES,
  vehicleModelById,
  type OwnedVehicle,
  type Place,
  fuelSpec,
  usesFuel,
} from "@lagos-living/shared";
import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, markProgress, withTransaction } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";
import { hasOverdueFines } from "./justice-service.js";
import { vehicleEvents } from "./vehicle-events.js";
import "./world-footprints.js";

export const MAX_VEHICLES = 3;
export const MAX_BICYCLES = 2;
export const GARAGE_CAPACITY = VEHICLE_RULES.garageCapacity;
const DESK_RANGE = 6;
const KERB_RANGE = 12;
const SLOT_CLEARANCE = 5;
export const DEALERSHIP_ID = "lekki-motors";
export const MECHANIC_ID = "ade-auto-works";

export const vehicleColumns = `id, owner_user_id, model_id, colour, plate, condition, odometer_m, service_odometer_m,
  status, driver_session_id, x, z, yaw, garage_property_id, insured_until, locked, dents, fuel_l`;

export type VehicleRow = {
  id: string;
  dents?: number;
  owner_user_id: string;
  model_id: string;
  colour: string;
  plate: string;
  condition: number;
  odometer_m: number;
  service_odometer_m: number;
  status: OwnedVehicle["status"];
  driver_session_id: string | null;
  x: number | null;
  z: number | null;
  yaw: number | null;
  garage_property_id: string | null;
  insured_until: Date | null;
  locked: boolean;
  fuel_l?: number | null;
};

export function isInsured(row: Pick<VehicleRow, "insured_until">) {
  return Boolean(row.insured_until && new Date(row.insured_until).getTime() > Date.now());
}

export function serviceQuote(row: VehicleRow) {
  const model = getVehicleModel(row.model_id);
  const fullRepair = repairCost(model, Number(row.condition));
  const repair = fullRepair > 0 && isInsured(row) ? Math.min(VEHICLE_RULES.insuredExcess, fullRepair) : fullRepair;
  const dents = dentQuote(Number(row.dents ?? 0), isInsured(row));
  return { repair, fullRepair, dents: Number(row.dents ?? 0), dentRepair: dents.pay, total: VEHICLE_RULES.routineServiceFee + repair + dents.pay };
}

export function toOwned(row: VehicleRow) {
  const model = getVehicleModel(row.model_id);
  const metresSinceService = Number(row.odometer_m) - Number(row.service_odometer_m);
  const vehicle: OwnedVehicle = {
    id: row.id,
    modelId: row.model_id,
    colour: row.colour,
    plate: row.plate,
    condition: Number(row.condition),
    odometerMetres: Math.round(Number(row.odometer_m)),
    metresSinceService: Math.round(metresSinceService),
    status: row.status,
    x: row.x === null ? null : Number(row.x),
    z: row.z === null ? null : Number(row.z),
    yaw: row.yaw === null ? null : Number(row.yaw),
    garagePropertyId: row.garage_property_id,
    insuredUntil: row.insured_until ? new Date(row.insured_until).toISOString() : null,
    locked: row.locked !== false,
  };
  return {
    ...vehicle,
    modelName: model.name,
    insured: isInsured(row),
    premium: insurancePremium(model),
    serviceDue: metresSinceService >= VEHICLE_RULES.serviceIntervalMetres,
    serviceQuote: serviceQuote(row),
    tank: fuelSpec(model).tank,
    fuel: usesFuel(model) ? Math.round((row.fuel_l == null ? fuelSpec(model).tank : Number(row.fuel_l)) * 10) / 10 : null,
  };
}

type Spot = Pick<Place, "name" | "door" | "kerb" | "kerbYaw">;

/** Mapped places carry a kerb; listings without one fall back to their door coordinates. */
export async function propertySpot(client: PoolClient, propertyId: string): Promise<Spot> {
  const place = propertyPlace(propertyId);
  if (place) return place;
  const plot = plotForHome(propertyId);
  const built = builtHomePlace(propertyId);
  if (plot && built) return { name: built.name, door: built.door, kerb: plot.kerb, kerbYaw: Math.atan2(plot.along[0], plot.along[1]) };
  const listing = await client.query(`SELECT name, world_x, world_z FROM property_listing WHERE id = $1`, [propertyId]);
  if (!listing.rowCount) throw new EconomyError("Unknown property", 404);
  const door: [number, number] = [Number(listing.rows[0].world_x), Number(listing.rows[0].world_z)];
  return { name: listing.rows[0].name, door, kerb: door, kerbYaw: 0 };
}

/** The player must be at the business: its door or the kerb outside. */
/** Owners can move cars between garage and driveway from the home designer while inside that home. */
function insideHome(userId: string, propertyId: string) {
  return getPlayerPosition(userId)?.location === `home:${propertyId}`;
}

function requireAtPlace(userId: string, place: Spot, message: string) {
  const position = getPlayerPosition(userId);
  const near =
    position?.location === "street" &&
    (Math.hypot(position.x - place.door[0], position.z - place.door[1]) <= DESK_RANGE ||
      Math.hypot(position.x - place.kerb[0], position.z - place.kerb[1]) <= KERB_RANGE);
  if (!near) throw new EconomyError(message, 409);
}

export function slotIsClear(x: number, z: number, yaw: number) {
  const ax = Math.sin(yaw) * 2.4;
  const az = Math.cos(yaw) * 2.4;
  return [[0, 0], [ax, az], [-ax, -az]].every(
    ([dx, dz]) => walkable(x + dx!, z + dz!, 0),
  );
}

/** First kerbside slot outside a place that is not occupied by another car. */
export async function freeKerbSlot(client: PoolClient, place: Spot, ignoreVehicleId = "") {
  const nearby = await client.query(
    `SELECT x, z FROM player_vehicle
     WHERE status IN ('parked', 'driving') AND id <> $5
       AND x BETWEEN $1 AND $2 AND z BETWEEN $3 AND $4`,
    [place.kerb[0] - 95, place.kerb[0] + 95, place.kerb[1] - 95, place.kerb[1] + 95, ignoreVehicleId],
  );
  const taken = nearby.rows.map((row) => [Number(row.x), Number(row.z)] as const);
  for (let index = 0; index < 25; index += 1) {
    const [x, z] = kerbSlot(place.kerb, place.kerbYaw, index);
    if (!slotIsClear(x, z, place.kerbYaw)) continue;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < SLOT_CLEARANCE)) continue;
    return { x, z, yaw: place.kerbYaw };
  }
  return { x: place.kerb[0], z: place.kerb[1], yaw: place.kerbYaw };
}

function newPlate() {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const pick = () => letters[randomInt(letters.length)];
  return `EKO ${String(randomInt(100, 1000))} ${pick()}${pick()}`;
}

async function lockWalletAndReplay(client: PoolClient, userId: string, idempotencyKey: string) {
  await ensureWallet(client, userId);
  const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
  const replay = await client.query(
    `SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, idempotencyKey],
  );
  return {
    balance: Number(wallet.rows[0].balance),
    replayed: Boolean(replay.rowCount),
  };
}

async function lockOwnVehicle(client: PoolClient, userId: string, vehicleId: string) {
  const result = await client.query<VehicleRow>(
    `SELECT ${vehicleColumns} FROM player_vehicle WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`,
    [vehicleId, userId],
  );
  if (!result.rowCount) throw new EconomyError("That vehicle is not yours", 404);
  return result.rows[0]!;
}

async function requireParked(client: PoolClient, row: VehicleRow) {
  if (row.status === "towing") throw new EconomyError("Ade Recovery has this car right now. It comes back once it is repaired.", 409);
  const tow = await client.query(`SELECT 1 FROM vehicle_tow WHERE vehicle_id = $1 AND stage NOT IN ('delivered', 'cancelled')`, [row.id]);
  if (tow.rowCount) throw new EconomyError("A recovery truck is on its way for this car.", 409);
  if (row.status === "driving") throw new EconomyError("Step out of the vehicle first.", 409);
  if (row.status === "garaged") throw new EconomyError("Take the vehicle out of the garage first.", 409);
}

export async function logEvent(client: PoolClient, vehicleId: string, userId: string, kind: string, amount: number, detail: object = {}) {
  await client.query(
    `INSERT INTO vehicle_event (id, vehicle_id, user_id, kind, amount, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), vehicleId, userId, kind, amount, JSON.stringify(detail)],
  );
}

export async function listVehicles(userId: string) {
  const result = await pool.query<VehicleRow>(
    `SELECT ${vehicleColumns} FROM player_vehicle WHERE owner_user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return result.rows.map(toOwned);
}

export async function purchaseVehicle(userId: string, modelId: string, colour: string, idempotencyKey: string) {
  const model = vehicleModelById.get(modelId);
  if (!model) throw new EconomyError("That model is not on the forecourt", 404);
  const paint = colour.toLowerCase();
  if (!model.colours.includes(paint)) throw new EconomyError("That colour is not offered for this model.");
  const dealer = getPlace(DEALERSHIP_ID);
  requireAtPlace(userId, dealer, `Visit ${dealer.name} on ${dealer.street} to buy a vehicle.`);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await withTransaction(async (client) => {
        const wallet = await lockWalletAndReplay(client, userId, idempotencyKey);
        const existing = await client.query<VehicleRow>(
          `SELECT ${vehicleColumns} FROM player_vehicle WHERE owner_user_id = $1 AND purchase_key = $2`,
          [userId, idempotencyKey],
        );
        if (existing.rowCount) {
          return { balance: wallet.balance, replayed: true, vehicle: toOwned(existing.rows[0]!) };
        }
        if (await hasOverdueFines(client, userId)) {
          throw new EconomyError("Settle your overdue traffic fines (Phone → Justice) before buying another vehicle.", 409);
        }
        const bicycle = model.body === "bicycle";
        const sameKind = VEHICLE_MODELS.filter((entry) => (entry.body === "bicycle") === bicycle).map((entry) => entry.id);
        const owned = await client.query(
          `SELECT COUNT(*)::INTEGER AS count FROM player_vehicle WHERE owner_user_id = $1 AND model_id = ANY($2)`,
          [userId, sameKind],
        );
        const cap = bicycle ? MAX_BICYCLES : MAX_VEHICLES;
        if (owned.rows[0].count >= cap) {
          throw new EconomyError(bicycle ? `Residents may own up to ${cap} bicycles.` : `Residents may own up to ${cap} motor vehicles.`, 409);
        }
        const plate = newPlate();
        const balance = await debitWallet(client, userId, model.price, "vehicle_purchase",
          `${model.name} · ${plate}`, idempotencyKey, { modelId, plate });
        const slot = await freeKerbSlot(client, dealer);
        const id = randomUUID();
        const inserted = await client.query<VehicleRow>(
          `INSERT INTO player_vehicle (id, owner_user_id, model_id, colour, plate, status, x, z, yaw, purchase_key)
           VALUES ($1, $2, $3, $4, $5, 'parked', $6, $7, $8, $9)
           RETURNING ${vehicleColumns}`,
          [id, userId, modelId, paint, plate, slot.x, slot.z, slot.yaw, idempotencyKey],
        );
        await logEvent(client, id, userId, "purchase", model.price, { plate });
        await markProgress(client, userId, "first_vehicle");
        return { balance, replayed: false, vehicle: toOwned(inserted.rows[0]!) };
      });
      vehicleEvents.emit("changed", result.vehicle.id);
      return result;
    } catch (error) {
      const constraint = (error as { code?: string; constraint?: string });
      if (constraint.code === "23505" && constraint.constraint === "player_vehicle_plate_key" && attempt < 3) continue;
      throw error;
    }
  }
}

export async function serviceVehicle(userId: string, vehicleId: string, idempotencyKey: string) {
  const mechanic = getPlace(MECHANIC_ID);
  requireAtPlace(userId, mechanic, `Bring the vehicle to ${mechanic.name} on ${mechanic.street}.`);
  const result = await withTransaction(async (client) => {
    const wallet = await lockWalletAndReplay(client, userId, idempotencyKey);
    const row = await lockOwnVehicle(client, userId, vehicleId);
    if (wallet.replayed) return { balance: wallet.balance, replayed: true, vehicle: toOwned(row) };
    await requireParked(client, row);
    if (Math.hypot(Number(row.x) - mechanic.kerb[0], Number(row.z) - mechanic.kerb[1]) > VEHICLE_RULES.workshopRange) {
      throw new EconomyError(`Park the vehicle outside ${mechanic.name} first.`, 409);
    }
    const sinceService = Number(row.odometer_m) - Number(row.service_odometer_m);
    if (Number(row.condition) >= 100 && sinceService < 500 && !Number(row.dents ?? 0)) {
      throw new EconomyError("The mechanic checked it over: nothing needs doing yet.");
    }
    const quote = serviceQuote(row);
    const balance = await debitWallet(client, userId, quote.total, "vehicle_service",
      `${mechanic.name} · ${row.plate}`, idempotencyKey, { vehicleId, ...quote });
    const updated = await client.query<VehicleRow>(
      `UPDATE player_vehicle SET condition = 100, dents = 0, service_odometer_m = odometer_m, updated_at = NOW()
       WHERE id = $1 RETURNING ${vehicleColumns}`,
      [vehicleId],
    );
    await logEvent(client, vehicleId, userId, quote.repair > 0 ? "repair" : "service", quote.total, {
      conditionBefore: Number(row.condition),
      insured: isInsured(row),
      ...quote,
    });
    return { balance, replayed: false, vehicle: toOwned(updated.rows[0]!), charged: quote.total };
  });
  vehicleEvents.emit("changed", vehicleId);
  return result;
}

export async function insureVehicle(userId: string, vehicleId: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    const wallet = await lockWalletAndReplay(client, userId, idempotencyKey);
    const row = await lockOwnVehicle(client, userId, vehicleId);
    if (wallet.replayed) return { balance: wallet.balance, replayed: true, vehicle: toOwned(row) };
    if (row.insured_until && new Date(row.insured_until).getTime() - Date.now() > 86_400_000) {
      throw new EconomyError("Cover is already active. Renew within a day of it ending.");
    }
    const premium = insurancePremium(getVehicleModel(row.model_id));
    const balance = await debitWallet(client, userId, premium, "vehicle_insurance",
      `Comprehensive cover · ${row.plate}`, idempotencyKey, { vehicleId });
    const updated = await client.query<VehicleRow>(
      `UPDATE player_vehicle
       SET insured_until = GREATEST(COALESCE(insured_until, NOW()), NOW()) + make_interval(days => $2),
           updated_at = NOW()
       WHERE id = $1 RETURNING ${vehicleColumns}`,
      [vehicleId, VEHICLE_RULES.insuranceDays],
    );
    await logEvent(client, vehicleId, userId, "insurance", premium);
    return { balance, replayed: false, vehicle: toOwned(updated.rows[0]!) };
  });
}

export async function garageVehicle(userId: string, vehicleId: string, propertyId: string) {
  const result = await withTransaction(async (client) => {
    const place = await propertySpot(client, propertyId);
    const held = await client.query(
      `SELECT 1 FROM property_tenure
       WHERE property_id = $1 AND owner_user_id = $2 AND (expires_at IS NULL OR expires_at > NOW())`,
      [propertyId, userId],
    );
    if (!held.rowCount) throw new EconomyError("You can only garage a vehicle at a home you hold.", 403);
    const row = await lockOwnVehicle(client, userId, vehicleId);
    await requireParked(client, row);
    const atHome =
      Math.hypot(Number(row.x) - place.kerb[0], Number(row.z) - place.kerb[1]) <= VEHICLE_RULES.garageRange ||
      Math.hypot(Number(row.x) - place.door[0], Number(row.z) - place.door[1]) <= VEHICLE_RULES.garageRange;
    if (!atHome) throw new EconomyError(`Park outside ${place.name} to use its garage.`, 409);
    const position = getPlayerPosition(userId);
    const beside = position?.location === "street" && Math.hypot(position.x - Number(row.x), position.z - Number(row.z)) <= 12;
    if (!beside && !insideHome(userId, propertyId)) {
      throw new EconomyError("Stand next to the vehicle to put it away.", 409);
    }
    const used = await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM player_vehicle WHERE status = 'garaged' AND garage_property_id = $1`,
      [propertyId],
    );
    if (used.rows[0].count >= GARAGE_CAPACITY) throw new EconomyError("This garage is full.", 409);
    const updated = await client.query<VehicleRow>(
      `UPDATE player_vehicle SET status = 'garaged', garage_property_id = $2, driver_session_id = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING ${vehicleColumns}`,
      [vehicleId, propertyId],
    );
    await logEvent(client, vehicleId, userId, "garage", 0, { propertyId });
    return { vehicle: toOwned(updated.rows[0]!) };
  });
  vehicleEvents.emit("changed", vehicleId);
  return result;
}

export async function setVehicleLock(userId: string, vehicleId: string, locked: boolean) {
  const result = await withTransaction(async (client) => {
    const row = await lockOwnVehicle(client, userId, vehicleId);
    const updated = await client.query<VehicleRow>(
      `UPDATE player_vehicle SET locked = $2, updated_at = NOW() WHERE id = $1 RETURNING ${vehicleColumns}`,
      [row.id, locked],
    );
    await logEvent(client, vehicleId, userId, locked ? "lock" : "unlock", 0, {});
    return { vehicle: toOwned(updated.rows[0]!) };
  });
  vehicleEvents.emit("changed", vehicleId);
  return result;
}

export async function retrieveVehicle(userId: string, vehicleId: string) {
  const result = await withTransaction(async (client) => {
    const row = await lockOwnVehicle(client, userId, vehicleId);
    if (row.status !== "garaged" || !row.garage_property_id) throw new EconomyError("That vehicle is not garaged.");
    const place = await propertySpot(client, row.garage_property_id);
    if (!insideHome(userId, row.garage_property_id)) requireAtPlace(userId, place, `Go to ${place.name} to take the vehicle out.`);
    const slot = await freeKerbSlot(client, place, vehicleId);
    const updated = await client.query<VehicleRow>(
      `UPDATE player_vehicle SET status = 'parked', garage_property_id = NULL, x = $2, z = $3, yaw = $4, updated_at = NOW()
       WHERE id = $1 RETURNING ${vehicleColumns}`,
      [vehicleId, slot.x, slot.z, slot.yaw],
    );
    await logEvent(client, vehicleId, userId, "retrieve", 0, { propertyId: row.garage_property_id });
    return { vehicle: toOwned(updated.rows[0]!) };
  });
  vehicleEvents.emit("changed", vehicleId);
  return result;
}

export type RoomVehicle = {
  id: string;
  ownerUserId: string;
  ownerName: string;
  modelId: string;
  colour: string;
  plate: string;
  condition: number;
  x: number;
  z: number;
  yaw: number;
  driverSessionId: string | null;
  lights: boolean;
  locked: boolean;
  /** Present only on temporary dealer cars, which are never written to the database. */
  testDrive?: { endsAt: number; origin: [number, number]; yaw: number; warned: boolean };
  /** Naija World Ride car, driven for a rider by a non-player driver; never stored. */
  npc?: boolean;
  /** Ade Recovery truck: the car on its bed and the winch position (0 down, 1 loaded). */
  tow?: { carrying: { modelId: string; colour: string; plate: string } | null; lift: number };
  /** Hired from a bike station; billed per minute until returned to any dock. */
  rental?: { id: string; stationId: string; startedAt: number };
  /** Dubai hire car: lives only in the room and is collected when the hire ends. */
  hire?: { id: string; endsAt: number };
  /** Litres in an owned motor vehicle's tank, burned as it is driven; absent for bicycles and the room's own cars. */
  fuel?: number;
};

const roomColumns = `vehicle.id, vehicle.owner_user_id, vehicle.model_id, vehicle.colour, vehicle.plate,
  vehicle.condition, vehicle.x, vehicle.z, vehicle.yaw, vehicle.driver_session_id, vehicle.status, vehicle.locked, vehicle.fuel_l,
  COALESCE("user".username, "user".name) AS owner_name`;

function toRoomVehicle(row: Record<string, unknown>): RoomVehicle {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    ownerName: String(row.owner_name),
    modelId: String(row.model_id),
    colour: String(row.colour),
    plate: String(row.plate),
    condition: Number(row.condition),
    x: Number(row.x),
    z: Number(row.z),
    yaw: Number(row.yaw),
    driverSessionId: (row.driver_session_id as string | null) ?? null,
    lights: false,
    locked: row.locked !== false,
    ...(usesFuel(getVehicleModel(String(row.model_id))) ? { fuel: row.fuel_l == null ? fuelSpec(getVehicleModel(String(row.model_id))).tank : Number(row.fuel_l) } : {}),
  };
}

/** After a restart nobody is driving: park every vehicle where it was last saved. */
export async function parkAbandonedVehicles() {
  await pool.query(
    `UPDATE player_vehicle SET status = 'parked', driver_session_id = NULL, updated_at = NOW()
     WHERE status = 'driving'`,
  );
}

export async function loadStreetVehicles() {
  const result = await pool.query(
    `SELECT ${roomColumns} FROM player_vehicle vehicle JOIN "user" ON "user".id = vehicle.owner_user_id
     WHERE vehicle.status IN ('parked', 'driving')`,
  );
  return result.rows.map(toRoomVehicle);
}

/** Null when the vehicle is no longer on the street (garaged or deleted). */
export async function loadStreetVehicle(vehicleId: string) {
  const result = await pool.query(
    `SELECT ${roomColumns} FROM player_vehicle vehicle JOIN "user" ON "user".id = vehicle.owner_user_id
     WHERE vehicle.id = $1 AND vehicle.status IN ('parked', 'driving')`,
    [vehicleId],
  );
  return result.rowCount ? toRoomVehicle(result.rows[0]) : null;
}

/** Atomically hands the keys to one session; null if someone else got there first. */
export async function claimVehicle(userId: string, vehicleId: string, sessionId: string) {
  const result = await pool.query(
    `UPDATE player_vehicle SET status = 'driving', driver_session_id = $3, updated_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND status = 'parked' AND condition > 0
       AND NOT EXISTS (SELECT 1 FROM vehicle_tow WHERE vehicle_id = $1 AND stage NOT IN ('delivered', 'cancelled'))
     RETURNING condition`,
    [vehicleId, userId, sessionId],
  );
  return result.rowCount ? { condition: Number(result.rows[0].condition) } : null;
}

export async function saveDrivingVehicle(
  vehicleId: string,
  pose: { x: number; z: number; yaw: number },
  metres: number,
  park: boolean,
  fuel?: number,
) {
  await pool.query(
    `UPDATE player_vehicle
     SET x = $2, z = $3, yaw = $4, odometer_m = odometer_m + $5, updated_at = NOW(), fuel_l = COALESCE($7, fuel_l),
         status = CASE WHEN $6 THEN 'parked' ELSE status END,
         driver_session_id = CASE WHEN $6 THEN NULL ELSE driver_session_id END
     WHERE id = $1 AND status = 'driving'`,
    [vehicleId, pose.x, pose.z, pose.yaw, Math.max(0, metres), park, fuel ?? null],
  );
}

/** Lesser knocks stop at VEHICLE_RULES.minorFloor; only a severe impact can disable the car. */
export async function damageVehicle(userId: string, vehicleId: string, damage: number, speed: number, severe = false) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE player_vehicle
       SET condition = GREATEST(CASE WHEN $4 THEN 0 ELSE LEAST(condition, $5) END, condition - $3), updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 RETURNING condition, insured_until`,
      [vehicleId, userId, damage, severe, VEHICLE_RULES.minorFloor],
    );
    if (!result.rowCount) return null;
    await logEvent(client, vehicleId, userId, "impact", 0, { damage, severe, speed: Math.round(speed * 10) / 10 });
    return { condition: Number(result.rows[0].condition), insured: isInsured(result.rows[0]) };
  });
}
