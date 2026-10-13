import { FRONT_WALL, HOME_LAYOUTS, roomAt, type HomeLayout, type HomeLevel, type RoomKind } from "./home-layouts.js";
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
  /** Rooms it belongs in, best first; a new piece is delivered to the first one the home has. */
  rooms: RoomKind[];
  /** Stands with its back (or headboard) against a wall. */
  wall?: boolean;
  /** Colour used for the piece on the floor plan. */
  plan: string;
  /** Label on the floor plan. */
  short: string;
};

export const FURNITURE: FurnitureItem[] = [
  { id: "island-bed", name: "Island Double Bed", description: "A comfortable bed that enables sleeping at home.", price: 36_000, size: [1.7, 2.2], bed: true, rooms: ["bedroom"], wall: true, plan: "#8fb3e0", short: "Bed" },
  { id: "lagoon-sofa", name: "Lagoon Sofa", description: "A compact teal sofa for a Lagos living room.", price: 28_000, size: [2.4, 1.0], rooms: ["living"], plan: "#3a9a8f", short: "Sofa" },
  { id: "woven-table", name: "Woven Side Table", description: "A locally inspired table for small interiors.", price: 9_500, size: [1.3, 0.8], rooms: ["living", "bedroom"], plan: "#b07a46", short: "Table" },
  { id: "eko-king-bed", name: "Eko King Bed", description: "A wide upholstered king bed with bedside tables.", price: 78_000, size: [2.9, 2.4], bed: true, rooms: ["bedroom"], wall: true, plan: "#c9b7e8", short: "King bed" },
  { id: "ikoyi-sectional", name: "Ikoyi Sectional Sofa", description: "An L-shaped grey sectional that seats six.", price: 95_000, size: [2.8, 2.0], rooms: ["living"], plan: "#8d939b", short: "Sectional" },
  { id: "velvet-armchair", name: "Velvet Armchair", description: "A deep mustard armchair for reading by the window.", price: 22_000, size: [0.95, 0.95], rooms: ["living", "study", "bedroom"], plan: "#d9a526", short: "Chair" },
  { id: "marble-coffee-table", name: "Marble Coffee Table", description: "A low white marble table for the sitting room.", price: 18_000, size: [1.2, 0.65], rooms: ["living"], plan: "#e8e4dc", short: "Coffee" },
  { id: "dining-set", name: "Six-seat Dining Set", description: "A walnut dining table with six chairs for Sunday rice.", price: 65_000, size: [2.2, 1.7], rooms: ["dining"], plan: "#7a5232", short: "Dining" },
  { id: "tv-console", name: "TV and Media Console", description: "A 65-inch TV on a long low console.", price: 55_000, size: [1.9, 0.5], rooms: ["living"], wall: true, plan: "#2b2f36", short: "TV" },
  { id: "wardrobe", name: "Sliding Wardrobe", description: "A tall wardrobe with mirrored sliding doors.", price: 48_000, size: [1.7, 0.65], rooms: ["bedroom"], wall: true, plan: "#cfc6b6", short: "Wardrobe" },
  { id: "bookshelf", name: "Open Bookshelf", description: "Five open shelves of books and keepsakes.", price: 21_000, size: [1.0, 0.4], rooms: ["study", "living"], wall: true, plan: "#9c6b3f", short: "Books" },
  { id: "work-desk", name: "Work Desk and Chair", description: "A desk with a laptop and an office chair.", price: 32_000, size: [1.4, 1.2], rooms: ["study", "bedroom"], wall: true, plan: "#5c6b7a", short: "Desk" },
  { id: "floor-lamp", name: "Arc Floor Lamp", description: "A brass floor lamp with a warm shade.", price: 9_000, size: [0.45, 0.45], rooms: ["living", "bedroom"], plan: "#f2d27a", short: "Lamp" },
  { id: "potted-palm", name: "Potted Palm", description: "A tall areca palm in a clay pot.", price: 7_500, size: [0.6, 0.6], rooms: ["living"], wall: true, plan: "#4f9a4a", short: "Palm" },
  { id: "aso-rug", name: "Aso-oke Pattern Rug", description: "A large woven rug in indigo and gold.", price: 16_000, size: [2.6, 1.8], floor: true, rooms: ["living"], plan: "#3b4f8f", short: "Rug" },
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

/** `level` is the storey (see HomeLevel); pieces without one stand on the ground floor. */
export type PlacedPiece = { id?: string; itemId: string; x: number; z: number; rotation: number; level?: number | null };

const levelOf = (piece: Pick<PlacedPiece, "level">): HomeLevel => (piece.level === 1 ? 1 : 0);
const within = (inner: FloorRect, outer: FloorRect, margin: number) =>
  Math.abs(inner.x - outer.x) + inner.hx <= outer.hx - margin + 1e-6 && Math.abs(inner.z - outer.z) + inner.hz <= outer.hz - margin + 1e-6;

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
  const level = levelOf(piece);
  if (level === 1) {
    if (!layout.upper) return "This home has no upstairs.";
    for (const fixture of layout.upper.fixtures) if (overlaps(rect, fixture)) return `Leave the ${fixture.label.toLowerCase()} clear.`;
    if (!layout.upper.floors.some((floor) => within(rect, floor, margin))) return "Keep it inside the walls of an upstairs room.";
  } else {
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
  }
  if (item.floor) return null;
  for (const other of others) {
    if (piece.id && other.id === piece.id) continue;
    if (levelOf(other) !== level) continue;
    const otherItem = furnitureItem(other.itemId);
    if (!otherItem || otherItem.floor) continue;
    if (overlaps(rect, furnitureRect(otherItem, other.x, other.z, other.rotation))) return `It would sit on top of the ${otherItem.name.toLowerCase()}.`;
  }
  return null;
}

/** The room a piece should stand in on this plan: the first of its rooms the home has. */
export function homeRoomFor(itemId: string, layout: HomeLayout = HOME_LAYOUTS.flat): RoomKind | null {
  const item = furnitureItem(itemId);
  return item?.rooms.find((room) => layout.rooms.some((zone) => zone.room === room)) ?? null;
}

/** The room a piece belongs in when it stands somewhere else (a wardrobe left in the living room), or null. */
export function misplacedRoom(piece: PlacedPiece, layout: HomeLayout = HOME_LAYOUTS.flat): RoomKind | null {
  const item = furnitureItem(piece.itemId);
  if (!item) return null;
  const here = roomAt(layout, piece.x, piece.z, levelOf(piece));
  if (here && item.rooms.includes(here)) return null;
  const home = homeRoomFor(piece.itemId, layout);
  return home && home !== here ? home : null;
}

/** How far the back of a piece stands off the wall of `walls` (the room it stands in) it faces away from. */
function wallGap(rect: FloorRect, rotation: number, walls: FloorRect) {
  if (rotation === 0) return walls.z + walls.hz - (rect.z + rect.hz);
  if (rotation === 180) return rect.z - rect.hz - (walls.z - walls.hz);
  if (rotation === 90) return walls.x + walls.hx - (rect.x + rect.hx);
  return rect.x - rect.hx - (walls.x - walls.hx);
}

/**
 * The best free spot for a piece: inside its room (or `room` when given), backed onto a wall if it is a wardrobe,
 * bed, shelf or TV, with a little space around it. Falls back to the nearest free floor; null when the home is full.
 */
export function findFreeSpot(itemId: string, others: PlacedPiece[], layout: HomeLayout = HOME_LAYOUTS.flat, room?: RoomKind | null): { x: number; z: number; rotation: FurnitureRotation; level: HomeLevel } | null {
  const item = furnitureItem(itemId);
  if (!item) return null;
  const target = room ?? homeRoomFor(itemId, layout);
  const house: FloorRect = { x: 0, z: (layout.back + FRONT_WALL) / 2, hx: layout.halfX, hz: (layout.back - FRONT_WALL) / 2 };
  const zone: FloorRect & { level?: HomeLevel } = layout.rooms.find((entry) => entry.room === target) ?? house;
  const level: HomeLevel = zone.level === 1 && layout.upper ? 1 : 0;
  // Upstairs the room's own walls are the ones to back onto; downstairs the outer walls of the house.
  const walls = level ? zone : house;
  const rotations: FurnitureRotation[] = item.wall ? [0, 90, 180, 270] : [0, 90];
  const solids = others.flatMap((other) => {
    const otherItem = furnitureItem(other.itemId);
    return otherItem && !otherItem.floor && levelOf(other) === level ? [furnitureRect(otherItem, other.x, other.z, other.rotation)] : [];
  });
  const search = level ? walls : house;
  let best: { x: number; z: number; rotation: FurnitureRotation; score: number } | null = null;
  for (const rotation of rotations) {
    for (let gx = search.x - search.hx; gx <= search.x + search.hx + 1e-6; gx += 0.1) {
      for (let gz = search.z - search.hz; gz <= search.z + search.hz + 1e-6; gz += 0.1) {
        const [x, z] = [snapFloor(gx), snapFloor(gz)];
        const rect = furnitureRect(item, x, z, rotation);
        const outside = Math.max(0, Math.abs(x - zone.x) - zone.hx) + Math.max(0, Math.abs(z - zone.z) - zone.hz);
        const spill = Math.max(0, Math.abs(x - zone.x) + rect.hx - zone.hx) + Math.max(0, Math.abs(z - zone.z) + rect.hz - zone.hz);
        let score = (outside > 0 ? 100 + outside * 10 : 0) + spill * 4 + Math.hypot(x - zone.x, z - zone.z) * (item.wall ? 0.05 : 0.15);
        if (item.wall) score += Math.max(0, wallGap(rect, rotation, walls) - 0.05) * 8;
        if (!item.floor && solids.some((other) => overlaps(rect, other, 0.35))) score += 2;
        if (best && score >= best.score) continue;
        if (placementProblem({ itemId, x, z, rotation, level }, others, layout)) continue;
        best = { x, z, rotation, score };
      }
    }
  }
  return best && { x: best.x, z: best.z, rotation: best.rotation, level };
}
