import { ensureWallet, creditWallet, debitWallet, withTransaction } from "./economy-service.js";

/** A resident's stake into a street football pot; one per match, so a retried join never pays twice. */
export async function payMatchStake(userId: string, matchId: string, amount: number, pitch: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const paid = await client.query(`SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `match:${matchId}`]);
    if (paid.rowCount) return Number(paid.rows[0].balance_after);
    return debitWallet(client, userId, amount, "match_stake", `Street football stake · ${pitch}`, `match:${matchId}`, { matchId });
  });
}

/** Pays a winner's share of the pot, or gives a stake back after a draw or an abandoned match. */
export async function payMatchOut(userId: string, matchId: string, amount: number, kind: "match_win" | "match_refund", label: string) {
  if (amount <= 0) return null;
  return withTransaction(async (client) => {
    const key = `match:${matchId}:${kind}`;
    const done = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, key]);
    if (done.rowCount) return null;
    return creditWallet(client, userId, amount, kind, label, key);
  });
}
