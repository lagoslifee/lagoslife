import {
  agentFee,
  ESTATE_AGENT,
  builtHomeId,
  constructionStages,
  designTotal,
  houseDesign,
  houseDoor,
  plotById,
  PLOT_TERMS,
  PLOTS,
  readyBuiltPrice,
  SHOP_DESIGN_ID,
  SOLID_FROM_STAGE,
  STAGE_LABELS,
  syncPlotFootprints,
  type HouseDesign,
  type Plot,
} from "@lagos-living/shared";
import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, markProgress, withTransaction } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";
import { releaseBelongings } from "./property-service.js";

/** Fired after anything on a plot changes, so rooms can tell clients and collision stays current. */
export const buildingEvents = new EventEmitter<{ changed: [] }>();
buildingEvents.on("changed", () => void refreshPlotFootprints().catch((error) => console.error("Plot footprint refresh failed", error)));

export async function refreshPlotFootprints() {
  const rows = await pool.query(`SELECT plot_id, design_id, stages_paid FROM construction`);
  const shops = await pool.query(`SELECT plot_id FROM player_business WHERE plot_id IS NOT NULL`);
  syncPlotFootprints([
    ...rows.rows.map((row) => ({ plotId: row.plot_id, designId: row.design_id, stagesPaid: Number(row.stages_paid) })),
    ...shops.rows.map((row) => ({ plotId: row.plot_id, designId: SHOP_DESIGN_ID, stagesPaid: SOLID_FROM_STAGE })),
  ]);
}

async function announce<T>(work: Promise<T>) {
  const result = await work;
  buildingEvents.emit("changed");
  return result;
}

function requirePlot(plotId: string) {
  const plot = plotById(plotId);
  if (!plot) throw new EconomyError("That plot is not on the map.", 404);
  return plot;
}

function requireDesign(designId: string) {
  const design = houseDesign(designId);
  if (!design) throw new EconomyError("Choose one of the house designs.", 400);
  return design;
}

function requireAtGate(userId: string, plot: Plot, action: string) {
  const position = getPlayerPosition(userId);
  if (position?.location !== "street" || Math.hypot(position.x - plot.gate[0], position.z - plot.gate[1]) > PLOT_TERMS.range) {
    throw new EconomyError(`Walk to the signboard at ${plot.name} (${plot.site}) to ${action}.`, 409);
  }
}

/** Replays return the original outcome instead of charging twice. */
async function replayed(client: PoolClient, userId: string, idempotencyKey: string) {
  const replay = await client.query(
    `SELECT balance_after FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, idempotencyKey],
  );
  return replay.rowCount ? Number(replay.rows[0].balance_after) : null;
}

async function lockWallet(client: PoolClient, userId: string) {
  await ensureWallet(client, userId);
  const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
  return Number(wallet.rows[0].balance);
}

/** Removes a plot and everything on it once its lease has run past the grace period. */
async function releasePlot(client: PoolClient, plotId: string) {
  const homeId = builtHomeId(plotId);
  const house = await client.query(`SELECT 1 FROM property_tenure WHERE property_id = $1`, [homeId]);
  if (house.rowCount) {
    await releaseBelongings(client, homeId);
    await client.query(`DELETE FROM property_tenure WHERE property_id = $1`, [homeId]);
  }
  await client.query(`UPDATE property_listing SET active = FALSE WHERE id = $1`, [homeId]);
  await client.query(`UPDATE player_business SET plot_id = NULL WHERE plot_id = $1`, [plotId]);
  await client.query(`DELETE FROM plot_tenure WHERE plot_id = $1`, [plotId]);
}

/** Test-progress reset: hands back the player's land and any house on it. */
export async function releasePlotsOf(userId: string) {
  await announce(
    withTransaction(async (client) => {
      const held = await client.query(`SELECT plot_id FROM plot_tenure WHERE owner_user_id = $1 FOR UPDATE`, [userId]);
      for (const { plot_id: plotId } of held.rows) await releasePlot(client, plotId);
    }),
  );
}

/** Guest testers come and go; land they abandon goes back on the market so the few plots stay available. */
export const GUEST_PLOT_IDLE_HOURS = 24;

export async function releaseIdleGuestPlots() {
  const idle = await pool.query(
    `SELECT t.plot_id FROM plot_tenure t
     JOIN "user" u ON u.id = t.owner_user_id
     LEFT JOIN player_profile p ON p.user_id = t.owner_user_id
     WHERE u.email LIKE '%@guest.lagosliving.local'
       AND COALESCE(p.updated_at, u."createdAt") < NOW() - make_interval(hours => $1)`,
    [GUEST_PLOT_IDLE_HOURS],
  );
  for (const { plot_id: plotId } of idle.rows) await withTransaction((client) => releasePlot(client, plotId));
  if (idle.rowCount) buildingEvents.emit("changed");
  return idle.rowCount ?? 0;
}

export async function settleExpiredPlotLeases() {
  const expired = await pool.query(`SELECT plot_id FROM plot_tenure WHERE expires_at IS NOT NULL AND expires_at <= NOW()`);
  for (const { plot_id: plotId } of expired.rows) {
    await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT plot_id FROM plot_tenure WHERE plot_id = $1 AND expires_at <= NOW() FOR UPDATE`,
        [plotId],
      );
      if (locked.rowCount) await releasePlot(client, plotId);
    });
  }
  if (expired.rowCount) buildingEvents.emit("changed");
}

/** Turns construction whose last stage has finished into a home the owner can enter. */
async function completeReadyHouses(userId: string) {
  const ready = await pool.query(
    `SELECT plot_id FROM construction
     WHERE owner_user_id = $1 AND stages_paid = $2 AND completed_at IS NULL AND stage_ready_at <= NOW()`,
    [userId, constructionStages.length],
  );
  for (const { plot_id: plotId } of ready.rows) {
    await withTransaction(async (client) => {
      const row = await client.query(
        `SELECT design_id FROM construction WHERE plot_id = $1 AND completed_at IS NULL FOR UPDATE`,
        [plotId],
      );
      if (!row.rowCount) return;
      const plot = requirePlot(plotId);
      const design = requireDesign(row.rows[0].design_id);
      const homeId = builtHomeId(plotId);
      const [doorX, doorZ] = houseDoor(plot);
      await client.query(
        `INSERT INTO property_listing
           (id, name, district, address_label, purchase_price, monthly_rent, world_x, world_z, active,
            listing_type, deposit, rent_interval_days, grace_days, storage_slots, street_name, description)
         VALUES ($1, $2, 'Lekki Phase 1', $3, $4, $5, $6, $7, TRUE, 'built', 0, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, purchase_price = EXCLUDED.purchase_price, active = TRUE,
           storage_slots = EXCLUDED.storage_slots, description = EXCLUDED.description`,
        [homeId, `${design.name}, ${plot.name}`, plot.site, designTotal(design), PLOT_TERMS.leaseRent, doorX, doorZ,
          PLOT_TERMS.leaseIntervalDays, PLOT_TERMS.leaseGraceDays, design.storageSlots, plot.street ?? plot.site,
          `${design.description} Built by you on ${plot.name}.`],
      );
      await client.query(
        `INSERT INTO property_tenure (property_id, owner_user_id, tenure_type) VALUES ($1, $2, 'owned')
         ON CONFLICT (property_id) DO NOTHING`,
        [homeId, userId],
      );
      await client.query(`INSERT INTO home_state (property_id) VALUES ($1) ON CONFLICT (property_id) DO NOTHING`, [homeId]);
      await client.query(`UPDATE construction SET completed_at = NOW() WHERE plot_id = $1`, [plotId]);
      await ensureProfile(client, userId);
      // Players who build a house move into it, even if they were renting before.
      await client.query(`UPDATE player_profile SET home_property_id = $2 WHERE user_id = $1`, [userId, homeId]);
      await markProgress(client, userId, "first_built_home");
    });
  }
  if (ready.rowCount) buildingEvents.emit("changed");
}

export type PlotStatus = {
  id: string;
  status: "available" | "mine" | "taken";
  tenureType: "leased" | "owned" | null;
  nextPaymentAt: string | null;
  accessEndsAt: string | null;
  overdue: boolean;
  construction: null | {
    designId: HouseDesign["id"];
    stagesPaid: number;
    stageStartedAt: string;
    stageReadyAt: string;
    completed: boolean;
    homeId: string | null;
  };
  /** A business trading from a shopfront on this plot. */
  business: null | { type: string; name: string };
};

/** Every plot with its state, plus the builder's own construction. Finishes houses whose last stage is done. */
export async function listPlots(userId: string): Promise<PlotStatus[]> {
  await settleExpiredPlotLeases();
  await completeReadyHouses(userId);
  const tenures = await pool.query(
    `SELECT t.plot_id, t.owner_user_id, t.tenure_type, t.next_payment_at, t.expires_at,
            c.design_id, c.stages_paid, c.stage_started_at, c.stage_ready_at, c.completed_at
     FROM plot_tenure t LEFT JOIN construction c ON c.plot_id = t.plot_id`,
  );
  const byPlot = new Map(tenures.rows.map((row) => [row.plot_id as string, row]));
  const shops = await pool.query<{ plot_id: string; type: string; name: string }>(`SELECT plot_id, type, name FROM player_business WHERE plot_id IS NOT NULL`);
  const shopByPlot = new Map(shops.rows.map((row) => [row.plot_id, { type: row.type, name: row.name }]));
  return PLOTS.map((plot) => {
    const row = byPlot.get(plot.id);
    if (!row) return { id: plot.id, status: "available", tenureType: null, nextPaymentAt: null, accessEndsAt: null, overdue: false, construction: null, business: null };
    const mine = row.owner_user_id === userId;
    const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
    return {
      id: plot.id,
      status: mine ? "mine" : "taken",
      tenureType: mine ? row.tenure_type : null,
      nextPaymentAt: mine ? iso(row.next_payment_at) : null,
      accessEndsAt: mine ? iso(row.expires_at) : null,
      overdue: Boolean(mine && row.next_payment_at && new Date(row.next_payment_at).getTime() < Date.now()),
      // Other players see what stands on a plot so the world looks the same to everyone.
      construction: row.design_id
        ? {
            designId: row.design_id,
            stagesPaid: Number(row.stages_paid),
            stageStartedAt: iso(row.stage_started_at)!,
            stageReadyAt: iso(row.stage_ready_at)!,
            completed: Boolean(row.completed_at),
            homeId: row.completed_at ? builtHomeId(plot.id) : null,
          }
        : null,
      business: shopByPlot.get(plot.id) ?? null,
    };
  });
}

export async function acquirePlot(userId: string, plotId: string, tenure: "leased" | "owned", idempotencyKey: string, viaAgent = false) {
  const plot = requirePlot(plotId);
  await settleExpiredPlotLeases();
  return announce(withTransaction(async (client) => {
    const balanceBefore = await lockWallet(client, userId);
    const replay = await replayed(client, userId, idempotencyKey);
    if (replay !== null) return { balance: replay, replayed: true };
    if (!viaAgent) requireAtGate(userId, plot, tenure === "owned" ? "buy it" : "lease it");
    const held = await client.query(`SELECT plot_id FROM plot_tenure WHERE owner_user_id = $1`, [userId]);
    if (held.rowCount) throw new EconomyError("You already hold a plot. Build on it first.", 409);
    const taken = await client.query(`SELECT 1 FROM plot_tenure WHERE plot_id = $1 FOR UPDATE`, [plotId]);
    if (taken.rowCount) throw new EconomyError("Another resident already holds this plot.", 409);
    const price = tenure === "owned" ? PLOT_TERMS.purchasePrice : PLOT_TERMS.leaseRent;
    const fee = viaAgent ? agentFee(price) : 0;
    if (balanceBefore < price + fee) throw new EconomyError("Insufficient game naira", 402);
    if (fee) await debitWallet(client, userId, fee, "construction", `${ESTATE_AGENT.name} · agent's fee`, `${idempotencyKey}:agent`, { plotId });
    const balance = await debitWallet(client, userId, price, tenure === "owned" ? "plot_purchase" : "plot_lease",
      `${plot.name} · ${tenure === "owned" ? "freehold" : "ground rent"}`, idempotencyKey, { plotId, tenure });
    await client.query(
      tenure === "owned"
        ? `INSERT INTO plot_tenure (plot_id, owner_user_id, tenure_type) VALUES ($1, $2, 'owned')`
        : `INSERT INTO plot_tenure (plot_id, owner_user_id, tenure_type, next_payment_at, expires_at)
           VALUES ($1, $2, 'leased', NOW() + make_interval(days => $3), NOW() + make_interval(days => $3 + $4))`,
      tenure === "owned" ? [plotId, userId] : [plotId, userId, PLOT_TERMS.leaseIntervalDays, PLOT_TERMS.leaseGraceDays],
    );
    await markProgress(client, userId, "first_plot");
    return { balance, replayed: false };
  }));
}

export async function renewPlotLease(userId: string, plotId: string, idempotencyKey: string) {
  const plot = requirePlot(plotId);
  return announce(withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await replayed(client, userId, idempotencyKey);
    if (replay !== null) return { balance: replay, replayed: true };
    const held = await client.query(
      `SELECT tenure_type, next_payment_at FROM plot_tenure WHERE plot_id = $1 AND owner_user_id = $2 FOR UPDATE`,
      [plotId, userId],
    );
    if (!held.rowCount) throw new EconomyError("You do not hold this plot.", 403);
    if (held.rows[0].tenure_type !== "leased") throw new EconomyError("You own this plot; there is no ground rent.");
    const intervalMs = PLOT_TERMS.leaseIntervalDays * 86_400_000;
    if (new Date(held.rows[0].next_payment_at).getTime() - Date.now() > intervalMs * 1.5) {
      throw new EconomyError("Ground rent is already paid well in advance.");
    }
    const balance = await debitWallet(client, userId, PLOT_TERMS.leaseRent, "plot_lease", `${plot.name} · ground rent`, idempotencyKey, { plotId });
    await client.query(
      `UPDATE plot_tenure
       SET next_payment_at = GREATEST(next_payment_at, NOW()) + make_interval(days => $2),
           expires_at = GREATEST(next_payment_at, NOW()) + make_interval(days => $2 + $3)
       WHERE plot_id = $1`,
      [plotId, PLOT_TERMS.leaseIntervalDays, PLOT_TERMS.leaseGraceDays],
    );
    return { balance, replayed: false };
  }));
}

/** Hires builders for the foundation of the chosen design. */
export async function startConstruction(userId: string, plotId: string, designId: string, idempotencyKey: string) {
  const plot = requirePlot(plotId);
  const design = requireDesign(designId);
  return announce(withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await replayed(client, userId, idempotencyKey);
    if (replay !== null) return { balance: replay, replayed: true };
    requireAtGate(userId, plot, "brief the builders");
    const held = await client.query(`SELECT 1 FROM plot_tenure WHERE plot_id = $1 AND owner_user_id = $2 FOR UPDATE`, [plotId, userId]);
    if (!held.rowCount) throw new EconomyError("Lease or buy this plot before building on it.", 403);
    const existing = await client.query(`SELECT 1 FROM construction WHERE plot_id = $1`, [plotId]);
    if (existing.rowCount) throw new EconomyError("Building has already started on this plot.", 409);
    await refuseShopPlot(client, plotId);
    const stage = design.stages.foundation;
    const balance = await debitWallet(client, userId, stage.cost, "construction",
      `${plot.name} · ${design.name} · ${STAGE_LABELS.foundation}`, idempotencyKey, { plotId, designId, stage: "foundation" });
    await client.query(
      `INSERT INTO construction (plot_id, owner_user_id, design_id, stages_paid, stage_ready_at)
       VALUES ($1, $2, $3, 1, NOW() + make_interval(secs => $4))`,
      [plotId, userId, design.id, stage.minutes * 60],
    );
    await markProgress(client, userId, "first_construction");
    return { balance, replayed: false };
  }));
}

/** A plot with a shopfront on it has no room for a house. */
async function refuseShopPlot(client: PoolClient, plotId: string) {
  const shop = await client.query(`SELECT 1 FROM player_business WHERE plot_id = $1`, [plotId]);
  if (shop.rowCount) throw new EconomyError("Your business premises stand on this plot.", 409);
}

/**
 * Builders finish a design in one go on land the resident already holds, for a markup instead of waiting on each
 * stage. Land is never sold with a house: buy or lease the plot first, then choose what to build.
 */
export async function buyReadyBuilt(userId: string, plotId: string, designId: string, idempotencyKey: string, viaAgent = false) {
  const plot = requirePlot(plotId);
  const design = requireDesign(designId);
  await settleExpiredPlotLeases();
  const result = await announce(withTransaction(async (client) => {
    const balanceBefore = await lockWallet(client, userId);
    const replay = await replayed(client, userId, idempotencyKey);
    if (replay !== null) return { balance: replay, replayed: true };
    if (!viaAgent) requireAtGate(userId, plot, "brief the builders");
    const tenure = await client.query(`SELECT 1 FROM plot_tenure WHERE plot_id = $1 AND owner_user_id = $2 FOR UPDATE`, [plotId, userId]);
    if (!tenure.rowCount) throw new EconomyError("Buy or lease this plot first, then choose what to build on it.", 403);
    const existing = await client.query(`SELECT 1 FROM construction WHERE plot_id = $1`, [plotId]);
    if (existing.rowCount) throw new EconomyError("Building has already started on this plot.", 409);
    await refuseShopPlot(client, plotId);
    const price = readyBuiltPrice(design);
    const fee = viaAgent ? agentFee(price) : 0;
    if (balanceBefore < price + fee) throw new EconomyError("Insufficient game naira", 402);
    if (fee) await debitWallet(client, userId, fee, "construction", `${ESTATE_AGENT.name} · agent's fee`, `${idempotencyKey}:agent`, { plotId, designId });
    const balance = await debitWallet(client, userId, price, "construction",
      `${plot.name} · ${design.name} · built in one go`, idempotencyKey, { plotId, designId, readyBuilt: true });
    await client.query(
      `INSERT INTO construction (plot_id, owner_user_id, design_id, stages_paid, stage_started_at, stage_ready_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [plotId, userId, design.id, constructionStages.length],
    );
    return { balance, replayed: false };
  }));
  await completeReadyHouses(userId);
  return { ...result, homeId: builtHomeId(plotId) };
}

/** Pays the builders for the next stage once the current one is finished. */
export async function payNextStage(userId: string, plotId: string, idempotencyKey: string) {
  const plot = requirePlot(plotId);
  return announce(withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await replayed(client, userId, idempotencyKey);
    if (replay !== null) return { balance: replay, replayed: true };
    requireAtGate(userId, plot, "pay the builders");
    const row = await client.query(
      `SELECT design_id, stages_paid, stage_ready_at FROM construction
       WHERE plot_id = $1 AND owner_user_id = $2 FOR UPDATE`,
      [plotId, userId],
    );
    if (!row.rowCount) throw new EconomyError("Choose a design and pay for the foundation first.", 409);
    const paid = Number(row.rows[0].stages_paid);
    if (paid >= constructionStages.length) throw new EconomyError("Every stage is paid for. The house is nearly done.", 409);
    if (new Date(row.rows[0].stage_ready_at).getTime() > Date.now()) {
      throw new EconomyError(`The builders are still on the ${STAGE_LABELS[constructionStages[paid - 1]!].toLowerCase()}.`, 409);
    }
    const design = requireDesign(row.rows[0].design_id);
    const next = constructionStages[paid]!;
    const balance = await debitWallet(client, userId, design.stages[next].cost, "construction",
      `${plot.name} · ${design.name} · ${STAGE_LABELS[next]}`, idempotencyKey, { plotId, stage: next });
    await client.query(
      `UPDATE construction SET stages_paid = stages_paid + 1, stage_started_at = NOW(),
         stage_ready_at = NOW() + make_interval(secs => $2)
       WHERE plot_id = $1`,
      [plotId, design.stages[next].minutes * 60],
    );
    return { balance, replayed: false };
  }));
}
