import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { HUSTLE_FUND, loanLimit, loanOwed, STORY_CHAPTERS, takingsShare, type HustleStatus, type StoryChapterId, type StoryFacts } from "@lagos-living/shared";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

type LoanRow = { id: string; principal: string; owed: string; remaining: string; created_at: Date; due_at: Date };
type Db = PoolClient | typeof pool;

/** A loan paid off within this long of being taken doesn't raise the limit, so borrowing and repaying at once can't. */
const COUNTS_AFTER_MS = 12 * 3_600_000;

const openLoan = async (db: Db, userId: string, lock = false) =>
  (await db.query<LoanRow>(`SELECT id, principal, owed, remaining, created_at, due_at FROM hustle_loan WHERE user_id = $1 AND repaid_at IS NULL${lock ? " FOR UPDATE" : ""}`, [userId])).rows[0] ?? null;

const loansRepaid = async (db: Db, userId: string) =>
  Number((await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM hustle_loan WHERE user_id = $1 AND repaid_at IS NOT NULL AND repaid_at - created_at >= make_interval(secs => $2)`, [userId, COUNTS_AFTER_MS / 1000])).rows[0]!.count);

async function lockWallet(client: PoolClient, userId: string) {
  await ensureWallet(client, userId);
  await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
}

const replayed = async (client: PoolClient, userId: string, key: string) =>
  Boolean((await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, key])).rowCount);

const balanceOf = async (db: Db, userId: string) => Number((await db.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]?.balance ?? 0);

async function storyFacts(db: Db, userId: string): Promise<StoryFacts> {
  const { rows } = await db.query<{ businesses: string; takings: string; cars: string; homes: string }>(
    `SELECT
       (SELECT COUNT(*) FROM player_business WHERE user_id = $1) AS businesses,
       (SELECT COALESCE(SUM(amount), 0) FROM game_transaction WHERE user_id = $1 AND kind = 'business_income') AS takings,
       (SELECT COUNT(*) FROM player_vehicle WHERE owner_user_id = $1) AS cars,
       (SELECT COUNT(*) FROM property_tenure WHERE owner_user_id = $1 AND tenure_type = 'owned')
         + (SELECT COUNT(*) FROM plot_tenure WHERE owner_user_id = $1 AND tenure_type = 'owned') AS homes`,
    [userId],
  );
  const row = rows[0]!;
  return {
    businesses: Number(row.businesses),
    takings: Number(row.takings),
    loansRepaid: Number((await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM hustle_loan WHERE user_id = $1 AND repaid_at IS NOT NULL`, [userId])).rows[0]!.count),
    cars: Number(row.cars),
    homes: Number(row.homes),
    // Borrowed money doesn't count towards being rich.
    balance: (await balanceOf(db, userId)) - Number((await openLoan(db, userId))?.remaining ?? 0),
  };
}

export async function hustleStatus(userId: string, db: Db = pool): Promise<HustleStatus> {
  const [loan, repaid, facts, claims] = await Promise.all([
    openLoan(db, userId),
    loansRepaid(db, userId),
    storyFacts(db, userId),
    db.query<{ chapter: string }>(`SELECT chapter FROM story_claim WHERE user_id = $1`, [userId]),
  ]);
  const claimed = new Set(claims.rows.map((row) => row.chapter));
  const overdue = Boolean(loan && loan.due_at.getTime() < Date.now());
  return {
    loan: loan && {
      id: loan.id,
      principal: Number(loan.principal),
      owed: Number(loan.owed),
      remaining: Number(loan.remaining),
      dueAt: loan.due_at.toISOString(),
      overdue,
      share: takingsShare(overdue),
    },
    limit: loanLimit(repaid),
    loansRepaid: repaid,
    chapters: STORY_CHAPTERS.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      story: chapter.story,
      goal: chapter.goal,
      reward: chapter.reward,
      done: chapter.done(facts),
      claimed: claimed.has(chapter.id),
    })),
  };
}

/** Pays out a loan into the wallet; the 10% fee is added to what is owed, not taken from the payout. */
export async function borrow(userId: string, amount: number, idempotencyKey: string) {
  const key = `loan:${idempotencyKey}`;
  await withTransaction(async (client) => {
    await lockWallet(client, userId);
    if (await replayed(client, userId, key)) return;
    if (await openLoan(client, userId, true)) throw new EconomyError("Pay off your current Hustle Fund loan before borrowing again.", 409);
    const limit = loanLimit(await loansRepaid(client, userId));
    if (amount < HUSTLE_FUND.minLoan || amount > limit) throw new EconomyError(`You can borrow between ₦${HUSTLE_FUND.minLoan.toLocaleString("en-NG")} and ₦${limit.toLocaleString("en-NG")}.`, 400);
    const owed = loanOwed(amount);
    const id = randomUUID();
    await client.query(
      `INSERT INTO hustle_loan (id, user_id, principal, owed, remaining, due_at) VALUES ($1, $2, $3, $4, $4, NOW() + make_interval(days => $5))`,
      [id, userId, amount, owed, HUSTLE_FUND.termDays],
    );
    await creditWallet(client, userId, amount, "loan_payout", `${HUSTLE_FUND.name} · loan (₦${owed.toLocaleString("en-NG")} to pay back)`, key);
  });
  return hustleStatus(userId);
}

async function payDown(client: PoolClient, userId: string, loan: LoanRow, amount: number, reference: string, key: string) {
  const pay = Math.min(amount, Number(loan.remaining));
  if (pay <= 0) return 0;
  await debitWallet(client, userId, pay, "loan_repayment", reference, key, { loanId: loan.id });
  await client.query(`UPDATE hustle_loan SET remaining = remaining - $2, repaid_at = CASE WHEN remaining - $2 = 0 THEN NOW() ELSE NULL END WHERE id = $1`, [loan.id, pay]);
  return pay;
}

/** Pays back up to `amount` (all that's owed when omitted) from the wallet. */
export async function repay(userId: string, amount: number | undefined, idempotencyKey: string) {
  const key = `loan-repay:${idempotencyKey}`;
  await withTransaction(async (client) => {
    await lockWallet(client, userId);
    if (await replayed(client, userId, key)) return;
    const loan = await openLoan(client, userId, true);
    if (!loan) throw new EconomyError("You don't owe the Hustle Fund anything.", 409);
    const pay = Math.min(amount ?? Number(loan.remaining), Number(loan.remaining), await balanceOf(client, userId));
    if (pay <= 0) throw new EconomyError("You need some game naira in your wallet to pay back.", 402);
    await payDown(client, userId, loan, pay, `${HUSTLE_FUND.name} · repayment`, key);
  });
  return hustleStatus(userId);
}

/**
 * Called inside a business collection, after its takings are credited to the locked wallet: the fund's share goes to an
 * open loan. Returns what was paid.
 */
export async function repayFromTakings(client: PoolClient, userId: string, takings: number, businessName: string) {
  const loan = await openLoan(client, userId, true);
  if (!loan || takings <= 0) return 0;
  const share = takingsShare(loan.due_at.getTime() < Date.now());
  return payDown(client, userId, loan, Math.floor(takings * share), `${HUSTLE_FUND.name} · ${Math.round(share * 100)}% of ${businessName} takings`, `loan-takings:${loan.id}:${randomUUID()}`);
}

export async function claimChapter(userId: string, chapterId: StoryChapterId) {
  const chapter = STORY_CHAPTERS.find((entry) => entry.id === chapterId);
  if (!chapter) throw new EconomyError("That chapter isn't in the story.", 404);
  await withTransaction(async (client) => {
    await lockWallet(client, userId);
    if (!chapter.done(await storyFacts(client, userId))) throw new EconomyError(`Finish this chapter first: ${chapter.goal}`, 409);
    const inserted = await client.query(`INSERT INTO story_claim (user_id, chapter) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, chapter.id]);
    if (!inserted.rowCount) return;
    await creditWallet(client, userId, chapter.reward, "story_reward", `Your Lagos story · ${chapter.title}`, `story:${chapter.id}`);
  });
  return hustleStatus(userId);
}
