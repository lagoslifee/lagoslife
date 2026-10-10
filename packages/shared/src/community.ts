import { z } from "zod";

/**
 * Community venues. The library, park and places of worship are "quiet places": visiting any of them gives the
 * same small energy lift on one shared cooldown, so no venue (religious or not) is mechanically better than another,
 * and none is ever required. The community hall offers one paid volunteer shift per Lagos calendar day.
 */
export const QUIET_PLACE_KINDS = ["library", "park", "worship"] as const;
export type QuietPlaceKind = (typeof QUIET_PLACE_KINDS)[number];

export const COMMUNITY = {
  quietVisitEnergy: 8,
  quietVisitCooldownMs: 30 * 60_000,
  volunteerWage: 1_500,
  volunteerEnergyCost: 10,
  volunteerHungerCost: 5,
  volunteerMinimumEnergy: 15,
  /** Lagos is UTC+1 all year (no daylight saving). */
  lagosUtcOffsetHours: 1,
} as const;

/** Lagos calendar date (YYYY-MM-DD) for a timestamp. */
export function lagosDay(at: number) {
  return new Date(at + COMMUNITY.lagosUtcOffsetHours * 3_600_000).toISOString().slice(0, 10);
}

export const communityVisitSchema = z.object({ placeId: z.string().min(1).max(80) });

export type CommunityStatus = {
  /** When the next quiet-place visit gives energy again (ISO), or null if it does now. */
  quietReadyAt: string | null;
  lastQuietPlaceId: string | null;
  volunteeredToday: boolean;
  volunteerDays: number;
  quietVisits: number;
};
