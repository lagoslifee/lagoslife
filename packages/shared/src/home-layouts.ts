import { plotDesignId } from "./building.js";
import { listingTemplateId } from "./homes.js";
import { INTERIOR_HALF, type Vec2 } from "./world.js";

/** How grand a home's interior is; it follows the listing's price band. */
export type HomeTier = "flat" | "house" | "apartment" | "mansion";

type Area = { x: number; z: number; hx: number; hz: number; label: string };

export type RoomKind = "living" | "bedroom" | "dining" | "study";
export const ROOM_NAMES: Record<RoomKind, string> = { living: "Living room", bedroom: "Bedroom", dining: "Dining area", study: "Study" };
/** Storey of a home: 0 is the ground floor, 1 the floor up the stairs. */
export type HomeLevel = 0 | 1;
/** Part of an open-plan home set aside for one use, as a room-local rectangle. `level` is 0 unless it is upstairs. */
export type RoomZone = { room: RoomKind; x: number; z: number; hx: number; hz: number; level?: HomeLevel };
const zone = (room: RoomKind, x0: number, x1: number, z0: number, z1: number, level?: HomeLevel): RoomZone => ({ room, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, ...(level ? { level } : {}) });
const rect = (label: string, x0: number, x1: number, z0: number, z1: number): Area => ({ label, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });

/**
 * The floor up the stairs: `y` is its height, `floors` the slabs furniture can stand on (inside the walls of the
 * upstairs rooms and the landing), `walks` everywhere a resident can walk (the floors plus the doorways between them),
 * `fixtures` what must stay clear (the doorways), and `stair` the stairwell the staircase rises through.
 */
export type UpperFloor = { y: number; floors: Area[]; walks: Area[]; fixtures: Area[]; stair: Area };

/** The mansion's upper floor: a suite over each side of the hall, joined by the landing at the head of the stairs. */
const MANSION_UPPER: UpperFloor = (() => {
  const [wall, door0, door1] = [2.6, 16.6, 18.2];
  const floors = [rect("East suite", wall + 0.15, 13, 9.35, 19.2), rect("West suite", -13, -wall - 0.15, 9.35, 19.2), rect("Landing", -wall + 0.15, wall - 0.15, 15.6, 19.2)];
  // Doorways overlap the landing and the suite on either side, so walking through always stays inside one of them.
  const doors = [rect("Suite doorway", wall - 1.0, wall + 1.0, door0, door1), rect("Suite doorway", -wall - 1.0, -wall + 1.0, door0, door1)];
  return {
    y: 3.6,
    floors,
    walks: [...floors, ...doors],
    fixtures: [rect("Bedroom door", wall + 0.15, wall + 1.2, door0, door1), rect("Study door", -wall - 1.2, -wall - 0.15, door0, door1)],
    stair: rect("Stairwell", -2.0, 2.0, 9.2, 15.6),
  };
})();

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
  /** The rooms of the plan; furniture is delivered to the room it belongs in. */
  rooms: RoomZone[];
  /** The floor up the stairs, in homes that have one. */
  upper?: UpperFloor;
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
    rooms: [zone("living", -4.2, 5.6, -4.8, 0.6), zone("dining", -5.6, 1.6, 0.6, 4.8), zone("bedroom", 1.6, 5.6, 0.6, 4.8)],
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
    rooms: [zone("living", -6.3, 7.5, -4.8, 3.4), zone("dining", -7.5, -1.0, 3.4, 8.4), zone("bedroom", 1.6, 7.5, 3.4, 8.4)],
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
    rooms: [zone("living", -4.5, 8.5, -4.8, 4.6), zone("dining", -8.5, -4.5, 0.9, 6.0), zone("bedroom", 1.6, 8.5, 4.6, 10.2), zone("study", -8.5, -1.6, 6.0, 10.2)],
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
      ...[-2.9, 2.9].map((x) => ({ label: "Gallery column", x, z: 9.45, hx: 0.25, hz: 0.25 })),
      { label: "Storage chest", x: 12.4, z: 18.15, hx: 0.6, hz: 1.05 },
    ],
    kitchen: [-11.1, 0],
    storage: [12.45, 18.5],
    rooms: [
      zone("living", 2.6, 13, 2.4, 19.2),
      zone("dining", -13, -2.6, 3.2, 19.2),
      zone("bedroom", 2.75, 13, 9.35, 19.2, 1),
      zone("study", -13, -2.75, 9.35, 19.2, 1),
    ],
    upper: MANSION_UPPER,
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

/** The room of the plan a room-local point stands in on a storey, if any. */
export function roomAt(layout: HomeLayout, x: number, z: number, level: HomeLevel = 0): RoomKind | null {
  return layout.rooms.find((room) => (room.level ?? 0) === level && Math.abs(x - room.x) <= room.hx && Math.abs(z - room.z) <= room.hz)?.room ?? null;
}

/** Whether a room-local point is inside the walls, `inset` metres clear of them. */
export function insideHome(layout: HomeLayout, x: number, z: number, inset = 0) {
  return Math.abs(x) <= layout.halfX - inset && z >= FRONT_WALL + inset && z <= layout.back - inset;
}
