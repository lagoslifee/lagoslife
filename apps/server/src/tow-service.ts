import { getPlace, getVehicleModel, VEHICLE_RULES, type TowDestination, type TowQuote, type TowStage } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import { vehicleEvents } from "./vehicle-events.js";
import {
  freeKerbSlot,
  GARAGE_CAPACITY,
  isInsured,
  logEvent,
  MECHANIC_ID,
  propertySpot,
  serviceQuote,
  vehicleColumns,
  type VehicleRow,
} from "./vehicle-service.js";

export type TowJobRow = {
  id: string;
  vehicleId: string;
  userId: string;
  stage: TowStage;
  destination: TowDestination;
  quote: TowQuote;
  from: [number, number];
  collectedAt: number | null;
  vehicle: { modelId: string; colour: string; plate: string; modelName: string };
};

const toJob = (row: Record<string, unknown>): TowJobRow => {
  const towFee = Number(row.tow_fee);
  const repair = Number(row.repair);
  const fullRepair = Number(row.full_repair);
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    userId: String(row.user_id),
    stage: row.stage as TowStage,
    destination: row.destination === "home" ? { kind: "home", propertyId: String(row.property_id) } : { kind: "here" },
    quote: { towFee, repair, fullRepair, insurer: fullRepair - repair, total: Number(row.charged) },
    from: [Number(row.from_x), Number(row.from_z)],
    collectedAt: row.collected_at ? new Date(row.collected_at as string).getTime() : null,
    vehicle: {
      modelId: String(row.model_id),
      colour: String(row.colour),
      plate: String(row.plate),
      modelName: getVehicleModel(String(row.model_id)).name,
    },
  };
};

const jobSelect = `SELECT tow.*, vehicle.model_id, vehicle.colour, vehicle.plate
  FROM vehicle_tow tow JOIN player_vehicle vehicle ON vehicle.id = tow.vehicle_id`;

/** Repair is charged up front with the tow; cover pays everything above the excess and the tow itself. */
export function towQuote(row: VehicleRow): TowQuote {
  const { repair, fullRepair } = serviceQuote(row);
  const towFee = isInsured(row) ? 0 : VEHICLE_RULES.towFee;
  return { towFee, repair, fullRepair, insurer: fullRepair - repair, total: towFee + repair };
}

export async function activeTows() {
  const result = await pool.query(`${jobSelect} WHERE tow.stage NOT IN ('delivered', 'cancelled')`);
  return result.rows.map(toJob);
}

async function holdsHome(client: PoolClient, userId: string, propertyId: string) {
  const held = await client.query(
    `SELECT 1 FROM property_tenure WHERE property_id = $1 AND owner_user_id = $2 AND (expires_at IS NULL OR expires_at > NOW())`,
    [propertyId, userId],
  );
  return Boolean(held.rowCount);
}

/**
 * One charge, one job: a replayed key returns the existing job, and the partial unique index refuses a
 * second active tow for the same car.
 */
export async function requestTow(userId: string, vehicleId: string, destination: TowDestination, idempotencyKey: string, expressFee = 0) {
  const job = await withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`${jobSelect} WHERE tow.user_id = $1 AND tow.idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { job: toJob(replay.rows[0]), replayed: true };
    const locked = await client.query<VehicleRow>(
      `SELECT ${vehicleColumns} FROM player_vehicle WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`,
      [vehicleId, userId],
    );
    const row = locked.rows[0];
    if (!row) throw new EconomyError("That vehicle is not yours", 404);
    if (getVehicleModel(row.model_id).body === "bicycle") throw new EconomyError("Bicycles are not towed. Wheel it to the mechanic.", 409);
    if (row.status === "garaged") throw new EconomyError("It is in your garage. Take it out first.", 409);
    if (row.status === "towing") throw new EconomyError("Ade Recovery already has this car.", 409);
    const active = await client.query(`SELECT 1 FROM vehicle_tow WHERE vehicle_id = $1 AND stage NOT IN ('delivered', 'cancelled')`, [vehicleId]);
    if (active.rowCount) throw new EconomyError("A recovery truck is already on its way for this car.", 409);
    if (destination.kind === "home" && !(await holdsHome(client, userId, destination.propertyId))) {
      throw new EconomyError("You can only send it to a home you rent or own.", 403);
    }
    const quote = towQuote(row);
    const id = randomUUID();
    const charged = quote.total + expressFee;
    await debitWallet(client, userId, charged, "vehicle_tow", `${expressFee ? "Express tow" : "Tow"} & repair · ${row.plate}`, idempotencyKey, { vehicleId, towId: id, ...quote, expressFee });
    const inserted = await client.query(
      `INSERT INTO vehicle_tow (id, vehicle_id, user_id, stage, destination, property_id, tow_fee, repair, full_repair, charged, idempotency_key, from_x, from_z)
       VALUES ($1, $2, $3, 'arriving', $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        id, vehicleId, userId, destination.kind, destination.kind === "home" ? destination.propertyId : null,
        quote.towFee, quote.repair, quote.fullRepair, charged, idempotencyKey, Number(row.x), Number(row.z),
      ],
    );
    await logEvent(client, vehicleId, userId, "tow", charged, { towId: id, destination: destination.kind, express: expressFee > 0 });
    return { job: toJob({ ...inserted.rows[0], model_id: row.model_id, colour: row.colour, plate: row.plate }), replayed: false };
  });
  return job;
}

export async function setTowStage(towId: string, stage: TowStage) {
  await pool.query(`UPDATE vehicle_tow SET stage = $2 WHERE id = $1 AND stage NOT IN ('delivered', 'cancelled')`, [towId, stage]);
}

/** The car leaves the street onto the truck bed. */
export async function collectTow(towId: string) {
  return withTransaction(async (client) => {
    const tow = await client.query(
      `UPDATE vehicle_tow SET stage = 'collected', collected_at = NOW() WHERE id = $1 AND stage IN ('arriving', 'loading') RETURNING vehicle_id`,
      [towId],
    );
    if (!tow.rowCount) return false;
    await client.query(
      `UPDATE player_vehicle SET status = 'towing', driver_session_id = NULL, updated_at = NOW() WHERE id = $1`,
      [tow.rows[0].vehicle_id],
    );
    return true;
  });
}

/** Refunds in full; only before the car is collected. */
export async function cancelTow(towId: string, userId: string, reason: string) {
  const result = await withTransaction(async (client) => {
    const tow = await client.query(
      `UPDATE vehicle_tow SET stage = 'cancelled', ended_at = NOW(), note = $3
       WHERE id = $1 AND user_id = $2 AND stage IN ('requested', 'arriving', 'loading') RETURNING *`,
      [towId, userId, reason],
    );
    if (!tow.rowCount) return null;
    const charged = Number(tow.rows[0].charged);
    if (charged > 0) await creditWallet(client, userId, charged, "tow_refund", "Tow cancelled · refund", `tow-refund:${towId}`);
    return { refunded: charged };
  });
  return result;
}

export type DeliverySpot = { kind: "kerb"; x: number; z: number; yaw: number } | { kind: "garage"; propertyId: string };

/** Home: a free kerb slot outside, else the garage if it has room. Null when neither is available. */
export async function homeDelivery(userId: string, propertyId: string, vehicleId: string): Promise<{ spot: DeliverySpot; name: string } | null> {
  const client = await pool.connect();
  try {
    if (!(await holdsHome(client, userId, propertyId))) return null;
    const place = await propertySpot(client, propertyId);
    const slot = await freeKerbSlot(client, place, vehicleId);
    if (slot.x !== place.kerb[0] || slot.z !== place.kerb[1]) return { spot: { kind: "kerb", ...slot }, name: place.name };
    const used = await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM player_vehicle WHERE status = 'garaged' AND garage_property_id = $1`,
      [propertyId],
    );
    if (used.rows[0].count < GARAGE_CAPACITY) return { spot: { kind: "garage", propertyId }, name: place.name };
    return { spot: { kind: "kerb", ...slot }, name: place.name };
  } finally {
    client.release();
  }
}

/** Last resort: a free kerb slot outside Ade Auto Works. */
export async function mechanicDelivery(vehicleId: string): Promise<DeliverySpot> {
  const client = await pool.connect();
  try {
    return { kind: "kerb", ...(await freeKerbSlot(client, getPlace(MECHANIC_ID), vehicleId)) };
  } finally {
    client.release();
  }
}

/** First held home, for fallbacks when the chosen spot is unusable. */
export async function firstHome(userId: string) {
  const result = await pool.query(
    `SELECT property_id FROM property_tenure WHERE owner_user_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY property_id LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? String(result.rows[0].property_id) : null;
}

/** Repaired, serviced and put back: same row, so plate, colour, odometer and ownership are untouched. */
export async function deliverTow(towId: string, spot: DeliverySpot, note: string | null) {
  const delivered = await withTransaction(async (client) => {
    const tow = await client.query(
      `UPDATE vehicle_tow SET stage = 'delivered', ended_at = NOW(), note = $2,
         delivered_x = $3, delivered_z = $4
       WHERE id = $1 AND stage NOT IN ('delivered', 'cancelled') RETURNING vehicle_id, user_id, full_repair`,
      [towId, note, spot.kind === "kerb" ? spot.x : null, spot.kind === "kerb" ? spot.z : null],
    );
    if (!tow.rowCount) return null;
    const { vehicle_id: vehicleId, user_id: userId } = tow.rows[0];
    if (spot.kind === "kerb") {
      await client.query(
        `UPDATE player_vehicle SET status = 'parked', garage_property_id = NULL, driver_session_id = NULL, x = $2, z = $3, yaw = $4,
           condition = 100, service_odometer_m = odometer_m, updated_at = NOW()
         WHERE id = $1`,
        [vehicleId, spot.x, spot.z, spot.yaw],
      );
    } else {
      await client.query(
        `UPDATE player_vehicle SET status = 'garaged', garage_property_id = $2, driver_session_id = NULL,
           condition = 100, service_odometer_m = odometer_m, updated_at = NOW()
         WHERE id = $1`,
        [vehicleId, spot.propertyId],
      );
    }
    await logEvent(client, vehicleId, userId, "repair", 0, { towId, fullRepair: Number(tow.rows[0].full_repair) });
    return String(vehicleId);
  });
  if (delivered) vehicleEvents.emit("changed", delivered);
  return delivered;
}
