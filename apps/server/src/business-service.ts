import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BUSINESS,
  BUSINESS_TYPES,
  COURSES,
  hourlyIncome,
  pendingIncome,
  upgradeCost,
  type BusinessStatus,
  type BusinessTypeId,
  type CourseId,
  PLOT_SHOP,
  plotById,
} from "@lagos-living/shared";
import { pool } from "./database.js";
import { certificates, hasCertificate } from "./certificates.js";
import { buildingEvents } from "./building-service.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

type BusinessRow = { id: string; type: BusinessTypeId; name: string; level: number; collected_at: Date; created_at: Date; plot_id: string | null };
const BUSINESS_COLUMNS = `id, type, name, level, collected_at, created_at, plot_id`;

export async function businessStatus(userId: string): Promise<BusinessStatus> {
  const [businesses, courses, earned] = await Promise.all([
    pool.query<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM player_business WHERE user_id = $1 ORDER BY created_at`, [userId]),
    pool.query<{ course: CourseId; ends_at: Date }>(`SELECT course, ends_at FROM player_course WHERE user_id = $1 ORDER BY started_at`, [userId]),
    certificates(pool, userId),
  ]);
  const admin = earned.includes("business-admin");
  const now = Date.now();
  return {
    businesses: businesses.rows.map((row) => {
      const elapsed = now - row.collected_at.getTime();
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        level: row.level,
        perHour: hourlyIncome(row.type, row.level, admin, Boolean(row.plot_id)),
        pending: pendingIncome(row.type, row.level, admin, elapsed, Boolean(row.plot_id)),
        full: elapsed >= BUSINESS.storeHours * 3_600_000,
        upgradeCost: upgradeCost(row.type, row.level),
        openedAt: row.created_at.toISOString(),
        plotId: row.plot_id,
      };
    }),
    courses: courses.rows.map((row) => ({ course: row.course, endsAt: row.ends_at.toISOString(), done: row.ends_at.getTime() <= now })),
    certificates: earned,
  };
}

async function lockWallet(client: PoolClient, userId: string) {
  await ensureWallet(client, userId);
  await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
}

const replayed = async (client: PoolClient, userId: string, key: string) =>
  Boolean((await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, key])).rowCount);

const balanceOf = async (client: PoolClient, userId: string) => Number((await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]!.balance);

/**
 * Registers a business: one of each type, and some need a certificate first. With `plotId` the builders also put up a
 * shopfront on the resident's own empty plot (and an existing business of that type moves in instead of re-registering).
 */
export async function startBusiness(userId: string, type: BusinessTypeId, name: string, idempotencyKey: string, plotId?: string) {
  const spec = BUSINESS_TYPES[type];
  const key = `business:${idempotencyKey}`;
  const result = await withTransaction(async (client) => {
    await lockWallet(client, userId);
    if (!(await replayed(client, userId, key))) {
      const owned = await client.query<{ id: string; type: string; plot_id: string | null }>(`SELECT id, type, plot_id FROM player_business WHERE user_id = $1`, [userId]);
      const existing = owned.rows.find((row) => row.type === type);
      if (plotId) {
        const plot = plotById(plotId);
        if (!plot) throw new EconomyError("That plot is not on the map.", 404);
        const held = await client.query(`SELECT 1 FROM plot_tenure WHERE plot_id = $1 AND owner_user_id = $2 FOR UPDATE`, [plotId, userId]);
        if (!held.rowCount) throw new EconomyError("Buy or lease this plot before building on it.", 403);
        const built = await client.query(`SELECT 1 FROM construction WHERE plot_id = $1`, [plotId]);
        const occupied = await client.query(`SELECT 1 FROM player_business WHERE plot_id = $1`, [plotId]);
        if (built.rowCount || occupied.rowCount) throw new EconomyError("Something is already built on this plot.", 409);
        if (existing?.plot_id) throw new EconomyError(`Your ${spec.name} already has its own premises.`, 409);
      }
      if (!existing && spec.needs && !(await hasCertificate(client, userId, spec.needs))) {
        throw new EconomyError(`You need the ${COURSES[spec.needs].name} certificate first. Enrol at the Lagos Skills Academy (Phone → Business → School).`, 403);
      }
      if (existing && !plotId) throw new EconomyError(`You already run a ${spec.name}. Upgrade it instead.`, 409);
      if (!existing && (owned.rowCount ?? 0) >= BUSINESS.maxBusinesses) throw new EconomyError(`You can run up to ${BUSINESS.maxBusinesses} businesses.`, 409);
      if (!existing) await debitWallet(client, userId, spec.cost, "business_start", `Registered ${name} · ${spec.name}`, key, { type });
      if (plotId) {
        await debitWallet(client, userId, PLOT_SHOP.cost, "construction", `${plotById(plotId)!.name} · shopfront for ${existing ? spec.name : name}`, existing ? key : `${key}:shop`, { plotId, type });
      }
      if (existing) await client.query(`UPDATE player_business SET plot_id = $2 WHERE id = $1`, [existing.id, plotId]);
      else await client.query(`INSERT INTO player_business (id, user_id, type, name, plot_id) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), userId, type, name, plotId ?? null]);
    }
    return { balance: await balanceOf(client, userId) };
  });
  if (plotId) buildingEvents.emit("changed");
  return result;
}

/** Collects what is waiting first, so an upgrade never loses income already earned at the old rate. */
export async function upgradeBusiness(userId: string, businessId: string, idempotencyKey: string) {
  const key = `business-up:${idempotencyKey}`;
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const { rows } = await client.query<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM player_business WHERE id = $1 AND user_id = $2 FOR UPDATE`, [businessId, userId]);
    const row = rows[0];
    if (!row) throw new EconomyError("Business not found.", 404);
    if (!(await replayed(client, userId, key))) {
      const cost = upgradeCost(row.type, row.level);
      if (cost === null) throw new EconomyError(`${row.name} is already at the top level.`, 409);
      await collectRow(client, userId, row);
      await debitWallet(client, userId, cost, "business_upgrade", `${row.name} · upgrade to level ${row.level + 1}`, key, { businessId });
      await client.query(`UPDATE player_business SET level = level + 1 WHERE id = $1`, [businessId]);
    }
    return { balance: await balanceOf(client, userId) };
  });
}

async function collectRow(client: PoolClient, userId: string, row: BusinessRow) {
  const admin = await hasCertificate(client, userId, "business-admin");
  const amount = pendingIncome(row.type, row.level, admin, Date.now() - row.collected_at.getTime(), Boolean(row.plot_id));
  await client.query(`UPDATE player_business SET collected_at = NOW() WHERE id = $1`, [row.id]);
  if (amount <= 0) return 0;
  await creditWallet(client, userId, amount, "business_income", `${row.name} · takings`, `business-income:${row.id}:${randomUUID()}`);
  return amount;
}

/** The row lock makes two taps collect once: the second sees the fresh `collected_at` and gets nothing. */
export async function collectBusiness(userId: string, businessId: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const { rows } = await client.query<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM player_business WHERE id = $1 AND user_id = $2 FOR UPDATE`, [businessId, userId]);
    const row = rows[0];
    if (!row) throw new EconomyError("Business not found.", 404);
    const amount = await collectRow(client, userId, row);
    return { collected: amount, balance: await balanceOf(client, userId) };
  });
}

/** One course at a time; a finished course stays as a certificate and can't be taken twice. */
export async function enrol(userId: string, course: CourseId, idempotencyKey: string) {
  const spec = COURSES[course];
  const key = `school:${idempotencyKey}`;
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    if (!(await replayed(client, userId, key))) {
      const taken = await client.query<{ course: string; ends_at: Date }>(`SELECT course, ends_at FROM player_course WHERE user_id = $1`, [userId]);
      if (taken.rows.some((row) => row.course === course)) throw new EconomyError(`You've already taken ${spec.name}.`, 409);
      const studying = taken.rows.find((row) => row.ends_at.getTime() > Date.now());
      if (studying) throw new EconomyError(`Finish ${COURSES[studying.course as CourseId]?.name ?? "your current course"} first.`, 409);
      await debitWallet(client, userId, spec.fee, "school_fee", `Lagos Skills Academy · ${spec.name}`, key, { course });
      await client.query(`INSERT INTO player_course (user_id, course, ends_at) VALUES ($1, $2, NOW() + make_interval(mins => $3))`, [userId, course, spec.minutes]);
    }
    return { balance: await balanceOf(client, userId) };
  });
}
