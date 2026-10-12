import { BOUTIQUE, defaultAppearance, type CharacterAppearance } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getEconomyState, purchaseItem } from "./economy-service.js";
import { loadAppearance, loadCharacter, profileEvents, saveAppearance, wardrobe } from "./profile-service.js";

const user = { id: `profile-user-${randomUUID()}`, username: `pro${randomUUID().replaceAll("-", "").slice(0, 12)}` };

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Profile Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("character appearance", () => {
  it("starts from the default look before anything is saved", async () => {
    expect(await loadAppearance(user.id)).toEqual(defaultAppearance);
  });

  it("saves a look, reads it back and tells the live room", async () => {
    const look: CharacterAppearance = { body: "female", skinTone: "golden", hairstyle: "locs", outfit: "athleisure", accessory: "cap" };
    const heard: Array<[string, CharacterAppearance]> = [];
    const listener = (userId: string, appearance: CharacterAppearance) => heard.push([userId, appearance]);
    profileEvents.on("appearance", listener);
    try {
      expect((await saveAppearance(user.id, look)).appearance).toEqual(look);
    } finally {
      profileEvents.off("appearance", listener);
    }
    expect(heard).toEqual([[user.id, look]]);
    expect((await loadCharacter(user.id)).appearance).toEqual(look);
  });

  it("sells every boutique outfit from the phone, then lets the buyer wear it", async () => {
    const rows = await pool.query<{ id: string; price: string; vendor_id: string | null }>(`SELECT id, price, vendor_id FROM shop_catalog WHERE id = ANY($1) AND active`, [BOUTIQUE.map((item) => `outfit:${item.outfit}`)]);
    expect(rows.rows.map((row) => [row.id, Number(row.price), row.vendor_id]).sort()).toEqual(BOUTIQUE.map((item) => [`outfit:${item.outfit}`, item.price, null]).sort());
    const look: CharacterAppearance = { ...defaultAppearance, outfit: "suit-navy" };
    await expect(saveAppearance(user.id, look)).rejects.toThrow(/Buy that outfit/);
    await getEconomyState(user.id);
    await pool.query(`UPDATE wallet SET balance = 1000000 WHERE user_id = $1`, [user.id]);
    await purchaseItem(user.id, "outfit:suit-navy", randomUUID());
    expect((await wardrobe(user.id)).outfits).toContain("suit-navy");
    expect((await saveAppearance(user.id, look)).appearance.outfit).toBe("suit-navy");
  });

  it("falls back to the default look when stored data is no longer valid", async () => {
    await pool.query(`UPDATE player_profile SET appearance = $2 WHERE user_id = $1`, [user.id, { skinTone: "green", hairstyle: "afro" }]);
    expect(await loadAppearance(user.id)).toEqual(defaultAppearance);
  });
});
