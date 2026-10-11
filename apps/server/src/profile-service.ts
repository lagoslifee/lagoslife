import { isStarterOutfit, outfits, readAppearance, starterOutfits, type CharacterAppearance, type OutfitId } from "@lagos-living/shared";
import { EventEmitter } from "node:events";
import { pool } from "./database.js";
import { EconomyError } from "./economy-service.js";

/** Shop items that unlock an outfit are named `outfit:<id>`. */
export const outfitItemId = (outfit: OutfitId) => `outfit:${outfit}`;

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

/** Outfits the player may wear: everyone's starter wardrobe plus anything bought, such as Dubai boutique wear. */
export async function wardrobe(userId: string): Promise<{ outfits: OutfitId[] }> {
  const result = await pool.query<{ item_id: string }>(
    `SELECT item_id FROM inventory_item WHERE user_id = $1 AND item_id LIKE 'outfit:%'`,
    [userId],
  );
  const owned = new Set(result.rows.map((row) => row.item_id));
  return { outfits: [...starterOutfits, ...outfits.filter((outfit) => !isStarterOutfit(outfit) && owned.has(outfitItemId(outfit)))] };
}

export async function saveAppearance(userId: string, appearance: CharacterAppearance) {
  if (!isStarterOutfit(appearance.outfit)) {
    const { outfits: wearable } = await wardrobe(userId);
    if (!wearable.includes(appearance.outfit)) throw new EconomyError("Buy that outfit at a boutique before wearing it.", 403);
  }
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
