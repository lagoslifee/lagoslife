import {
  getPlace,
  POLICE,
  POLICE_CHECKPOINTS,
  PLACES,
  type PoliceCase,
  ROBBERY,
  type RobberyRecord,
  SECURITY,
  SECURITY_PLANS,
  type SecurityPlanId,
  type SecurityStatus,
} from "@lagos-living/shared";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, VENDOR_RANGE, withTransaction } from "./economy-service.js";
import { issueCitation } from "./justice-service.js";
import { isNear } from "./player-presence.js";
import { findResident, hiddenPlayers } from "./safety-service.js";

export const securityEvents = new EventEmitter<{ changed: [userId: string, guards: number] }>();

const SECURITY_PLACE = "eko-shield-security";
const POLICE_STATIONS = PLACES.filter((place) => place.kind === "police");

export async function getSecurityStatus(userId: string): Promise<SecurityStatus> {
  const result = await pool.query(`SELECT plan, guards, ends_at FROM security_hire WHERE user_id = $1 AND ends_at > NOW() ORDER BY ends_at DESC LIMIT 1`, [userId]);
  const row = result.rows[0];
  return row ? { plan: row.plan as SecurityPlanId, guards: Number(row.guards), until: new Date(row.ends_at).toISOString() } : { plan: null, guards: 0, until: null };
}

/** Hires guards for the next day; a new hire replaces the current one from now. Paid at the company's office. */
export async function hireSecurity(userId: string, plan: SecurityPlanId, idempotencyKey: string) {
  const office = getPlace(SECURITY_PLACE);
  if (!isNear(userId, office.door, VENDOR_RANGE)) throw new EconomyError(`Go to ${office.name} on ${office.street} to hire guards.`, 409);
  const spec = SECURITY_PLANS[plan];
  const result = await withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT 1 FROM security_hire WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { replayed: true, balance: Number((await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance) };
    const balance = await debitWallet(client, userId, spec.price, "security_hire", `${spec.label} · ${office.name}`, idempotencyKey, { plan });
    await client.query(`UPDATE security_hire SET ends_at = NOW() WHERE user_id = $1 AND ends_at > NOW()`, [userId]);
    await client.query(
      `INSERT INTO security_hire (id, user_id, plan, guards, price, ends_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6), $7)`,
      [randomUUID(), userId, plan, spec.guards, spec.price, SECURITY.hireMs / 1_000, idempotencyKey],
    );
    return { replayed: false, balance };
  });
  const status = await getSecurityStatus(userId);
  securityEvents.emit("changed", userId, status.guards);
  return { ...result, status };
}

export async function dismissSecurity(userId: string) {
  await pool.query(`UPDATE security_hire SET ends_at = NOW() WHERE user_id = $1 AND ends_at > NOW()`, [userId]);
  securityEvents.emit("changed", userId, 0);
  return getSecurityStatus(userId);
}

/** Papers are in order when the car is insured and roadworthy. Test drives and rentals are covered by the lender. */
export async function papersInOrder(vehicleId: string) {
  const result = await pool.query(`SELECT insured_until, condition FROM player_vehicle WHERE id = $1`, [vehicleId]);
  const row = result.rows[0];
  if (!row) return { ok: true, reason: null };
  if (Number(row.condition) < POLICE.roadworthyCondition) return { ok: false, reason: "this car isn't roadworthy" };
  if (!row.insured_until || new Date(row.insured_until).getTime() <= Date.now()) return { ok: false, reason: "there's no valid insurance" };
  return { ok: true, reason: null };
}

type Where = { x: number; z: number; district: string | null };

/** Records how a checkpoint stop ended and issues any citation. `fled` resolves the escape roll. */
export async function resolveCheckpoint(
  userId: string,
  checkpointId: string,
  vehicleId: string | null,
  answer: "comply" | "flee",
  where: Where,
  random = Math.random,
) {
  let outcome: "cleared" | "fined" | "fled_escaped" | "fled_caught";
  let reason: string | null = null;
  if (answer === "comply") {
    const papers = vehicleId ? await papersInOrder(vehicleId) : { ok: true, reason: null };
    outcome = papers.ok ? "cleared" : "fined";
    reason = papers.reason;
  } else {
    outcome = random() < POLICE.fleeEscapeChance ? "fled_escaped" : "fled_caught";
  }
  await pool.query(`INSERT INTO checkpoint_stop (id, user_id, checkpoint_id, vehicle_id, outcome) VALUES ($1, $2, $3, $4, $5)`, [
    randomUUID(),
    userId,
    checkpointId,
    vehicleId,
    outcome,
  ]);
  const evidence = { x: where.x, z: where.z, speed: 0, district: where.district, detectedBy: "server" as const };
  const citation =
    outcome === "fined"
      ? await issueCitation(userId, "no_papers", evidence, { ignoreCooldown: true })
      : outcome === "fled_caught"
        ? await issueCitation(userId, "evading_checkpoint", evidence, { ignoreCooldown: true })
        : null;
  return { outcome, reason, citation };
}

/** True when officers at a station or checkpoint would see something happen at (x, z). */
export function policeWitness(x: number, z: number) {
  return (
    POLICE_STATIONS.some((station) => Math.hypot(station.door[0] - x, station.door[1] - z) < ROBBERY.witnessRange) ||
    POLICE_CHECKPOINTS.some((checkpoint) => Math.hypot(checkpoint.point[0] - x, checkpoint.point[1] - z) < ROBBERY.witnessRange)
  );
}

/**
 * Starts a hold-up. Refused for residents in their first hour, anyone with hired security, residents who block each
 * other, and within the robber's and victim's cooldowns. The amount is fixed now and taken only when it resolves.
 */
export async function startRobbery(robberId: string, victimId: string, x: number, z: number) {
  if (robberId === victimId) throw new EconomyError("You can't rob yourself.", 409);
  if ((await hiddenPlayers(robberId)).has(victimId)) throw new EconomyError("You can't reach that resident.", 409);
  const [victim, robberRecent, victimRecent, guards] = await Promise.all([
    pool.query(`SELECT u."createdAt" AS created_at, w.balance FROM "user" u LEFT JOIN wallet w ON w.user_id = u.id WHERE u.id = $1`, [victimId]),
    pool.query(`SELECT 1 FROM robbery WHERE robber_id = $1 AND created_at > NOW() - make_interval(secs => $2)`, [robberId, ROBBERY.robberCooldownMs / 1_000]),
    pool.query(`SELECT 1 FROM robbery WHERE victim_id = $1 AND outcome = 'robbed' AND created_at > NOW() - make_interval(secs => $2)`, [
      victimId,
      ROBBERY.victimCooldownMs / 1_000,
    ]),
    getSecurityStatus(victimId),
  ]);
  const row = victim.rows[0];
  if (!row) throw new EconomyError("No such resident.", 404);
  if (Date.now() - new Date(row.created_at).getTime() < ROBBERY.newResidentMs) throw new EconomyError("They only just arrived in Lagos. Leave them be.", 409);
  if (guards.guards > 0) throw new EconomyError("They have armed security with them.", 409);
  if (robberRecent.rowCount) throw new EconomyError("Lie low for a while before trying that again.", 429);
  if (victimRecent.rowCount) throw new EconomyError("They were robbed recently and have nothing left on them.", 409);
  const amount = Math.min(ROBBERY.cap, Math.floor(Number(row.balance ?? 0) * ROBBERY.share));
  if (amount <= 0) throw new EconomyError("They have no money on them.", 409);
  const id = randomUUID();
  await pool.query(`INSERT INTO robbery (id, robber_id, victim_id, amount, x, z) VALUES ($1, $2, $3, $4, $5, $6)`, [id, robberId, victimId, amount, x, z]);
  return { id, amount };
}

/** Ends a pending hold-up once. Money moves only on "robbed"; "caught" means officers saw it and charged the robber. */
export async function resolveRobbery(robberyId: string, outcome: "robbed" | "escaped" | "caught", where: Where) {
  const resolved = await withTransaction(async (client) => {
    const result = await client.query(`SELECT * FROM robbery WHERE id = $1 AND outcome = 'pending' FOR UPDATE`, [robberyId]);
    const row = result.rows[0];
    if (!row) return null;
    let amount = 0;
    if (outcome === "robbed") {
      await ensureWallet(client, row.victim_id);
      await ensureWallet(client, row.robber_id);
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [row.victim_id]);
      amount = Math.min(Number(row.amount), Number(wallet.rows[0].balance));
      if (amount > 0) {
        await debitWallet(client, row.victim_id, amount, "robbery_loss", "Robbed at gunpoint", `robbery:${robberyId}:loss`, { robberyId });
        await creditWallet(client, row.robber_id, amount, "robbery_gain", "Hold-up", `robbery:${robberyId}:gain`);
      }
    }
    await client.query(`UPDATE robbery SET outcome = $2, amount = $3, resolved_at = NOW() WHERE id = $1`, [robberyId, outcome, amount]);
    return { robberId: String(row.robber_id), victimId: String(row.victim_id), amount };
  });
  if (resolved && outcome === "caught") {
    await issueCitation(resolved.robberId, "armed_robbery", { x: where.x, z: where.z, speed: 0, district: where.district, detectedBy: "server" }, { ignoreCooldown: true });
  }
  return resolved;
}

/**
 * Reports a robbery at a police station. If the city recorded that resident robbing the reporter in the last day,
 * they are charged: whatever they still have of the money goes back to the victim and they get a citation.
 */
export async function reportRobbery(reporterId: string, userName: string, details: string) {
  const station = POLICE_STATIONS.find((place) => isNear(reporterId, place.door, VENDOR_RANGE));
  if (!station) throw new EconomyError("Report crimes at a police station.", 409);
  const accused = await findResident(userName);
  if (accused.id === reporterId) throw new EconomyError("You can't report yourself.", 409);
  const charged = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM robbery WHERE robber_id = $1 AND victim_id = $2 AND outcome = 'robbed' AND reported_at IS NULL
         AND created_at > NOW() - make_interval(secs => $3)
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [accused.id, reporterId, ROBBERY.reportWindowMs / 1_000],
    );
    const robbery = result.rows[0];
    const caseId = randomUUID();
    if (!robbery) {
      await client.query(`INSERT INTO police_case (id, reporter_id, accused_id, status, details) VALUES ($1, $2, $3, 'no_record', $4)`, [caseId, reporterId, accused.id, details]);
      return null;
    }
    await client.query(`UPDATE robbery SET reported_at = NOW() WHERE id = $1`, [robbery.id]);
    await ensureWallet(client, accused.id);
    const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [accused.id]);
    const restitution = Math.min(Number(robbery.amount), Number(wallet.rows[0].balance));
    if (restitution > 0) {
      await debitWallet(client, accused.id, restitution, "robbery_restitution", "Restitution ordered by the police", `robbery:${robbery.id}:restitution-out`, { robberyId: robbery.id });
      await creditWallet(client, reporterId, restitution, "robbery_restitution", "Money recovered by the police", `robbery:${robbery.id}:restitution-in`);
    }
    await client.query(`INSERT INTO police_case (id, reporter_id, accused_id, robbery_id, status, details, amount) VALUES ($1, $2, $3, $4, 'charged', $5, $6)`, [
      caseId,
      reporterId,
      accused.id,
      robbery.id,
      details,
      restitution,
    ]);
    return { restitution, x: Number(robbery.x), z: Number(robbery.z) };
  });
  if (!charged) return { status: "no_record" as const, accused: accused.name, restitution: 0, station: station.name };
  await issueCitation(accused.id, "armed_robbery", { x: charged.x, z: charged.z, speed: 0, district: null, detectedBy: "server" }, { ignoreCooldown: true });
  return { status: "charged" as const, accused: accused.name, restitution: charged.restitution, station: station.name };
}

const NAME = `COALESCE(u."displayUsername", u.username, u.name)`;

export async function policeRecords(userId: string): Promise<{ robberies: RobberyRecord[]; cases: PoliceCase[] }> {
  const [robberies, cases] = await Promise.all([
    pool.query(
      `SELECT r.id, r.amount, r.outcome, r.created_at, r.reported_at, r.victim_id = $1 AS victim, ${NAME} AS other_name
       FROM robbery r JOIN "user" u ON u.id = CASE WHEN r.victim_id = $1 THEN r.robber_id ELSE r.victim_id END
       WHERE (r.victim_id = $1 OR r.robber_id = $1) AND r.outcome <> 'pending'
       ORDER BY r.created_at DESC LIMIT 20`,
      [userId],
    ),
    pool.query(
      `SELECT c.id, c.status, c.created_at, c.amount, ${NAME} AS accused_name
       FROM police_case c JOIN "user" u ON u.id = c.accused_id WHERE c.reporter_id = $1 ORDER BY c.created_at DESC LIMIT 20`,
      [userId],
    ),
  ]);
  return {
    robberies: robberies.rows.map((row) => ({
      id: String(row.id),
      role: row.victim ? "victim" : "robber",
      otherName: String(row.other_name),
      amount: Number(row.amount),
      outcome: row.outcome,
      at: new Date(row.created_at).toISOString(),
      reported: Boolean(row.reported_at),
    })),
    cases: cases.rows.map((row) => ({ id: String(row.id), accusedName: String(row.accused_name), status: row.status, createdAt: new Date(row.created_at).toISOString(), amount: Number(row.amount) })),
  };
}
