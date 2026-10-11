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
  /** One VIP table for the night, seats the owner and up to TABLE_GUESTS_MAX invited guests. */
  tablePrice: number;
};

export const CLUBS: Record<string, Club> = {
  "admiralty-lounge": { id: "admiralty-lounge", cover: 2_000, tablePrice: 40_000, tagline: "Amapiano and Afrobeats on the Lekki strip.", dj: "DJ Tobi", accent: "#8a3cff", bpm: 112 },
  "awolowo-rooftop": { id: "awolowo-rooftop", cover: 5_000, tablePrice: 80_000, tagline: "Ikoyi's dressy rooftop. Highlife, Afro-house and city lights.", dj: "DJ Amaka", accent: "#ff9d1c", bpm: 120 },
  "eko-nights": { id: "eko-nights", cover: 3_500, tablePrice: 60_000, tagline: "Victoria Island's loudest dance floor. Open till dawn.", dj: "DJ Kemi", accent: "#ff2d7a", bpm: 105 },
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
  floor: { centre: [INTERIOR_ORIGIN[0] + 0.4, INTERIOR_ORIGIN[1] + 0.7] as Vec2, half: [2.6, 2.0] as Vec2 },
} as const;

/** VIP booths along the east wall: sofa against the wall, table in front, `spot` is where you stand to use it. */
export const CLUB_TABLES = [1, 2, 3].map((no) => {
  const z = INTERIOR_ORIGIN[1] - 3.2 + (no - 1) * 3.0;
  const x = INTERIOR_ORIGIN[0] + INTERIOR_HALF[0];
  return { no, sofa: [x - 0.55, z] as Vec2, table: [x - 1.5, z] as Vec2, spot: [x - 2.3, z] as Vec2 };
});
export const TABLE_GUESTS_MAX = 5;
/** Bottles are ordered from the table and carried over by a waiter; served only to the table's owner and guests. */
export const BOTTLE_MENU = [
  { id: "dom-perignon", name: "Dom Pérignon", price: 150_000, sparkler: true },
  { id: "clase-azul", name: "Clase Azul Reposado", price: 120_000, sparkler: true },
  { id: "moet", name: "Moët & Chandon Impérial", price: 60_000, sparkler: true },
  { id: "hennessy-vs", name: "Hennessy VS", price: 45_000, sparkler: false },
  { id: "sparkling-juice", name: "Sparkling grape juice (alcohol-free)", price: 12_000, sparkler: false },
  { id: "chapman-jug", name: "Chapman jug (alcohol-free)", price: 8_000, sparkler: false },
] as const;
export type BottleItem = (typeof BOTTLE_MENU)[number];
export const bottleById = new Map<string, BottleItem>(BOTTLE_MENU.map((item) => [item.id, item]));
/** Bottles shown on a table; older ones are cleared away. */
export const TABLE_BOTTLES_SHOWN = 6;

export const tableInviteSchema = z.object({ userName: z.string().trim().min(1).max(40) });
export const tableBottleSchema = z.object({ itemId: z.string().min(1).max(40), idempotencyKey: z.uuid() });

export type ClubTable = {
  no: number;
  ownerName: string | null;
  mine: boolean;
  guest: boolean;
  guests: string[];
  bottles: Array<{ id: string; itemId: string; byName: string; at: string }>;
};

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
