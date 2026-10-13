import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { filterChat, neighbourhoodParty, OWAMBE, OWAMBE_STYLE, owambeDish, type OwambeKind, type OwambeParty } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

export const owambeEvents = new EventEmitter<{ changed: [] }>();

type BookingRow = { kind: OwambeKind; celebrant: string; host: string; starts_at: Date; ends_at: Date };

/** The party on the event ground right now: a resident's booking if one is running, otherwise the neighbourhood's. */
export async function currentOwambe(now = Date.now()): Promise<OwambeParty> {
  const { rows } = await pool.query<BookingRow>(
    `SELECT booking.kind, booking.celebrant, COALESCE("user".username, "user".name) AS host, booking.starts_at, booking.ends_at
     FROM owambe_booking booking JOIN "user" ON "user".id = booking.host_user_id
     WHERE booking.starts_at <= $1 AND booking.ends_at > $1 ORDER BY booking.starts_at DESC LIMIT 1`,
    [new Date(now)],
  );
  const row = rows[0];
  if (!row) return neighbourhoodParty(now);
  return { kind: row.kind, celebrant: row.celebrant, host: row.host, startsAt: row.starts_at.getTime(), endsAt: row.ends_at.getTime() };
}

/**
 * Books the ground for a party starting now: the host pays for the canopy, the caterers, the DJ and the MC, and every
 * guest eats on them. Only one resident party at a time.
 */
export async function hostOwambe(userId: string, input: { kind: OwambeKind; celebrant: string; idempotencyKey: string }, now = Date.now()) {
  const celebrant = filterChat(input.celebrant).text.trim();
  if (celebrant.length < 2) throw new EconomyError("Give the celebrant a name.");
  const price = OWAMBE.hostPrice[input.kind];
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`LOCK TABLE owambe_booking IN EXCLUSIVE MODE`);
    const replay = await client.query(`SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, input.idempotencyKey]);
    if (replay.rowCount) return { balance: Number(replay.rows[0].balance_after), party: await currentOwambe(now) };
    const busy = await client.query<{ ends_at: Date }>(`SELECT ends_at FROM owambe_booking WHERE ends_at > $1 ORDER BY ends_at DESC LIMIT 1`, [new Date(now)]);
    if (busy.rowCount) {
      const minutes = Math.ceil((busy.rows[0]!.ends_at.getTime() - now) / 60_000);
      throw new EconomyError(`The ground is booked for another ${minutes} minute${minutes === 1 ? "" : "s"}.`, 409);
    }
    const style = OWAMBE_STYLE[input.kind];
    const balance = await debitWallet(client, userId, price, "owambe_food", `Owambe · ${style.label} for ${celebrant}`, input.idempotencyKey, { kind: input.kind });
    await client.query(
      `INSERT INTO owambe_booking (id, host_user_id, kind, celebrant, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, input.kind, celebrant, new Date(now), new Date(now + OWAMBE.partyMs)],
    );
    const host = await client.query<{ host: string }>(`SELECT COALESCE(username, name) AS host FROM "user" WHERE id = $1`, [userId]);
    return { balance, party: { kind: input.kind, celebrant, host: host.rows[0]?.host ?? "A resident", startsAt: now, endsAt: now + OWAMBE.partyMs } satisfies OwambeParty };
  }).then((result) => {
    owambeEvents.emit("changed");
    return result;
  });
}

/**
 * A plate served at the table: free to the guest, and good for a few minutes of hunger and a little energy. Returns
 * how long until the next plate when it's too soon.
 */
export async function servePlate(userId: string, dishId: string, now = Date.now()) {
  const dish = owambeDish(dishId);
  if (!dish) throw new EconomyError("The caterers don't have that.", 404);
  return withTransaction(async (client) => {
    await client.query(`SELECT 1 FROM player_profile WHERE user_id = $1 FOR UPDATE`, [userId]);
    const last = await client.query<{ eaten_at: Date }>(`SELECT eaten_at FROM owambe_plate WHERE user_id = $1 ORDER BY eaten_at DESC LIMIT 1`, [userId]);
    const wait = last.rowCount ? last.rows[0]!.eaten_at.getTime() + OWAMBE.plateEveryMs - now : 0;
    if (wait > 0) return { served: false as const, wait };
    await client.query(`INSERT INTO owambe_plate (user_id, dish, eaten_at) VALUES ($1, $2, $3)`, [userId, dish.id, new Date(now)]);
    const profile = await client.query<{ hunger: number; energy: number }>(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, OWAMBE.hunger, OWAMBE.energy],
    );
    return { served: true as const, hunger: profile.rows[0]?.hunger ?? null, energy: profile.rows[0]?.energy ?? null };
  });
}
