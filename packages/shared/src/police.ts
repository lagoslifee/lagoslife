import { z } from "zod";
import type { Vec2 } from "./world.js";

/**
 * Fictional policing. Checkpoints stop drivers on a few major roads to check their papers (valid insurance and a
 * roadworthy car); driving off risks a heavier fine. Robberies are seen and recorded by the server, so a report at a
 * police station is checked against that record rather than taken on one player's word. All penalties are citations
 * in game naira, appealable like traffic fines.
 */
export const POLICE = {
  authority: "Lagos Police (fictional)",
  /** Drivers passing this close to a checkpoint are flagged down. */
  checkpointRadius: 12,
  /** A driver is stopped at most once in this window. */
  checkpointCooldownMs: 15 * 60_000,
  /** Time to answer the officer; driving more than `fleeDistance` from the checkpoint counts as driving off. */
  answerMs: 25_000,
  fleeDistance: 45,
  /** Chance a driver who drives off gets away without a fine. */
  fleeEscapeChance: 0.5,
  /** Below this condition (0–100) a car isn't roadworthy. */
  roadworthyCondition: 30,
} as const;

export const ROBBERY = {
  /** Robber and victim must both be on foot and this close. */
  range: 3,
  /** Share of the victim's balance taken, capped. */
  share: 0.1,
  cap: 20_000,
  /** The victim decides within this window; no answer counts as handing it over. */
  responseMs: 8_000,
  /** Chance a victim who runs gets away. */
  runEscapeChance: 0.5,
  robberCooldownMs: 30 * 60_000,
  /** The same resident can't be robbed again for this long. */
  victimCooldownMs: 2 * 3_600_000,
  /** Residents in their first hour can't be robbed. */
  newResidentMs: 60 * 60_000,
  /** Robberies this close to a police station or checkpoint are seen by officers and charged at once. */
  witnessRange: 60,
  /** Reports must be made within this long of the robbery. */
  reportWindowMs: 24 * 3_600_000,
} as const;

export type Checkpoint = { id: string; name: string; point: Vec2; yaw: number };

/** On one carriageway each of Admiralty Way, Ozumba Mbadiwe Avenue, Awolowo Road and Ahmadu Bello Way. */
export const POLICE_CHECKPOINTS: Checkpoint[] = [
  { id: "admiralty-checkpoint", name: "Admiralty Way checkpoint", point: [-299.8, 376.1], yaw: 1.442 },
  { id: "ozumba-checkpoint", name: "Ozumba Mbadiwe checkpoint", point: [-5198.6, -717.3], yaw: -1.947 },
  { id: "awolowo-checkpoint", name: "Awolowo Road checkpoint", point: [-4678.4, 60.6], yaw: -1.622 },
  { id: "ahmadu-bello-checkpoint", name: "Ahmadu Bello Way checkpoint", point: [-5582.2, -2378.6], yaw: -1.641 },
];

export const checkpointAnswerSchema = z.object({ checkpointId: z.string().min(1).max(60), answer: z.enum(["comply", "flee"]) });
export const robberyAnswerSchema = z.object({ robberyId: z.string().min(1).max(60), answer: z.enum(["comply", "run"]) });
export const holdUpSchema = z.object({ sessionId: z.string().min(1).max(60) });
export const policeReportSchema = z.object({ userName: z.string().trim().min(1).max(40), details: z.string().trim().max(500).default("") });

export type CheckpointStop = { checkpointId: string; name: string; expiresAt: number };
export type HoldUp = { robberyId: string; robberName: string; amount: number; expiresAt: number };
export type RobberyRecord = {
  id: string;
  role: "victim" | "robber";
  otherName: string;
  amount: number;
  outcome: "robbed" | "escaped" | "caught";
  at: string;
  reported: boolean;
};
export type PoliceCase = { id: string; accusedName: string; status: "charged" | "no_record"; createdAt: string; amount: number };

export const SECURITY_PLANS = {
  pair: { guards: 2, price: 25_000, label: "Two guards and a Hilux" },
  squad: { guards: 4, price: 45_000, label: "Four guards and a Hilux" },
} as const;
export type SecurityPlanId = keyof typeof SECURITY_PLANS;
export const SECURITY = {
  /** A hire lasts this long. */
  hireMs: 24 * 3_600_000,
  company: "Eko Shield Security (fictional)",
} as const;
export const hireSecuritySchema = z.object({ plan: z.enum(["pair", "squad"]), idempotencyKey: z.uuid() });
export type SecurityStatus = { plan: SecurityPlanId | null; guards: number; until: string | null };
