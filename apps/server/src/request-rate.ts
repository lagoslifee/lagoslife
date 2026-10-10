import type { Pool } from "pg";
import { pool } from "./database.js";

/**
 * Counts a request against a fixed window in Postgres and returns whether it is within `max`. The upsert is atomic,
 * so concurrent requests on any number of server processes share one count.
 */
export async function withinRate(key: string, max: number, windowMs: number, db: Pool = pool) {
  const result = await db.query<{ count: number }>(
    `INSERT INTO request_rate (key, window_started_at, count) VALUES ($1, NOW(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN request_rate.window_started_at <= NOW() - make_interval(secs => $2) THEN 1 ELSE request_rate.count + 1 END,
       window_started_at = CASE WHEN request_rate.window_started_at <= NOW() - make_interval(secs => $2) THEN NOW() ELSE request_rate.window_started_at END
     RETURNING count`,
    [key, windowMs / 1_000],
  );
  return result.rows[0]!.count <= max;
}

export async function purgeExpiredRates(olderThanMs = 3_600_000) {
  const result = await pool.query(
    `DELETE FROM request_rate WHERE window_started_at < NOW() - make_interval(secs => $1)`,
    [olderThanMs / 1_000],
  );
  return result.rowCount ?? 0;
}
