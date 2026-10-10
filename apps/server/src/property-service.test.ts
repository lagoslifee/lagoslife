import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { purchaseItem } from "./economy-service.js";
import {
  acquireProperty,
  getInterior,
  invitePropertyGuest,
  performHomeAction,
  placeFurniture,
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
      (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z)
     VALUES ($1, 'Test Garden Flat', 'Ikoyi', 'Automated test listing', 180000, 30000, 0, 0)`,
    [propertyId],
  );
  await pool.query(
    `INSERT INTO property_listing
      (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z)
     VALUES ($1, 'Test Rental Flat', 'Ikoyi', 'Automated rental listing', 180000, 30000, 0, 0)`,
    [rentalId],
  );
});

afterAll(async () => {
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

  it("allows exactly one winner during a concurrent property purchase", async () => {
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
  });
});
