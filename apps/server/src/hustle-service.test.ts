import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUSTLE_FUND, hourlyIncome, loanLimit, loanOwed, STORY_CHAPTERS } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { borrow, claimChapter, hustleStatus, repay } = await import("./hustle-service.js");
const { businessStatus, collectBusiness, startBusiness } = await import("./business-service.js");

const user = { id: `hustle-${randomUUID()}`, username: `hu${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const START = 100_000;
const balance = async () => Number((await pool.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id])).rows[0]!.balance);

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Hustle Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("Eko Hustle Fund and the storyline", () => {
  it("pays a starter loan once per key, within the first limit, and only one at a time", async () => {
    await expect(borrow(user.id, HUSTLE_FUND.firstLimit + 1, randomUUID())).rejects.toThrow(/between/);
    const key = randomUUID();
    const [first, again] = await Promise.all([borrow(user.id, 400_000, key), borrow(user.id, 400_000, key)]);
    expect(first.loan?.remaining).toBe(loanOwed(400_000));
    expect(again.loan?.id).toBe(first.loan?.id);
    expect(await balance()).toBe(START + 400_000);
    await expect(borrow(user.id, 50_000, randomUUID())).rejects.toThrow(/Pay off/);
  });

  it("takes the fund's share of business takings towards the loan", async () => {
    await startBusiness(user.id, "pos-kiosk", "Starter POS", randomUUID());
    const { businesses } = await businessStatus(user.id);
    await pool.query(`UPDATE player_business SET collected_at = NOW() - INTERVAL '2 hours' WHERE user_id = $1`, [user.id]);
    const before = await balance();
    const { collected } = await collectBusiness(user.id, businesses[0]!.id);
    expect(collected).toBe(hourlyIncome("pos-kiosk", 1, false) * 2);
    const cut = Math.floor(collected * HUSTLE_FUND.takingsShare);
    expect(await balance()).toBe(before + collected - cut);
    expect((await hustleStatus(user.id)).loan?.remaining).toBe(loanOwed(400_000) - cut);
  });

  it("pays off in full, never below zero, and a quick turnaround doesn't raise the limit", async () => {
    const owed = (await hustleStatus(user.id)).loan!.remaining;
    await pool.query(`UPDATE wallet SET balance = 1000 WHERE user_id = $1`, [user.id]);
    const partial = await repay(user.id, undefined, randomUUID());
    expect(partial.loan?.remaining).toBe(owed - 1000);
    expect(await balance()).toBe(0);
    await pool.query(`UPDATE wallet SET balance = 2000000 WHERE user_id = $1`, [user.id]);
    const done = await repay(user.id, undefined, randomUUID());
    expect(done.loan).toBeNull();
    expect(done.limit).toBe(HUSTLE_FUND.firstLimit);
    await pool.query(`UPDATE hustle_loan SET created_at = created_at - INTERVAL '1 day' WHERE user_id = $1`, [user.id]);
    expect((await hustleStatus(user.id)).limit).toBe(loanLimit(1));
  });

  it("pays each finished chapter's bonus once and refuses unfinished ones", async () => {
    const before = await balance();
    const fresh = STORY_CHAPTERS.find((chapter) => chapter.id === "fresh")!;
    await Promise.all([claimChapter(user.id, "fresh"), claimChapter(user.id, "fresh")]);
    expect(await balance()).toBe(before + fresh.reward);
    await claimChapter(user.id, "clean-slate");
    await expect(claimChapter(user.id, "moving")).rejects.toThrow(/Finish/);
    const status = await hustleStatus(user.id);
    expect(status.chapters.filter((chapter) => chapter.claimed).map((chapter) => chapter.id)).toEqual(["fresh", "clean-slate"]);
  });
});
