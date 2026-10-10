import { readAppearance, type CharacterAppearance } from "@lagos-living/shared";
import { EventEmitter } from "node:events";
import { pool } from "./database.js";

/** `appearance` (userId, appearance): a saved character change the live room should show at once. */
export const profileEvents = new EventEmitter();
profileEvents.setMaxListeners(50);

export async function loadCharacter(userId: string) {
  const result = await pool.query<{ appearance: unknown; tutorialComplete: boolean }>(
    `SELECT appearance, tutorial_complete AS "tutorialComplete" FROM player_profile WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return { appearance: readAppearance(row?.appearance), tutorialComplete: row?.tutorialComplete ?? false };
}

export async function loadAppearance(userId: string) {
  return (await loadCharacter(userId)).appearance;
}

export async function saveAppearance(userId: string, appearance: CharacterAppearance) {
  const result = await pool.query<{ appearance: unknown; tutorialComplete: boolean }>(
    `INSERT INTO player_profile (user_id, appearance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
     SET appearance = EXCLUDED.appearance, updated_at = NOW()
     RETURNING appearance, tutorial_complete AS "tutorialComplete"`,
    [userId, appearance],
  );
  const saved = readAppearance(result.rows[0]!.appearance);
  profileEvents.emit("appearance", userId, saved);
  return { appearance: saved, tutorialComplete: result.rows[0]!.tutorialComplete };
}
