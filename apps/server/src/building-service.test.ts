import { builtHomeId, designTotal, houseDesign, houseFootprint, insideBuilding, plotById, PLOT_TERMS, PLOTS, readyBuiltPrice } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquirePlot, buyReadyBuilt, listPlots, payNextStage, refreshPlotFootprints, releaseIdleGuestPlots, renewPlotLease, settleExpiredPlotLeases, startConstruction } from "./building-service.js";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";
import { acquireProperty, invitePropertyGuest, listProperties } from "./property-service.js";

const users = [0, 1].map(() => ({ id: `build-user-${randomUUID()}`, username: `bld${randomUUID().replaceAll("-", "").slice(0, 12)}` }));
const guest = { id: `build-guest-${randomUUID()}`, username: `Guest_${randomUUID().slice(0, 6)}` };
let plotA = "";
let plotB = "";
const key = () => `test-${randomUUID()}`;
const balance = async (userId: string) => (await getEconomyState(userId)).balance;
const atGate = (userId: string, plotId: string) => {
  const gate = plotById(plotId)!.gate;
  setPlayerPosition(userId, gate[0], gate[1], "street");
};
const finishCurrentStage = (plotId: string) =>
  pool.query(`UPDATE construction SET stage_ready_at = NOW() - INTERVAL '1 second' WHERE plot_id = $1`, [plotId]);

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Builder Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $4, $2)`,
    [guest.id, guest.username, `guest-${randomUUID()}@guest.lagosliving.local`, guest.username.toLowerCase()],
  );
  const held = await pool.query(`SELECT plot_id FROM plot_tenure`);
  const taken = new Set(held.rows.map((row) => row.plot_id));
  const free = PLOTS.filter((plot) => !taken.has(plot.id)).reverse();
  if (free.length < 2) throw new Error("Building tests need two free plots in the development database");
  plotA = free[0]!.id;
  plotB = free[1]!.id;
});

afterAll(async () => {
  const homes = [builtHomeId(plotA), builtHomeId(plotB)];
  await pool.query(`UPDATE player_profile SET home_property_id = NULL WHERE home_property_id = ANY($1)`, [homes]);
  await pool.query(`DELETE FROM property_tenure WHERE property_id = ANY($1)`, [homes]);
  await pool.query(`DELETE FROM home_state WHERE property_id = ANY($1)`, [homes]);
  await pool.query(`DELETE FROM property_listing WHERE id = ANY($1)`, [homes]);
  await pool.query(`DELETE FROM plot_tenure WHERE plot_id = ANY($1)`, [[plotA, plotB]]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[...users.map((user) => user.id), guest.id]]);
  await refreshPlotFootprints();
});

describe("land and building", () => {
  it("leases a plot only at its signboard, one plot per resident", async () => {
    const [builder, rival] = users;
    const start = await balance(builder!.id);
    setPlayerPosition(builder!.id, 0, 0, "street");
    await expect(acquirePlot(builder!.id, plotA, "leased", key())).rejects.toMatchObject({ status: 409 });
    atGate(builder!.id, plotA);
    await acquirePlot(builder!.id, plotA, "leased", key());
    expect(await balance(builder!.id)).toBe(start - PLOT_TERMS.leaseRent);
    atGate(builder!.id, plotB);
    await expect(acquirePlot(builder!.id, plotB, "owned", key())).rejects.toThrow(/already hold a plot/);
    atGate(rival!.id, plotA);
    await expect(acquirePlot(rival!.id, plotA, "owned", key())).rejects.toThrow(/Another resident/);

    const plots = await listPlots(rival!.id);
    expect(plots.find((plot) => plot.id === plotA)).toMatchObject({ status: "taken", tenureType: null });
    const mine = (await listPlots(builder!.id)).find((plot) => plot.id === plotA)!;
    expect(mine).toMatchObject({ status: "mine", tenureType: "leased" });
    expect(new Date(mine.nextPaymentAt!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    await expect(renewPlotLease(builder!.id, plotA, key())).resolves.toMatchObject({ replayed: false });
    await expect(renewPlotLease(builder!.id, plotA, key())).rejects.toThrow(/well in advance/);
  });

  it("builds stage by stage, waiting for the builders, and the finished house becomes the builder's home", async () => {
    const [builder, rival] = users;
    const design = houseDesign("self-contain")!;
    atGate(builder!.id, plotA);
    await expect(startConstruction(builder!.id, plotA, "palace", key())).rejects.toMatchObject({ status: 400 });
    const before = await balance(builder!.id);
    const idempotencyKey = key();
    await startConstruction(builder!.id, plotA, design.id, idempotencyKey);
    await expect(startConstruction(builder!.id, plotA, design.id, idempotencyKey)).resolves.toMatchObject({ replayed: true });
    expect(await balance(builder!.id)).toBe(before - design.stages.foundation.cost);
    await expect(payNextStage(builder!.id, plotA, key())).rejects.toThrow(/still on the foundation/);

    const centre = houseFootprint(plotById(plotA)!, design).reduce((sum, [x, z]) => [sum[0] + x / 4, sum[1] + z / 4], [0, 0]);
    await refreshPlotFootprints();
    expect(insideBuilding(centre[0]!, centre[1]!, 0)).toBe(false);

    for (let stage = 2; stage <= 4; stage += 1) {
      await finishCurrentStage(plotA);
      await payNextStage(builder!.id, plotA, key());
      if (stage === 2) {
        await refreshPlotFootprints();
        expect(insideBuilding(centre[0]!, centre[1]!, 0)).toBe(true);
      }
    }
    expect(await balance(builder!.id)).toBe(before - designTotal(design));
    await expect(payNextStage(builder!.id, plotA, key())).rejects.toThrow(/Every stage is paid/);
    let plot = (await listPlots(builder!.id)).find((entry) => entry.id === plotA)!;
    expect(plot.construction).toMatchObject({ stagesPaid: 4, completed: false, homeId: null });

    await finishCurrentStage(plotA);
    plot = (await listPlots(builder!.id)).find((entry) => entry.id === plotA)!;
    expect(plot.construction).toMatchObject({ completed: true, homeId: builtHomeId(plotA) });
    const economy = await getEconomyState(builder!.id);
    expect(economy.homePropertyId).toBe(builtHomeId(plotA));
    expect(economy.progress.first_built_home).toBeTruthy();
    const home = (await listProperties(builder!.id)).find((listing) => listing.id === builtHomeId(plotA));
    expect(home).toMatchObject({ isMine: true, tenureType: "owned", listingType: "built" });
    expect(home!.door).toEqual(home!.door.map(Number));

    expect((await listProperties(rival!.id)).some((listing) => listing.id === builtHomeId(plotA))).toBe(false);
    setPlayerPosition(rival!.id, home!.door[0], home!.door[1], "street");
    await expect(acquireProperty(rival!.id, builtHomeId(plotA), "owned", key())).rejects.toThrow(/belongs to the resident/);
  });

  it("refuses builders' fees the resident cannot afford", async () => {
    const [, buyer] = users;
    atGate(buyer!.id, plotB);
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, 3000000) ON CONFLICT (user_id) DO UPDATE SET balance = 3000000`, [buyer!.id]);
    await acquirePlot(buyer!.id, plotB, "owned", key());
    const plot = (await listPlots(buyer!.id)).find((entry) => entry.id === plotB)!;
    expect(plot).toMatchObject({ status: "mine", tenureType: "owned", nextPaymentAt: null, accessEndsAt: null });
    await pool.query(`UPDATE wallet SET balance = 1000 WHERE user_id = $1`, [buyer!.id]);
    await expect(startConstruction(buyer!.id, plotB, "duplex", key())).rejects.toMatchObject({ status: 402 });
  });

  it("returns a leased plot and the house on it once ground rent lapses past the grace period", async () => {
    const [builder] = users;
    await pool.query(`UPDATE plot_tenure SET next_payment_at = NOW() - INTERVAL '4 days', expires_at = NOW() - INTERVAL '1 minute' WHERE plot_id = $1`, [plotA]);
    await settleExpiredPlotLeases();
    const plot = (await listPlots(builder!.id)).find((entry) => entry.id === plotA)!;
    expect(plot).toMatchObject({ status: "available", construction: null });
    const tenure = await pool.query(`SELECT 1 FROM property_tenure WHERE property_id = $1`, [builtHomeId(plotA)]);
    expect(tenure.rowCount).toBe(0);
    expect((await getEconomyState(builder!.id)).homePropertyId).toBeNull();
    expect((await listProperties(builder!.id)).some((listing) => listing.id === builtHomeId(plotA))).toBe(false);
  });

  it("hands back land held by a guest who has been away for a day, but not a regular resident's", async () => {
    const [, buyer] = users;
    atGate(guest.id, plotA);
    await acquirePlot(guest.id, plotA, "leased", key());
    await releaseIdleGuestPlots();
    expect((await listPlots(guest.id)).find((entry) => entry.id === plotA)?.status).toBe("mine");

    await pool.query(`UPDATE player_profile SET updated_at = NOW() - INTERVAL '25 hours' WHERE user_id = ANY($1)`, [[guest.id, buyer!.id]]);
    expect(await releaseIdleGuestPlots()).toBeGreaterThanOrEqual(1);
    expect((await listPlots(guest.id)).find((entry) => entry.id === plotA)?.status).toBe("available");
    expect((await listPlots(buyer!.id)).find((entry) => entry.id === plotB)?.status).toBe("mine");
  });

  it("sells land on its own, then has the builders finish a house in one go, and lets the owner invite a friend round", async () => {
    const [builder, buyer] = users;
    const design = houseDesign("pool-villa")!;
    expect(design.pool).not.toBeNull();
    expect(design.parking).toBeGreaterThanOrEqual(2);
    await pool.query(`UPDATE wallet SET balance = 3000000 WHERE user_id = $1`, [builder!.id]);
    setPlayerPosition(builder!.id, 0, 0, "street");
    await expect(buyReadyBuilt(builder!.id, plotA, design.id, key())).rejects.toMatchObject({ status: 409 });
    atGate(builder!.id, plotB);
    await expect(buyReadyBuilt(builder!.id, plotB, design.id, key())).rejects.toMatchObject({ status: 403 });
    atGate(builder!.id, plotA);
    await expect(buyReadyBuilt(builder!.id, plotA, design.id, key())).rejects.toThrow(/Buy or lease this plot first/);
    await acquirePlot(builder!.id, plotA, "owned", key());
    expect((await listPlots(builder!.id)).find((entry) => entry.id === plotA)).toMatchObject({ status: "mine", construction: null, business: null });
    const idempotencyKey = key();
    const bought = await buyReadyBuilt(builder!.id, plotA, design.id, idempotencyKey);
    expect(bought).toMatchObject({ replayed: false, homeId: builtHomeId(plotA) });
    await expect(buyReadyBuilt(builder!.id, plotA, design.id, idempotencyKey)).resolves.toMatchObject({ replayed: true });
    const price = readyBuiltPrice(design);
    expect(price).toBeGreaterThan(designTotal(design));
    expect(await balance(builder!.id)).toBe(3_000_000 - PLOT_TERMS.purchasePrice - price);
    const plot = (await listPlots(builder!.id)).find((entry) => entry.id === plotA)!;
    expect(plot).toMatchObject({ status: "mine", tenureType: "owned", construction: { designId: "pool-villa", completed: true } });
    expect((await getEconomyState(builder!.id)).homePropertyId).toBe(builtHomeId(plotA));

    expect((await listProperties(buyer!.id)).some((listing) => listing.id === builtHomeId(plotA))).toBe(false);
    await invitePropertyGuest(builder!.id, builtHomeId(plotA), buyer!.username);
    const visit = (await listProperties(buyer!.id)).find((listing) => listing.id === builtHomeId(plotA));
    expect(visit).toMatchObject({ isMine: false, hasGuestAccess: true });
  });
});
