import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { pool } from "./database.js";
import { purgeExpiredRates, withinRate } from "./request-rate.js";

const keys: string[] = [];
const freshKey = () => {
  const key = `test:${randomUUID()}`;
  keys.push(key);
  return key;
};

afterAll(async () => {
  await pool.query(`DELETE FROM request_rate WHERE key = ANY($1)`, [keys]);
});

describe("shared request rate", () => {
  it("allows the limit within a window and refuses the next request", async () => {
    const key = freshKey();
    const results = [];
    for (let index = 0; index < 4; index++) results.push(await withinRate(key, 3, 10_000));
    expect(results).toEqual([true, true, true, false]);
  });

  it("counts concurrent requests from separate connection pools exactly", async () => {
    const key = freshKey();
    // A second pool stands in for another server process with its own connections.
    const other = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
    try {
      const outcomes = await Promise.all(
        Array.from({ length: 40 }, (_, index) => withinRate(key, 25, 10_000, index % 2 ? other : pool)),
      );
      expect(outcomes.filter(Boolean)).toHaveLength(25);
    } finally {
      await other.end();
    }
  });

  it("starts a new window once the old one has passed, and purges old windows", async () => {
    const key = freshKey();
    expect(await withinRate(key, 1, 10_000)).toBe(true);
    expect(await withinRate(key, 1, 10_000)).toBe(false);
    await pool.query(`UPDATE request_rate SET window_started_at = NOW() - INTERVAL '11 seconds' WHERE key = $1`, [key]);
    expect(await withinRate(key, 1, 10_000)).toBe(true);

    await pool.query(`UPDATE request_rate SET window_started_at = NOW() - INTERVAL '2 hours' WHERE key = $1`, [key]);
    await purgeExpiredRates();
    const left = await pool.query(`SELECT 1 FROM request_rate WHERE key = $1`, [key]);
    expect(left.rowCount).toBe(0);
  });
});
