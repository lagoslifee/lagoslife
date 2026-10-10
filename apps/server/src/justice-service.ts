import { type Citation, JUSTICE, OFFENCES, type OffenceId } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import type { Actor } from "./safety-service.js";

type CitationRow = {
  id: string;
  user_id: string;
  offence: OffenceId;
  fine: string;
  status: Citation["status"];
  evidence: Citation["evidence"];
  issued_at: Date;
  due_at: Date;
  paid_at: Date | null;
  appeal_statement: string | null;
  appeal_filed_at: Date | null;
  appeal_outcome: "upheld" | "overturned" | null;
  appeal_note: string | null;
};

function toCitation(row: CitationRow): Citation {
  return {
    id: row.id,
    offence: row.offence,
    title: OFFENCES[row.offence].title,
    fine: Number(row.fine),
    status: row.status,
    issuedAt: row.issued_at.toISOString(),
    dueAt: row.due_at.toISOString(),
    evidence: row.evidence,
    appeal: row.appeal_filed_at
      ? { statement: row.appeal_statement ?? "", filedAt: row.appeal_filed_at.toISOString(), outcome: row.appeal_outcome, note: row.appeal_note }
      : null,
    paidAt: row.paid_at?.toISOString() ?? null,
  };
}

async function logEvent(client: PoolClient, citation: { id: string; user_id: string }, actor: Actor | null, event: string, note: string | null = null) {
  await client.query(
    `INSERT INTO justice_event (id, citation_id, user_id, actor_id, actor_name, event, note)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT COALESCE("displayUsername", username, name) FROM "user" WHERE id = $4), $5), $6, $7)`,
    [randomUUID(), citation.id, citation.user_id, actor?.userId ?? null, actor?.name ?? JUSTICE.authority, event, note],
  );
}

/**
 * Issued by the simulation only. Returns null when the player already received a citation within the cooldown,
 * so a pile-up of impacts yields a single ticket.
 */
export async function issueCitation(userId: string, offence: OffenceId, evidence: Citation["evidence"]) {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('citation:' || $1))`, [userId]);
    const recent = await client.query(
      `SELECT 1 FROM citation WHERE user_id = $1 AND issued_at > NOW() - make_interval(secs => $2)`,
      [userId, JUSTICE.citationCooldownMs / 1_000],
    );
    if (recent.rowCount) return null;
    const result = await client.query<CitationRow>(
      `INSERT INTO citation (id, user_id, offence, fine, evidence, due_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(hours => $6))
       RETURNING *`,
      [randomUUID(), userId, offence, OFFENCES[offence].fine, JSON.stringify(evidence), JUSTICE.dueHours],
    );
    const row = result.rows[0]!;
    await logEvent(client, row, null, "issued", `${OFFENCES[offence].title} at ${evidence.speed.toFixed(1)} m/s`);
    return toCitation(row);
  });
}

export async function listCitations(userId: string) {
  const result = await pool.query<CitationRow>(`SELECT * FROM citation WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 50`, [userId]);
  return result.rows.map(toCitation);
}

async function lockOwnCitation(client: PoolClient, userId: string, citationId: string) {
  const result = await client.query<CitationRow>(`SELECT * FROM citation WHERE id = $1 AND user_id = $2 FOR UPDATE`, [citationId, userId]);
  if (!result.rowCount) throw new EconomyError("That citation is not yours.", 404);
  return result.rows[0]!;
}

export async function payCitation(userId: string, citationId: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const row = await lockOwnCitation(client, userId, citationId);
    if (row.status === "paid") {
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      return { citation: toCitation(row), balance: Number(wallet.rows[0].balance), replayed: true };
    }
    if (row.status === "appealed") throw new EconomyError("Your appeal is still being reviewed. Nothing is owed until it is decided.", 409);
    if (row.status === "overturned") throw new EconomyError("This citation was overturned on appeal. Nothing is owed.", 409);
    const balance = await debitWallet(client, userId, Number(row.fine), "fine_payment", `${OFFENCES[row.offence].title} fine`, idempotencyKey, {
      citationId: row.id,
    });
    const updated = await client.query<CitationRow>(`UPDATE citation SET status = 'paid', paid_at = NOW() WHERE id = $1 RETURNING *`, [row.id]);
    await logEvent(client, row, { userId, name: "" }, "paid");
    return { citation: toCitation(updated.rows[0]!), balance, replayed: false };
  });
}

export async function appealCitation(userId: string, citationId: string, statement: string) {
  return withTransaction(async (client) => {
    const row = await lockOwnCitation(client, userId, citationId);
    if (row.appeal_filed_at) throw new EconomyError("Each citation can be appealed once.", 409);
    if (row.status !== "unpaid") throw new EconomyError("Only unpaid citations can be appealed.", 409);
    if (row.due_at.getTime() < Date.now()) throw new EconomyError("The appeal window has closed.", 409);
    const updated = await client.query<CitationRow>(
      `UPDATE citation SET status = 'appealed', appeal_statement = $2, appeal_filed_at = NOW() WHERE id = $1 RETURNING *`,
      [row.id, statement],
    );
    await logEvent(client, row, { userId, name: "" }, "appealed", statement);
    return toCitation(updated.rows[0]!);
  });
}

export async function listAppeals() {
  const result = await pool.query(
    `SELECT c.*, COALESCE(u."displayUsername", u.username, u.name) AS user_name
     FROM citation c JOIN "user" u ON u.id = c.user_id
     WHERE c.status = 'appealed' ORDER BY c.appeal_filed_at ASC LIMIT 100`,
  );
  return result.rows.map((row) => ({ ...toCitation(row as CitationRow), userId: String(row.user_id), userName: String(row.user_name) }));
}

/**
 * A moderator rules on an appeal. Upheld fines become payable again with at least a day to pay; overturned
 * fines are void. Moderators cannot rule on their own citations.
 */
export async function decideAppeal(actor: Actor, citationId: string, outcome: "upheld" | "overturned", note: string) {
  return withTransaction(async (client) => {
    const result = await client.query<CitationRow>(`SELECT * FROM citation WHERE id = $1 FOR UPDATE`, [citationId]);
    const row = result.rows[0];
    if (!row) throw new EconomyError("No such citation.", 404);
    if (row.user_id === actor.userId) throw new EconomyError("Another moderator must decide your own appeal.", 403);
    if (row.status !== "appealed") throw new EconomyError("That appeal has already been decided.", 409);
    const updated = await client.query<CitationRow>(
      `UPDATE citation
       SET status = $2, appeal_outcome = $3, appeal_note = $4, decided_by = $5, decided_at = NOW(),
           due_at = CASE WHEN $3 = 'upheld' THEN GREATEST(due_at, NOW() + INTERVAL '24 hours') ELSE due_at END
       WHERE id = $1 RETURNING *`,
      [row.id, outcome === "upheld" ? "unpaid" : "overturned", outcome, note, actor.userId],
    );
    await logEvent(client, row, actor, outcome, note);
    return toCitation(updated.rows[0]!);
  });
}

export async function citationHistory(citationId: string) {
  const result = await pool.query(
    `SELECT event, actor_name AS "actorName", note, created_at AS "createdAt" FROM justice_event WHERE citation_id = $1 ORDER BY created_at`,
    [citationId],
  );
  return result.rows;
}

export async function hasOverdueFines(client: PoolClient | typeof pool, userId: string) {
  const result = await client.query(`SELECT 1 FROM citation WHERE user_id = $1 AND status = 'unpaid' AND due_at < NOW() LIMIT 1`, [userId]);
  return Boolean(result.rowCount);
}
