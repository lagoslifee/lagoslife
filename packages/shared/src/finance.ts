import { z } from "zod";
import { lagosDay } from "./community.js";

/*
 * Daily bonus, the simulated stock and crypto market, and the betting games. Everything here moves fictional game
 * naira only. Random outcomes are drawn on the server from a secret seed (`rand`), so every resident sees the same
 * price, spin or score and nobody can read future results out of the client code.
 */

export type SeededRandom = (key: string) => number;

/* ---------- Daily bonus ---------- */

export const DAILY_REWARDS = [5_000, 10_000, 20_000, 30_000, 50_000, 75_000, 150_000] as const;
export function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Day 1–7 of the streak pays the matching reward; after day 7 the week repeats. */
export function dailyReward(streak: number) {
  return DAILY_REWARDS[(Math.max(1, streak) - 1) % DAILY_REWARDS.length]!;
}

/** Streak after claiming today: one more if yesterday was claimed, otherwise back to day 1. */
export function nextStreak(lastDay: string | null, streak: number, today: string) {
  if (lastDay === today) return streak;
  return lastDay === previousDay(today) ? streak + 1 : 1;
}

export type DailyStatus = { today: string; streak: number; claimedToday: boolean; nextStreak: number; nextAmount: number; rewards: readonly number[] };

/* ---------- Bank transfers ---------- */

export const TRANSFER_LIMITS = { min: 100, max: 5_000_000 };
export const transferRequestSchema = z.object({
  userName: z.string().trim().min(2).max(40),
  amount: z.number().int().min(TRANSFER_LIMITS.min).max(TRANSFER_LIMITS.max),
  note: z.string().trim().max(80).default(""),
  idempotencyKey: z.string().uuid(),
});

/* ---------- Market ---------- */

export type MarketAsset = { id: string; symbol: string; name: string; kind: "share" | "crypto"; base: number; swing: number; blurb: string };

export const MARKET_ASSETS: readonly MarketAsset[] = [
  { id: "lgt", symbol: "LGT", name: "Lagoon Telecom", kind: "share", base: 2_400, swing: 0.16, blurb: "Mobile network and data" },
  { id: "lkb", symbol: "LKB", name: "Lekki Trust Bank", kind: "share", base: 1_150, swing: 0.13, blurb: "Retail and business banking" },
  { id: "ekc", symbol: "EKC", name: "Eko Cement", kind: "share", base: 780, swing: 0.11, blurb: "Building materials" },
  { id: "nde", symbol: "NDE", name: "Delta Energy", kind: "share", base: 5_600, swing: 0.22, blurb: "Oil, gas and power" },
  { id: "jlf", symbol: "JLF", name: "Jollof Foods", kind: "share", base: 320, swing: 0.18, blurb: "Restaurants and packaged food" },
  { id: "btc", symbol: "BTC", name: "Bitcoin (simulated)", kind: "crypto", base: 95_000_000, swing: 0.32, blurb: "Game price, not the real bitcoin market" },
];
export const marketAsset = (id: string) => MARKET_ASSETS.find((asset) => asset.id === id);

/** Fee on every buy and sell, so flipping on tiny moves loses money. */
export const MARKET_FEE = 0.005;
export const TRADE_LIMITS = { min: 500, max: 10_000_000 };
const HOUR = 3_600_000;

/**
 * Multi-scale noise: each term changes every 2^k hours, so prices drift over days and wobble within the hour, but
 * stay within roughly ±swing of the base price instead of wandering to zero.
 */
function level(asset: MarketAsset, hour: number, rand: SeededRandom) {
  let total = 0;
  for (let k = 0; k < 6; k += 1) {
    const span = 2 ** k;
    total += (rand(`market:${asset.id}:${k}:${Math.floor(hour / span)}`) - 0.5) * (0.5 + k * 0.25);
  }
  return total / 2.4;
}

export function assetPrice(asset: MarketAsset, ms: number, rand: SeededRandom) {
  const hours = ms / HOUR;
  const hour = Math.floor(hours);
  const f = hours - hour;
  const blend = (1 - Math.cos(f * Math.PI)) / 2;
  const drift = level(asset, hour, rand) * (1 - blend) + level(asset, hour + 1, rand) * blend;
  const jitter = (rand(`market:${asset.id}:m:${Math.floor(ms / 60_000)}`) - 0.5) * 0.006;
  const price = asset.base * Math.exp(asset.swing * drift * 2 + jitter);
  return asset.kind === "crypto" ? Math.round(price) : Math.round(price * 100) / 100;
}

export type MarketQuote = { id: string; symbol: string; name: string; kind: MarketAsset["kind"]; blurb: string; price: number; change24h: number; history: number[] };
export type Holding = { assetId: string; units: number; invested: number; value: number };
export type MarketStatus = { quotes: MarketQuote[]; holdings: Holding[]; fee: number; at: number };

export const tradeRequestSchema = z.object({
  assetId: z.string().min(1).max(10),
  side: z.enum(["buy", "sell"]),
  /** Naira to spend when buying, or naira worth to sell; `all` sells the whole holding. */
  amount: z.union([z.number().int().min(TRADE_LIMITS.min).max(TRADE_LIMITS.max), z.literal("all")]),
  idempotencyKey: z.string().uuid(),
});

/* ---------- Betting ---------- */

export const BET_LIMITS = { min: 100, max: 1_000_000 };

export const SPIN_ROUND_MS = 20_000;
/** Bets close this long before the wheel stops. */
export const SPIN_CLOSE_MS = 3_000;
export const SPIN_SEGMENTS = [
  { multiplier: 0, weight: 58, colour: "#2b2f36" },
  { multiplier: 1.5, weight: 20, colour: "#3a8dde" },
  { multiplier: 2, weight: 13, colour: "#2fbf71" },
  { multiplier: 3, weight: 5, colour: "#f2a93b" },
  { multiplier: 5, weight: 3, colour: "#e2574c" },
  { multiplier: 10, weight: 1, colour: "#b05ce6" },
] as const;
/** The 24 slices drawn on the wheel, in order; their counts follow the weights above as closely as 24 slices allow. */
export const SPIN_WHEEL = [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 10, 0, 2] as const;

/** Expected return per naira staked on the wheel (below 1: the house keeps a small edge). */
export function spinReturn() {
  const total = SPIN_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);
  return SPIN_SEGMENTS.reduce((sum, segment) => sum + (segment.multiplier * segment.weight) / total, 0);
}

export function spinMultiplier(u: number) {
  const total = SPIN_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);
  let pick = u * total;
  for (const segment of SPIN_SEGMENTS) {
    pick -= segment.weight;
    if (pick < 0) return segment.multiplier;
  }
  return 0;
}

/** Which wheel slice to stop on for a multiplier, varied by round so the wheel doesn't always stop on the same slice. */
export function spinSlice(multiplier: number, round: number) {
  const slices = SPIN_WHEEL.flatMap((value, index) => (value === multiplier ? [index] : []));
  return slices[round % slices.length] ?? 0;
}

export const spinRound = (ms: number) => Math.floor(ms / SPIN_ROUND_MS);
export const spinStopsAt = (round: number) => (round + 1) * SPIN_ROUND_MS;

export const FOOTBALL_ROUND_MS = 10 * 60_000;
export type FootballClub = { id: string; name: string; short: string; rating: number; league: string };
export const FOOTBALL_CLUBS: readonly FootballClub[] = [
  { id: "ars", name: "Arsenal", short: "ARS", rating: 88, league: "Premier League" },
  { id: "mci", name: "Manchester City", short: "MCI", rating: 89, league: "Premier League" },
  { id: "liv", name: "Liverpool", short: "LIV", rating: 89, league: "Premier League" },
  { id: "che", name: "Chelsea", short: "CHE", rating: 84, league: "Premier League" },
  { id: "mun", name: "Manchester United", short: "MUN", rating: 82, league: "Premier League" },
  { id: "tot", name: "Tottenham", short: "TOT", rating: 81, league: "Premier League" },
  { id: "new", name: "Newcastle", short: "NEW", rating: 82, league: "Premier League" },
  { id: "avl", name: "Aston Villa", short: "AVL", rating: 81, league: "Premier League" },
  { id: "rma", name: "Real Madrid", short: "RMA", rating: 91, league: "Champions League" },
  { id: "bar", name: "Barcelona", short: "BAR", rating: 89, league: "Champions League" },
  { id: "atm", name: "Atlético Madrid", short: "ATM", rating: 84, league: "Champions League" },
  { id: "bay", name: "Bayern Munich", short: "BAY", rating: 89, league: "Champions League" },
  { id: "bvb", name: "Borussia Dortmund", short: "BVB", rating: 83, league: "Champions League" },
  { id: "psg", name: "Paris Saint-Germain", short: "PSG", rating: 87, league: "Champions League" },
  { id: "int", name: "Inter Milan", short: "INT", rating: 86, league: "Champions League" },
  { id: "juv", name: "Juventus", short: "JUV", rating: 83, league: "Champions League" },
  { id: "eny", name: "Enyimba", short: "ENY", rating: 72, league: "NPFL" },
  { id: "rin", name: "Rangers International", short: "RAN", rating: 70, league: "NPFL" },
  { id: "rem", name: "Remo Stars", short: "REM", rating: 70, league: "NPFL" },
  { id: "kan", name: "Kano Pillars", short: "KAN", rating: 69, league: "NPFL" },
];
const clubById = new Map(FOOTBALL_CLUBS.map((club) => [club.id, club]));
export const footballClub = (id: string) => clubById.get(id);
export const FOOTBALL_MATCHES_PER_ROUND = 6;

export type Fixture = { id: string; round: number; home: string; away: string; odds: { home: number; draw: number; away: number } };
export type Pick = "home" | "draw" | "away";

/** Same-competition pairings so fixtures look like real ones: Arsenal v Chelsea, Real Madrid v Bayern, Enyimba v Rangers. */
export function roundFixtures(round: number, rand: SeededRandom): Fixture[] {
  const leagues = new Map<string, FootballClub[]>();
  for (const entry of FOOTBALL_CLUBS) leagues.set(entry.league, [...(leagues.get(entry.league) ?? []), entry]);
  const pairs: Array<[FootballClub, FootballClub]> = [];
  for (const [league, clubs] of leagues) {
    const order = [...clubs].sort((a, b) => rand(`fx:${round}:${league}:${a.id}`) - rand(`fx:${round}:${league}:${b.id}`));
    for (let index = 0; index + 1 < order.length; index += 2) pairs.push([order[index]!, order[index + 1]!]);
  }
  pairs.sort((a, b) => rand(`fx:${round}:pick:${a[0].id}`) - rand(`fx:${round}:pick:${b[0].id}`));
  return pairs.slice(0, FOOTBALL_MATCHES_PER_ROUND).map(([home, away]) => ({ id: `${round}-${home.id}-${away.id}`, round, home: home.id, away: away.id, odds: matchOdds(home, away) }));
}

export function expectedGoals(home: FootballClub, away: FootballClub) {
  const diff = (home.rating - away.rating) / 22;
  return { home: 1.45 * Math.exp(diff), away: 1.15 * Math.exp(-diff) };
}

function poisson(lambda: number, goals: number) {
  let p = Math.exp(-lambda);
  for (let k = 1; k <= goals; k += 1) p *= lambda / k;
  return p;
}

export function matchProbabilities(home: FootballClub, away: FootballClub) {
  const xg = expectedGoals(home, away);
  const result = { home: 0, draw: 0, away: 0 };
  for (let h = 0; h <= 9; h += 1) {
    for (let a = 0; a <= 9; a += 1) {
      const p = poisson(xg.home, h) * poisson(xg.away, a);
      if (h > a) result.home += p;
      else if (h === a) result.draw += p;
      else result.away += p;
    }
  }
  const total = result.home + result.draw + result.away;
  return { home: result.home / total, draw: result.draw / total, away: result.away / total };
}

/** Bookmaker odds with an 8% margin, never below 1.05. */
export function matchOdds(home: FootballClub, away: FootballClub) {
  const p = matchProbabilities(home, away);
  const price = (q: number) => Math.max(1.05, Math.round((0.92 / q) * 100) / 100);
  return { home: price(p.home), draw: price(p.draw), away: price(p.away) };
}

function poissonDraw(lambda: number, u: number) {
  let goals = 0;
  let cumulative = poisson(lambda, 0);
  while (u > cumulative && goals < 9) {
    goals += 1;
    cumulative += poisson(lambda, goals);
  }
  return goals;
}

export type Goal = { side: "home" | "away"; minute: number };
export type MatchResult = { home: number; away: number; goals: Goal[] };

/** Full-time score and goal minutes for a fixture; the server only reveals goals whose minute has been played. */
export function matchResult(fixture: Fixture, rand: SeededRandom): MatchResult {
  const xg = expectedGoals(footballClub(fixture.home)!, footballClub(fixture.away)!);
  const home = poissonDraw(xg.home, rand(`fx:${fixture.id}:home`));
  const away = poissonDraw(xg.away, rand(`fx:${fixture.id}:away`));
  const goals: Goal[] = [];
  for (let index = 0; index < home; index += 1) goals.push({ side: "home", minute: 1 + Math.floor(rand(`fx:${fixture.id}:hm:${index}`) * 90) });
  for (let index = 0; index < away; index += 1) goals.push({ side: "away", minute: 1 + Math.floor(rand(`fx:${fixture.id}:am:${index}`) * 90) });
  goals.sort((a, b) => a.minute - b.minute);
  return { home, away, goals };
}

export const pickOf = (result: { home: number; away: number }): Pick => (result.home > result.away ? "home" : result.home === result.away ? "draw" : "away");
export const footballRound = (ms: number) => Math.floor(ms / FOOTBALL_ROUND_MS);

export const spinBetSchema = z.object({ stake: z.number().int().min(BET_LIMITS.min).max(BET_LIMITS.max), idempotencyKey: z.string().uuid() });
export const footballBetSchema = z.object({
  fixtureId: z.string().min(3).max(40),
  pick: z.enum(["home", "draw", "away"]),
  stake: z.number().int().min(BET_LIMITS.min).max(BET_LIMITS.max),
  idempotencyKey: z.string().uuid(),
});

export type BetRecord = { id: string; game: "spin" | "football"; round: number; selection: string; stake: number; odds: number | null; status: "pending" | "won" | "lost"; payout: number; createdAt: string; detail: string };
export type LiveFixture = Fixture & { minute: number; score: { home: number; away: number } | null; final: boolean };
export type BettingStatus = {
  now: number;
  spin: { round: number; stopsAt: number; closesAt: number; last: Array<{ round: number; multiplier: number }> };
  football: { upcoming: Fixture[]; kickoffAt: number; live: LiveFixture[]; results: LiveFixture[] };
  bets: BetRecord[];
  returnToPlayer: number;
};

/* ---------- Spraying money ---------- */

/** Notes thrown to the car spotters. The money leaves the player's wallet and goes to NPCs, not to other players. */
export const SPRAY_AMOUNTS = [2_000, 5_000, 20_000] as const;
export const spraySchema = z.object({
  amount: z.union([z.literal(SPRAY_AMOUNTS[0]), z.literal(SPRAY_AMOUNTS[1]), z.literal(SPRAY_AMOUNTS[2])]),
  idempotencyKey: z.string().min(8).max(80),
});
