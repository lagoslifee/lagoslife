import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  assetPrice,
  BET_LIMITS,
  footballClub,
  dailyReward,
  DAILY_REWARDS,
  footballRound,
  FOOTBALL_ROUND_MS,
  lagosDay,
  MARKET_ASSETS,
  MARKET_FEE,
  marketAsset,
  matchResult,
  nextStreak,
  pickOf,
  roundFixtures,
  spinMultiplier,
  spinReturn,
  spinRound,
  spinStopsAt,
  SPIN_CLOSE_MS,
  type BetRecord,
  type BettingStatus,
  type DailyStatus,
  type Fixture,
  type LiveFixture,
  type MarketStatus,
  type Pick,
} from "@lagos-living/shared";
import { config } from "./config.js";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import { playerEvents } from "./player-events.js";

const seedKey = createHmac("sha256", config.BETTER_AUTH_SECRET).update("lagos-living:fortune").digest();

/** Secret-seeded uniform number in [0, 1): the same for every resident, unpredictable without the server secret. */
export function fortune(key: string) {
  return createHmac("sha256", seedKey).update(key).digest().readUInt32BE(0) / 4294967296;
}

async function replayed(client: PoolClient, userId: string, idempotencyKey: string) {
  const { rowCount } = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
  return Boolean(rowCount);
}

async function balanceOf(client: PoolClient, userId: string) {
  const { rows } = await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(rows[0]?.balance ?? 0);
}

/* ---------- Daily bonus ---------- */

export async function dailyStatus(userId: string, now = Date.now()): Promise<DailyStatus> {
  const today = lagosDay(now);
  const { rows } = await pool.query<{ streak: number; last_day: string | null }>(
    `SELECT streak, to_char(last_day, 'YYYY-MM-DD') AS last_day FROM daily_reward WHERE user_id = $1`,
    [userId],
  );
  const streak = rows[0]?.streak ?? 0;
  const lastDay = rows[0]?.last_day ?? null;
  const claimedToday = lastDay === today;
  const upcoming = claimedToday ? streak + 1 : nextStreak(lastDay, streak, today);
  const alive = claimedToday || upcoming > 1;
  return { today, streak: alive ? streak : 0, claimedToday, nextStreak: upcoming, nextAmount: dailyReward(upcoming), rewards: DAILY_REWARDS };
}

/** One claim per Lagos calendar day: the row lock and the per-day ledger key stop double claims across tabs. */
export async function claimDaily(userId: string, now = Date.now()) {
  const today = lagosDay(now);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`INSERT INTO daily_reward (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    const { rows } = await client.query<{ streak: number; last_day: string | null }>(
      `SELECT streak, to_char(last_day, 'YYYY-MM-DD') AS last_day FROM daily_reward WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const row = rows[0]!;
    if (row.last_day === today) throw new EconomyError("Today's bonus is already collected. Come back tomorrow.", 409);
    const streak = nextStreak(row.last_day, row.streak, today);
    const amount = dailyReward(streak);
    const balance = await creditWallet(client, userId, amount, "daily_reward", `Daily bonus · day ${streak}`, `daily:${today}`);
    await client.query(`UPDATE daily_reward SET streak = $2, last_day = $3::date, updated_at = NOW() WHERE user_id = $1`, [userId, streak, today]);
    return { amount, streak, balance };
  });
}

/* ---------- Transfers ---------- */

export async function transferMoney(userId: string, input: { userName: string; amount: number; note: string; idempotencyKey: string }) {
  const result = await withTransaction(async (client) => {
    const target = await client.query<{ id: string; username: string }>(`SELECT id, username FROM "user" WHERE LOWER(username) = LOWER($1)`, [input.userName]);
    const recipient = target.rows[0];
    if (!recipient) throw new EconomyError(`No resident is called ${input.userName}.`, 404);
    if (recipient.id === userId) throw new EconomyError("You can't send money to yourself.");
    const sender = await client.query<{ username: string }>(`SELECT username FROM "user" WHERE id = $1`, [userId]);
    await ensureWallet(client, userId);
    await ensureWallet(client, recipient.id);
    // Lock both wallets in a fixed order so two residents paying each other at once can't deadlock.
    await client.query(`SELECT 1 FROM wallet WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR UPDATE`, [[userId, recipient.id]]);
    if (await replayed(client, userId, `transfer:${input.idempotencyKey}`)) {
      return { replayed: true, balance: await balanceOf(client, userId), to: recipient.username, recipientId: recipient.id, from: sender.rows[0]?.username ?? "A resident" };
    }
    const memo = input.note ? ` · “${input.note}”` : "";
    const balance = await debitWallet(client, userId, input.amount, "transfer_out", `Transfer to ${recipient.username}${memo}`, `transfer:${input.idempotencyKey}`, { to: recipient.id });
    await creditWallet(client, recipient.id, input.amount, "transfer_in", `Transfer from ${sender.rows[0]?.username ?? "a resident"}${memo}`, `transfer-in:${input.idempotencyKey}`);
    return { replayed: false, balance, to: recipient.username, recipientId: recipient.id, from: sender.rows[0]?.username ?? "A resident" };
  });
  if (!result.replayed) {
    playerEvents.emit("notice", result.recipientId, "success", `${result.from} sent you ₦${input.amount.toLocaleString("en-NG")}${input.note ? ` · “${input.note}”` : ""}. Check Phone → Bank.`);
  }
  return { replayed: result.replayed, balance: result.balance, to: result.to };
}

/* ---------- Market ---------- */

export function quotes(now = Date.now()) {
  return MARKET_ASSETS.map((asset) => {
    const price = assetPrice(asset, now, fortune);
    const dayAgo = assetPrice(asset, now - 24 * 3_600_000, fortune);
    const history = Array.from({ length: 25 }, (_, index) => assetPrice(asset, now - (24 - index) * 3_600_000, fortune));
    return { id: asset.id, symbol: asset.symbol, name: asset.name, kind: asset.kind, blurb: asset.blurb, price, change24h: (price - dayAgo) / dayAgo, history };
  });
}

export async function marketStatus(userId: string, now = Date.now()): Promise<MarketStatus> {
  const prices = quotes(now);
  const { rows } = await pool.query<{ asset_id: string; units: string; invested: string }>(
    `SELECT asset_id, units, invested FROM investment_holding WHERE user_id = $1 AND units > 0 ORDER BY asset_id`,
    [userId],
  );
  return {
    quotes: prices,
    holdings: rows.map((row) => {
      const price = prices.find((quote) => quote.id === row.asset_id)?.price ?? 0;
      return { assetId: row.asset_id, units: Number(row.units), invested: Number(row.invested), value: Math.floor(Number(row.units) * price) };
    }),
    fee: MARKET_FEE,
    at: now,
  };
}

export async function trade(userId: string, input: { assetId: string; side: "buy" | "sell"; amount: number | "all"; idempotencyKey: string }, now = Date.now()) {
  const asset = marketAsset(input.assetId);
  if (!asset) throw new EconomyError("That asset isn't listed.", 404);
  const price = assetPrice(asset, now, fortune);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const key = `trade:${input.idempotencyKey}`;
    if (await replayed(client, userId, key)) return { replayed: true, balance: await balanceOf(client, userId), units: 0, price, naira: 0 };
    await client.query(`INSERT INTO investment_holding (user_id, asset_id, units) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [userId, asset.id]);
    const { rows } = await client.query<{ units: string; invested: string }>(
      `SELECT units, invested FROM investment_holding WHERE user_id = $1 AND asset_id = $2 FOR UPDATE`,
      [userId, asset.id],
    );
    const held = Number(rows[0]!.units);
    const invested = Number(rows[0]!.invested);
    if (input.side === "buy") {
      if (input.amount === "all") throw new EconomyError("Enter how much to invest.");
      const units = Math.floor(((input.amount * (1 - MARKET_FEE)) / price) * 1e8) / 1e8;
      if (units <= 0) throw new EconomyError("That's too little to buy any.");
      const balance = await debitWallet(client, userId, input.amount, "investment_buy", `Bought ${units.toLocaleString("en-NG", { maximumFractionDigits: 8 })} ${asset.symbol} @ ₦${price.toLocaleString("en-NG")}`, key, { assetId: asset.id, units, price });
      await client.query(`UPDATE investment_holding SET units = units + $3, invested = invested + $4, updated_at = NOW() WHERE user_id = $1 AND asset_id = $2`, [userId, asset.id, units, input.amount]);
      return { replayed: false, balance, units, price, naira: input.amount };
    }
    if (held <= 0) throw new EconomyError(`You don't hold any ${asset.symbol}.`);
    const units = input.amount === "all" ? held : Math.min(held, Math.ceil((input.amount / price) * 1e8) / 1e8);
    const naira = Math.floor(units * price * (1 - MARKET_FEE));
    if (naira <= 0) throw new EconomyError("That's too little to sell.");
    const balance = await creditWallet(client, userId, naira, "investment_sell", `Sold ${units.toLocaleString("en-NG", { maximumFractionDigits: 8 })} ${asset.symbol} @ ₦${price.toLocaleString("en-NG")}`, key);
    const remaining = Math.max(0, held - units);
    const cost = remaining <= 1e-8 ? 0 : Math.round(invested * (remaining / held));
    await client.query(`UPDATE investment_holding SET units = $3, invested = $4, updated_at = NOW() WHERE user_id = $1 AND asset_id = $2`, [userId, asset.id, remaining <= 1e-8 ? 0 : remaining, cost]);
    return { replayed: false, balance, units, price, naira };
  });
}

/* ---------- Betting ---------- */

export const spinResult = (round: number) => spinMultiplier(fortune(`spin:${round}`));

const fixturesCache = new Map<number, Fixture[]>();
export function fixturesFor(round: number) {
  let fixtures = fixturesCache.get(round);
  if (!fixtures) {
    fixtures = roundFixtures(round, fortune);
    fixturesCache.set(round, fixtures);
    if (fixturesCache.size > 50) fixturesCache.delete(fixturesCache.keys().next().value!);
  }
  return fixtures;
}

function liveFixture(fixture: Fixture, now: number): LiveFixture {
  const start = fixture.round * FOOTBALL_ROUND_MS;
  const elapsed = Math.max(0, Math.min(1, (now - start) / FOOTBALL_ROUND_MS));
  const minute = Math.floor(elapsed * 90);
  const final = now >= start + FOOTBALL_ROUND_MS;
  if (now < start) return { ...fixture, minute: 0, score: null, final: false };
  const result = matchResult(fixture, fortune);
  const shown = final ? result.goals : result.goals.filter((goal) => goal.minute <= minute);
  return {
    ...fixture,
    minute: final ? 90 : minute,
    score: { home: shown.filter((goal) => goal.side === "home").length, away: shown.filter((goal) => goal.side === "away").length },
    final,
  };
}

function fixtureName(fixture: Fixture) {
  return `${footballClub(fixture.home)?.name ?? fixture.home} v ${footballClub(fixture.away)?.name ?? fixture.away}`;
}

/** Pays out every finished bet; anyone's status call settles their own bets, so no background worker is needed. */
async function settleBets(userId: string, now: number) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; game: string; round: string; fixture_id: string | null; selection: string; stake: string; odds: string | null }>(
      `SELECT id, game, round, fixture_id, selection, stake, odds FROM bet
       WHERE user_id = $1 AND status = 'pending' AND settles_at <= to_timestamp($2 / 1000.0) FOR UPDATE`,
      [userId, now],
    );
    for (const row of rows) {
      const stake = Number(row.stake);
      let payout = 0;
      let label = "";
      if (row.game === "spin") {
        const multiplier = spinResult(Number(row.round));
        payout = Math.floor(stake * multiplier);
        label = `Spin win · ${multiplier}×`;
      } else {
        const fixture = fixturesFor(Number(row.round)).find((entry) => entry.id === row.fixture_id);
        if (fixture && pickOf(matchResult(fixture, fortune)) === row.selection) payout = Math.floor(stake * Number(row.odds));
        label = fixture ? `Bet won · ${fixtureName(fixture)}` : "Bet won";
      }
      await client.query(`UPDATE bet SET status = $2, payout = $3, settled_at = NOW() WHERE id = $1`, [row.id, payout > 0 ? "won" : "lost", payout]);
      if (payout > 0) {
        await ensureWallet(client, userId);
        await creditWallet(client, userId, payout, "bet_win", label, `bet-win:${row.id}`);
      }
    }
  });
}

export async function bettingStatus(userId: string, now = Date.now()): Promise<BettingStatus> {
  await settleBets(userId, now);
  const round = spinRound(now);
  const current = footballRound(now);
  const { rows } = await pool.query<{ id: string; game: "spin" | "football"; round: string; fixture_id: string | null; selection: string; stake: string; odds: string | null; status: BetRecord["status"]; payout: string; created_at: Date }>(
    `SELECT id, game, round, fixture_id, selection, stake, odds, status, payout, created_at FROM bet WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [userId],
  );
  return {
    now,
    spin: {
      round,
      stopsAt: spinStopsAt(round),
      closesAt: spinStopsAt(round) - SPIN_CLOSE_MS,
      last: Array.from({ length: 12 }, (_, index) => round - 1 - index).map((past) => ({ round: past, multiplier: spinResult(past) })),
    },
    football: {
      upcoming: fixturesFor(current + 1),
      kickoffAt: (current + 1) * FOOTBALL_ROUND_MS,
      live: fixturesFor(current).map((fixture) => liveFixture(fixture, now)),
      results: fixturesFor(current - 1).map((fixture) => liveFixture(fixture, now)),
    },
    bets: rows.map((row) => {
      const fixture = row.fixture_id ? fixturesFor(Number(row.round)).find((entry) => entry.id === row.fixture_id) : undefined;
      const result = fixture && row.status !== "pending" ? matchResult(fixture, fortune) : null;
      const detail =
        row.game === "spin"
          ? row.status === "pending" ? "Wheel spinning…" : `Wheel stopped on ${spinResult(Number(row.round))}×`
          : fixture
            ? `${fixtureName(fixture)} · ${row.selection === "draw" ? "Draw" : footballClub(row.selection === "home" ? fixture.home : fixture.away)?.name} to win${result ? ` · FT ${result.home}–${result.away}` : ""}`
            : row.selection;
      return {
        id: row.id,
        game: row.game,
        round: Number(row.round),
        selection: row.selection,
        stake: Number(row.stake),
        odds: row.odds === null ? null : Number(row.odds),
        status: row.status,
        payout: Number(row.payout),
        createdAt: row.created_at.toISOString(),
        detail,
      };
    }),
    returnToPlayer: spinReturn(),
  };
}

async function placeBet(userId: string, bet: { game: "spin" | "football"; round: number; fixtureId: string | null; selection: string; stake: number; odds: number | null; settlesAt: number; label: string; idempotencyKey: string }) {
  if (bet.stake < BET_LIMITS.min || bet.stake > BET_LIMITS.max) throw new EconomyError("Stake out of range.");
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const key = `bet:${bet.idempotencyKey}`;
    if (await replayed(client, userId, key)) return { replayed: true, balance: await balanceOf(client, userId) };
    const balance = await debitWallet(client, userId, bet.stake, "bet_stake", bet.label, key, { game: bet.game, round: bet.round });
    await client.query(
      `INSERT INTO bet (id, user_id, game, round, fixture_id, selection, stake, odds, settles_at) VALUES ($9, $1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
      [userId, bet.game, bet.round, bet.fixtureId, bet.selection, bet.stake, bet.odds, bet.settlesAt, randomUUID()],
    );
    return { replayed: false, balance };
  });
}

export async function betSpin(userId: string, input: { stake: number; idempotencyKey: string }, now = Date.now()) {
  let round = spinRound(now);
  if (now > spinStopsAt(round) - SPIN_CLOSE_MS) round += 1;
  const result = await placeBet(userId, { game: "spin", round, fixtureId: null, selection: "wheel", stake: input.stake, odds: null, settlesAt: spinStopsAt(round), label: "Spin the wheel", idempotencyKey: input.idempotencyKey });
  return { ...result, round, stopsAt: spinStopsAt(round) };
}

export async function betFootball(userId: string, input: { fixtureId: string; pick: Pick; stake: number; idempotencyKey: string }, now = Date.now()) {
  const next = footballRound(now) + 1;
  const fixture = fixturesFor(next).find((entry) => entry.id === input.fixtureId);
  if (!fixture) throw new EconomyError("Betting on that match has closed. Pick one from the next round.", 409);
  const odds = fixture.odds[input.pick];
  const result = await placeBet(userId, {
    game: "football",
    round: next,
    fixtureId: fixture.id,
    selection: input.pick,
    stake: input.stake,
    odds,
    settlesAt: (next + 1) * FOOTBALL_ROUND_MS,
    label: `Bet · ${fixtureName(fixture)} @ ${odds}`,
    idempotencyKey: input.idempotencyKey,
  });
  return { ...result, odds };
}
