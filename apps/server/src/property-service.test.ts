import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getPlace, HOME_UNITS, propertyPlace } from "@lagos-living/shared";
import { purchaseItem } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";
import {
  acquireProperty,
  cancelTenancy,
  getInterior,
  listProperties,
  renewTenancy,
  settleExpiredTenancies,
  invitePropertyGuest,
  performHomeAction,
  placeFurniture,
  moveFurniture,
} from "./property-service.js";

const propertyId = `property-test-${randomUUID()}`;
const rentalId = `rental-test-${randomUUID()}`;
const users = [0, 1, 2].map(() => ({
  id: `property-user-${randomUUID()}`,
  username: `home${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Housing Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  await pool.query(
    `INSERT INTO property_listing
      (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z, listing_type)
     VALUES ($1, 'Test Garden Flat', 'Ikoyi', 'Automated test listing', 180000, 30000, 0, 0, 'sale')`,
    [propertyId],
  );
  await pool.query(
    `INSERT INTO property_listing
      (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z,
       listing_type, deposit, rent_interval_days, grace_days)
     VALUES ($1, 'Test Rental Flat', 'Ikoyi', 'Automated rental listing', 180000, 30000, 0, 0,
       'rental', 10000, 7, 3)`,
    [rentalId],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM property_storage WHERE property_id = ANY($1)`, [[propertyId, rentalId]]);
  await pool.query(`DELETE FROM furniture_placement WHERE property_id = ANY($1)`, [[propertyId, rentalId]]);
  await pool.query(`UPDATE player_profile SET home_property_id = NULL WHERE home_property_id = ANY($1)`, [[propertyId, rentalId]]);
  await pool.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM property_tenure WHERE property_id = $1`, [rentalId]);
  await pool.query(`DELETE FROM home_state WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM home_state WHERE property_id = $1`, [rentalId]);
  await pool.query(`DELETE FROM property_listing WHERE id = $1`, [propertyId]);
  await pool.query(`DELETE FROM property_listing WHERE id = $1`, [rentalId]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("property ownership and access", () => {
  let owner = users[0]!;
  let deniedBuyer = users[1]!;

  it("requires visiting the listing before signing", async () => {
    setPlayerPosition(users[0]!.id, 300, 300);
    await expect(acquireProperty(users[0]!.id, propertyId, "owned", randomUUID())).rejects.toThrow(
      "For Rent / For Sale sign",
    );
  });

  it("allows exactly one winner during a concurrent property purchase", async () => {
    for (const user of users) setPlayerPosition(user.id, 1, 1);
    const attempts = await Promise.allSettled(
      users.slice(0, 2).map((user) =>
        acquireProperty(user.id, propertyId, "owned", randomUUID()),
      ),
    );
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const tenure = await pool.query(
      `SELECT owner_user_id FROM property_tenure WHERE property_id = $1`,
      [propertyId],
    );
    owner = users.find(({ id }) => id === tenure.rows[0].owner_user_id)!;
    deniedBuyer = users.find(({ id }) => id !== owner.id && id !== users[2]!.id)!;
    await expect(getInterior(deniedBuyer.id, propertyId)).rejects.toThrow(
      "do not have access",
    );
  });

  it("creates a time-limited rental with immediate interior access", async () => {
    await expect(acquireProperty(users[2]!.id, rentalId, "owned", randomUUID())).rejects.toThrow("rent only");
    const result = await acquireProperty(users[2]!.id, rentalId, "rented", randomUUID());
    expect(result.replayed).toBe(false);
    const tenure = await pool.query(
      `SELECT tenure_type, expires_at FROM property_tenure WHERE property_id = $1`,
      [rentalId],
    );
    expect(tenure.rows[0].tenure_type).toBe("rented");
    expect(new Date(tenure.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    await expect(getInterior(users[2]!.id, rentalId)).resolves.toMatchObject({
      access: { owner: true },
    });
  });

  it("saves furniture and daily-life state, then grants explicit guest access", async () => {
    const store = getPlace("home-and-style").door;
    setPlayerPosition(owner.id, store[0], store[1]);
    await purchaseItem(owner.id, "lagoon-sofa", randomUUID());
    const placementKey = randomUUID();
    const first = await placeFurniture(owner.id, propertyId, {
      itemId: "lagoon-sofa",
      gridX: 2,
      gridZ: 3,
      rotation: 90,
      idempotencyKey: placementKey,
    });
    const replay = await placeFurniture(owner.id, propertyId, {
      itemId: "lagoon-sofa",
      gridX: 2,
      gridZ: 3,
      rotation: 90,
      idempotencyKey: placementKey,
    });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);

    await purchaseItem(owner.id, "island-bed", randomUUID());
    await placeFurniture(owner.id, propertyId, {
      itemId: "island-bed",
      gridX: 5,
      gridZ: 2,
      rotation: 0,
      idempotencyKey: randomUUID(),
    });
    const rested = await performHomeAction(owner.id, propertyId, "sleep");
    expect(rested.energy).toBe(100);
    const cooked = await performHomeAction(owner.id, propertyId, "cook");
    expect(cooked.hunger).toBe(100);
    const cleaned = await performHomeAction(owner.id, propertyId, "clean");
    expect(cleaned.cleanliness).toBe(100);
    await invitePropertyGuest(owner.id, propertyId, users[2]!.username);
    const guestInterior = await getInterior(users[2]!.id, propertyId);
    expect(guestInterior.furniture).toHaveLength(2);
    expect(guestInterior.access.guest).toBe(true);
    await expect(
      placeFurniture(users[2]!.id, propertyId, {
        itemId: "lagoon-sofa",
        gridX: 3,
        gridZ: 3,
        rotation: 0,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("Only the owner");
    await expect(
      placeFurniture(owner.id, propertyId, {
        itemId: "island-bed",
        gridX: 3,
        gridZ: 0,
        rotation: 0,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("doorway");
  });

  it("places furniture anywhere on the floor, never on top of other pieces, and moves it", async () => {
    setPlayerPosition(owner.id, 0, 0, "street");
    await pool.query(`UPDATE wallet SET balance = 500000 WHERE user_id = $1`, [owner.id]);
    await purchaseItem(owner.id, "velvet-armchair", randomUUID());
    await purchaseItem(owner.id, "aso-rug", randomUUID());
    const sofa = (await getInterior(owner.id, propertyId)).furniture.find((piece: { itemId: string }) => piece.itemId === "lagoon-sofa")!;
    expect([sofa.x, sofa.z]).toEqual([expect.closeTo(-2.1, 3), expect.closeTo(0.8, 3)]);
    await expect(
      placeFurniture(owner.id, propertyId, { itemId: "velvet-armchair", x: -2.1, z: 0.9, rotation: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/on top of the lagoon sofa/);
    await expect(
      placeFurniture(owner.id, propertyId, { itemId: "aso-rug", x: -2.0, z: 0.8, rotation: 0, idempotencyKey: randomUUID() }),
    ).resolves.toMatchObject({ replayed: false });
    const chair = await placeFurniture(owner.id, propertyId, { itemId: "velvet-armchair", x: 0.33, z: 2.04, rotation: 180, idempotencyKey: randomUUID() });
    let placed = (await getInterior(owner.id, propertyId)).furniture.find((piece: { id: string }) => piece.id === chair.id)!;
    expect(placed).toMatchObject({ rotation: 180, x: expect.closeTo(0.3, 3), z: expect.closeTo(2.0, 3) });
    await expect(moveFurniture(owner.id, propertyId, { placementId: chair.id, x: -5.0, z: -1.2, rotation: 0 })).rejects.toThrow(/kitchen/);
    await expect(moveFurniture(owner.id, propertyId, { placementId: chair.id, x: 9, z: 0, rotation: 0 })).rejects.toThrow(/inside the walls/);
    await moveFurniture(owner.id, propertyId, { placementId: chair.id, x: 3.5, z: 3.9, rotation: 90 });
    placed = (await getInterior(owner.id, propertyId)).furniture.find((piece: { id: string }) => piece.id === chair.id)!;
    expect(placed).toMatchObject({ rotation: 90, x: expect.closeTo(3.5, 3), z: expect.closeTo(3.9, 3) });
    await expect(moveFurniture(users[2]!.id, propertyId, { placementId: chair.id, x: 3.5, z: 3.0, rotation: 0 })).rejects.toThrow("Only the owner");
  });
});

describe("rental agreements", () => {
  const tenant = () => users[2]!;

  it("charges rent and deposit once, shows the terms, and renews", async () => {
    const listing = (await listProperties(tenant().id)).find(({ id }) => id === rentalId)!;
    expect(listing).toMatchObject({ rent: 30000, deposit: 10000, upfrontRent: 40000, intervalDays: 7, isMine: true });
    const deposits = await pool.query(
      `SELECT amount FROM game_transaction WHERE user_id = $1 AND kind = 'property_deposit'`,
      [tenant().id],
    );
    expect(deposits.rows.map(({ amount }) => Number(amount))).toEqual([-10000]);

    const before = await pool.query(
      `SELECT next_payment_at FROM property_tenure WHERE property_id = $1`,
      [rentalId],
    );
    const key = randomUUID();
    const [first, second] = await Promise.all([
      renewTenancy(tenant().id, rentalId, key),
      renewTenancy(tenant().id, rentalId, key),
    ]);
    expect([first.replayed, second.replayed].filter(Boolean)).toHaveLength(1);
    const after = await pool.query(
      `SELECT next_payment_at FROM property_tenure WHERE property_id = $1`,
      [rentalId],
    );
    const added = new Date(after.rows[0].next_payment_at).getTime() - new Date(before.rows[0].next_payment_at).getTime();
    expect(Math.round(added / 86_400_000)).toBe(7);
    await expect(renewTenancy(tenant().id, rentalId, randomUUID())).rejects.toThrow("well in advance");
  });

  it("prevents a second resident from renting an occupied flat", async () => {
    setPlayerPosition(users[1]!.id, 0, 0);
    await expect(acquireProperty(users[1]!.id, rentalId, "rented", randomUUID())).rejects.toThrow(
      "already holds",
    );
  });

  it("cancels with a deposit refund and frees the flat", async () => {
    const result = await cancelTenancy(tenant().id, rentalId, randomUUID());
    expect(result).toEqual({ cancelled: true, refunded: 10000 });
    const listing = (await listProperties(users[1]!.id)).find(({ id }) => id === rentalId)!;
    expect(listing.available).toBe(true);
  });

  it("ends an unpaid tenancy after the grace period and returns stored belongings", async () => {
    setPlayerPosition(users[1]!.id, 0, 0);
    await acquireProperty(users[1]!.id, rentalId, "rented", randomUUID());
    await pool.query(
      `UPDATE property_tenure
       SET next_payment_at = NOW() - INTERVAL '4 days', expires_at = NOW() - INTERVAL '1 hour'
       WHERE property_id = $1`,
      [rentalId],
    );
    await pool.query(
      `INSERT INTO property_storage (property_id, user_id, item_id, quantity) VALUES ($1, $2, 'island-water', 2)`,
      [rentalId, users[1]!.id],
    );
    await settleExpiredTenancies();
    await expect(getInterior(users[1]!.id, rentalId)).rejects.toThrow("do not have access");
    const returned = await pool.query(
      `SELECT quantity FROM inventory_item WHERE user_id = $1 AND item_id = 'island-water'`,
      [users[1]!.id],
    );
    expect(Number(returned.rows[0].quantity)).toBe(2);
  });

  it("seeds every mapped home unit, each sharing its building's door", async () => {
    const listings = await listProperties(users[0]!.id);
    for (const unit of HOME_UNITS) {
      const listing = listings.find(({ id }) => id === unit.id);
      expect(listing, unit.id).toBeDefined();
      expect(listing!.placeId).toBe(unit.placeId);
      expect(listing!.door).toEqual(getPlace(unit.placeId).door);
    }
    expect(HOME_UNITS.filter(({ placeId }) => placeId === "lekki-adebayo-flat-2")).toHaveLength(12);
    expect(HOME_UNITS.filter(({ placeId }) => placeId === "lekki-chief-okoro-house")).toHaveLength(6);
  });

  it("lets several residents rent flats in the same building at once", async () => {
    const court = getPlace("lekki-adebayo-flat-2");
    const free = (await listProperties(users[0]!.id)).filter((listing) => listing.placeId === court.id && listing.available);
    expect(free.length).toBeGreaterThanOrEqual(2);
    const tenants = [users[0]!, users[2]!];
    await pool.query(`UPDATE wallet SET balance = 250000 WHERE user_id = ANY($1)`, [tenants.map(({ id }) => id)]);
    for (const tenant of tenants) setPlayerPosition(tenant.id, court.door[0], court.door[1]);
    const rented: Array<{ userId: string; propertyId: string }> = [];
    try {
      const results = await Promise.allSettled(
        tenants.map((tenant, index) => acquireProperty(tenant.id, free[index]!.id, "rented", randomUUID())),
      );
      expect(results.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
      tenants.forEach((tenant, index) => rented.push({ userId: tenant.id, propertyId: free[index]!.id }));
      const seen = await listProperties(users[0]!.id);
      expect(seen.find(({ id }) => id === free[0]!.id)).toMatchObject({ isMine: true, available: false });
      expect(seen.find(({ id }) => id === free[1]!.id)).toMatchObject({ isMine: false, available: false });
      expect(propertyPlace(free[1]!.id)?.id).toBe(court.id);
    } finally {
      for (const { userId, propertyId } of rented) await cancelTenancy(userId, propertyId, randomUUID());
    }
  });
});
