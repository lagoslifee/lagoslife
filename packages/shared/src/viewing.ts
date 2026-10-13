import { z } from "zod";
import { FOOTBALL_CLUBS, matchOdds, matchResult, type FootballClub, type Goal } from "./finance.js";

/**
 * Champions Viewing Centre: pay at the door for an hour, then watch the big screen. A new match kicks off every two
 * minutes and plays a full 90 at speed; everyone in the hall sees the same moment because it runs off the clock.
 */
export const VIEWING = {
  placeId: "champions-viewing-centre",
  entryFee: 1_500,
  passMinutes: 60,
  matchMs: 120_000,
} as const;

export const viewingLocation = (placeId: string = VIEWING.placeId) => `viewing:${placeId}`;
export const viewingEntrySchema = z.object({ placeId: z.string().min(3).max(60) });

/** Real milliseconds inside one match slot: walk-out, two halves, the break and the full-time card. */
export const BROADCAST = { intro: 5_000, half: 50_000, interval: 6_000, outro: 9_000 } as const;

export type BroadcastPhase = "pre" | "first" | "half" | "second" | "full";
export type Broadcast = {
  slot: number;
  startsAt: number;
  endsAt: number;
  league: string;
  home: FootballClub;
  away: FootballClub;
  phase: BroadcastPhase;
  /** Match clock in minutes (0–90), fractional. */
  minute: number;
  score: { home: number; away: number };
  goals: Goal[];
  /** The most recent goal and how many real milliseconds ago it went in. */
  lastGoal: (Goal & { ago: number }) | null;
  next: { home: FootballClub; away: FootballClub; league: string };
};

/** FNV-1a, then a mulberry finaliser: a stable public number in [0, 1) for a key. */
export function hash01(key: string) {
  let h = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    h ^= key.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

const tvRandom = (key: string) => hash01(`tv:${key}`);

/** Two clubs from the same competition, so the screen shows Arsenal v Chelsea or Enyimba v Rangers, never a mix. */
export function broadcastFixture(slot: number) {
  const leagues = [...new Set(FOOTBALL_CLUBS.map((club) => club.league))];
  const league = leagues[Math.floor(tvRandom(`${slot}:league`) * leagues.length)]!;
  const clubs = FOOTBALL_CLUBS.filter((club) => club.league === league);
  const first = Math.floor(tvRandom(`${slot}:home`) * clubs.length);
  const second = (first + 1 + Math.floor(tvRandom(`${slot}:away`) * (clubs.length - 1))) % clubs.length;
  return { league, home: clubs[first]!, away: clubs[second]! };
}

/** Real milliseconds into the slot at which match minute `minute` is played. */
export function broadcastTime(minute: number) {
  if (minute <= 45) return Math.round(BROADCAST.intro + (minute / 45) * BROADCAST.half);
  return Math.round(BROADCAST.intro + BROADCAST.half + BROADCAST.interval + ((minute - 45) / 45) * BROADCAST.half);
}

export function broadcastAt(now: number): Broadcast {
  const slot = Math.floor(now / VIEWING.matchMs);
  const startsAt = slot * VIEWING.matchMs;
  const t = now - startsAt;
  const { league, home, away } = broadcastFixture(slot);
  const fixture = { id: `tv${slot}-${home.id}-${away.id}`, round: slot, home: home.id, away: away.id, odds: matchOdds(home, away) };
  const result = matchResult(fixture, tvRandom);
  const firstEnd = BROADCAST.intro + BROADCAST.half;
  const secondStart = firstEnd + BROADCAST.interval;
  const secondEnd = secondStart + BROADCAST.half;
  let phase: BroadcastPhase;
  let minute: number;
  if (t < BROADCAST.intro) [phase, minute] = ["pre", 0];
  else if (t < firstEnd) [phase, minute] = ["first", ((t - BROADCAST.intro) / BROADCAST.half) * 45];
  else if (t < secondStart) [phase, minute] = ["half", 45];
  else if (t < secondEnd) [phase, minute] = ["second", 45 + ((t - secondStart) / BROADCAST.half) * 45];
  else [phase, minute] = ["full", 90];
  const goals = result.goals.filter((goal) => broadcastTime(goal.minute) <= t);
  const last = goals[goals.length - 1];
  const nextFixture = broadcastFixture(slot + 1);
  return {
    slot,
    startsAt,
    endsAt: startsAt + VIEWING.matchMs,
    league,
    home,
    away,
    phase,
    minute,
    score: { home: goals.filter((goal) => goal.side === "home").length, away: goals.filter((goal) => goal.side === "away").length },
    goals,
    lastGoal: last ? { ...last, ago: t - broadcastTime(last.minute) } : null,
    next: nextFixture,
  };
}

/** Full-time score of a slot, for tests and the "last result" line. */
export function broadcastResult(slot: number) {
  const { home, away } = broadcastFixture(slot);
  return matchResult({ id: `tv${slot}-${home.id}-${away.id}`, round: slot, home: home.id, away: away.id, odds: matchOdds(home, away) }, tvRandom);
}

export type ViewingStatus = { placeId: string; fee: number; passUntil: string | null };
