import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { pool } = await import("./database.js");
const { collectParcel, eatParcel, hireStaff, homeStaff, openParcels, orderDelivery, partyUntil, startParty, staffByHome } = await import("./home-services-service.js");
const { performHomeAction } = await import("./property-service.js");
const { setPlayerPosition } = await import("./player-presence.js");
const { startRest } = await import("./home-living-service.js");

const owner = { id: `hs-${randomUUID()}`, username: `hs${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const stranger = { id: `hs-${randomUUID()}`, username: `hs${randomUUID().replaceAll("-", "").slice(0, 12)}` };
let propertyId = "";

beforeAll(async () => {
  for (const user of [owner, stranger]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Home Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, 500000) ON CONFLICT (user_id) DO UPDATE SET balance = 500000`, [user.id]);
  }
  const free = await pool.query<{ id: string }>(
    `SELECT id FROM property_listing WHERE id NOT IN (SELECT property_id FROM property_tenure) ORDER BY id LIMIT 1`,
  );
  propertyId = free.rows[0]!.id;
  await pool.query(`INSERT INTO property_tenure (property_id, owner_user_id, tenure_type, acquired_at) VALUES ($1, $2, 'owned', NOW())`, [propertyId, owner.id]);
  await pool.query(`INSERT INTO home_state (property_id, cleanliness) VALUES ($1, 20) ON CONFLICT (property_id) DO UPDATE SET cleanliness = 20`, [propertyId]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM home_staff WHERE property_id = $1`, [propertyId]);
  await pool.query(`UPDATE home_state SET party_until = NULL WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[owner.id, stranger.id]]);
});

describe("home services", () => {
  it("hires staff for a week, once per key, owner only", async () => {
    const key = randomUUID();
    const first = await hireStaff(owner.id, propertyId, "cleaner", key);
    const again = await hireStaff(owner.id, propertyId, "cleaner", key);
    expect(again.balance).toBe(first.balance);
    expect(first.balance).toBe(500_000 - 25_000);
    expect((await homeStaff(propertyId)).map((entry) => entry.role)).toEqual(["cleaner"]);
    expect((await staffByHome([propertyId])).get(propertyId)).toEqual(["cleaner"]);
    const clean = await pool.query(`SELECT cleanliness FROM home_state WHERE property_id = $1`, [propertyId]);
    expect(clean.rows[0].cleanliness).toBe(100);
    await expect(hireStaff(stranger.id, propertyId, "guard", randomUUID())).rejects.toThrow(/access/);
  });

  it("starts a party and refuses TV without a TV", async () => {
    await startParty(owner.id, propertyId);
    expect(await partyUntil(propertyId)).not.toBeNull();
    await expect(performHomeAction(owner.id, propertyId, "tv")).rejects.toThrow(/Place a TV/);
  });

  it("charges once for a delivery, hands it over where it was dropped, and feeds you when you eat it", async () => {
    await pool.query(`INSERT INTO player_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [stranger.id]);
    await pool.query(`UPDATE player_profile SET hunger = 10 WHERE user_id = $1`, [stranger.id]);
    setPlayerPosition(stranger.id, 100, 200);
    const key = randomUUID();
    const result = await orderDelivery(stranger.id, "jollof-chicken", key);
    expect((await orderDelivery(stranger.id, "jollof-chicken", key)).balance).toBe(result.balance);
    expect(result.balance).toBe(500_000 - 4_500 - 1_000);
    expect(result.parcel).toMatchObject({ status: "on_the_way", drop: [100, 200], destination: "here" });
    await expect(collectParcel(stranger.id, key)).rejects.toThrow(/isn't there yet/);
    await pool.query(`UPDATE food_parcel SET arrives_at = NOW() WHERE id = $1`, [key]);
    setPlayerPosition(stranger.id, 400, 200);
    await expect(collectParcel(stranger.id, key)).rejects.toThrow(/Go back/);
    setPlayerPosition(stranger.id, 105, 200);
    await expect(eatParcel(stranger.id, key)).rejects.toThrow(/Take it/);
    expect((await collectParcel(stranger.id, key)).taken).toBe(false);
    const eaten = await eatParcel(stranger.id, key);
    expect(eaten.needs.hunger).toBe(70);
    expect(eaten.seated).toBe(false);
    await expect(eatParcel(stranger.id, key)).rejects.toThrow(/already eaten/);
    expect(await openParcels(stranger.id)).toEqual([]);
  });

  it("delivers to the front door of your home, and you can take it from inside", async () => {
    await pool.query(`UPDATE player_profile SET home_property_id = NULL WHERE user_id = $1`, [owner.id]);
    await expect(orderDelivery(owner.id, "suya", randomUUID(), "home")).rejects.toThrow(/Set a home/);
    await pool.query(`INSERT INTO player_profile (user_id, home_property_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET home_property_id = $2`, [owner.id, propertyId]);
    const key = randomUUID();
    const { parcel } = await orderDelivery(owner.id, "suya", key, "home");
    expect(parcel).toMatchObject({ destination: "home", propertyId, dropLocation: "street" });
    await pool.query(`UPDATE food_parcel SET arrives_at = NOW() WHERE id = $1`, [key]);
    setPlayerPosition(owner.id, 0, 0, `home:${propertyId}`);
    expect((await collectParcel(owner.id, key)).taken).toBe(false);
    await startRest(owner.id);
    expect((await eatParcel(owner.id, key)).seated).toBe(true);
    await pool.query(`UPDATE player_profile SET home_property_id = NULL WHERE user_id = $1`, [owner.id]);
  });
});
