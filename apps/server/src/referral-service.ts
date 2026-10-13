import { REFERRAL, type ReferralStatus } from "@lagos-living/shared";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { creditWallet, EconomyError, ensureProfile, ensureWallet, withTransaction } from "./economy-service.js";
import { playerEvents } from "./player-events.js";

const money = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

export async function referralStatus(userId: string): Promise<ReferralStatus> {
  await ensureProfile(pool, userId);
  const { rows } = await pool.query<{ code: string | null; created: Date; referred_by: string | null; referrer: string | null; paid_at: Date | null; invited: string; paid: string; earned: string }>(
    `SELECT u.username AS code, u."createdAt" AS created, p.referred_by, r.username AS referrer, p.referral_paid_at AS paid_at,
            (SELECT COUNT(*) FROM player_profile WHERE referred_by = u.id) AS invited,
            (SELECT COUNT(*) FROM player_profile WHERE referred_by = u.id AND referral_paid_at IS NOT NULL) AS paid,
            (SELECT COALESCE(SUM(amount), 0) FROM game_transaction WHERE user_id = u.id AND kind = 'referral_bonus') AS earned
     FROM "user" u JOIN player_profile p ON p.user_id = u.id LEFT JOIN "user" r ON r.id = p.referred_by
     WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new EconomyError("No such resident.", 404);
  const fresh = Date.now() - row.created.getTime() < REFERRAL.claimWindowHours * 3_600_000;
  return {
    code: row.code ?? "",
    invited: Number(row.invited),
    paid: Number(row.paid),
    earned: Number(row.earned),
    referredBy: row.referrer,
    bonusPending: Boolean(row.referred_by && !row.paid_at),
    canClaim: !row.referred_by && fresh && Boolean(row.code),
  };
}

/** Records who invited a brand-new account; the bonus itself waits for the newcomer's first paid job. */
export async function claimReferral(userId: string, code: string) {
  const clean = code.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(clean)) throw new EconomyError("That invite code doesn't look right.", 400);
  return withTransaction(async (client) => {
    await ensureProfile(client, userId);
    const me = await client.query<{ created: Date; username: string | null; referred_by: string | null }>(
      `SELECT u."createdAt" AS created, u.username, p.referred_by FROM "user" u JOIN player_profile p ON p.user_id = u.id WHERE u.id = $1 FOR UPDATE OF p`,
      [userId],
    );
    const row = me.rows[0];
    if (!row?.username) throw new EconomyError("Create a full account to use an invite.", 409);
    if (row.referred_by) throw new EconomyError("You already joined with an invite.", 409);
    if (Date.now() - row.created.getTime() > REFERRAL.claimWindowHours * 3_600_000) {
      throw new EconomyError(`Invites only count within ${REFERRAL.claimWindowHours} hours of signing up.`, 409);
    }
    const inviter = await client.query<{ id: string; username: string }>(`SELECT id, username FROM "user" WHERE LOWER(username) = LOWER($1)`, [clean]);
    const referrer = inviter.rows[0];
    if (!referrer) throw new EconomyError("No resident has that invite code.", 404);
    if (referrer.id === userId) throw new EconomyError("You can't invite yourself.", 409);
    await client.query(`UPDATE player_profile SET referred_by = $2, updated_at = NOW() WHERE user_id = $1`, [userId, referrer.id]);
    playerEvents.emit("notice", referrer.id, "info", `🎁 ${row.username} joined with your invite. You both get paid when they finish their first job.`);
    return { referredBy: referrer.username, bonus: REFERRAL.newcomerBonus };
  });
}

/** Called inside a job payout's transaction so the bonus lands exactly once, alongside the first earned naira. */
export async function payReferralIfDue(client: PoolClient, userId: string) {
  const due = await client.query<{ referred_by: string }>(
    `SELECT referred_by FROM player_profile WHERE user_id = $1 AND referred_by IS NOT NULL AND referral_paid_at IS NULL FOR UPDATE`,
    [userId],
  );
  const referrerId = due.rows[0]?.referred_by;
  if (!referrerId) return null;
  await client.query(`UPDATE player_profile SET referral_paid_at = NOW() WHERE user_id = $1`, [userId]);
  await creditWallet(client, userId, REFERRAL.newcomerBonus, "referral_bonus", "Welcome bonus · joined with an invite", `referral:new:${userId}`);
  const paid = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM player_profile WHERE referred_by = $1 AND referral_paid_at IS NOT NULL AND user_id <> $2`,
    [referrerId, userId],
  );
  const names = await client.query<{ id: string; username: string | null }>(`SELECT id, username FROM "user" WHERE id = ANY($1)`, [[userId, referrerId]]);
  const newcomer = names.rows.find((entry) => entry.id === userId)?.username ?? "Your friend";
  let referrerPaid = false;
  if (Number(paid.rows[0]?.n ?? 0) < REFERRAL.maxPaidInvites) {
    await ensureWallet(client, referrerId);
    await creditWallet(client, referrerId, REFERRAL.referrerBonus, "referral_bonus", `Invite bonus · ${newcomer} finished their first job`, `referral:ref:${userId}`);
    referrerPaid = true;
  }
  const notify = () => {
    playerEvents.emit("notice", userId, "success", `🎁 Invite bonus: +${money(REFERRAL.newcomerBonus)} for finishing your first job.`);
    if (referrerPaid) playerEvents.emit("notice", referrerId, "success", `🎁 ${newcomer} finished their first job: +${money(REFERRAL.referrerBonus)} invite bonus.`);
  };
  return { bonus: REFERRAL.newcomerBonus, notify };
}
