import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TEST_FUNDS = "10000000";
const { pool } = await import("./database.js");
const { getEconomyState } = await import("./economy-service.js");

const user = { id: `funds-user-${randomUUID()}`, username: `funds${randomUUID().replaceAll("-", "").slice(0, 12)}` };

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Funds Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("testing funds", () => {
  it("refills a wallet to TEST_FUNDS once, even when read concurrently, and records each refill", async () => {
    const [first] = await Promise.all([getEconomyState(user.id), getEconomyState(user.id)]);
    expect(first.balance).toBe(10_000_000);
    await pool.query(`UPDATE wallet SET balance = 1500000 WHERE user_id = $1`, [user.id]);
    await Promise.all([getEconomyState(user.id), getEconomyState(user.id), getEconomyState(user.id)]);
    const wallet = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id]);
    expect(Number(wallet.rows[0].balance)).toBe(10_000_000);
    const refills = await pool.query(`SELECT amount FROM game_transaction WHERE user_id = $1 AND kind = 'test_funds' ORDER BY created_at`, [user.id]);
    expect(refills.rows.map((row) => Number(row.amount))).toEqual([10_000_000 - Number(process.env.STARTING_NAIRA ?? 250_000), 8_500_000]);
  });
});
