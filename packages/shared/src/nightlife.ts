import { z } from "zod";
import { COMMUNITY } from "./community.js";
import { INTERIOR_HALF, INTERIOR_ORIGIN, type Vec2 } from "./world.js";

/**
 * Clubs: pay the cover once per Lagos night for a wristband, then come and go freely until 6 am. Inside, residents
 * share one dance floor (everyone in the same club sees each other) and the bar sells soft drinks and small chops.
 * Names, DJs and menus are fictional.
 */
export type Club = {
  id: string;
  cover: number;
  tagline: string;
  dj: string;
  /** Neon accent for the fascia and the dance floor. */
  accent: string;
  /** Beats per minute for the club's music and light show. */
  bpm: number;
};

export const CLUBS: Record<string, Club> = {
  "admiralty-lounge": { id: "admiralty-lounge", cover: 2_000, tagline: "Amapiano and Afrobeats on the Lekki strip.", dj: "DJ Tobi", accent: "#8a3cff", bpm: 112 },
  "awolowo-rooftop": { id: "awolowo-rooftop", cover: 5_000, tagline: "Ikoyi's dressy rooftop. Highlife, Afro-house and city lights.", dj: "DJ Amaka", accent: "#ff9d1c", bpm: 120 },
  "eko-nights": { id: "eko-nights", cover: 3_500, tagline: "Victoria Island's loudest dance floor. Open till dawn.", dj: "DJ Kemi", accent: "#ff2d7a", bpm: 105 },
};

export const CLUB_MENU = [
  { id: "chapman", name: "Chapman", price: 1_200, hunger: 3, energy: 4 },
  { id: "zobo", name: "Chilled zobo", price: 600, hunger: 2, energy: 2 },
  { id: "malt", name: "Malt", price: 800, hunger: 4, energy: 3 },
  { id: "energy-drink", name: "Energy drink", price: 1_500, hunger: 0, energy: 10 },
  { id: "water", name: "Bottled water", price: 300, hunger: 1, energy: 1 },
  { id: "small-chops", name: "Small chops platter", price: 2_500, hunger: 20, energy: 2 },
  { id: "suya", name: "Suya wrap", price: 2_000, hunger: 16, energy: 1 },
] as const;
export type ClubMenuItem = (typeof CLUB_MENU)[number];
export const clubMenuById = new Map<string, ClubMenuItem>(CLUB_MENU.map((item) => [item.id, item]));

export const NIGHTLIFE = {
  /** A Lagos night runs from 6 am to 6 am the next day, so a 1 am visit belongs to the evening before. */
  nightStartsAtHour: 6,
  /** Orders are taken within this distance of the bar's service point. */
  barRange: 2.2,
} as const;

/** Club room layout, in the shared interior space: bar along the west wall, DJ booth on the north wall. */
export const CLUB_LAYOUT = {
  bar: [INTERIOR_ORIGIN[0] - INTERIOR_HALF[0] + 1.9, INTERIOR_ORIGIN[1] + 0.4] as Vec2,
  dj: [INTERIOR_ORIGIN[0] + 0.6, INTERIOR_ORIGIN[1] + INTERIOR_HALF[1] - 0.9] as Vec2,
  floor: { centre: [INTERIOR_ORIGIN[0] + 0.9, INTERIOR_ORIGIN[1] + 0.7] as Vec2, half: [2.6, 2.0] as Vec2 },
} as const;

export const clubLocation = (placeId: string) => `club:${placeId}`;

/** Lagos night (YYYY-MM-DD of the evening it started) for a timestamp. */
export function lagosNight(at: number) {
  return new Date(at + (COMMUNITY.lagosUtcOffsetHours - NIGHTLIFE.nightStartsAtHour) * 3_600_000).toISOString().slice(0, 10);
}

/** End of the current Lagos night (6 am Lagos time) as epoch milliseconds. */
export function lagosNightEndsAt(at: number) {
  const night = lagosNight(at);
  return Date.parse(`${night}T00:00:00Z`) + (24 + NIGHTLIFE.nightStartsAtHour - COMMUNITY.lagosUtcOffsetHours) * 3_600_000;
}

export const clubOrderSchema = z.object({ itemId: z.string().min(1).max(40), idempotencyKey: z.uuid() });

export type ClubStatus = {
  placeId: string;
  /** Holds tonight's wristband for this club. */
  wristband: boolean;
  /** When tonight's wristband stops working (ISO). */
  validUntil: string;
  /** Total visits to this club, all nights. */
  nights: number;
};
