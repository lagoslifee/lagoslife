import { randomUUID } from "node:crypto";
import { FOOTBALL_ROUND_MS, footballRound, matchResult, pickOf, SPIN_ROUND_MS, spinRound } from "@lagos-living/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { pool } = await import("./database.js");
const { betFootball, betSpin, bettingStatus, claimDaily, dailyStatus, fixturesFor, fortune, marketStatus, spinResult, splitCabFare, sprayMoney, trade, transferMoney } = await import("./finance-service.js");

const make = () => ({ id: `fin-${randomUUID()}`, username: `fin${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const alice = make();
const bob = make();
const balance = async (userId: string) => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]?.balance ?? 0);

beforeAll(async () => {
  for (const user of [alice, bob]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Finance Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, 1000000) ON CONFLICT (user_id) DO UPDATE SET balance = 1000000`, [user.id]);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[alice.id, bob.id]]);
});

describe("daily bonus", () => {
  it("pays once per Lagos day and grows the streak on consecutive days", async () => {
    const day1 = Date.UTC(2030, 0, 1, 12);
    const first = await claimDaily(alice.id, day1);
    expect(first).toMatchObject({ streak: 1, amount: 5_000 });
    await expect(claimDaily(alice.id, day1 + 3_600_000)).rejects.toThrow(/already collected/);
    expect((await dailyStatus(alice.id, day1)).claimedToday).toBe(true);
    const second = await claimDaily(alice.id, day1 + 24 * 3_600_000);
    expect(second).toMatchObject({ streak: 2, amount: 10_000 });
    const afterGap = await dailyStatus(alice.id, day1 + 4 * 24 * 3_600_000);
    expect(afterGap).toMatchObject({ streak: 0, nextStreak: 1, claimedToday: false });
  });
});

describe("transfers", () => {
  it("moves money once per idempotency key and refuses unknown names", async () => {
    const [a0, b0] = [await balance(alice.id), await balance(bob.id)];
    const key = randomUUID();
    await transferMoney(alice.id, { userName: bob.username.toUpperCase(), amount: 25_000, note: "fuel", idempotencyKey: key });
    const replay = await transferMoney(alice.id, { userName: bob.username, amount: 25_000, note: "fuel", idempotencyKey: key });
    expect(replay.replayed).toBe(true);
    expect(await balance(alice.id)).toBe(a0 - 25_000);
    expect(await balance(bob.id)).toBe(b0 + 25_000);
    await expect(transferMoney(alice.id, { userName: "nobody-by-this-name", amount: 500, note: "", idempotencyKey: randomUUID() })).rejects.toThrow(/No resident/);
    await expect(transferMoney(alice.id, { userName: alice.username, amount: 500, note: "", idempotencyKey: randomUUID() })).rejects.toThrow(/yourself/);
  });
});

describe("shared cab", () => {
  it("moves half the fare from the guest to the host once per ride", async () => {
    const [a0, b0] = [await balance(alice.id), await balance(bob.id)];
    const rideId = randomUUID();
    await splitCabFare(alice.id, bob.id, 1_500, rideId, "Bob", "Alice");
    await expect(splitCabFare(alice.id, bob.id, 1_500, rideId, "Bob", "Alice")).rejects.toThrow(/already sharing/);
    expect(await balance(alice.id)).toBe(a0 + 1_500);
    expect(await balance(bob.id)).toBe(b0 - 1_500);
  });
});

describe("spraying money", () => {
  it("debits the sprayer once per key", async () => {
    const start = await balance(bob.id);
    const key = randomUUID();
    await sprayMoney(bob.id, 5_000, key);
    expect((await sprayMoney(bob.id, 5_000, key)).replayed).toBe(true);
    expect(await balance(bob.id)).toBe(start - 5_000);
  });
});

describe("market", () => {
  it("buys and sells at the shared price, keeping the fee", async () => {
    const now = Date.UTC(2030, 2, 3, 10, 15);
    const start = await balance(alice.id);
    const bought = await trade(alice.id, { assetId: "btc", side: "buy", amount: 200_000, idempotencyKey: randomUUID() }, now);
    expect(bought.units).toBeGreaterThan(0);
    const status = await marketStatus(alice.id, now);
    expect(status.holdings.find((holding) => holding.assetId === "btc")?.invested).toBe(200_000);
    const sold = await trade(alice.id, { assetId: "btc", side: "sell", amount: "all", idempotencyKey: randomUUID() }, now);
    expect(sold.naira).toBeLessThan(200_000);
    expect(sold.naira).toBeGreaterThan(197_000);
    expect(await balance(alice.id)).toBe(start - 200_000 + sold.naira);
    await expect(trade(alice.id, { assetId: "btc", side: "sell", amount: "all", idempotencyKey: randomUUID() }, now)).rejects.toThrow(/don't hold/);
  });
});

describe("betting", () => {
  it("settles a spin with the round's shared result", async () => {
    const placedAt = Date.UTC(2030, 4, 1, 9, 0, 1);
    const start = await balance(bob.id);
    const placed = await betSpin(bob.id, { stake: 1_000, idempotencyKey: randomUUID() }, placedAt);
    expect(placed.round).toBe(spinRound(placedAt));
    const status = await bettingStatus(bob.id, placed.stopsAt + 1);
    const bet = status.bets.find((entry) => entry.game === "spin")!;
    const multiplier = spinResult(placed.round);
    expect(bet.status).toBe(multiplier > 0 ? "won" : "lost");
    expect(await balance(bob.id)).toBe(start - 1_000 + Math.floor(1_000 * multiplier));
    expect(SPIN_ROUND_MS).toBe(20_000);
  });

  it("only takes football bets on the next round and pays the fixture's real result", async () => {
    const now = Date.UTC(2030, 4, 1, 9, 3);
    const next = footballRound(now) + 1;
    const fixture = fixturesFor(next)[0]!;
    const winner = pickOf(matchResult(fixture, fortune));
    const start = await balance(bob.id);
    await betFootball(bob.id, { fixtureId: fixture.id, pick: winner, stake: 2_000, idempotencyKey: randomUUID() }, now);
    const live = fixturesFor(footballRound(now))[0]!;
    await expect(betFootball(bob.id, { fixtureId: live.id, pick: "home", stake: 2_000, idempotencyKey: randomUUID() }, now)).rejects.toThrow(/closed/);
    const status = await bettingStatus(bob.id, (next + 1) * FOOTBALL_ROUND_MS + 1);
    const bet = status.bets.find((entry) => entry.game === "football")!;
    expect(bet.status).toBe("won");
    expect(await balance(bob.id)).toBe(start - 2_000 + Math.floor(2_000 * fixture.odds[winner]));
  });
});
