import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUSINESS, BUSINESS_TYPES, COURSES, hourlyIncome, PLOT_SHOP, PLOTS, upgradeCost } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { businessStatus, collectBusiness, enrol, startBusiness, upgradeBusiness } = await import("./business-service.js");
const { acquirePlot, listPlots, startConstruction, buyReadyBuilt } = await import("./building-service.js");

const user = { id: `biz-${randomUUID()}`, username: `biz${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const START = 20_000_000;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Biz Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("businesses and school", () => {
  it("registers a kiosk once per key and refuses a second of the same type", async () => {
    const key = randomUUID();
    const first = await startBusiness(user.id, "pos-kiosk", "Mama Tobi POS", key);
    const again = await startBusiness(user.id, "pos-kiosk", "Mama Tobi POS", key);
    expect(first.balance).toBe(START - BUSINESS_TYPES["pos-kiosk"].cost);
    expect(again.balance).toBe(first.balance);
    await expect(startBusiness(user.id, "pos-kiosk", "Second", randomUUID())).rejects.toThrow(/already run/);
  });

  it("needs a certificate for a buka, and a course in progress doesn't count", async () => {
    await expect(startBusiness(user.id, "buka", "Iya Basira", randomUUID())).rejects.toThrow(/certificate/);
    await enrol(user.id, "catering", randomUUID());
    await expect(startBusiness(user.id, "buka", "Iya Basira", randomUUID())).rejects.toThrow(/certificate/);
    await expect(enrol(user.id, "beauty", randomUUID())).rejects.toThrow(/Finish/);
    await pool.query(`UPDATE player_course SET ends_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`, [user.id]);
    const status = await businessStatus(user.id);
    expect(status.certificates).toEqual(["catering"]);
    await startBusiness(user.id, "buka", "Iya Basira", randomUUID());
    await expect(enrol(user.id, "catering", randomUUID())).rejects.toThrow(/already taken/);
  });

  it("collects income once, capped at the store limit, and upgrades at the published cost", async () => {
    await pool.query(`UPDATE player_business SET collected_at = NOW() - INTERVAL '30 hours' WHERE user_id = $1 AND type = 'pos-kiosk'`, [user.id]);
    const kiosk = (await businessStatus(user.id)).businesses.find((entry) => entry.type === "pos-kiosk")!;
    expect(kiosk.full).toBe(true);
    expect(kiosk.pending).toBe(hourlyIncome("pos-kiosk", 1, false) * 8);
    const [one, two] = await Promise.all([collectBusiness(user.id, kiosk.id), collectBusiness(user.id, kiosk.id)]);
    expect(one.collected + two.collected).toBe(kiosk.pending);
    const before = (await businessStatus(user.id)).businesses.find((entry) => entry.id === kiosk.id)!;
    const wallet = Math.max(one.balance, two.balance);
    const upgraded = await upgradeBusiness(user.id, kiosk.id, randomUUID());
    expect(upgraded.balance).toBeLessThanOrEqual(wallet - upgradeCost("pos-kiosk", 1)! + before.pending + 50);
    const after = (await businessStatus(user.id)).businesses.find((entry) => entry.id === kiosk.id)!;
    expect(after.level).toBe(2);
    expect(after.perHour).toBe(hourlyIncome("pos-kiosk", 2, false));
  });

  it("charges the course fee", async () => {
    const before = Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id])).rows[0].balance);
    const after = await enrol(user.id, "hospitality", randomUUID());
    expect(after.balance).toBe(before - COURSES.hospitality.fee);
  });

  it("builds a shopfront on the owner's own plot, moving the business in for better takings and keeping houses off it", async () => {
    const free = (await listPlots(user.id)).filter((entry) => entry.status === "available");
    const plotId = free[free.length - 1]!.id;
    await expect(startBusiness(user.id, "pos-kiosk", "Mama Tobi POS", randomUUID(), plotId)).rejects.toThrow(/Buy or lease/);
    await acquirePlot(user.id, plotId, "owned", randomUUID(), true);
    const before = Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id])).rows[0].balance);
    const moved = await startBusiness(user.id, "pos-kiosk", "Mama Tobi POS", randomUUID(), plotId);
    expect(moved.balance).toBe(before - PLOT_SHOP.cost);
    const kiosk = (await businessStatus(user.id)).businesses.find((entry) => entry.type === "pos-kiosk")!;
    expect(kiosk.plotId).toBe(plotId);
    expect(kiosk.perHour).toBe(Math.round(BUSINESS_TYPES["pos-kiosk"].perHour * 1.5 * (1 + BUSINESS.premisesBoost)));
    expect((await listPlots(user.id)).find((entry) => entry.id === plotId)).toMatchObject({ status: "mine", construction: null, business: { type: "pos-kiosk", name: "Mama Tobi POS" } });
    await expect(startBusiness(user.id, "buka", "Iya Basira", randomUUID(), plotId)).rejects.toThrow(/already built/);
    await expect(buyReadyBuilt(user.id, plotId, "bungalow", randomUUID(), true)).rejects.toThrow(/business premises/);
    await expect(startConstruction(user.id, plotId, "bungalow", randomUUID())).rejects.toThrow();
    await pool.query(`DELETE FROM plot_tenure WHERE plot_id = $1`, [plotId]);
    await pool.query(`UPDATE player_business SET plot_id = NULL WHERE plot_id = $1`, [plotId]);
  });
});
