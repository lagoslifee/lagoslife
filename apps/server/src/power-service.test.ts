import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cutMinutes, DIESEL, GENERATORS, NEPA, nepaAt } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { agePower, buyDiesel, buyGenerator, homePower, switchGenerator } = await import("./power-service.js");

const owner = { id: `power-${randomUUID()}`, username: `power${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const START = 10_000_000;
let propertyId = "";
const balance = async () => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [owner.id])).rows[0].balance);
const lister = GENERATORS[0]!;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Power Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [owner.id, `${owner.username}@example.test`, owner.username],
  );
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [owner.id, START]);
  propertyId = (await pool.query(`SELECT id FROM property_listing WHERE id NOT IN (SELECT property_id FROM property_tenure) ORDER BY id LIMIT 1`)).rows[0].id;
  await pool.query(`INSERT INTO property_tenure (property_id, owner_user_id, tenure_type, acquired_at) VALUES ($1, $2, 'owned', NOW())`, [propertyId, owner.id]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM home_power WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM property_tenure WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [owner.id]);
});

describe("NEPA schedule", () => {
  it("cuts light for about the configured share of the day, the same for everyone on a feeder", () => {
    const day = 24 * 3_600_000;
    const share = cutMinutes("home-a", 0, day) / (24 * 60);
    expect(share).toBeGreaterThan(NEPA.cutShare - 0.15);
    expect(share).toBeLessThan(NEPA.cutShare + 0.15);
    const at = nepaAt("home-a", 1_000_000);
    expect(new Date(at.changesAt).getTime()).toBeGreaterThan(1_000_000);
    expect(nepaAt("home-a", at.changesAt).on).toBe(!at.on);
  });
});

describe("home generator", () => {
  it("installs a generator, sells diesel up to the tank, and burns it only through cuts while someone is home", async () => {
    expect((await homePower(owner.id, propertyId)).generator).toBeNull();
    const installed = await buyGenerator(owner.id, propertyId, { model: lister.id, idempotencyKey: randomUUID() });
    expect(installed.power).toMatchObject({ generator: lister.id, litres: 10, tank: lister.tank, running: true });
    expect(await balance()).toBe(START - lister.price);
    const bought = await buyDiesel(owner.id, propertyId, { litres: 200, idempotencyKey: randomUUID() });
    expect(bought.litres).toBe(lister.tank - 10);
    expect(await balance()).toBe(START - lister.price - (lister.tank - 10) * DIESEL.pricePerLitre);
    await expect(buyDiesel(owner.id, propertyId, { litres: 5, idempotencyKey: randomUUID() })).rejects.toThrow(/full/);

    // Someone was home for the last 60 minutes: diesel burns for the cut minutes in that hour.
    await homePower(owner.id, propertyId, true);
    await agePower(propertyId, 60);
    const now = Date.now();
    const expected = cutMinutes(propertyId, now - 60 * 60_000, now) * lister.burnPerMinute;
    const after = await homePower(owner.id, propertyId, true);
    expect(after.litres).toBeCloseTo(Math.max(0, lister.tank - expected), 0);
    expect(after.lit).toBe(after.nepa || after.litres > 0);

    // Nobody home for a day: the gateman switched it off after a few minutes, so almost nothing burns.
    await pool.query(`UPDATE home_power SET litres = $2, settled_at = NOW() - INTERVAL '1 day', last_seen_at = NOW() - INTERVAL '1 day' WHERE property_id = $1`, [propertyId, lister.tank]);
    const empty = await homePower(owner.id, propertyId);
    expect(empty.litres).toBeGreaterThanOrEqual(lister.tank - NEPA.gatemanOffMinutes * lister.burnPerMinute - 0.1);
  });

  it("refills on the standing order at the owner's expense once the tank runs low", async () => {
    await pool.query(`UPDATE home_power SET litres = 2 WHERE property_id = $1`, [propertyId]);
    const before = await balance();
    const { power } = await switchGenerator(owner.id, propertyId, { autoDiesel: true });
    expect(power.autoDiesel).toBe(true);
    expect(power.litres).toBeGreaterThan(lister.tank - 3);
    expect(await balance()).toBe(before - Math.floor(lister.tank - 2) * DIESEL.pricePerLitre);
    const off = await switchGenerator(owner.id, propertyId, { running: false });
    expect(off.power.running).toBe(false);
    expect(off.power.source).not.toBe("generator");
  });
});
