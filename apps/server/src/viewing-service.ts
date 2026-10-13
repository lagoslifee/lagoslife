import { VIEWING, placeById, type ViewingStatus } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

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
