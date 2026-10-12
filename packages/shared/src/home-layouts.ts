import { plotDesignId } from "./building.js";
import { listingTemplateId } from "./homes.js";
import { INTERIOR_HALF, type Vec2 } from "./world.js";

/** How grand a home's interior is; it follows the listing's price band. */
export type HomeTier = "flat" | "house" | "apartment" | "mansion";

type Area = { x: number; z: number; hx: number; hz: number; label: string };

/**
 * One interior plan. Coordinates are room-local metres from INTERIOR_ORIGIN, the same frame furniture is saved in.
 * Every plan shares the front wall (and so the street door, spawn and exit) at z = FRONT_WALL and grows north, east
 * and west from there, so furniture placed in the original room stays inside the walls of every plan.
 */
export type HomeLayout = {
  tier: HomeTier;
  name: string;
  halfX: number;
  back: number;
  height: number;
  /** Built-in parts of the home that furniture must leave clear. */
  fixtures: Area[];
  /** Where to stand to cook, and the centre of the storage chest. */
  kitchen: Vec2;
  storage: Vec2;
};

export const FRONT_WALL = -INTERIOR_HALF[1];
const door: Area = { label: "Front door", x: 0, z: FRONT_WALL + 1.05, hx: 1.2, hz: 1.05 };

export const HOME_LAYOUTS: Record<HomeTier, HomeLayout> = {
  flat: {
    tier: "flat",
    name: "Flat",
    halfX: INTERIOR_HALF[0],
    back: INTERIOR_HALF[1],
    height: 3.0,
    fixtures: [
      door,
      { label: "Kitchen", x: -INTERIOR_HALF[0] + 0.7, z: -1.2, hx: 0.7, hz: 1.7 },
      { label: "Storage chest", x: INTERIOR_HALF[0] - 0.6, z: INTERIOR_HALF[1] - 1.05, hx: 0.6, hz: 1.05 },
    ],
    kitchen: [-INTERIOR_HALF[0] + 1.3, -1.2],
    storage: [INTERIOR_HALF[0] - 0.55, INTERIOR_HALF[1] - 0.7],
  },
  house: {
    tier: "house",
    name: "Family house",
    halfX: 7.5,
    back: 8.4,
    height: 3.4,
    fixtures: [
      door,
      { label: "Kitchen", x: -6.9, z: -1.0, hx: 0.6, hz: 2.2 },
      { label: "Hall console", x: 3.0, z: FRONT_WALL + 0.3, hx: 0.8, hz: 0.3 },
      { label: "Storage chest", x: 6.9, z: 7.35, hx: 0.6, hz: 1.05 },
    ],
    kitchen: [-5.9, -1.0],
    storage: [6.95, 7.7],
  },
  apartment: {
    tier: "apartment",
    name: "Luxury apartment",
    halfX: 8.5,
    back: 10.2,
    height: 3.6,
    fixtures: [
      door,
      { label: "Kitchen", x: -6.5, z: -1.5, hx: 2.0, hz: 2.4 },
      { label: "Hall console", x: 3.2, z: FRONT_WALL + 0.3, hx: 0.8, hz: 0.3 },
      { label: "Storage chest", x: 7.9, z: 9.15, hx: 0.6, hz: 1.05 },
    ],
    kitchen: [-6.65, -1.5],
    storage: [7.95, 9.5],
  },
  mansion: {
    tier: "mansion",
    name: "Mansion",
    halfX: 13,
    back: 19.2,
    height: 7.2,
    fixtures: [
      door,
      { label: "Kitchen", x: -10.7, z: 0, hx: 2.3, hz: 2.8 },
      { label: "Grand piano", x: 9.8, z: 0.5, hx: 1.5, hz: 1.6 },
      { label: "Staircase", x: 0, z: 12.4, hx: 2.4, hz: 3.4 },
      { label: "Hall console", x: -3.4, z: FRONT_WALL + 0.3, hx: 0.8, hz: 0.3 },
      { label: "Hall console", x: 3.4, z: FRONT_WALL + 0.3, hx: 0.8, hz: 0.3 },
      ...[-9, -4.5, 4.5, 9].map((x) => ({ label: "Gallery column", x, z: 15.8, hx: 0.3, hz: 0.3 })),
      { label: "Storage chest", x: 12.4, z: 18.15, hx: 0.6, hz: 1.05 },
    ],
    kitchen: [-11.1, 0],
    storage: [12.45, 18.5],
  },
};

const LISTING_TIERS: Array<[prefix: string, tier: HomeTier]> = [
  ["lekki-chief-okoro-house", "house"],
  ["vi-femi-pearse-court", "apartment"],
  ["vi-kofo-residences", "apartment"],
  ["ikoyi-", "mansion"],
];
const DESIGN_TIERS: Record<string, HomeTier> = {
  "self-contain": "flat",
  bungalow: "house",
  duplex: "apartment",
  "pool-villa": "mansion",
  "estate-mansion": "mansion",
  "helipad-mansion": "mansion",
};

/** The plan for a home; flats and anything unknown get the original room. Built houses follow their design. */
export function homeLayout(propertyId: string | null | undefined): HomeLayout {
  if (!propertyId) return HOME_LAYOUTS.flat;
  const id = listingTemplateId(propertyId);
  if (id.startsWith("built-")) return HOME_LAYOUTS[DESIGN_TIERS[plotDesignId(id.slice("built-".length)) ?? ""] ?? "flat"];
  const tier = LISTING_TIERS.find(([prefix]) => id.startsWith(prefix))?.[1];
  return HOME_LAYOUTS[tier ?? "flat"];
}

/** Whether a room-local point is inside the walls, `inset` metres clear of them. */
export function insideHome(layout: HomeLayout, x: number, z: number, inset = 0) {
  return Math.abs(x) <= layout.halfX - inset && z >= FRONT_WALL + inset && z <= layout.back - inset;
}
