import { z } from "zod";
import type { Vec2 } from "./world.js";

/** A five-a-side cage marked out on a real pitch in the OSM data; `yaw` points along its length towards Gold's goal. */
export type StreetPitch = { id: string; name: string; centre: Vec2; yaw: number; length: number; width: number };

export const STREET_PITCHES: StreetPitch[] = [
  { id: "ozumba-cage", name: "Ozumba Mbadiwe cage", centre: [-199.6, 334.7], yaw: 2.57, length: 40, width: 24 },
  { id: "ligali-pitch", name: "Ligali Ayorinde pitch", centre: [-369.4, 71.1], yaw: Math.PI / 2, length: 50, width: 28 },
];
export const streetPitchById = new Map(STREET_PITCHES.map((pitch) => [pitch.id, pitch]));

export const FOOTBALL_TEAMS = ["green", "gold"] as const;
export type FootballTeam = (typeof FOOTBALL_TEAMS)[number];

export const FOOTBALL_KITS: Record<FootballTeam, { name: string; shirt: string; shorts: string; socks: string }> = {
  green: { name: "Eko Greens", shirt: "#0f8a4a", shorts: "#f4f4f2", socks: "#0f8a4a" },
  gold: { name: "Island Golds", shirt: "#f2b705", shorts: "#17171a", socks: "#17171a" },
};

export const FOOTBALL = {
  teamMax: 5,
  /** Naira each player puts in the pot; the first player in sets it for the match. */
  stakes: [0, 2_000, 10_000, 50_000] as const,
  goalsToWin: 5,
  matchMs: 5 * 60_000,
  /** Pause after a goal before the ball goes back on the spot. */
  restartMs: 2_500,
  /** Seconds the result stays up before the cage is free again. */
  finishedMs: 12_000,
  goalWidth: 5,
  goalHeight: 2.2,
  /** A resident this far from the centre spot is walking off. */
  leaveRange: 45,
  joinRange: 35,
  kickRange: 1.6,
  dribbleRange: 1.0,
  tackleRange: 2.0,
  tackleCooldownMs: 1_500,
  tackleChance: 0.6,
  keeperReach: 2.4,
  /** Depth of the box a keeper can catch in, from their own goal line. */
  boxDepth: 7,
  passSpeed: 13,
  shotSpeed: 19,
  shotLift: 3.6,
  ballRadius: 0.11,
} as const;

/** Ball in pitch space: `along` towards Gold's goal, `across` to the right of that, `h` up. */
export type FootballBall = { along: number; across: number; h: number; va: number; vc: number; vh: number };
export const restingBall = (): FootballBall => ({ along: 0, across: 0, h: 0, va: 0, vc: 0, vh: 0 });

export type FootballPlayer = { sessionId: string; name: string; team: FootballTeam; keeper: boolean };
export type FootballEvent = { kind: "goal" | "save" | "tackle" | "kickoff" | "full_time"; team?: FootballTeam; by?: string; text: string; at: number };
export type FootballState = {
  pitchId: string;
  phase: "lobby" | "playing" | "finished";
  stake: number;
  pot: number;
  score: Record<FootballTeam, number>;
  endsAt: number | null;
  restartAt: number | null;
  players: FootballPlayer[];
  ball: FootballBall;
  holder: string | null;
  winner: FootballTeam | "draw" | null;
  event: FootballEvent | null;
};

export const footballJoinSchema = z.object({
  pitchId: z.string().min(1).max(40),
  team: z.enum(FOOTBALL_TEAMS),
  stake: z
    .number()
    .int()
    .refine((stake) => (FOOTBALL.stakes as readonly number[]).includes(stake)),
});
export const footballKickSchema = z.object({ kind: z.enum(["pass", "shoot"]), yaw: z.number().finite() });

export const attackSign = (team: FootballTeam) => (team === "green" ? 1 : -1);
export const otherTeam = (team: FootballTeam): FootballTeam => (team === "green" ? "gold" : "green");

export function toPitch(pitch: StreetPitch, x: number, z: number) {
  const [dx, dz] = [x - pitch.centre[0], z - pitch.centre[1]];
  const [s, c] = [Math.sin(pitch.yaw), Math.cos(pitch.yaw)];
  return { along: dx * s + dz * c, across: dx * c - dz * s };
}

export function fromPitch(pitch: StreetPitch, along: number, across: number): Vec2 {
  const [s, c] = [Math.sin(pitch.yaw), Math.cos(pitch.yaw)];
  return [pitch.centre[0] + s * along + c * across, pitch.centre[1] + c * along - s * across];
}

/** A world-space heading turned into a direction on the pitch. */
export function pitchDirection(pitch: StreetPitch, yaw: number) {
  const relative = yaw - pitch.yaw;
  return { along: Math.cos(relative), across: Math.sin(relative) };
}

export function nearestPitch(x: number, z: number) {
  let best: StreetPitch | null = null;
  let distance = Infinity;
  for (const pitch of STREET_PITCHES) {
    const d = Math.hypot(pitch.centre[0] - x, pitch.centre[1] - z);
    if (d < distance) [best, distance] = [pitch, d];
  }
  return best ? { pitch: best, distance } : null;
}

/**
 * Moves a loose ball one step: gravity and bounce, grass friction, rebounds off the cage walls, and a goal when it
 * crosses an end line between the posts under the bar. Returns the team that scored, if any.
 */
export function stepBall(ball: FootballBall, pitch: StreetPitch, dt: number): FootballTeam | null {
  ball.vh -= 9.8 * dt;
  ball.h += ball.vh * dt;
  if (ball.h <= 0) {
    ball.h = 0;
    ball.vh = Math.abs(ball.vh) > 1.5 ? -ball.vh * 0.45 : 0;
  }
  const drag = Math.exp(-(ball.h > 0.05 ? 0.15 : 1.1) * dt);
  ball.va *= drag;
  ball.vc *= drag;
  if (Math.hypot(ball.va, ball.vc) < 0.08) [ball.va, ball.vc] = [0, 0];
  ball.along += ball.va * dt;
  ball.across += ball.vc * dt;
  const side = pitch.width / 2 - FOOTBALL.ballRadius;
  if (Math.abs(ball.across) > side) {
    ball.across = Math.sign(ball.across) * side;
    ball.vc = -ball.vc * 0.7;
  }
  const end = pitch.length / 2;
  if (Math.abs(ball.along) > end - FOOTBALL.ballRadius) {
    const mouth = Math.abs(ball.across) < FOOTBALL.goalWidth / 2 && ball.h < FOOTBALL.goalHeight;
    if (mouth && Math.abs(ball.along) > end) return ball.along > 0 ? "green" : "gold";
    if (!mouth) {
      ball.along = Math.sign(ball.along) * (end - FOOTBALL.ballRadius);
      ball.va = -ball.va * 0.7;
    }
  }
  return null;
}
