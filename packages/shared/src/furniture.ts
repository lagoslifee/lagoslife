import { FRONT_WALL, HOME_LAYOUTS, type HomeLayout } from "./home-layouts.js";
import { INTERIOR_HALF, type Vec2 } from "./world.js";

export type FurnitureRotation = 0 | 90 | 180 | 270;

/**
 * Furniture a resident can buy and arrange at home. `size` is the footprint in metres at rotation 0: width along the
 * room's x axis, depth along z (the back of a sofa or the headboard of a bed faces +z).
 * Keep in step with shop_catalog rows in apps/server/migrations (0004 and 0026).
 */
export type FurnitureItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  size: [number, number];
  /** Rugs and mats: walked over and furnished on top of, so they never block other pieces. */
  floor?: boolean;
  /** Lets the owner (and invited guests) sleep at home. */
  bed?: boolean;
  /** Colour used for the piece on the floor plan. */
  plan: string;
  /** Label on the floor plan. */
  short: string;
};

export const FURNITURE: FurnitureItem[] = [
  { id: "island-bed", name: "Island Double Bed", description: "A comfortable bed that enables sleeping at home.", price: 36_000, size: [1.7, 2.2], bed: true, plan: "#8fb3e0", short: "Bed" },
  { id: "lagoon-sofa", name: "Lagoon Sofa", description: "A compact teal sofa for a Lagos living room.", price: 28_000, size: [2.4, 1.0], plan: "#3a9a8f", short: "Sofa" },
  { id: "woven-table", name: "Woven Side Table", description: "A locally inspired table for small interiors.", price: 9_500, size: [1.3, 0.8], plan: "#b07a46", short: "Table" },
  { id: "eko-king-bed", name: "Eko King Bed", description: "A wide upholstered king bed with bedside tables.", price: 78_000, size: [2.9, 2.4], bed: true, plan: "#c9b7e8", short: "King bed" },
  { id: "ikoyi-sectional", name: "Ikoyi Sectional Sofa", description: "An L-shaped grey sectional that seats six.", price: 95_000, size: [2.8, 2.0], plan: "#8d939b", short: "Sectional" },
  { id: "velvet-armchair", name: "Velvet Armchair", description: "A deep mustard armchair for reading by the window.", price: 22_000, size: [0.95, 0.95], plan: "#d9a526", short: "Chair" },
  { id: "marble-coffee-table", name: "Marble Coffee Table", description: "A low white marble table for the sitting room.", price: 18_000, size: [1.2, 0.65], plan: "#e8e4dc", short: "Coffee" },
  { id: "dining-set", name: "Six-seat Dining Set", description: "A walnut dining table with six chairs for Sunday rice.", price: 65_000, size: [2.2, 1.7], plan: "#7a5232", short: "Dining" },
  { id: "tv-console", name: "TV and Media Console", description: "A 65-inch TV on a long low console.", price: 55_000, size: [1.9, 0.5], plan: "#2b2f36", short: "TV" },
  { id: "wardrobe", name: "Sliding Wardrobe", description: "A tall wardrobe with mirrored sliding doors.", price: 48_000, size: [1.7, 0.65], plan: "#cfc6b6", short: "Wardrobe" },
  { id: "bookshelf", name: "Open Bookshelf", description: "Five open shelves of books and keepsakes.", price: 21_000, size: [1.0, 0.4], plan: "#9c6b3f", short: "Books" },
  { id: "work-desk", name: "Work Desk and Chair", description: "A desk with a laptop and an office chair.", price: 32_000, size: [1.4, 1.2], plan: "#5c6b7a", short: "Desk" },
  { id: "floor-lamp", name: "Arc Floor Lamp", description: "A brass floor lamp with a warm shade.", price: 9_000, size: [0.45, 0.45], plan: "#f2d27a", short: "Lamp" },
  { id: "potted-palm", name: "Potted Palm", description: "A tall areca palm in a clay pot.", price: 7_500, size: [0.6, 0.6], plan: "#4f9a4a", short: "Palm" },
  { id: "aso-rug", name: "Aso-oke Pattern Rug", description: "A large woven rug in indigo and gold.", price: 16_000, size: [2.6, 1.8], floor: true, plan: "#3b4f8f", short: "Rug" },
];

const furnitureIndex = new Map(FURNITURE.map((item) => [item.id, item]));

export function furnitureItem(id: string) {
  return furnitureIndex.get(id) ?? null;
}

export const BED_ITEM_IDS = FURNITURE.filter((item) => item.bed).map((item) => item.id);

/** Room-local rectangle: centre and half extents, in metres from the middle of the room. */
export type FloorRect = { x: number; z: number; hx: number; hz: number };

export const ROOM_HALF: Vec2 = INTERIOR_HALF;

/** Parts of a flat that must stay clear: the way in from the front door, the kitchen counter and the storage chest. */
export const HOME_FIXTURES: Array<FloorRect & { label: string }> = HOME_LAYOUTS.flat.fixtures;

/** Floor area a piece covers at a position and rotation. */
export function furnitureRect(item: Pick<FurnitureItem, "size">, x: number, z: number, rotation: number): FloorRect {
  const turned = rotation === 90 || rotation === 270;
  const [w, d] = item.size;
  return { x, z, hx: (turned ? d : w) / 2, hz: (turned ? w : d) / 2 };
}

function overlaps(a: FloorRect, b: FloorRect, gap = 0) {
  return Math.abs(a.x - b.x) < a.hx + b.hx + gap && Math.abs(a.z - b.z) < a.hz + b.hz + gap;
}

/** Where pieces placed on the old 8 × 6 grid stand, in room-local metres. */
export function legacyCellPosition(gridX: number, gridZ: number): Vec2 {
  return [-ROOM_HALF[0] + (gridX + 0.5) * 1.4, -ROOM_HALF[1] + (gridZ + 0.5) * 1.6];
}

/** Nearest old grid cell, still stored alongside free positions for older clients. */
export function nearestCell(x: number, z: number): Vec2 {
  return [
    Math.max(0, Math.min(7, Math.floor((x + ROOM_HALF[0]) / 1.4))),
    Math.max(0, Math.min(5, Math.floor((z + ROOM_HALF[1]) / 1.6))),
  ];
}

export type PlacedPiece = { id?: string; itemId: string; x: number; z: number; rotation: number };

/** Positions snap to 10 cm so a dragged piece lands where it looks like it does on the plan. */
export function snapFloor(value: number) {
  return Math.round(value * 10) / 10;
}

/** Why a piece cannot stand here, or null if it can. `others` may include the piece itself (matched by id). */
export function placementProblem(piece: PlacedPiece, others: PlacedPiece[], layout: HomeLayout = HOME_LAYOUTS.flat): string | null {
  const item = furnitureItem(piece.itemId);
  if (!item) return "That is not furniture.";
  if (![0, 90, 180, 270].includes(piece.rotation)) return "Turn furniture in quarter turns.";
  const rect = furnitureRect(item, piece.x, piece.z, piece.rotation);
  const margin = 0.05;
  for (const fixture of layout.fixtures) {
    if (overlaps(rect, fixture)) return fixture.label === "Front door" ? "Keep the doorway clear — furniture cannot block the exit." : `Leave the ${fixture.label.toLowerCase()} clear.`;
  }
  if (
    Math.abs(rect.x) + rect.hx > layout.halfX - margin + 1e-6 ||
    rect.z - rect.hz < FRONT_WALL + margin - 1e-6 ||
    rect.z + rect.hz > layout.back - margin + 1e-6
  ) {
    return "Keep it inside the walls.";
  }
  if (item.floor) return null;
  for (const other of others) {
    if (piece.id && other.id === piece.id) continue;
    const otherItem = furnitureItem(other.itemId);
    if (!otherItem || otherItem.floor) continue;
    if (overlaps(rect, furnitureRect(otherItem, other.x, other.z, other.rotation))) return `It would sit on top of the ${otherItem.name.toLowerCase()}.`;
  }
  return null;
}

/** A free spot for a newly bought piece, scanning from the middle of the room outwards; null when the room is full. */
export function findFreeSpot(itemId: string, others: PlacedPiece[], layout: HomeLayout = HOME_LAYOUTS.flat): { x: number; z: number; rotation: FurnitureRotation } | null {
  const candidates: Array<[number, number]> = [];
  for (let x = -layout.halfX; x <= layout.halfX; x += 0.2) {
    for (let z = FRONT_WALL; z <= layout.back; z += 0.2) candidates.push([snapFloor(x), snapFloor(z)]);
  }
  candidates.sort((a, b) => Math.hypot(a[0], a[1] - 0.6) - Math.hypot(b[0], b[1] - 0.6));
  for (const rotation of [0, 90] as const) {
    for (const [x, z] of candidates) {
      if (!placementProblem({ itemId, x, z, rotation }, others, layout)) return { x, z, rotation };
    }
  }
  return null;
}
