import { pool } from "./database.js";

export async function loadDiscoveries(userId: string) {
  const { rows } = await pool.query<{ place_id: string }>("SELECT place_id FROM place_discovery WHERE user_id = $1", [userId]);
  return new Set(rows.map((row) => row.place_id));
}

export async function recordDiscovery(userId: string, placeId: string) {
  await pool.query("INSERT INTO place_discovery (user_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, placeId]);
}

export async function homePropertyOf(userId: string) {
  const { rows } = await pool.query<{ home_property_id: string | null }>("SELECT home_property_id FROM player_profile WHERE user_id = $1", [userId]);
  return rows[0]?.home_property_id ?? null;
}
