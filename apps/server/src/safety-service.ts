import {
  CHAT,
  type ModerationActionKind,
  type ReportReason,
  type SafetyStatus,
  type StaffRole,
} from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { EconomyError, withTransaction } from "./economy-service.js";

/** Lets HTTP moderation and block changes reach live room sessions in the same process. */
export const safetyEvents = new EventEmitter<{
  sanctioned: [userId: string, kind: "warn" | "mute" | "suspend" | "lift_mute" | "lift_suspension", reason: string, endsAt: number | null];
  blocksChanged: [userIds: string[]];
}>();

export type Actor = { userId: string; name: string };
type Db = PoolClient | typeof pool;

export async function getRole(userId: string, db: Db = pool): Promise<StaffRole | null> {
  const result = await db.query(`SELECT role FROM staff_role WHERE user_id = $1`, [userId]);
  return (result.rows[0]?.role as StaffRole | undefined) ?? null;
}

export async function requireStaff(userId: string, needed: StaffRole = "moderator") {
  const role = await getRole(userId);
  if (!role || (needed === "admin" && role !== "admin")) throw new EconomyError("Not found", 404);
  return role;
}

async function activeSanction(db: Db, userId: string, kind: "mute" | "suspend") {
  const result = await db.query(
    `SELECT id, reason, ends_at AS "endsAt" FROM account_sanction
     WHERE user_id = $1 AND kind = $2 AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())
     ORDER BY ends_at DESC NULLS FIRST LIMIT 1`,
    [userId, kind],
  );
  const row = result.rows[0];
  return row ? { id: String(row.id), reason: String(row.reason), endsAt: row.endsAt ? new Date(row.endsAt) : null } : null;
}

const suspensionCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof activeSanction>> }>();
safetyEvents.on("sanctioned", (userId) => suspensionCache.delete(userId));

/** Checked on every authenticated request, so it is cached briefly and invalidated by moderation actions. */
export async function activeSuspension(userId: string) {
  const cached = suspensionCache.get(userId);
  if (cached && Date.now() - cached.at < 5_000) return cached.value;
  const value = await activeSanction(pool, userId, "suspend");
  suspensionCache.set(userId, { at: Date.now(), value });
  return value;
}

export async function activeMute(userId: string) {
  return activeSanction(pool, userId, "mute");
}

/** Everyone this player should neither see chat from nor send chat to: blocks in either direction. */
export async function hiddenPlayers(userId: string) {
  const result = await pool.query(
    `SELECT blocked_id AS id FROM player_block WHERE blocker_id = $1
     UNION SELECT blocker_id AS id FROM player_block WHERE blocked_id = $1`,
    [userId],
  );
  return new Set(result.rows.map(({ id }) => String(id)));
}

async function userByName(db: Db, userName: string) {
  const result = await db.query(
    `SELECT id, COALESCE("displayUsername", username, name) AS name FROM "user" WHERE LOWER(username) = LOWER($1)`,
    [userName],
  );
  const row = result.rows[0];
  if (!row) throw new EconomyError("No resident goes by that name.", 404);
  return { id: String(row.id), name: String(row.name) };
}

async function userById(db: Db, userId: string) {
  const result = await db.query(`SELECT id, COALESCE("displayUsername", username, name) AS name FROM "user" WHERE id = $1`, [userId]);
  const row = result.rows[0];
  if (!row) throw new EconomyError("No such resident.", 404);
  return { id: String(row.id), name: String(row.name) };
}

export async function getSafetyStatus(userId: string): Promise<SafetyStatus> {
  const [role, mute, blocked, warnings] = await Promise.all([
    getRole(userId),
    activeMute(userId),
    pool.query(
      `SELECT b.blocked_id AS "userId", COALESCE(u."displayUsername", u.username, u.name) AS "userName"
       FROM player_block b JOIN "user" u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at`,
      [userId],
    ),
    pool.query(
      `SELECT id, reason, created_at AS at FROM account_sanction
       WHERE user_id = $1 AND kind = 'warn' AND acknowledged_at IS NULL ORDER BY created_at`,
      [userId],
    ),
  ]);
  return {
    role,
    mutedUntil: mute ? (mute.endsAt?.toISOString() ?? "indefinitely") : null,
    blocked: blocked.rows,
    warnings: warnings.rows.map((row) => ({ id: String(row.id), reason: String(row.reason), at: new Date(row.at).toISOString() })),
  };
}

export async function acknowledgeWarnings(userId: string) {
  await pool.query(`UPDATE account_sanction SET acknowledged_at = NOW() WHERE user_id = $1 AND kind = 'warn' AND acknowledged_at IS NULL`, [userId]);
  return getSafetyStatus(userId);
}

export async function blockPlayer(userId: string, userName: string) {
  const target = await userByName(pool, userName);
  if (target.id === userId) throw new EconomyError("You cannot block yourself.");
  await pool.query(`INSERT INTO player_block (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, target.id]);
  safetyEvents.emit("blocksChanged", [userId, target.id]);
  return getSafetyStatus(userId);
}

export async function unblockPlayer(userId: string, userName: string) {
  const target = await userByName(pool, userName);
  await pool.query(`DELETE FROM player_block WHERE blocker_id = $1 AND blocked_id = $2`, [userId, target.id]);
  safetyEvents.emit("blocksChanged", [userId, target.id]);
  return getSafetyStatus(userId);
}

export async function recordChat(input: {
  id: string;
  userId: string;
  userName: string;
  location: string;
  x: number;
  z: number;
  body: string;
  shown: string;
  filtered: boolean;
  recipients: number;
}) {
  await pool.query(
    `INSERT INTO chat_message (id, user_id, user_name, location, x, z, body, shown, filtered, recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.id, input.userId, input.userName, input.location, input.x, input.z, input.body, input.shown, input.filtered, input.recipients],
  );
}

/** Drops chat older than the retention window unless an unresolved report points at it. */
export async function purgeExpiredChat() {
  const result = await pool.query(
    `DELETE FROM chat_message m
     WHERE m.created_at < NOW() - make_interval(days => $1)
       AND NOT EXISTS (SELECT 1 FROM player_report r WHERE r.chat_message_id = m.id AND r.status = 'open')`,
    [CHAT.retentionDays],
  );
  return result.rowCount ?? 0;
}

export async function reportPlayer(
  userId: string,
  input: { userName: string; reason: ReportReason; details: string; chatMessageId?: string | undefined },
) {
  const target = await userByName(pool, input.userName);
  if (target.id === userId) throw new EconomyError("You cannot report yourself.");
  if (input.chatMessageId) {
    const message = await pool.query(`SELECT user_id FROM chat_message WHERE id = $1`, [input.chatMessageId]);
    if (message.rows[0]?.user_id !== target.id) throw new EconomyError("That message was not sent by this resident.");
  }
  const id = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO player_report (id, reporter_id, reported_id, reason, details, chat_message_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING
     RETURNING id`,
    [id, userId, target.id, input.reason, input.details, input.chatMessageId ?? null],
  );
  return { reportId: inserted.rows[0]?.id ?? null, alreadyOpen: !inserted.rowCount, reported: target.name };
}

async function audit(
  client: Db,
  actor: Actor,
  action: string,
  reason: string,
  target: { id: string; name: string } | null,
  details: object = {},
) {
  await client.query(
    `INSERT INTO moderation_audit (id, actor_id, actor_name, target_user_id, target_name, action, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), actor.userId, actor.name, target?.id ?? null, target?.name ?? null, action, reason, JSON.stringify(details)],
  );
}

/** Moderators may act on players; admins may also act on moderators. Nobody acts on themselves or on an admin. */
async function requireAuthority(client: Db, actor: Actor, targetId: string) {
  if (actor.userId === targetId) throw new EconomyError("You cannot moderate your own account.", 403);
  const [actorRole, targetRole] = await Promise.all([getRole(actor.userId, client), getRole(targetId, client)]);
  if (!actorRole) throw new EconomyError("Not found", 404);
  if (targetRole === "admin" || (targetRole === "moderator" && actorRole !== "admin")) {
    throw new EconomyError("Only an admin can act on staff accounts, and admins cannot be moderated here.", 403);
  }
}

export async function applyModerationAction(
  actor: Actor,
  input: { targetUserId: string; action: ModerationActionKind; reason: string; durationHours?: number | undefined; reportId?: string | undefined },
) {
  const outcome = await withTransaction(async (client) => {
    const target = await userById(client, input.targetUserId);
    await requireAuthority(client, actor, target.id);
    let endsAt: Date | null = null;
    if (input.action === "warn" || input.action === "mute" || input.action === "suspend") {
      endsAt = input.durationHours ? new Date(Date.now() + input.durationHours * 3_600_000) : null;
      await client.query(
        `INSERT INTO account_sanction (id, user_id, kind, reason, created_by, ends_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), target.id, input.action, input.reason, actor.userId, input.action === "warn" ? null : endsAt],
      );
    } else {
      const kind = input.action === "lift_mute" ? "mute" : "suspend";
      const lifted = await client.query(
        `UPDATE account_sanction SET lifted_at = NOW(), lifted_by = $3
         WHERE user_id = $1 AND kind = $2 AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())`,
        [target.id, kind, actor.userId],
      );
      if (!lifted.rowCount) throw new EconomyError(`There is no active ${kind} to lift.`, 409);
    }
    if (input.reportId) {
      const resolved = await client.query(
        `UPDATE player_report SET status = 'actioned', resolved_by = $2, resolved_at = NOW(), resolution_note = $3
         WHERE id = $1 AND reported_id = $4 AND status = 'open'`,
        [input.reportId, actor.userId, `${input.action}: ${input.reason}`, target.id],
      );
      if (!resolved.rowCount) throw new EconomyError("That report is not open for this resident.", 409);
    }
    await audit(client, actor, input.action, input.reason, target, {
      durationHours: input.durationHours ?? null,
      endsAt: endsAt?.toISOString() ?? null,
      reportId: input.reportId ?? null,
    });
    return { target, endsAt };
  });
  safetyEvents.emit("sanctioned", outcome.target.id, input.action, input.reason, input.action === "warn" ? null : (outcome.endsAt?.getTime() ?? null));
  return { target: outcome.target, action: input.action, endsAt: outcome.endsAt?.toISOString() ?? null };
}

export async function resolveReport(actor: Actor, reportId: string, resolution: "actioned" | "dismissed", note: string) {
  return withTransaction(async (client) => {
    const report = await client.query(`SELECT reported_id FROM player_report WHERE id = $1 AND status = 'open' FOR UPDATE`, [reportId]);
    if (!report.rowCount) throw new EconomyError("That report is not open.", 409);
    const target = await userById(client, String(report.rows[0].reported_id));
    if (target.id === actor.userId) throw new EconomyError("Another moderator must handle reports about you.", 403);
    await client.query(
      `UPDATE player_report SET status = $2, resolved_by = $3, resolved_at = NOW(), resolution_note = $4 WHERE id = $1`,
      [reportId, resolution, actor.userId, note],
    );
    await audit(client, actor, `report_${resolution}`, note, target, { reportId });
    return { reportId, resolution };
  });
}

export async function listReports(status: "open" | "actioned" | "dismissed" = "open") {
  const result = await pool.query(
    `SELECT r.id, r.reason, r.details, r.status, r.created_at AS "createdAt", r.resolution_note AS "resolutionNote",
            r.reported_id AS "reportedId", COALESCE(t."displayUsername", t.username, t.name) AS "reportedName",
            COALESCE(p."displayUsername", p.username, p.name) AS "reporterName",
            m.shown AS "messageShown", m.body AS "messageOriginal", m.created_at AS "messageAt",
            (SELECT COUNT(*)::INTEGER FROM player_report o WHERE o.reported_id = r.reported_id AND o.status = 'open') AS "openAgainst"
     FROM player_report r
     JOIN "user" t ON t.id = r.reported_id
     JOIN "user" p ON p.id = r.reporter_id
     LEFT JOIN chat_message m ON m.id = r.chat_message_id
     WHERE r.status = $1
     ORDER BY r.created_at ${status === "open" ? "ASC" : "DESC"}
     LIMIT 100`,
    [status],
  );
  return result.rows;
}

/** What a moderator needs to judge a resident: recent chat, reports, sanctions and audit history. */
export async function residentRecord(userId: string) {
  const target = await userById(pool, userId);
  const [role, chat, reports, sanctions, history] = await Promise.all([
    getRole(userId),
    pool.query(
      `SELECT id, body, shown, filtered, location, created_at AS at FROM chat_message WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    ),
    pool.query(
      `SELECT id, reason, details, status, created_at AS "createdAt" FROM player_report WHERE reported_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    ),
    pool.query(
      `SELECT id, kind, reason, created_at AS "createdAt", ends_at AS "endsAt", lifted_at AS "liftedAt",
              (lifted_at IS NULL AND kind <> 'warn' AND (ends_at IS NULL OR ends_at > NOW())) AS active
       FROM account_sanction WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    ),
    pool.query(
      `SELECT id, actor_name AS "actorName", action, reason, created_at AS "createdAt"
       FROM moderation_audit WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    ),
  ]);
  return { ...target, role, chat: chat.rows, reports: reports.rows, sanctions: sanctions.rows, history: history.rows };
}

export async function findResident(userName: string) {
  return userByName(pool, userName);
}

export async function listAudit(limit = 100) {
  const result = await pool.query(
    `SELECT id, actor_name AS "actorName", target_name AS "targetName", action, reason, details, created_at AS "createdAt"
     FROM moderation_audit ORDER BY created_at DESC LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return result.rows;
}

/** Admin only. Grants or removes a staff role; `actor` is "console" when run from the server command line. */
export async function setStaffRole(actor: Actor, userName: string, role: StaffRole | null, reason: string) {
  return withTransaction(async (client) => {
    const target = await userByName(client, userName);
    if (actor.userId !== "console") {
      if ((await getRole(actor.userId, client)) !== "admin") throw new EconomyError("Not found", 404);
      if (actor.userId === target.id) throw new EconomyError("You cannot change your own role.", 403);
    }
    const previous = await getRole(target.id, client);
    if (role) {
      await client.query(
        `INSERT INTO staff_role (user_id, role, granted_by) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`,
        [target.id, role, actor.userId],
      );
    } else {
      await client.query(`DELETE FROM staff_role WHERE user_id = $1`, [target.id]);
    }
    await audit(client, actor, role ? "role_granted" : "role_revoked", reason, target, { previous, role });
    return { userId: target.id, userName: target.name, role };
  });
}

export async function staffOverview() {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER FROM player_report WHERE status = 'open') AS "openReports",
       (SELECT COUNT(*)::INTEGER FROM citation WHERE status = 'appealed') AS "pendingAppeals",
       (SELECT COUNT(*)::INTEGER FROM account_sanction WHERE kind = 'suspend' AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())) AS "activeSuspensions",
       (SELECT COUNT(*)::INTEGER FROM account_sanction WHERE kind = 'mute' AND lifted_at IS NULL AND ends_at > NOW()) AS "activeMutes",
       (SELECT COUNT(*)::INTEGER FROM chat_message WHERE created_at > NOW() - INTERVAL '24 hours') AS "chatLast24h"`,
  );
  const staff = await pool.query(
    `SELECT s.user_id AS "userId", COALESCE(u."displayUsername", u.username, u.name) AS "userName", s.role, s.granted_at AS "grantedAt"
     FROM staff_role s JOIN "user" u ON u.id = s.user_id ORDER BY s.role, u.username`,
  );
  return { ...result.rows[0], staff: staff.rows };
}
