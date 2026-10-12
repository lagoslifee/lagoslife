import type { PoolClient } from "pg";
import type { CourseId } from "@lagos-living/shared";
import { pool } from "./database.js";

type Db = PoolClient | typeof pool;

/** Finished courses only; a course still in progress is not a certificate yet. */
export async function certificates(db: Db, userId: string): Promise<CourseId[]> {
  const { rows } = await db.query<{ course: CourseId }>(`SELECT course FROM player_course WHERE user_id = $1 AND ends_at <= NOW() ORDER BY ends_at`, [userId]);
  return rows.map((row) => row.course);
}

export async function hasCertificate(db: Db, userId: string, course: CourseId) {
  const { rowCount } = await db.query(`SELECT 1 FROM player_course WHERE user_id = $1 AND course = $2 AND ends_at <= NOW()`, [userId, course]);
  return Boolean(rowCount);
}

