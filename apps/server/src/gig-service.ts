import { randomInt, randomUUID } from "node:crypto";
import { applyRepair, BUSINESS, boardGigs, gigBoard, GIG_BOARD_MS, GIG_RANGE, GENERATOR_FAULTS, getPlace, gigType, newRepair, REPAIR_ACTION_MS, repairView, type ActiveGig, type Gig, type GigStatus, type RepairAction, type RepairState } from "@lagos-living/shared";
import { hasCertificate } from "./certificates.js";
import { pool } from "./database.js";
import { creditWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import { fortune } from "./finance-service.js";
import { isNear } from "./player-presence.js";
import { payReferralIfDue } from "./referral-service.js";

type GigRow = { id: string; gig_id: string; type_id: string; title: string; task: string; emoji: string; place_id: string; reward: string; work_seconds: number; status: "travelling" | "working"; started_work_at: Date | null; repair: RepairState | null; repair_action_at: Date | null };

const handsOn = (row: GigRow) => gigType(row.type_id)?.handsOn ?? false;

const boardCache = new Map<number, Gig[]>();
export function gigsFor(board: number) {
  let gigs = boardCache.get(board);
  if (!gigs) {
    gigs = boardGigs(board, fortune);
    boardCache.set(board, gigs);
    if (boardCache.size > 20) boardCache.delete(boardCache.keys().next().value!);
  }
  return gigs;
}

function toActive(row: GigRow): ActiveGig {
  return {
    id: row.gig_id,
    board: Number(row.gig_id.split("-")[0]),
    typeId: row.type_id,
    title: row.title,
    task: row.task,
    emoji: row.emoji,
    placeId: row.place_id,
    reward: Number(row.reward),
    workSeconds: handsOn(row) ? 0 : row.work_seconds,
    handsOn: handsOn(row),
    runId: row.id,
    status: row.status,
    startedWorkAt: row.started_work_at ? row.started_work_at.toISOString() : null,
    repair: row.repair ? repairView(row.repair) : null,
  };
}

async function openGig(userId: string, lock = false, client: { query: typeof pool.query } = pool) {
  const { rows } = await client.query<GigRow>(
    `SELECT id, gig_id, type_id, title, task, emoji, place_id, reward, work_seconds, status, started_work_at, repair, repair_action_at
     FROM gig_run WHERE user_id = $1 AND status IN ('travelling', 'working')${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function gigStatus(userId: string, now = Date.now()): Promise<GigStatus> {
  const board = gigBoard(now);
  const [active, totals] = await Promise.all([
    openGig(userId),
    pool.query<{ count: number; earned: string | null }>(`SELECT COUNT(*)::int AS count, SUM(reward) AS earned FROM gig_run WHERE user_id = $1 AND status = 'completed'`, [userId]),
  ]);
  return { board: gigsFor(board), nextBoardAt: (board + 1) * GIG_BOARD_MS, active: active ? toActive(active) : null, completed: totals.rows[0]?.count ?? 0, earned: Number(totals.rows[0]?.earned ?? 0) };
}

export async function takeGig(userId: string, gigId: string, now = Date.now()) {
  const gig = gigsFor(gigBoard(now)).find((entry) => entry.id === gigId);
  if (!gig) throw new EconomyError("That gig has been taken off the board. Pick one from the current list.", 409);
  if (await openGig(userId)) throw new EconomyError("Finish or cancel your current gig first.", 409);
  try {
    await pool.query(
      `INSERT INTO gig_run (id, user_id, gig_id, type_id, title, task, emoji, place_id, reward, work_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), userId, gig.id, gig.typeId, gig.title, gig.task, gig.emoji, gig.placeId, (await hasCertificate(pool, userId, "hospitality")) ? Math.round((gig.reward * (1 + BUSINESS.jobBoost)) / 50) * 50 : gig.reward, gig.workSeconds],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new EconomyError("Finish or cancel your current gig first.", 409);
    throw error;
  }
  return gigStatus(userId, now);
}

/** Starts the work timer; only at the gig's door. */
export async function startGigWork(userId: string) {
  const row = await openGig(userId);
  if (!row) throw new EconomyError("You don't have a gig. Pick one in Phone → Jobs.", 404);
  if (!isNear(userId, getPlace(row.place_id).door, GIG_RANGE)) throw new EconomyError(`Go to ${getPlace(row.place_id).name} to start this job.`, 409);
  const repair = handsOn(row) && !row.repair ? newRepair(GENERATOR_FAULTS[randomInt(GENERATOR_FAULTS.length)]!) : null;
  await pool.query(`UPDATE gig_run SET status = 'working', started_work_at = COALESCE(started_work_at, NOW()), repair = COALESCE(repair, $2) WHERE id = $1`, [row.id, repair]);
  return toActive((await openGig(userId))!);
}

/** One step of a hands-on repair at the machine. The fault stays on the server; the reply only says what you found. */
export async function repairGig(userId: string, action: RepairAction) {
  return withTransaction(async (client) => {
    const row = await openGig(userId, true, client);
    if (!row || row.status !== "working" || !row.repair) throw new EconomyError("Start the repair job at the place first.", 409);
    if (!isNear(userId, getPlace(row.place_id).door, GIG_RANGE + 6)) throw new EconomyError(`Go back to the generator at ${getPlace(row.place_id).name}.`, 409);
    const wait = row.repair_action_at ? REPAIR_ACTION_MS - (Date.now() - row.repair_action_at.getTime()) : 0;
    if (wait > 250) throw new EconomyError("Finish what you're doing first.", 429);
    const result = applyRepair(row.repair, action);
    if (!result.ok) throw new EconomyError(result.message, 409);
    await client.query(`UPDATE gig_run SET repair = $2, repair_action_at = NOW() WHERE id = $1`, [row.id, result.state]);
    return { message: result.message, gig: toActive({ ...row, repair: result.state }) };
  });
}

/** Pays once the work time has passed at the door; the row lock and per-run ledger key stop double pay. */
export async function completeGig(userId: string) {
  let notify: (() => void) | undefined;
  const outcome = await withTransaction(async (client) => {
    const row = await openGig(userId, true, client);
    if (!row || row.status !== "working" || !row.started_work_at) throw new EconomyError("Start the job at the place first.", 409);
    if (handsOn(row) && !row.repair?.running) throw new EconomyError("The generator still isn't running. Find the fault, fix it and start it.", 409);
    const left = handsOn(row) ? 0 : row.work_seconds * 1000 - (Date.now() - row.started_work_at.getTime());
    if (left > 500) throw new EconomyError(`Keep working: ${Math.ceil(left / 1000)} s to go.`, 409);
    if (!isNear(userId, getPlace(row.place_id).door, GIG_RANGE + 6)) throw new EconomyError(`You left ${getPlace(row.place_id).name} before the job was done. Go back to finish it.`, 409);
    await ensureWallet(client, userId);
    const balance = await creditWallet(client, userId, Number(row.reward), "job_reward", `${row.title} · ${getPlace(row.place_id).name}`, `gig:${row.id}`);
    await client.query(`UPDATE gig_run SET status = 'completed', completed_at = NOW() WHERE id = $1`, [row.id]);
    const referral = await payReferralIfDue(client, userId);
    notify = referral?.notify;
    return { reward: Number(row.reward), balance: balance + (referral?.bonus ?? 0), title: row.title };
  });
  notify?.();
  return outcome;
}

export async function cancelGig(userId: string) {
  await pool.query(`UPDATE gig_run SET status = 'cancelled', completed_at = NOW() WHERE user_id = $1 AND status IN ('travelling', 'working')`, [userId]);
  return { cancelled: true };
}
