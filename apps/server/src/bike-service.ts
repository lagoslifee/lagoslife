import { randomUUID } from "node:crypto";
import { BIKE_RENTAL, bikeStationById, rentalUsage } from "@lagos-living/shared";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

export type ActiveRental = { id: string; stationId: string; startedAt: number; deposit: number; x: number; z: number; yaw: number };

const toRental = (row: Record<string, unknown>): ActiveRental => ({
  id: String(row.id),
  stationId: String(row.station_from),
  startedAt: new Date(row.started_at as string).getTime(),
  deposit: Number(row.deposit),
  x: Number(row.last_x),
  z: Number(row.last_z),
  yaw: Number(row.last_yaw),
});

export async function activeRental(userId: string) {
  const result = await pool.query(`SELECT * FROM bike_rental WHERE user_id = $1 AND status = 'active'`, [userId]);
  return result.rows[0] ? toRental(result.rows[0]) : null;
}

/** Unlock fee and deposit in one transaction; the partial unique index allows one active rental per resident. */
export async function startRental(userId: string, stationId: string, idempotencyKey: string) {
  const station = bikeStationById.get(stationId);
  if (!station) throw new EconomyError("Unknown bike station", 404);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const existing = await client.query(`SELECT id FROM bike_rental WHERE user_id = $1 AND status = 'active' FOR UPDATE`, [userId]);
    if (existing.rowCount) throw new EconomyError("You already have a hired bike. Return it at any station first.", 409);
    const id = randomUUID();
    await debitWallet(client, userId, BIKE_RENTAL.unlockFee, "bike_rental", `Bike unlock · ${station.name}`, `bike-unlock:${idempotencyKey}`);
    const balance = await debitWallet(client, userId, BIKE_RENTAL.deposit, "bike_deposit", `Bike deposit · ${station.name}`, `bike-deposit:${idempotencyKey}`);
    const inserted = await client.query(
      `INSERT INTO bike_rental (id, user_id, station_from, deposit, last_x, last_z, last_yaw)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, userId, stationId, BIKE_RENTAL.deposit, station.point[0], station.point[1], station.yaw],
    );
    return { rental: toRental(inserted.rows[0]), balance };
  });
}

export async function parkRental(rentalId: string, x: number, z: number, yaw: number) {
  await pool.query(`UPDATE bike_rental SET last_x = $2, last_z = $3, last_yaw = $4 WHERE id = $1 AND status = 'active'`, [rentalId, x, z, yaw]);
}

/** Settles once: the status flip guards against double refunds. */
export async function returnRental(userId: string, rentalId: string, stationId: string, now = Date.now()) {
  return withTransaction(async (client) => {
    const ended = await client.query(
      `UPDATE bike_rental SET status = 'returned', ended_at = to_timestamp($4 / 1000.0), station_to = $3
       WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING *`,
      [rentalId, userId, stationId, now],
    );
    if (!ended.rowCount) throw new EconomyError("That hire has already been returned.", 409);
    const rental = toRental(ended.rows[0]);
    const { minutes, usage } = rentalUsage(rental.startedAt, now);
    await client.query(`UPDATE bike_rental SET usage = $2 WHERE id = $1`, [rentalId, usage]);
    const refund = rental.deposit - usage;
    const balance = refund > 0 ? await creditWallet(client, userId, refund, "deposit_refund", `Bike deposit back · ${minutes} min ride`, `bike-return:${rentalId}`) : null;
    return { minutes, usage, refund, balance };
  });
}
