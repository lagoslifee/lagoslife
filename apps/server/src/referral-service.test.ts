import { randomUUID } from "node:crypto";
import { REFERRAL } from "@lagos-living/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { pool } = await import("./database.js");
const { ensureWallet, withTransaction } = await import("./economy-service.js");
const { claimReferral, payReferralIfDue, referralStatus } = await import("./referral-service.js");

const make = (age = "0 hours") => ({ id: `ref-${randomUUID()}`, username: `ref${randomUUID().replaceAll("-", "").slice(0, 12)}`, age });
const host = make("30 days");
const newcomer = make();
const veteran = make("10 days");

const balance = async (userId: string) => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);

beforeAll(async () => {
  for (const user of [host, newcomer, veteran]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Referral Test', $2, FALSE, NOW() - $4::interval, NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username, user.age],
    );
    await withTransaction((client) => ensureWallet(client, user.id));
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM game_transaction WHERE user_id = ANY($1::text[])`, [[host.id, newcomer.id, veteran.id]]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[host.id, newcomer.id, veteran.id]]);
});

describe("referrals", () => {
  it("records the inviter once and only for new accounts", async () => {
    await expect(claimReferral(newcomer.id, newcomer.username)).rejects.toThrow(/yourself/);
    await expect(claimReferral(newcomer.id, "nobody_here_123")).rejects.toThrow(/No resident/);
    await expect(claimReferral(veteran.id, host.username)).rejects.toThrow(/within/);
    expect((await referralStatus(newcomer.id)).canClaim).toBe(true);
    const claimed = await claimReferral(newcomer.id, `@${host.username.toUpperCase()}`);
    expect(claimed.referredBy).toBe(host.username);
    await expect(claimReferral(newcomer.id, host.username)).rejects.toThrow(/already/);
    expect(await referralStatus(newcomer.id)).toMatchObject({ referredBy: host.username, bonusPending: true, canClaim: false });
    expect(await referralStatus(host.id)).toMatchObject({ code: host.username, invited: 1, paid: 0, earned: 0 });
  });

  it("pays both residents exactly once when the newcomer finishes a job", async () => {
    const before = [await balance(host.id), await balance(newcomer.id)] as const;
    const first = await withTransaction((client) => payReferralIfDue(client, newcomer.id));
    expect(first?.bonus).toBe(REFERRAL.newcomerBonus);
    const again = await withTransaction((client) => payReferralIfDue(client, newcomer.id));
    expect(again).toBeNull();
    expect(await balance(host.id)).toBe(before[0] + REFERRAL.referrerBonus);
    expect(await balance(newcomer.id)).toBe(before[1] + REFERRAL.newcomerBonus);
    expect(await referralStatus(host.id)).toMatchObject({ invited: 1, paid: 1, earned: REFERRAL.referrerBonus });
    expect((await referralStatus(newcomer.id)).bonusPending).toBe(false);
  });

  it("does nothing for residents who joined without an invite", async () => {
    expect(await withTransaction((client) => payReferralIfDue(client, veteran.id))).toBeNull();
  });
});
