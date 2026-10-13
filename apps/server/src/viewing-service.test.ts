import { VIEWING, viewingLocation, viewingMenuById } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";
import { orderAtViewing } from "./viewing-service.js";

const fan = { id: `viewing-user-${randomUUID()}`, username: `fan${randomUUID().replaceAll("-", "").slice(0, 12)}` };

async function balance() {
  return Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [fan.id])).rows[0].balance);
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Viewing Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [fan.id, `${fan.username}@example.test`, fan.username],
  );
  await getEconomyState(fan.id);
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [fan.id]);
});

describe("viewing centre kiosk", () => {
  it("only takes orders from people inside the hall", async () => {
    setPlayerPosition(fan.id, 0, 0, "street");
    await expect(orderAtViewing(fan.id, VIEWING.placeId, "malt", randomUUID())).rejects.toThrow("Go inside");
  });

  it("charges once per key, refreshes the fan and refuses what it doesn't sell", async () => {
    setPlayerPosition(fan.id, 0, 0, viewingLocation());
    await pool.query(`UPDATE player_profile SET hunger = 50, energy = 50 WHERE user_id = $1`, [fan.id]);
    const before = await balance();
    const key = randomUUID();
    const first = await orderAtViewing(fan.id, VIEWING.placeId, "malt", key);
    expect(first.replayed).toBe(false);
    expect(first.needs).toEqual({ hunger: 54, energy: 53 });
    expect((await orderAtViewing(fan.id, VIEWING.placeId, "malt", key)).replayed).toBe(true);
    expect(await balance()).toBe(before - viewingMenuById.get("malt")!.price);
    await expect(orderAtViewing(fan.id, VIEWING.placeId, "champagne", randomUUID())).rejects.toThrow("doesn't sell");
    await expect(orderAtViewing(fan.id, "eko-nights", "malt", randomUUID())).rejects.toThrow("isn't a viewing centre");
  });
});
