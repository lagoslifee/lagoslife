import { VIEWING, placeById, viewingLocation, viewingMenuById, type ViewingStatus } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, withTransaction } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";

const passKey = (placeId: string) => `viewing:${placeId}:`;

/** When the player's current pass for this viewing centre runs out, or null without one. */
export async function viewingPassUntil(userId: string, placeId: string = VIEWING.placeId) {
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM game_transaction
      WHERE user_id = $1 AND kind = 'venue_entry' AND idempotency_key LIKE $2 AND created_at > NOW() - make_interval(mins => $3)
      ORDER BY created_at DESC LIMIT 1`,
    [userId, `${passKey(placeId)}%`, VIEWING.passMinutes],
  );
  return rows[0] ? new Date(rows[0].created_at.getTime() + VIEWING.passMinutes * 60_000) : null;
}

export async function viewingStatus(userId: string, placeId: string = VIEWING.placeId): Promise<ViewingStatus> {
  const until = await viewingPassUntil(userId, placeId);
  return { placeId, fee: VIEWING.entryFee, passUntil: until?.toISOString() ?? null };
}

/** Pays the door fee for an hour of football. A pass that is still running is kept, not charged again. */
export async function buyViewingPass(userId: string, placeId: string) {
  const place = placeById.get(placeId);
  if (!place || place.kind !== "viewing") throw new EconomyError("That isn't a viewing centre.", 404);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const live = await client.query(
      `SELECT 1 FROM game_transaction WHERE user_id = $1 AND kind = 'venue_entry' AND idempotency_key LIKE $2 AND created_at > NOW() - make_interval(mins => $3)`,
      [userId, `${passKey(placeId)}%`, VIEWING.passMinutes],
    );
    const charged = live.rowCount ? 0 : VIEWING.entryFee;
    if (charged) await debitWallet(client, userId, charged, "venue_entry", `${place.name} · ${VIEWING.passMinutes}-minute pass`, `${passKey(placeId)}${Date.now()}`);
    const balance = Number((await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]!.balance);
    return { charged, balance };
  }).then(async (result) => ({ ...result, status: await viewingStatus(userId, placeId) }));
}

/** A drink or snack from the kiosk, for someone inside the hall; the client sends the waiter over with it. */
export async function orderAtViewing(userId: string, placeId: string, itemId: string, idempotencyKey: string) {
  const place = placeById.get(placeId);
  if (!place || place.kind !== "viewing") throw new EconomyError("That isn't a viewing centre.", 404);
  const item = viewingMenuById.get(itemId);
  if (!item) throw new EconomyError("The kiosk doesn't sell that.", 404);
  if (getPlayerPosition(userId)?.location !== viewingLocation(placeId)) throw new EconomyError("Go inside the viewing centre to order.", 409);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await ensureProfile(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT 1 FROM club_order WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) {
      const [wallet, profile] = await Promise.all([
        client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]),
        client.query(`SELECT hunger, energy FROM player_profile WHERE user_id = $1`, [userId]),
      ]);
      return { replayed: true, item, balance: Number(wallet.rows[0].balance), needs: { hunger: Number(profile.rows[0].hunger), energy: Number(profile.rows[0].energy) } };
    }
    const balance = await debitWallet(client, userId, item.price, "club_order", `${item.name} · ${place.name}`, idempotencyKey, { placeId, itemId });
    await client.query(
      `INSERT INTO club_order (id, user_id, place_id, item_id, price, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, placeId, item.id, item.price, idempotencyKey],
    );
    const updated = await client.query(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW()
       WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, item.hunger, item.energy],
    );
    return { replayed: false, item, balance, needs: { hunger: Number(updated.rows[0].hunger), energy: Number(updated.rows[0].energy) } };
  });
}
