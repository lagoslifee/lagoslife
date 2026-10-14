import { randomInt, randomUUID } from "node:crypto";
import { AIRCRAFT_RULES, aircraftById, type AircraftModel, type OwnedAircraft } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

type Row = { id: string; model_id: string; tail: string; created_at: Date };
const owned = (row: Row): OwnedAircraft => ({ id: row.id, modelId: row.model_id, tail: row.tail, boughtAt: row.created_at.toISOString() });

export async function hangar(userId: string) {
  const { rows } = await pool.query<Row>(`SELECT id, model_id, tail, created_at FROM aircraft WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return rows.map(owned);
}

/** Nigerian civil registrations are 5N- and three letters. */
function tailNumber() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `5N-${Array.from({ length: 3 }, () => letters[randomInt(letters.length)]).join("")}`;
}

export async function buyAircraft(userId: string, modelId: string, idempotencyKey: string) {
  const model = aircraftById.get(modelId);
  if (!model) throw new EconomyError("That aircraft isn't for sale.", 404);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query<Row>(`SELECT id, model_id, tail, created_at FROM aircraft WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rows[0]) return { aircraft: owned(replay.rows[0]), replayed: true };
    const count = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM aircraft WHERE user_id = $1`, [userId]);
    if (Number(count.rows[0]?.count ?? 0) >= AIRCRAFT_RULES.maxOwned) throw new EconomyError(`Your hangar holds ${AIRCRAFT_RULES.maxOwned} aircraft. That's the limit.`, 409);
    const id = randomUUID();
    let tail = tailNumber();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await client.query(`SELECT 1 FROM aircraft WHERE tail = $1`, [tail]);
      if (!clash.rowCount) break;
      tail = tailNumber();
    }
    await debitWallet(client, userId, model.price, "aircraft_purchase", `${model.name} · ${tail}`, `aircraft:${idempotencyKey}`, { modelId });
    const { rows } = await client.query<Row>(
      `INSERT INTO aircraft (id, user_id, model_id, tail, price, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, model_id, tail, created_at`,
      [id, userId, model.id, tail, model.price, idempotencyKey],
    );
    return { aircraft: owned(rows[0]!), replayed: false };
  });
}

/** The resident's own aircraft of this kind, or a reason they can't use it. */
export async function ownAircraft(userId: string, aircraftId: string, kind: AircraftModel["kind"]) {
  const { rows } = await pool.query<Row>(`SELECT id, model_id, tail, created_at FROM aircraft WHERE id = $1 AND user_id = $2`, [aircraftId, userId]);
  const row = rows[0];
  const model = row ? aircraftById.get(row.model_id) : undefined;
  if (!row || !model) throw new EconomyError("That aircraft isn't in your hangar.", 404);
  if (model.kind !== kind) throw new EconomyError(kind === "jet" ? "Only a jet can fly you to another country." : "Jets need a runway; a helicopter does the city hops.", 409);
  return { aircraft: owned(row), model };
}

/** Fuel, pilot and landing fees for one helicopter hop. */
export async function payHop(userId: string, aircraftId: string, destination: string) {
  const { aircraft, model } = await ownAircraft(userId, aircraftId, "helicopter");
  return withTransaction(async (client) => {
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const balance = await debitWallet(client, userId, model.tripCost, "aircraft_trip", `${model.name} ${aircraft.tail} · hop to ${destination}`, `hop:${randomUUID()}`, { aircraftId });
    return { balance, model, aircraft };
  });
}
