import { z } from "zod";
import { PLOTS } from "./building.js";
import { PLACES, STOPS, type Vec2 } from "./world.js";

export const AGBERO = {
  /** Opening ask, in game naira (rounded to ₦50). */
  askMin: 200,
  askMax: 500,
  /** The lowest he will accept after haggling. */
  floor: 100,
  /** A slow (under ~14 km/h) or stopped car this close to the spot gets approached. */
  triggerMetres: 14,
  maxSpeed: 4,
  /** Driving off faster than this answers "drive away". */
  driveOffSpeed: 6,
  answerMs: 20_000,
  /** One encounter per player per this long, and per spot. */
  playerCooldownMs: 20 * 60_000,
  spotCooldownMs: 3 * 60_000,
  /** Accounts younger than this are never approached. */
  newPlayerMs: 30 * 60_000,
  /** Chance that driving off gets an angry slap that leaves a dent; never more than one per encounter. */
  dentChance: 0.35,
  maxDents: 3,
  /** Panel-beating per dent at the mechanic; comprehensive cover pays this share. */
  dentRepair: 4_000,
  insuranceShare: 0.7,
  /** Stepping out of your own car this close to a stop, this soon after parking, brings the touts over on foot. */
  stepOutMs: 45_000,
  /** On foot, walking this far from where they surrounded you counts as walking off. */
  walkOffMetres: 18,
  /** With guards on foot, the guards move in by themselves after this beat. */
  guardsMoveMs: 2_500,
  /** Spots must be at least this far from homes, the spawn, airports and police. */
  protectedMetres: 120,
} as const;

const PROTECTED_KINDS = new Set(["starter_home", "rental", "sale", "delivery", "airport", "police", "consulate"]);
/** Doors and plots no tout may work near: homes for sale or rent, delivery homes, the spawn hostel, airports, police. */
export const PROTECTED_POINTS: Vec2[] = [
  ...PLACES.filter((place) => PROTECTED_KINDS.has(place.kind)).map((place) => place.door),
  ...PLOTS.map((plot) => plot.kerb as Vec2),
];

const SPOT_STOPS: Array<{ id: string; stops: string[] }> = [
  { id: "falomo", stops: ["falomo-eb", "falomo-wb"] },
  { id: "lateef-jakande", stops: ["lateef-jakande-eb", "lateef-jakande-wb"] },
  { id: "idowu-martins", stops: ["idowu-martins-eb", "idowu-martins-wb"] },
  { id: "ikoyi-bridge", stops: ["bridge-roundabout-eb", "bridge-roundabout-wb"] },
  { id: "akin-adesola", stops: ["akin-adesola-adeola-sb", "akin-adesola-adeola-nb"] },
];

export type AgberoSpot = { id: string; stopId: string; name: string; point: Vec2 };

/** Selected Lagos danfo stops where fictional touts (agberos) work. Nothing in Dubai. */
export const AGBERO_SPOTS: AgberoSpot[] = SPOT_STOPS.flatMap(({ id, stops }) =>
  stops.flatMap((stopId) => {
    const stop = STOPS.find((entry) => entry.id === stopId);
    if (!stop) return [];
    const point = stop.pole as Vec2;
    if (PROTECTED_POINTS.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) < AGBERO.protectedMetres)) return [];
    return [{ id: `${id}:${stopId}`, stopId, name: stop.name, point }];
  }),
);

export const agberoAnswerSchema = z.object({
  encounterId: z.string().min(1).max(64),
  choice: z.enum(["pay", "negotiate", "drive", "police", "guards"]),
});
export type AgberoChoice = z.infer<typeof agberoAnswerSchema>["choice"];

/** Sent to the driver; `null` ends the prompt. */
export type AgberoEncounter = {
  id: string;
  spotName: string;
  ask: number;
  negotiated: boolean;
  hasGuards: boolean;
  /** The player just stepped out of their car: the boys surround them on foot. */
  onFoot: boolean;
  expiresAt: number;
  point: Vec2;
};

/** How an encounter ended, so the client can play it out: notes sprayed, guards chasing the boys off, and so on. */
export type AgberoOutcome = { id: string; outcome: StreetIncident["outcome"]; amount: number; point: Vec2; onFoot: boolean };

export type StreetIncident = {
  id: string;
  spotName: string;
  outcome: "paid" | "drove_off" | "police" | "guards" | "ignored";
  paid: number;
  dent: boolean;
  reported: boolean;
  cctv: boolean;
  at: string;
};

export function dentQuote(dents: number, insured: boolean) {
  const full = dents * AGBERO.dentRepair;
  return { full, pay: insured ? Math.round((full * (1 - AGBERO.insuranceShare)) / 50) * 50 : full };
}
