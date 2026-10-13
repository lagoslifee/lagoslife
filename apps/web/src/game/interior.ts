import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import {
  bottleById,
  CLUB_LAYOUT,
  CLUB_TABLES,
  FRONT_WALL,
  GYM_ROOM,
  HOME_LAYOUTS,
  INTERIOR_EXIT,
  INTERIOR_HALF,
  INTERIOR_ORIGIN,
  legacyCellPosition,
  TV_ITEM_IDS,
  type Club,
  type ExerciseId,
  floorFinish,
  interiorStyle,
  type FloorFinishId,
  type HomeFinish,
  type HomeLayout,
  type InteriorStyle,
  type Vec2,
} from "@lagos-living/shared";
import type { Material } from "@babylonjs/core/Materials/material";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { buildExitDoor } from "./exit-door";
import { MeshBuilderBatch } from "./geometry";
import type { Materials } from "./materials";
import type { PropId, PropLibrary } from "./props";
import { buildBottle } from "./drinks";
import { GYM_RECEPTION, gymMachines, gymStations, pressBenchBoxes, pressBenchFootprints } from "./gym-stations";
import { fitSeats } from "./seat-fit";
import { SignAtlas } from "./sign-atlas";
import { buildViewingScreens, VIEWING_BENCH_LENGTH, VIEWING_BENCH_X, VIEWING_KIOSK, VIEWING_ROWS, VIEWING_SCREEN, VIEWING_SEAT_Y, viewingSeats } from "./viewing-hall";

export type InteriorKind = "starter" | "preview" | "home" | "club" | "gym" | "viewing";
/** `x`/`z` are room-local metres; pieces saved before free placement only have their grid cell. */
export type Placement = { id?: string; itemId: string; gridX: number; gridZ: number; rotation: number; x?: number | null; z?: number | null; level?: number | null };
/** `level` 1 marks spots and seats upstairs, offered only to residents up there. */
export type InteriorSpot = { id: "exit" | "bed" | "storage" | "kitchen" | "bar" | "stool" | "dance" | "tv" | "sofa" | "dining" | "gym" | "kiosk" | `table-${number}`; point: Vec2; label: string; level?: 1 };

const HEIGHT = 3.0;
const DUBAI_CLUB = "pearl-club-dubai";

export type HomeRest = "sofa" | "dining" | "bed";
/**
 * A place to sit: bar stools face the counter, VIP sofas face the room. `y` is the cushion height. Home seats carry
 * `rest`; bed places are lain on, with `at` at the foot end and `yaw` facing away from the headboard, and `width` the
 * mattress width when known. Sitting, `at` is where the hips go.
 */
export type ClubSeat = { at: Vec2; yaw: number; y: number; stool: boolean; table?: number; rest?: HomeRest; width?: number; level?: 1 };
const [OX, OZ] = INTERIOR_ORIGIN;
const [HX, HZ] = INTERIOR_HALF;

/** World point `lx` across and `lz` along a piece centred at `x, z` and turned by `yaw`. */
function local(x: number, z: number, yaw: number, lx: number, lz: number): Vec2 {
  return [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
}

/** World position of a placed piece. */
export function placementCentre(placement: Placement): Vec2 {
  const [x, z] = placement.x != null && placement.z != null ? [placement.x, placement.z] : legacyCellPosition(placement.gridX, placement.gridZ);
  return [OX + x, OZ + z];
}

/** Catalogue pieces drawn with a Meshy model when it has loaded; the box builders below still add seats, spots and collision. */
const FURNITURE_MODELS: Partial<Record<string, PropId>> = {
  "island-bed": "double-bed",
  "lagoon-sofa": "sofa",
  "woven-table": "side-table",
  "eko-king-bed": "king-bed",
  "ikoyi-sectional": "sectional",
  "velvet-armchair": "armchair",
  "marble-coffee-table": "coffee-table",
  "dining-set": "dining-set",
  "tv-console": "tv-console",
  wardrobe: "wardrobe",
  bookshelf: "bookshelf",
  "work-desk": "work-desk",
  "floor-lamp": "floor-lamp",
  "potted-palm": "potted-palm",
};
const SHOWPIECES: PropId[] = ["kitchen-wall", "kitchen-island", "grand-piano", "chandelier", "wall-art", "console-vase", "potted-palm"];

/** The iFitness training floor: wider and deeper than a flat, with a high ceiling. */
const GYM_LAYOUT: HomeLayout = { ...HOME_LAYOUTS.flat, halfX: GYM_ROOM.halfX, back: GYM_ROOM.back, height: GYM_ROOM.height };

/** Meshy models a home needs before it is built, so the first frame already shows them. */
export function interiorModels(kind: InteriorKind, layout: HomeLayout, placements: Placement[]): PropId[] {
  if (kind === "gym") return [...new Set([...gymMachines().map((machine) => machine.prop), "potted-palm" as const])];
  if (kind === "club" || kind === "starter" || kind === "viewing") return [];
  const pieces = kind === "preview" ? previewPieces(layout).map((piece) => piece.itemId) : placements.map((piece) => piece.itemId);
  const models = pieces.map((itemId) => FURNITURE_MODELS[itemId]).filter((id): id is PropId => Boolean(id));
  return [...new Set([...models, ...(layout.tier === "flat" ? [] : SHOWPIECES)])];
}

/** What a show-home preview is dressed with: a sitting room, a bed and, in the bigger homes, dining and a TV. */
function previewPieces(layout: HomeLayout): Placement[] {
  const piece = (itemId: string, x: number, z: number, rotation: number, level = 0): Placement => ({ itemId, gridX: 0, gridZ: 0, rotation, x, z, level });
  if (layout.tier === "flat") return [piece("lagoon-sofa", 0.3, -0.2, 0), piece("woven-table", 0.3, 1.4, 0), piece("island-bed", layout.halfX - 1.2, layout.back - 1.4, 0)];
  // The lounge faces away from the door, so the way in looks over a low sofa back; a mansion keeps its foyer clear.
  const wide = layout.tier === "mansion";
  const [cx, cz] = wide ? [6, 5.6] : [0, 0.6];
  return [
    piece("aso-rug", cx, cz + 1.0, 0),
    piece("ikoyi-sectional", cx, cz, 180),
    piece("marble-coffee-table", cx, cz + 1.7, 0),
    piece("tv-console", cx, cz + 3.0, 0),
    piece("velvet-armchair", cx + 2.3, cz + 1.7, 90),
    piece("floor-lamp", cx + 2.4, cz - 0.2, 0),
    piece("potted-palm", cx - 2.4, cz - 0.2, 0),
    piece("dining-set", wide ? -7 : -3.6, wide ? 6.5 : 5, 0),
    ...(wide
      ? [
          piece("eko-king-bed", 8.2, 17.9, 0, 1),
          piece("wardrobe", 12.6, 12.4, 90, 1),
          piece("velvet-armchair", 4.4, 11.2, 180, 1),
          piece("aso-rug", 8.2, 14.6, 0, 1),
          piece("bookshelf", -12.7, 13.4, 270, 1),
          piece("work-desk", -8, 18.5, 0, 1),
        ]
      : [piece("eko-king-bed", layout.halfX - 3.2, layout.back - 1.6, 0), piece("wardrobe", layout.halfX - 0.5, layout.back - 4.6, 90), piece("bookshelf", -layout.halfX + 0.3, 4.5, 270)]),
  ];
}

/** `finish` is the owner's chosen style and floor (see HOME_FINISH); without it a home shows its signature look. */
export type InteriorOptions = { layout?: HomeLayout; props?: PropLibrary | null; finish?: HomeFinish | null };

/** Builds one room at the interior origin; obstacles are returned as axis-aligned boxes. */
export function buildInterior(scene: Scene, materials: Materials, atlas: SignAtlas, kind: InteriorKind, title: string, placements: Placement[], club?: Club, options: InteriorOptions = {}) {
  const layout = kind === "gym" ? GYM_LAYOUT : kind === "club" || kind === "starter" || kind === "viewing" ? HOME_LAYOUTS.flat : (options.layout ?? HOME_LAYOUTS.flat);
  const props = options.props ?? null;
  const [X0, X1, Z0, Z1, H] = [OX - layout.halfX, OX + layout.halfX, OZ + FRONT_WALL, OZ + layout.back, layout.height];
  const disposables: Array<{ dispose(): void }> = [];
  const local_ = homeMaterials(scene, layout, disposables, options.finish ?? null);
  const batches = new Map<string, MeshBuilderBatch>();
  // While a Meshy model stands in for a piece, its box geometry goes here and is never built.
  const unused = new MeshBuilderBatch("interior unused");
  let hidden = false;
  // Furniture upstairs is built at floor height into its own batches, which are then raised onto the upper floor.
  let lifting = false;
  const get = (key: string) => {
    if (hidden) return unused;
    const name = lifting ? `${key}${LIFTED}` : key;
    let batch = batches.get(name);
    if (!batch) {
      batch = new MeshBuilderBatch(`interior ${name}`);
      batches.set(name, batch);
    }
    return batch;
  };
  const boxes: Array<{ x: number; z: number; hx: number; hz: number }> = [];
  const solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, color?: [number, number, number], collide = true) => {
    get(key).box(x, y, z, w, h, d, yaw, 1, color);
    if (collide && y - h / 2 < 1) {
      const swap = Math.abs(Math.sin(yaw)) > 0.7;
      boxes.push({ x, z, hx: (swap ? d : w) / 2, hz: (swap ? w : d) / 2 });
    }
  };
  const model = (id: PropId, x: number, z: number, yaw: number, scale = 1, y = 0) => props?.place(id, x, z, yaw, disposables, y, scale) ?? null;

  const corners: Vec2[] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
  const marina = kind === "club" && club?.id === DUBAI_CLUB;
  const gym = kind === "gym";
  const viewing = kind === "viewing";
  const plain = kind === "club" || kind === "starter" || gym || viewing;
  const grand = !plain && layout.tier !== "flat";
  if (!plain) get(local_.floorKey).polygon(corners, 0.02, local_.floorTile);
  else if (gym) get("vertexPaint").polygon(corners, 0.02, 1, [0.15, 0.15, 0.17]);
  else get("tiles").polygon(corners, 0.02, 1.2, marina ? [0.78, 0.76, 0.74] : kind === "club" ? [0.16, 0.14, 0.2] : viewing ? [0.5, 0.48, 0.44] : undefined);
  // The ceiling is its own mesh so the home designer can lift it off for a view from above.
  const ceiling = new MeshBuilderBatch("interior ceiling");
  ceiling.polygon(corners, H, 3, marina ? [0.14, 0.12, 0.1] : kind === "club" ? [0.08, 0.07, 0.1] : gym ? [0.2, 0.2, 0.22] : viewing ? [0.16, 0.17, 0.18] : local_.ceiling, true);
  const wallColor: [number, number, number] = marina ? [0.3, 0.25, 0.19] : kind === "club" ? [0.13, 0.11, 0.17] : gym ? [0.34, 0.34, 0.37] : viewing ? [0.1, 0.3, 0.17] : kind === "starter" ? [0.78, 0.68, 0.52] : local_.wall;
  const RAIL = 1.05;
  // Inward normals of the front, east, back and west walls.
  const inward: Vec2[] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  for (let index = 0; index < 4; index += 1) {
    const a = corners[index]!;
    const b = corners[(index + 1) % 4]!;
    if (plain) {
      get("plaster").wall(b[0], b[1], a[0], a[1], 0, H, 2.5, wallColor);
      continue;
    }
    const { scheme } = local_;
    get("homeWall").wall(b[0], b[1], a[0], a[1], 0, RAIL, 2.5, scheme.lower);
    // The back wall carries the print; the others are painted.
    if (index === 2) get("homePaper").wall(b[0], b[1], a[0], a[1], RAIL, H, 2.2);
    else get("homeWall").wall(b[0], b[1], a[0], a[1], RAIL, H, 2.5, scheme.upper);
    const [nx, nz] = inward[index]!;
    const [mx, mz] = [(a[0] + b[0]) / 2 + nx * 0.02, (a[1] + b[1]) / 2 + nz * 0.02];
    const along = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = index % 2 ? Math.PI / 2 : 0;
    get("homeSkirting").box(mx, 0.07, mz, along, 0.14, 0.04, yaw);
    get("homeRail").box(mx, RAIL, mz, along, 0.06, 0.05, yaw);
  }
  let upstairs: Upstairs | null = null;
  if (grand) {
    upstairs = dressHome(layout, { get, solid, model, boxes, paint: local_.wall });
  } else if (!gym && !viewing) {
    // Windows with a bright daylight view on the north and east walls.
    for (const x of kind === "club" ? [] : [-3, 0, 3]) {
      get("lamp").quad([OX + x + 0.7, 1.0, Z1 - 0.02], [OX + x - 0.7, 1.0, Z1 - 0.02], [OX + x - 0.7, 2.3, Z1 - 0.02], [OX + x + 0.7, 2.3, Z1 - 0.02], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      get("frame").box(OX + x, 1.65, Z1 - 0.04, 0.06, 1.3, 0.05);
      get("frame").box(OX + x, 1.0, Z1 - 0.06, 1.5, 0.06, 0.12);
      get("frame").box(OX + x, 2.3, Z1 - 0.04, 1.5, 0.06, 0.05);
    }
    if (kind !== "club") get("lamp").quad([X1 - 0.02, 1.0, OZ - 0.8], [X1 - 0.02, 1.0, OZ + 0.8], [X1 - 0.02, 2.3, OZ + 0.8], [X1 - 0.02, 2.3, OZ - 0.8], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // Exit door on the south wall.
  const [exitX, exitZ] = INTERIOR_EXIT;
  const exitDisposables: Array<{ dispose(): void }> = [];
  buildExitDoor(scene, exitX, OZ - HZ + 0.02, 0, exitDisposables, { label: kind === "club" ? "Back to the street" : gym || viewing ? "Out to Admiralty Way" : "Out to the street", width: 1.4 });
  const subtitle = club ? `Tonight: ${club.dj}` : gym ? "Members' training floor" : viewing ? "Every match live" : kind === "preview" ? "Show flat preview" : kind === "starter" ? "Starter room" : "Your home";
  const uv = atlas.get(title, "plate", subtitle);
  const signs = new MeshBuilderBatch("interior title");
  signs.quad([exitX + 2.4, 2.1, OZ - HZ + 0.03], [exitX + 0.9, 2.1, OZ - HZ + 0.03], [exitX + 0.9, 2.1 + 1.5 / SignAtlas.aspect, OZ - HZ + 0.03], [exitX + 2.4, 2.1 + 1.5 / SignAtlas.aspect, OZ - HZ + 0.03], [0, 0, 1], [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]]);

  const spots: InteriorSpot[] = [{ id: "exit", point: [exitX, OZ - HZ + 0.9], label: "Leave" }];
  const seats: ClubSeat[] = [];
  const addSpot = (id: InteriorSpot["id"], point: Vec2, label: string) => spots.push({ id, point, label });
  const addSeat = (at: Vec2, yaw: number, y: number, rest: HomeRest) => seats.push({ at, yaw, y, stool: false, rest });

  const bed = (x: number, z: number, yaw: number) => {
    solid("wood", x, 0.25, z, 1.6, 0.4, 2.1, yaw);
    get("bedding").box(x, 0.55, z, 1.5, 0.22, 2.0, yaw);
    const px = x + Math.sin(yaw) * 0.75;
    const pz = z + Math.cos(yaw) * 0.75;
    get("bedding").box(px, 0.72, pz, 1.2, 0.14, 0.4, yaw, 1, [0.8, 0.86, 0.95]);
    get("wood").box(x + Math.sin(yaw) * 1.05, 0.7, z + Math.cos(yaw) * 1.05, 1.7, 1.0, 0.08, yaw);
    addSpot("bed", local(x, z, yaw, -1.2, 0), "Lie down and sleep");
    addSeat(local(x, z, yaw, 0, -0.92), yaw + Math.PI, 0.79, "bed");
  };
  const sofa = (x: number, z: number, yaw: number) => {
    solid("fabric", x, 0.25, z, 2.2, 0.45, 0.9, yaw);
    get("fabric").box(x - Math.sin(yaw) * 0.38, 0.7, z - Math.cos(yaw) * 0.38, 2.2, 0.6, 0.18, yaw);
    get("fabric").box(x - Math.cos(yaw) * 1.02, 0.55, z + Math.sin(yaw) * 1.02, 0.18, 0.4, 0.9, yaw);
    get("fabric").box(x + Math.cos(yaw) * 1.02, 0.55, z - Math.sin(yaw) * 1.02, 0.18, 0.4, 0.9, yaw);
    for (const lx of [-0.55, 0.55]) addSeat(local(x, z, yaw, lx, 0.06), yaw, 0.48, "sofa");
    addSpot("sofa", local(x, z, yaw, 0, 1.0), "Sit on the sofa");
  };
  const table = (x: number, z: number, yaw: number) => {
    get("wood").box(x, 0.74, z, 1.3, 0.06, 0.8, yaw);
    for (const [lx, lz] of [[-0.58, -0.34], [0.58, -0.34], [-0.58, 0.34], [0.58, 0.34]] as const) {
      get("wood").box(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0.37, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), 0.06, 0.72, 0.06, yaw);
    }
    boxes.push({ x, z, hx: 0.65, hz: 0.65 });
  };
  const furniture: Record<string, (x: number, z: number, yaw: number) => void> = {
    "island-bed": bed,
    "lagoon-sofa": sofa,
    "woven-table": table,
    ...moreFurniture(get, solid, addSpot, addSeat),
  };

  disposables.push(...exitDisposables);
  const upperFloor = grand && layout.upper ? layout.upper : null;
  const upperBoxes: typeof boxes = [];
  const placePiece = (placement: Placement) => {
    const build = furniture[placement.itemId];
    if (!build) return;
    const [x, z] = placementCentre(placement);
    const yaw = (placement.rotation * Math.PI) / 180;
    const id = FURNITURE_MODELS[placement.itemId];
    const lift = placement.level === 1 && upperFloor ? upperFloor.y : 0;
    // Models face +Z; catalogue pieces put their back on local +z, so they turn half a turn.
    const placed = id ? model(id, x, z, yaw + Math.PI) : null;
    hidden = Boolean(placed);
    lifting = lift > 0;
    const [firstSeat, firstSpot, firstBox] = [seats.length, spots.length, boxes.length];
    build(x, z, yaw);
    hidden = false;
    lifting = false;
    if (placed) {
      const missing = new Set(fitSeats(placed, seats.slice(firstSeat)));
      if (missing.size) seats.splice(firstSeat, seats.length - firstSeat, ...seats.slice(firstSeat).filter((seat) => !missing.has(seat)));
    }
    if (TV_ITEM_IDS.includes(placement.itemId)) spots.push({ id: "tv", point: [x - Math.sin(yaw) * 1.8, z - Math.cos(yaw) * 1.8], label: "Watch TV" });
    if (!lift) return;
    if (placed) raise(placed, lift);
    for (const seat of seats.slice(firstSeat)) Object.assign(seat, { y: seat.y + lift, level: 1 });
    for (const spot of spots.slice(firstSpot)) spot.level = 1;
    upperBoxes.push(...boxes.splice(firstBox));
  };
  let animate: (seconds: number) => void = () => {};
  let clubView: ReturnType<typeof buildClub> | null = null;
  if (kind === "club") {
    clubView = buildClub(scene, atlas, get, solid, spots, disposables, club);
    animate = clubView.animate;
  } else if (gym) {
    dressGym(atlas, signs, { get, solid, model, boxes });
    for (const station of gymStations()) addSpot("gym", station.spot, GYM_SPOT_LABELS[station.exercise]);
    addSpot("gym", GYM_RECEPTION.spot, "Reception · membership");
  } else if (viewing) {
    dressViewing(atlas, signs, { get, solid, model, boxes });
    for (const seat of viewingSeats()) if (seat.fan === null) addSeat(seat.at, seat.yaw, VIEWING_SEAT_Y, "dining");
    for (const row of VIEWING_ROWS) for (const bx of VIEWING_BENCH_X) addSpot("dining", [OX + bx, OZ + row + 0.65], "Sit and watch the match");
    addSpot("kiosk", [VIEWING_KIOSK.counter[0] + 0.75, VIEWING_KIOSK.counter[1]], "Order a cold drink");
    const screens = buildViewingScreens(scene, disposables);
    animate = (seconds) => screens.update(seconds);
  } else if (kind === "starter") {
    bed(OX - HX + 1.0, OZ + HZ - 1.4, Math.PI);
    table(OX + 2.5, OZ + 2.6, 0);
    solid("wood", OX + HX - 0.4, 1.0, OZ - 1.5, 0.6, 2.0, 1.6, 0, [0.8, 0.7, 0.6]);
    get("fabric").polygon([[OX - 2, OZ - 1.5], [OX + 1, OZ - 1.5], [OX + 1, OZ + 1], [OX - 2, OZ + 1]], 0.03, 1, [0.8, 0.45, 0.3]);
  } else {
    if (!grand) {
      get("concrete").box(OX - HX + 0.35, 0.45, OZ - 1.2, 0.7, 0.9, 3.2, 0, 1, [0.92, 0.9, 0.86]);
      boxes.push({ x: OX - HX + 0.35, z: OZ - 1.2, hx: 0.35, hz: 1.6 });
      get("darkFrame").box(OX - HX + 0.35, 0.92, OZ - 0.6, 0.55, 0.04, 0.55);
      get("chrome").box(OX - HX + 0.35, 0.93, OZ - 1.8, 0.45, 0.03, 0.35);
      get("fabric").polygon([[OX - 1.5, OZ - 1], [OX + 2, OZ - 1], [OX + 2, OZ + 1.6], [OX - 1.5, OZ + 1.6]], 0.03, 1, [0.55, 0.3, 0.25]);
    }
    // A soft carpet marks out the bedroom of the open plan, so it reads as where the bed and wardrobe go.
    for (const room of layout.rooms.filter((entry) => entry.room === "bedroom" || (entry.level && upperFloor))) {
      // Upstairs suites get a large rug with the floor showing around it.
      const inset = room.level ? 1.4 : 0.3;
      const [x0, x1, z0, z1] = [OX + room.x - room.hx + inset, OX + room.x + room.hx - inset, OZ + room.z - room.hz + inset, OZ + room.z + room.hz - inset];
      const y = (room.level && upperFloor ? upperFloor.y : 0) + 0.025;
      get("bedding").polygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, 1, room.room === "bedroom" ? [0.72, 0.6, 0.52] : [0.36, 0.42, 0.5]);
    }
    spots.push({ id: "kitchen", point: [OX + layout.kitchen[0], OZ + layout.kitchen[1]], label: "Cook a meal" });
    if (kind === "home") {
      const [sx, sz] = [OX + layout.storage[0], OZ + layout.storage[1]];
      solid("wood", sx, 0.4, sz, 1.0, 0.8, 0.6, 0, [0.75, 0.55, 0.35]);
      get("chrome").box(sx, 0.62, sz - 0.3, 0.3, 0.06, 0.04);
      spots.push({ id: "storage", point: [sx, sz - 1.0], label: "Open storage" });
      for (const placement of placements) placePiece(placement);
    } else {
      for (const placement of previewPieces(layout)) placePiece(placement);
    }
  }

  const meshes: Mesh[] = [];
  for (const [name, batch] of batches) {
    const lifted = name.endsWith(LIFTED);
    const key = lifted ? name.slice(0, -LIFTED.length) : name;
    const material = local_.byKey[key] ?? (materials as unknown as Record<string, Material>)[key]!;
    const mesh = batch.build(scene, material);
    if (!mesh) continue;
    if (lifted) raise(mesh, upperFloor!.y);
    meshes.push(mesh);
  }
  const sign = signs.build(scene, atlas.material);
  if (sign) meshes.push(sign);
  const roof = ceiling.build(scene, plain ? materials.plaster : local_.byKey.homeCeiling!);
  if (roof) meshes.push(roof);
  // Bigger homes get a light per zone; tall rooms hang them lower so the floor still reads bright.
  const lightPoints: Vec2[] = gym
    ? [[-5, 0.5], [5, 0.5], [-4, 7.5], [5, 7.5]]
    : layout.tier === "mansion" ? [[0, 1.5], [-7.8, 4.6], [7.8, 4.6]] : layout.tier === "flat" || !grand ? [[0, 0]] : [[0, 0.5], [0, layout.back - 4]];
  // The mansion's side lights hang higher, between the floors, so they light the hall and the suites above it.
  const lightY = (index: number) => (upperFloor && index > 0 ? upperFloor.y + 1.6 : Math.min(H - 0.6, 4.2));
  const lights = lightPoints.map(([lx, lz], index) => {
    const light = new PointLight(`interior light ${index}`, new Vector3(OX + lx, lightY(index), OZ + lz), scene);
    light.intensity = kind === "club" ? 5 : viewing ? 7 : grand ? 26 : gym ? 16 : 18;
    light.range = grand || gym ? 20 : 14;
    light.diffuse = Color3.FromHexString(kind === "club" ? "#b8a8ff" : gym ? "#f1f4ff" : viewing ? "#dfe8ff" : "#fff1dc");
    // A light hanging just under the ceiling would burn a bright disc into it; the ceiling's own glow lights it evenly.
    if (roof && !plain) light.excludedMeshes.push(roof);
    return light;
  });

  let level: Level = "ground";
  let last: Vec2 | null = null;
  return {
    spots,
    seats: clubView?.seats ?? seats,
    /** Inside faces of the walls, in world metres, and the ceiling height. */
    bounds: { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1, height: H },
    collide(x: number, z: number, radius: number): Vec2 {
      if (upstairs) {
        const step = climb(level, upstairs, x, z, radius, last);
        level = step.level;
        if (step.point && level === "upper") {
          const [px, pz] = pushOut(step.point[0], step.point[1], radius, upperBoxes);
          last = clampToWalks(upstairs.walks, px, pz, radius, step.point);
          return last;
        }
        last = null;
        if (step.point) return step.point;
      }
      return pushOut(Math.max(X0 + radius, Math.min(X1 - radius, x)), Math.max(Z0 + radius, Math.min(Z1 - radius, z)), radius, boxes);
    },
    /** 1 while up the stairs on the upper floor, else 0: spots and seats with a `level` are only for that floor. */
    storey(): 0 | 1 {
      return level === "upper" ? 1 : 0;
    },
    /** Height the resident stands at: the floor, partway up the stairs, or up on the gallery. */
    floor(_x: number, z: number) {
      return upstairs ? levelHeight(level, upstairs, z) : 0.02;
    },
    /**
     * NEPA took light and no generator is running: the bulbs go out, leaving a candle's glow, and the painted walls
     * lose their self-light. `lit` brings everything back.
     */
    setPower(lit: boolean) {
      lights.forEach((light, index) => {
        light.metadata ??= { intensity: light.intensity, diffuse: light.diffuse.clone() };
        const base = light.metadata as { intensity: number; diffuse: Color3 };
        light.intensity = lit ? base.intensity : index === 0 ? base.intensity * 0.12 : 0;
        light.diffuse = lit ? base.diffuse : Color3.FromHexString("#ff9a4a");
      });
      for (const key of ["homeWall", "homeCeiling", "homePaper"]) {
        const material = local_.byKey[key] as PBRMaterial | undefined;
        if (!material) continue;
        material.metadata ??= { emissive: material.emissiveColor.clone() };
        const base = (material.metadata as { emissive: Color3 }).emissive;
        material.emissiveColor = lit ? base : base.scale(0.15);
      }
    },
    /** Lifts the ceiling off so the room can be seen from above. */
    setCutaway(open: boolean) {
      roof?.setEnabled(!open);
    },
    /** Advances animated fixtures such as the club light show; `seconds` is scene time. */
    update(seconds: number) {
      animate(seconds);
    },
    /** Club only: bottles standing on each VIP table. */
    setTableBottles(no: number, bottles: Array<{ id: string; itemId: string }>) {
      clubView?.setBottles(no, bottles);
    },
    /** Club only: strobes and boosts the lights over a VIP table when its bottles arrive. */
    celebrate(no: number) {
      clubView?.celebrate(no);
    },
    /** Club only: puts a bottle-service call-out ("1x CLASE AZUL FOR @TOBI") up on the DJ's LED wall for everyone. */
    announce(lines: string[], seconds: number) {
      clubView?.announce(lines, seconds);
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      for (const light of lights) light.dispose();
    },
  };
}

export type InteriorView = ReturnType<typeof buildInterior>;

const LIFTED = "@upstairs";

/** Raises a built mesh or a placed model (its world matrices are frozen) by `y` metres. */
function raise(node: TransformNode, y: number) {
  node.position.y += y;
  for (const mesh of [node, ...node.getChildMeshes()]) {
    mesh.unfreezeWorldMatrix();
    mesh.freezeWorldMatrix();
  }
}

type Box = { x: number; z: number; hx: number; hz: number };

/** Pushes a resident of `radius` out of any box they would overlap, along the shallower side. */
function pushOut(x: number, z: number, radius: number, boxes: Box[]): Vec2 {
  let [px, pz] = [x, z];
  for (const box of boxes) {
    const dx = px - box.x;
    const dz = pz - box.z;
    const ox = box.hx + radius - Math.abs(dx);
    const oz = box.hz + radius - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) px += Math.sign(dx || 1) * ox;
      else pz += Math.sign(dz || 1) * oz;
    }
  }
  return [px, pz];
}

type Batch = (key: string) => MeshBuilderBatch;
type HomeMaterials = ReturnType<typeof homeMaterials>;

/** Deterministic noise so every visit paints the same veins and planks. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function painted(scene: Scene, name: string, size: [number, number], draw: (context: CanvasRenderingContext2D, w: number, h: number) => void, disposables: Array<{ dispose(): void }>) {
  const texture = new DynamicTexture(name, { width: size[0], height: size[1] }, scene, true);
  draw(texture.getContext() as CanvasRenderingContext2D, size[0], size[1]);
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;
  disposables.push(texture);
  return texture;
}

/** Floors, trim and views for homes, drawn once per visit on small canvases, in the owner's chosen style and floor. */
function homeMaterials(scene: Scene, layout: HomeLayout, disposables: Array<{ dispose(): void }>, finish: HomeFinish | null) {
  const byKey: Record<string, Material> = {};
  const pbr = (name: string, setup: (material: PBRMaterial) => void) => {
    const material = new PBRMaterial(name, scene);
    material.metallic = 0;
    material.roughness = 0.5;
    setup(material);
    disposables.push(material);
    return material;
  };
  const style = interiorStyle(finish?.style, layout.tier);
  const scheme = homeScheme(style);
  const floorId = floorFinish(finish, layout.tier);
  // Painted plaster with a little self-light, so far walls and high ceilings stay bright on phones with few lights.
  // Emissive adds the same grey to every colour, so it stays low enough not to wash the paint out.
  byKey.homeWall = pbr("home wall", (material) => {
    material.roughness = 0.85;
    material.emissiveColor = new Color3(0.13, 0.12, 0.11);
  });
  byKey.homeCeiling = pbr("home ceiling", (material) => {
    material.roughness = 0.9;
    material.emissiveColor = Color3.FromArray(style.ceiling).scale(0.5);
  });
  byKey.homePaper = pbr("home wallpaper", (material) => {
    material.roughness = 0.75;
    material.emissiveColor = new Color3(0.1, 0.1, 0.09);
    material.albedoTexture = painted(scene, `${style.id} wallpaper`, [256, 256], scheme.paper, disposables);
  });
  byKey.homeSkirting = pbr("home skirting", (material) => {
    material.albedoColor = Color3.FromArray(scheme.skirting);
    material.roughness = 0.4;
  });
  byKey.homeRail = pbr("home rail", (material) => {
    material.albedoColor = Color3.FromArray(scheme.rail);
    material.roughness = 0.35;
    material.metallic = layout.tier === "mansion" || layout.tier === "apartment" ? 0.6 : 0;
  });
  const floor = pbr(`${layout.tier} ${floorId} floor`, (material) => {
    const look = FLOOR_LOOKS[floorId];
    material.albedoTexture = painted(scene, `${floorId} floor`, [512, 512], look.paint, disposables);
    material.roughness = look.roughness;
  });
  byKey.homeFloor = floor;
  // Trim, stair carriages and slab edges take a warm cream from the walls rather than a hard white.
  const cream = Color3.FromArray(style.upper).scale(0.45).add(new Color3(0.5, 0.48, 0.44));
  byKey.homeTrim = pbr("home trim", (material) => {
    material.albedoColor = cream;
    material.roughness = 0.3;
  });
  byKey.homeGold = pbr("home gold", (material) => {
    material.albedoColor = new Color3(0.86, 0.68, 0.32);
    material.metallic = 1;
    material.roughness = 0.28;
  });
  byKey.homeWood = pbr("home walnut", (material) => {
    material.albedoColor = new Color3(0.32, 0.2, 0.12);
    material.roughness = 0.45;
  });
  byKey.homeGlass = pbr("home glass", (material) => {
    material.albedoColor = new Color3(0.8, 0.9, 0.92);
    material.roughness = 0.05;
    material.alpha = 0.22;
    material.backFaceCulling = false;
  });
  const floorTile = FLOOR_LOOKS[floorId].tile * (layout.tier === "flat" ? 0.8 : 1);
  if (layout.tier === "flat") return { byKey, floorKey: "homeFloor", floorTile, wall: scheme.upper, scheme, ceiling: style.ceiling };
  const view = new StandardMaterial("home view", scene);
  view.disableLighting = true;
  view.emissiveTexture = painted(scene, "home view", [1024, 256], (context, w, h) => {
    const sky = context.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#7fb6e6");
    sky.addColorStop(0.62, "#d9ecf7");
    sky.addColorStop(0.63, "#5b8f8c");
    sky.addColorStop(1, "#2f6563");
    context.fillStyle = sky;
    context.fillRect(0, 0, w, h);
    const towers = seeded(41);
    for (let x = 0; x < w; ) {
      const width = 18 + towers() * 40;
      const top = h * (0.18 + towers() * 0.36);
      context.fillStyle = `rgb(${120 + towers() * 40}, ${140 + towers() * 30}, ${160 + towers() * 30})`;
      context.fillRect(x, top, width, h * 0.63 - top);
      context.fillStyle = "rgba(255, 255, 255, 0.35)";
      for (let y = top + 6; y < h * 0.6; y += 9) for (let wx = x + 4; wx < x + width - 4; wx += 7) context.fillRect(wx, y, 3, 4);
      x += width + towers() * 14;
    }
    if (layout.tier !== "apartment") {
      context.fillStyle = "#3e7a3a";
      for (let x = 0; x < w; x += 22 + towers() * 30) {
        context.fillRect(x, h * 0.4, 3, h * 0.3);
        context.beginPath();
        context.ellipse(x + 1.5, h * 0.4, 18, 7, 0, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = "#57a9c7";
      context.fillRect(0, h * 0.8, w, h * 0.2);
    }
  }, disposables);
  disposables.push(view);
  byKey.homeView = view;
  return { byKey, floorKey: "homeFloor", floorTile, wall: scheme.upper, scheme, ceiling: style.ceiling };
}

type Paint = (context: CanvasRenderingContext2D, w: number, h: number) => void;
type HomeScheme = { lower: Rgb; upper: Rgb; skirting: Rgb; rail: Rgb; paper: Paint };

/** Ankara-style print: repeating diamonds and dots, the way Lagos homes often dress one wall. */
const ankara = (ground: string, ink: string, accent: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  const cell = w / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const [cx, cy] = [col * cell + cell / 2, row * cell + cell / 2];
      context.fillStyle = ink;
      context.beginPath();
      context.moveTo(cx, cy - cell * 0.42);
      context.lineTo(cx + cell * 0.42, cy);
      context.lineTo(cx, cy + cell * 0.42);
      context.lineTo(cx - cell * 0.42, cy);
      context.fill();
      context.fillStyle = accent;
      context.beginPath();
      context.arc(cx, cy, cell * 0.14, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ground;
      context.beginPath();
      context.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = accent;
      for (const [dx, dy] of [[0, 0], [cell, 0], [0, cell], [cell, cell]] as const) {
        context.beginPath();
        context.arc(col * cell + dx, row * cell + dy, cell * 0.07, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
};

/** Tall palm fronds on a soft ground. */
const fronds = (ground: string, leaf: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  const random = seeded(7);
  context.strokeStyle = leaf;
  context.lineCap = "round";
  for (let index = 0; index < 9; index += 1) {
    const [x, y] = [random() * w, random() * h];
    const angle = random() * Math.PI * 2;
    const length = 60 + random() * 40;
    for (const shift of [-w, 0, w]) {
      const [sx, sy] = [x + shift, y];
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(sx, sy);
      context.lineTo(sx + Math.cos(angle) * length, sy + Math.sin(angle) * length);
      context.stroke();
      context.lineWidth = 1.4;
      for (let leafAt = 0.15; leafAt < 1; leafAt += 0.09) {
        const [lx, ly] = [sx + Math.cos(angle) * length * leafAt, sy + Math.sin(angle) * length * leafAt];
        for (const side of [-1, 1]) {
          const turn = angle + side * 0.9;
          context.beginPath();
          context.moveTo(lx, ly);
          context.lineTo(lx + Math.cos(turn) * 16 * (1 - leafAt * 0.6), ly + Math.sin(turn) * 16 * (1 - leafAt * 0.6));
          context.stroke();
        }
      }
    }
  }
};

/** Art-deco fans in thin metallic lines. */
const deco = (ground: string, line: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  context.strokeStyle = line;
  context.lineWidth = 2;
  const size = w / 4;
  for (let row = 0; row <= 4; row += 1) {
    for (let col = 0; col <= 4; col += 1) {
      const [cx, cy] = [col * size + (row % 2 ? size / 2 : 0), row * size * 0.5 + size * 0.5];
      for (let ring = 1; ring <= 3; ring += 1) {
        context.beginPath();
        context.arc(cx, cy, (size / 2) * (ring / 3), Math.PI, 0);
        context.stroke();
      }
    }
  }
};

/** Damask-like medallions for the mansion. */
const damask = (ground: string, ink: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  context.fillStyle = ink;
  const size = w / 2;
  for (const [cx, cy] of [[size / 2, size / 2], [size * 1.5, size * 1.5], [size * 1.5, size / 2 - size], [size / 2, size * 1.5]] as const) {
    for (const [ox, oy] of [[0, 0], [0, h], [0, -h]] as const) {
      const [x, y] = [cx + ox, cy + oy];
      context.beginPath();
      context.ellipse(x, y, size * 0.16, size * 0.3, 0, 0, Math.PI * 2);
      context.fill();
      for (const side of [-1, 1]) {
        context.beginPath();
        context.ellipse(x + side * size * 0.24, y + size * 0.05, size * 0.1, size * 0.2, side * 0.6, 0, Math.PI * 2);
        context.fill();
      }
      context.fillRect(x - 1.5, y - size * 0.46, 3, size * 0.92);
    }
  }
};

/** Indigo adire: tie-dye circles and resist-dyed lines, the cloth of Abeokuta. */
const adire = (ground: string, ink: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  context.strokeStyle = ink;
  context.fillStyle = ink;
  const cell = w / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const [cx, cy] = [col * cell + cell / 2, row * cell + cell / 2];
      if ((row + col) % 2) {
        for (let ring = 1; ring <= 3; ring += 1) {
          context.lineWidth = 2.2 - ring * 0.4;
          context.beginPath();
          context.arc(cx, cy, cell * 0.13 * ring, 0, Math.PI * 2);
          context.stroke();
        }
        context.beginPath();
        context.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
        context.fill();
      } else {
        context.lineWidth = 1.6;
        for (let line = -2; line <= 2; line += 1) {
          context.beginPath();
          context.moveTo(cx - cell * 0.4, cy + line * cell * 0.12);
          context.bezierCurveTo(cx - cell * 0.1, cy + line * cell * 0.12 - 6, cx + cell * 0.1, cy + line * cell * 0.12 + 6, cx + cell * 0.4, cy + line * cell * 0.12);
          context.stroke();
        }
      }
    }
  }
};

const plainPaper = (ground: string, ink: string): Paint => (context, w, h) => {
  context.fillStyle = ground;
  context.fillRect(0, 0, w, h);
  context.fillStyle = ink;
  for (let x = 0; x < w; x += w / 8) context.fillRect(x, 0, 1.5, h);
};

/** Wall paint, trim and feature-wall print for a style, so no room is plain white. */
function homeScheme(style: InteriorStyle): HomeScheme {
  const { kind, ground, ink, accent } = style.print;
  const paper = kind === "ankara" ? ankara(ground, ink, accent ?? ink) : kind === "fronds" ? fronds(ground, ink) : kind === "deco" ? deco(ground, ink) : kind === "damask" ? damask(ground, ink) : kind === "adire" ? adire(ground, ink) : plainPaper(ground, ink);
  return { lower: style.lower, upper: style.upper, skirting: style.skirting, rail: style.rail, paper };
}

/** How each floor finish is drawn: its texture, how glossy it is and how many metres one texture covers. */
const FLOOR_LOOKS: Record<FloorFinishId, { paint: Paint; roughness: number; tile: number }> = {
  oak: { paint: planks([168, 122, 74], 8, false), roughness: 0.42, tile: 2.4 },
  walnut: { paint: planks([92, 58, 36], 10, true), roughness: 0.3, tile: 2.0 },
  terrazzo: { paint: terrazzo("#d9c9ac", ["#9b4a2c", "#3f6b4f", "#f1ead9", "#6b5a45", "#c99b52"]), roughness: 0.2, tile: 1.6 },
  travertine: { paint: stone("#cdb48c", "rgba(120, 90, 55, 0.22)", "rgba(110, 82, 50, 0.45)", 10), roughness: 0.28, tile: 1.6 },
  "black-marble": { paint: stone("#1c1b1d", "rgba(214, 178, 104, 0.5)", "rgba(80, 70, 60, 0.6)", 16), roughness: 0.12, tile: 1.6 },
  "cream-marble": { paint: stone("#e9dfcd", "rgba(140, 125, 105, 0.28)", "rgba(170, 155, 135, 0.55)", 14), roughness: 0.16, tile: 1.6 },
  terracotta: { paint: clayTiles(), roughness: 0.6, tile: 1.4 },
  "flat-tiles": { paint: stone("#d8cdb8", "rgba(150, 140, 125, 0.12)", "rgba(150, 140, 125, 0.6)", 4), roughness: 0.3, tile: 1.2 },
};

/** Wooden planks in a base tone; `herringbone` lays short boards in a zigzag. */
function planks([r, g, b]: Rgb, rows: number, herringbone: boolean): Paint {
  return (context, w, h) => {
    const random = seeded(r * 31 + rows);
    const tone = () => 0.82 + random() * 0.3;
    if (herringbone) {
      const [len, wid] = [w / 4, w / 16];
      for (let y = -len; y < h + len; y += wid * 2) {
        for (let x = -len; x < w + len; x += len) {
          for (const flip of [0, 1]) {
            const t = tone();
            context.save();
            context.translate(x + flip * wid, y);
            context.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
            context.fillStyle = `rgb(${r * t}, ${g * t}, ${b * t})`;
            context.fillRect(0, 0, len, wid);
            context.strokeStyle = "rgba(30, 18, 10, 0.55)";
            context.lineWidth = 1.2;
            context.strokeRect(0, 0, len, wid);
            context.restore();
          }
        }
      }
      return;
    }
    for (let row = 0; row < rows; row += 1) {
      let x = -random() * w * 0.5;
      while (x < w) {
        const length = w * (0.35 + random() * 0.4);
        const t = tone();
        context.fillStyle = `rgb(${r * t}, ${g * t}, ${b * t})`;
        context.fillRect(x, (row * h) / rows, length, h / rows);
        context.strokeStyle = "rgba(60, 35, 18, 0.18)";
        for (let line = 0; line < 5; line += 1) {
          const y = (row * h) / rows + random() * (h / rows);
          context.beginPath();
          context.moveTo(x, y);
          context.bezierCurveTo(x + length * 0.3, y + 2, x + length * 0.6, y - 2, x + length, y + 1);
          context.stroke();
        }
        context.fillStyle = "rgba(40, 24, 12, 0.6)";
        context.fillRect(x, (row * h) / rows, 2, h / rows);
        x += length;
      }
      context.fillStyle = "rgba(40, 24, 12, 0.55)";
      context.fillRect(0, (row * h) / rows, w, 2);
    }
  };
}

/** Stone slabs: a ground colour, veins and the grout between four slabs. */
function stone(ground: string, vein: string, grout: string, veins: number): Paint {
  return (context, w, h) => {
    const random = seeded(veins * 97 + ground.length);
    context.fillStyle = ground;
    context.fillRect(0, 0, w, h);
    for (let index = 0; index < 400; index += 1) {
      context.fillStyle = `rgba(${random() > 0.5 ? "255, 255, 255" : "0, 0, 0"}, 0.03)`;
      context.fillRect(random() * w, random() * h, 6 + random() * 30, 6 + random() * 30);
    }
    context.strokeStyle = vein;
    for (let index = 0; index < veins; index += 1) {
      context.lineWidth = 0.6 + random() * 2;
      let [x, y] = [random() * w, random() * h];
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 0; step < 12; step += 1) {
        x += (random() - 0.3) * 70;
        y += (random() - 0.5) * 50;
        context.lineTo(x, y);
      }
      context.stroke();
    }
    context.fillStyle = grout;
    for (const at of [0, w / 2]) {
      context.fillRect(at, 0, 2, h);
      context.fillRect(0, at, w, 2);
    }
  };
}

function terrazzo(ground: string, chips: string[]): Paint {
  return (context, w, h) => {
    const random = seeded(23);
    context.fillStyle = ground;
    context.fillRect(0, 0, w, h);
    for (let index = 0; index < 1400; index += 1) {
      context.fillStyle = chips[index % chips.length]!;
      const [x, y, size] = [random() * w, random() * h, 1.5 + random() * (index % 9 === 0 ? 9 : 4)];
      context.beginPath();
      context.ellipse(x, y, size, size * (0.5 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  };
}

function clayTiles(): Paint {
  return (context, w, h) => {
    const random = seeded(61);
    const cell = w / 4;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const t = 0.85 + random() * 0.25;
        context.fillStyle = `rgb(${176 * t}, ${92 * t}, ${58 * t})`;
        context.fillRect(col * cell, row * cell, cell, cell);
        for (let spot = 0; spot < 30; spot += 1) {
          context.fillStyle = `rgba(${random() > 0.5 ? "90, 40, 20" : "230, 170, 110"}, 0.12)`;
          context.fillRect(col * cell + random() * cell, row * cell + random() * cell, 4 + random() * 10, 4 + random() * 10);
        }
      }
    }
    context.fillStyle = "rgba(225, 205, 180, 0.9)";
    for (let at = 0; at <= w; at += cell) {
      context.fillRect(at - 2, 0, 4, h);
      context.fillRect(0, at - 2, w, 4);
    }
  };
}

type WorldRect = { x0: number; x1: number; z0: number; z1: number };
/**
 * A walkable stair (world metres; z0 is the bottom tread) up to a landing from `deck.z0` at height `deck.y`, and
 * `walks`, everywhere a resident can walk up there: the landing, the rooms off it and the doorways between them.
 */
export type Upstairs = { stair: WorldRect; deck: { z0: number; y: number }; walks: WorldRect[] };

/**
 * The nearest point to `x, z` where a resident of `radius` stands inside one of `walks`. Coming `from` a point, only
 * the areas they already stand in count, so they pass from one to the next through the overlap (the doorways) and
 * never through a wall.
 */
export function clampToWalks(walks: WorldRect[], x: number, z: number, radius: number, from?: Vec2 | null): Vec2 {
  const inset = walks.map((walk) => {
    const [x0, x1] = walk.x1 - walk.x0 > radius * 2 ? [walk.x0 + radius, walk.x1 - radius] : [(walk.x0 + walk.x1) / 2, (walk.x0 + walk.x1) / 2];
    const [z0, z1] = walk.z1 - walk.z0 > radius * 2 ? [walk.z0 + radius, walk.z1 - radius] : [(walk.z0 + walk.z1) / 2, (walk.z0 + walk.z1) / 2];
    return { x0, x1, z0, z1 };
  });
  const holds = (area: WorldRect, px: number, pz: number) => px >= area.x0 - 1e-6 && px <= area.x1 + 1e-6 && pz >= area.z0 - 1e-6 && pz <= area.z1 + 1e-6;
  const current = from ? inset.filter((area) => holds(area, from[0], from[1])) : [];
  const candidates = current.length ? current : inset;
  let best: { point: Vec2; distance: number } | null = null;
  for (const area of candidates) {
    const point: Vec2 = [Math.max(area.x0, Math.min(area.x1, x)), Math.max(area.z0, Math.min(area.z1, z))];
    const distance = Math.hypot(point[0] - x, point[1] - z);
    if (distance < 1e-9) return point;
    if (!best || distance < best.distance) best = { point, distance };
  }
  return best?.point ?? [x, z];
}

export type Level = "ground" | "stairs" | "upper";

/**
 * Moves a resident between the ground floor, the stairs and the gallery. Returns the corrected point while on the
 * stairs or the gallery; on the ground floor the room's usual furniture collision applies (`point` is null).
 */
export function climb(level: Level, { stair, deck, walks }: Upstairs, x: number, z: number, radius: number, from?: Vec2 | null): { level: Level; point: Vec2 | null } {
  const [sx0, sx1] = [stair.x0 + radius, stair.x1 - radius];
  const inStairWidth = x > sx0 && x < sx1;
  let next = level;
  if (next === "ground" && inStairWidth && z > stair.z0 - 0.2 && z < stair.z0 + 0.6) next = "stairs";
  if (next === "upper" && inStairWidth && z < deck.z0 + radius) next = "stairs";
  if (next === "stairs") {
    if (z < stair.z0 - 0.05) next = "ground";
    else if (z > stair.z1 + radius) next = "upper";
    else return { level: next, point: [Math.max(sx0, Math.min(sx1, x)), z] };
  }
  // Upstairs: the balustrade and the walls keep residents on the landing and in the rooms, except at the top of the stairs.
  if (next === "upper") return { level: next, point: clampToWalks(walks, x, z, radius, level === "upper" ? from : null) };
  return { level: next, point: null };
}

export function levelHeight(level: Level, { stair, deck }: Upstairs, z: number) {
  if (level === "ground") return 0.02;
  if (level === "upper") return deck.y + 0.03;
  return 0.02 + Math.max(0, Math.min(1, (z - stair.z0) / (stair.z1 - stair.z0))) * deck.y;
}

type Dresser = {
  get: Batch;
  solid: Solid;
  model: (id: PropId, x: number, z: number, yaw: number, scale?: number, y?: number) => TransformNode | null;
  boxes: Array<{ x: number; z: number; hx: number; hz: number }>;
  /** Wall paint, for walls built inside the room. */
  paint?: Rgb;
};

/**
 * Built-in parts of the bigger homes: fitted kitchens, a hall console, art, plants, windows with a view, trim and
 * lighting, and in a mansion a double-height hall with a grand staircase, gallery, chandeliers and a grand piano.
 * Positions match the fixtures in HOME_LAYOUTS so bought furniture never lands on them.
 */
function dressHome(layout: HomeLayout, { get, solid, model, boxes, paint = [0.86, 0.76, 0.6] }: Dresser) {
  const [X0, X1, Z0, Z1, H] = [OX - layout.halfX, OX + layout.halfX, OZ + FRONT_WALL, OZ + layout.back, layout.height];
  const wx = (x: number) => OX + x;
  const wz = (z: number) => OZ + z;
  const block = (x: number, z: number, hx: number, hz: number) => boxes.push({ x, z, hx, hz });
  let levels: Upstairs | null = null;
  type Side = "north" | "east" | "west" | "south";
  /** Point on the inside of a wall: `along` runs along it (x for north/south, z for east/west), `out` steps into the room. */
  const onWall = (side: Side, along: number, y: number, out: number): [number, number, number] =>
    side === "north" ? [wx(along), y, Z1 - out] : side === "south" ? [wx(along), y, Z0 + out] : side === "east" ? [X1 - out, y, wz(along)] : [X0 + out, y, wz(along)];
  const facing = (side: Side) => (side === "north" ? Math.PI : side === "south" ? 0 : side === "east" ? -Math.PI / 2 : Math.PI / 2);
  const span = (side: Side) => (side === "north" || side === "south" ? [-layout.halfX, layout.halfX] : [FRONT_WALL, layout.back]) as Vec2;
  const strip = (key: string, side: Side, from: number, to: number, y: number, h: number, depth: number, color?: Rgb) => {
    const [x, , z] = onWall(side, (from + to) / 2, y, depth / 2);
    get(key).box(x, y, z, to - from, h, depth, side === "east" || side === "west" ? Math.PI / 2 : 0, 1, color);
  };
  const glazing = (side: Side, centre: number, width: number, y0: number, y1: number, panes = 1) => {
    const [a0, a1] = span(side);
    const u = (along: number) => (along - a0) / (a1 - a0);
    const v = (y: number) => y / Math.max(H, 3.2);
    const p = (along: number, y: number) => onWall(side, along, y, 0.02);
    const normal: [number, number, number] = side === "north" ? [0, 0, -1] : side === "south" ? [0, 0, 1] : side === "east" ? [-1, 0, 0] : [1, 0, 0];
    const [l, r] = [centre - width / 2, centre + width / 2];
    get("homeView").quad(p(r, y0), p(l, y0), p(l, y1), p(r, y1), normal, [[u(r), v(y0)], [u(l), v(y0)], [u(l), v(y1)], [u(r), v(y1)]]);
    for (const y of [y0, y1]) strip("darkFrame", side, l - 0.05, r + 0.05, y, 0.07, 0.08);
    for (let pane = 0; pane <= panes; pane += 1) {
      const at = l + (width * pane) / panes;
      const [x, , z] = onWall(side, at, (y0 + y1) / 2, 0.04);
      get("darkFrame").box(x, (y0 + y1) / 2, z, 0.06, y1 - y0, 0.06);
    }
    if (y0 > 0.3) strip("homeTrim", side, l - 0.12, r + 0.12, y0 - 0.04, 0.05, 0.18);
  };
  const art = (side: Side, along: number, y: number, scale: number) => {
    const [x, , z] = onWall(side, along, y, 0.04);
    if (!model("wall-art", x, z, facing(side), scale, y)) {
      const [fx, , fz] = onWall(side, along, y + 0.7 * scale, 0.03);
      get("homeGold").box(fx, y + 0.7 * scale, fz, 1.8 * scale, 1.3 * scale, 0.05, facing(side));
    }
  };
  const palm = (x: number, z: number) => {
    if (!model("potted-palm", wx(x), wz(z), 0)) solid("vertexPaint", wx(x), 0.3, wz(z), 0.5, 0.6, 0.5, 0, [0.72, 0.38, 0.24]);
    block(wx(x), wz(z), 0.3, 0.3);
  };
  /** Marble-topped console on gold legs against the front wall, with the vase and round mirror model on it. */
  const consoleTable = (x: number) => {
    const z = Z0 + 0.25;
    get("homeFloor").box(wx(x), 0.84, z, 1.5, 0.05, 0.42);
    for (const lx of [-0.68, 0.68]) for (const lz of [-0.16, 0.16]) get("homeGold").box(wx(x + lx), 0.41, z + lz, 0.04, 0.82, 0.04);
    get("homeGold").box(wx(x), 0.12, z, 1.4, 0.03, 0.34);
    model("console-vase", wx(x), Z0 + 0.3, 0, 0.75, 0.86);
    block(wx(x), z, 0.75, 0.25);
  };
  /** Fitted kitchen along the west wall; `scale` fits the 5 m Meshy run to the room. */
  const kitchen = (z: number, scale: number, island: number | null) => {
    const depth = 1.37 * scale;
    if (!model("kitchen-wall", X0 + depth / 2, wz(z), Math.PI / 2, scale)) {
      solid("concrete", X0 + 0.35, 0.45, wz(z), 0.7, 0.9, 5 * scale, 0, [0.2, 0.25, 0.38]);
      get("vertexPaint").box(X0 + 0.36, 0.93, wz(z), 0.74, 0.05, 5 * scale, 0, 1, [0.95, 0.94, 0.92]);
      get("concrete").box(X0 + 0.2, 2.1, wz(z), 0.4, 0.8, 5 * scale, 0, 1, [0.2, 0.25, 0.38]);
    }
    block(X0 + depth / 2, wz(z), depth / 2, 2.5 * scale);
    if (island === null) return;
    if (!model("kitchen-island", wx(island), wz(z), Math.PI / 2)) {
      solid("concrete", wx(island), 0.45, wz(z), 1.0, 0.9, 2.8, 0, [0.2, 0.25, 0.38]);
      get("vertexPaint").box(wx(island), 0.93, wz(z), 1.1, 0.06, 2.9, 0, 1, [0.97, 0.96, 0.94]);
    }
    block(wx(island), wz(z), 0.8, 1.5);
  };
  const trim = () => {
    for (const side of ["north", "east", "west"] as const) {
      const [a0, a1] = span(side);
      strip("homeTrim", side, a0, a1, 0.07, 0.14, 0.03);
      strip("homeTrim", side, a0, a1, H - 0.1, 0.16, 0.08);
    }
    for (const [from, to] of [[-layout.halfX, -0.9], [0.9, layout.halfX]] as const) {
      strip("homeTrim", "south", from, to, 0.07, 0.14, 0.03);
      strip("homeTrim", "south", from, to, H - 0.1, 0.16, 0.08);
    }
  };
  const downlights = (z0: number, z1: number, y: number) => {
    for (let x = -layout.halfX + 2; x <= layout.halfX - 2; x += 3) {
      for (let z = z0; z <= z1; z += 3) get("lamp").box(wx(x), y - 0.01, wz(z), 0.22, 0.02, 0.22);
    }
  };

  trim();
  if (layout.tier === "house") {
    for (const x of [-4.5, 0, 4.5]) glazing("north", x, 1.8, 0.9, 2.6, 2);
    for (const z of [0, 4.5]) glazing("east", z, 1.6, 0.9, 2.6, 2);
    glazing("west", 5.2, 1.6, 0.9, 2.6, 2);
    strip("homeTrim", "east", FRONT_WALL, layout.back, 1.0, 0.05, 0.04);
    strip("homeTrim", "north", -layout.halfX, layout.halfX, 1.0, 0.05, 0.04);
    kitchen(-1.0, 0.88, null);
    consoleTable(3.0);
    art("east", -2.6, 1.1, 0.9);
    art("south", -4.2, 1.1, 0.8);
    palm(-layout.halfX + 0.6, layout.back - 0.6);
    palm(layout.halfX - 0.6, FRONT_WALL + 0.6);
    downlights(FRONT_WALL + 1.5, layout.back - 1, H);
  } else if (layout.tier === "apartment") {
    glazing("north", 0, 15, 0.05, H - 0.2, 10);
    glazing("east", 1.5, 3.2, 0.05, H - 0.2, 2);
    kitchen(-1.5, 0.96, -5.3);
    consoleTable(3.2);
    art("west", 6.0, 1.0, 1.0);
    art("east", 7.0, 1.0, 0.9);
    palm(-layout.halfX + 0.7, layout.back - 0.7);
    palm(layout.halfX - 0.7, FRONT_WALL + 0.7);
    downlights(FRONT_WALL + 1.5, layout.back - 1, H);
  } else {
    const gallery = { z: 15.6, y: 3.6 };
    // Marble medallion under the foyer chandelier.
    const ring = (radius: number, y: number, color: Rgb) => {
      const points: Vec2[] = Array.from({ length: 40 }, (_, index) => [wx(Math.cos((index / 40) * Math.PI * 2) * radius), wz(1.5 + Math.sin((index / 40) * Math.PI * 2) * radius)]);
      get("vertexPaint").polygon(points, y, 1, color);
    };
    ring(2.4, 0.024, [0.62, 0.48, 0.22]);
    ring(2.2, 0.026, [0.1, 0.22, 0.18]);
    ring(1.3, 0.028, [0.93, 0.9, 0.84]);
    for (const side of ["east", "west"] as const) {
      const [a0, a1] = span(side);
      strip("homeTrim", side, a0, a1, 1.1, 0.06, 0.05);
      strip("homeGold", side, a0, a1, gallery.y + 0.05, 0.08, 0.06);
    }
    strip("homeGold", "south", -layout.halfX, layout.halfX, gallery.y + 0.05, 0.08, 0.06);
    // Tall windows in the double-height hall, a glazed wall to the pool terrace under the suites, and the suites'
    // own windows over the garden and the side lawns.
    for (const z of [1, 5.6]) glazing("east", z, 2.2, 0.6, 6.4, 2);
    for (const z of [6.2]) glazing("west", z, 2.2, 0.6, 6.4, 2);
    glazing("north", 0, 14, 0.05, gallery.y - 0.4, 8);
    for (const x of [-8.5, 8.5]) glazing("north", x, 3.4, gallery.y + 0.7, H - 0.9, 2);
    for (const side of ["east", "west"] as const) {
      for (const z of [12.6, 16.8]) glazing(side, z, 2.0, gallery.y + 0.8, H - 1.0, 2);
      glazing(side, 14.2, 2.4, 0.7, gallery.y - 0.6, 2);
    }
    glazing("south", 0, 2.4, 2.9, 4.6, 2);
    // Grand staircase rising to the gallery: marble treads on a white carriage, glass balustrade, gold rail.
    const steps = 18;
    const [stairZ0, stairZ1, stairHalf] = [9.2, gallery.z, 2.0];
    const run = (stairZ1 - stairZ0) / steps;
    for (let step = 0; step < steps; step += 1) {
      const top = ((step + 1) * gallery.y) / steps;
      const z = wz(stairZ0 + (step + 0.5) * run);
      get("homeTrim").box(OX, top / 2, z, stairHalf * 2 + 0.2, top, run);
      get("homeFloor").box(OX, top - 0.02, z - 0.02, stairHalf * 2, 0.05, run + 0.04);
    }
    // Solid from the side and underneath, but the first tread is left open so residents can walk up.
    block(OX, wz((stairZ0 + 0.6 + stairZ1) / 2), stairHalf + 0.1, (stairZ1 - stairZ0 - 0.6) / 2);
    for (const side of [-1, 1]) {
      const x = OX + side * (stairHalf + 0.08);
      const [z0, z1] = [wz(stairZ0), wz(stairZ1)];
      const glass = get("homeGlass");
      glass.quad([x, 0.05, z0], [x, gallery.y + 0.05, z1], [x, gallery.y + 1.0, z1], [x, 0.95, z0], [side, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      const rail = get("homeGold");
      rail.quad([x - 0.04, 0.99, z0], [x + 0.04, 0.99, z0], [x + 0.04, gallery.y + 1.04, z1], [x - 0.04, gallery.y + 1.04, z1], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      get("homeGold").box(x, 0.5, z0 + 0.05, 0.12, 1.0, 0.12);
    }
    // Upstairs: a bedroom suite over the east side of the hall and a study over the west, either side of the landing
    // at the head of the stairs, each through its own doorway. The slabs rest on the gallery columns.
    const upper = layout.upper!;
    const [wall, doorZ0, doorZ1, doorH] = [2.6, upper.fixtures[0]!.z - upper.fixtures[0]!.hz, upper.fixtures[0]!.z + upper.fixtures[0]!.hz, 2.35];
    const slab = (x0: number, x1: number, z0: number, z1: number) => {
      get("homeTrim").box(wx((x0 + x1) / 2), gallery.y - 0.18, wz((z0 + z1) / 2), x1 - x0, 0.36, z1 - z0);
      get("homeFloor").box(wx((x0 + x1) / 2), gallery.y + 0.01, wz((z0 + z1) / 2), x1 - x0, 0.02, z1 - z0);
      for (let x = x0 + 1.5; x <= x1 - 1.5; x += 3) for (let z = z0 + 1.5; z <= z1 - 1; z += 3) get("lamp").box(wx(x), gallery.y - 0.37, wz(z), 0.22, 0.02, 0.22);
    };
    slab(wall, layout.halfX, 9.2, layout.back);
    slab(-layout.halfX, -wall, 9.2, layout.back);
    slab(-wall, wall, gallery.z, layout.back);
    const roomWall = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
      const [w, d] = [Math.max(x1 - x0, 0.15), Math.max(z1 - z0, 0.15)];
      get("homeWall").box(wx((x0 + x1) / 2), (y0 + y1) / 2, wz((z0 + z1) / 2), w, y1 - y0, d, 0, 1, paint);
    };
    for (const side of [-1, 1]) {
      const inner = side * wall;
      // Front wall of the suite over the hall, trimmed in gold at the floor line.
      roomWall(Math.min(inner, side * layout.halfX), Math.max(inner, side * layout.halfX), 9.12, 9.28, gallery.y, H);
      get("homeGold").box(wx(side * (wall + layout.halfX) / 2), gallery.y + 0.05, wz(9.06), layout.halfX - wall, 0.08, 0.06);
      // Side wall on the landing and the stairwell, with the doorway near the back.
      roomWall(inner - 0.08, inner + 0.08, 9.2, doorZ0, gallery.y, H);
      roomWall(inner - 0.08, inner + 0.08, doorZ1, layout.back, gallery.y, H);
      roomWall(inner - 0.08, inner + 0.08, doorZ0, doorZ1, gallery.y + doorH, H);
      for (const z of [doorZ0, doorZ1]) get("homeWood").box(wx(inner), gallery.y + doorH / 2, wz(z), 0.24, doorH, 0.1);
      get("homeWood").box(wx(inner), gallery.y + doorH + 0.05, wz((doorZ0 + doorZ1) / 2), 0.24, 0.1, doorZ1 - doorZ0 + 0.1);
      // The door stands open against the suite wall.
      get("homeWood").box(wx(inner + side * 0.12), gallery.y + doorH / 2 - 0.02, wz(doorZ1 + 0.42), 0.05, doorH - 0.08, 0.82);
      get("homeGold").box(wx(inner + side * 0.16), gallery.y + 1.0, wz(doorZ1 + 0.72), 0.04, 0.04, 0.12);
      // Skirting inside the suite.
      get("homeSkirting").box(wx(side * (wall + layout.halfX) / 2), gallery.y + 0.07, wz(9.32), layout.halfX - wall, 0.14, 0.04);
    }
    for (const [from, to] of [[-wall, -stairHalf], [stairHalf, wall]] as const) {
      const glass = get("homeGlass");
      const z = wz(gallery.z) - 0.02;
      glass.quad([wx(from), gallery.y, z], [wx(to), gallery.y, z], [wx(to), gallery.y + 1.0, z], [wx(from), gallery.y + 1.0, z], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      get("homeGold").box(wx((from + to) / 2), gallery.y + 1.02, z, to - from, 0.06, 0.08);
    }
    for (const x of [-9, -4.5, 4.5, 9]) {
      solid("homeTrim", wx(x), gallery.y / 2, wz(15.8), 0.5, gallery.y, 0.5);
      get("homeGold").box(wx(x), 0.08, wz(15.8), 0.62, 0.16, 0.62);
      get("homeGold").box(wx(x), gallery.y - 0.42, wz(15.8), 0.62, 0.1, 0.62);
    }
    for (const x of [-2.9, 2.9]) {
      solid("homeTrim", wx(x), gallery.y / 2, wz(9.45), 0.4, gallery.y, 0.4);
      get("homeGold").box(wx(x), 0.08, wz(9.45), 0.5, 0.16, 0.5);
    }
    // Suite touches: a headboard wall of print behind where the bed goes, art in the study, palms by the windows.
    get("homePaper").box(wx(8.2), (gallery.y + 0.1 + gallery.y + 2.9) / 2, Z1 - 0.03, 5.2, 2.8, 0.02);
    get("homeGold").box(wx(8.2), gallery.y + 2.95, Z1 - 0.04, 5.3, 0.06, 0.04);
    for (const x of [-7.8, 7.8]) if (!model("wall-art", wx(x), wz(9.32), 0, 1.0, gallery.y + 1.1)) get("homeGold").box(wx(x), gallery.y + 1.8, wz(9.31), 1.8, 1.3, 0.05);
    downlights(9.8, layout.back - 0.8, H);
    levels = {
      stair: { x0: OX - stairHalf, x1: OX + stairHalf, z0: wz(stairZ0), z1: wz(stairZ1) },
      deck: { z0: wz(gallery.z), y: gallery.y },
      walks: upper.walks.map((area) => ({ x0: wx(area.x - area.hx), x1: wx(area.x + area.hx), z0: wz(area.z - area.hz), z1: wz(area.z + area.hz) })),
    };
    kitchen(0, 1, -9.73);
    if (!model("grand-piano", wx(9.8), wz(0.5), -Math.PI / 2)) solid("darkFrame", wx(9.8), 0.5, wz(0.5), 2.6, 1.0, 1.6, 0, [0.03, 0.03, 0.04]);
    block(wx(9.8), wz(0.5), 1.35, 0.95);
    model("chandelier", OX, wz(1.5), 0, 1.5, H - 4.5);
    for (const x of [-7, 7]) model("chandelier", wx(x), wz(5.6), 0, 0.85, H - 2.56);
    consoleTable(-3.4);
    consoleTable(3.4);
    art("west", 4.3, 1.5, 1.5);
    art("east", 5.0, 1.5, 1.5);
    art("north", 0, gallery.y + 0.9, 1.6);
    palm(-2.9, 8.7);
    palm(2.9, 8.7);
    palm(-layout.halfX + 0.8, FRONT_WALL + 0.8);
    palm(layout.halfX - 0.8, FRONT_WALL + 0.8);
  }
  return levels;
}

const GYM_SPOT_LABELS: Record<ExerciseId, string> = { treadmill: "Treadmill · cardio", bench: "Bench press", squat: "Squat rack", dumbbells: "Dumbbells" };

/**
 * iFitness inside: a cardio row of treadmills and bikes facing a mirror wall with TVs, free weights (squat rack,
 * benches, dumbbells) on black rubber along the east wall, a stretch mat, lockers, the front desk by the door, and a
 * glazed street front. The machines come from gym-stations.ts so members train exactly where they are drawn.
 */
/** A Lagos viewing centre: green walls, rows of wooden benches facing a projector screen, a drinks kiosk by the door. */
function dressViewing(atlas: SignAtlas, signs: MeshBuilderBatch, { get, solid, boxes }: Dresser) {
  const HX_ = HX;
  const Z1 = OZ + HZ;
  const Z0 = OZ - HZ;
  const sign = (text: string, sub: string, x0: number, x1: number, y0: number, z: number, style: "plate" | "club" = "plate") => {
    const uv = atlas.get(text, style, sub);
    const y1 = y0 + Math.abs(x1 - x0) / SignAtlas.aspect;
    signs.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, x1 > x0 ? -1 : 1], [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]]);
  };

  // Painted dado band and a darker floor strip down the aisle.
  for (const [ax, az, bx, bz] of [[OX - HX_, Z1, OX + HX_, Z1], [OX + HX_, Z0, OX + HX_, Z1], [OX - HX_, Z0, OX - HX_, Z1]] as const) {
    const yaw = ax === bx ? Math.PI / 2 : 0;
    const length = Math.hypot(bx - ax, bz - az);
    const [cx, cz] = [(ax + bx) / 2 + (ax === bx ? (ax < OX ? 0.03 : -0.03) : 0), (az + bz) / 2 + (ax === bx ? 0 : -0.03)];
    get("vertexPaint").box(cx, 0.55, cz, length, 1.1, 0.02, yaw, 1, [0.06, 0.18, 0.1]);
    get("vertexPaint").box(cx, 1.12, cz, length, 0.05, 0.03, yaw, 1, [0.95, 0.85, 0.2]);
  }
  get("vertexPaint").polygon([[OX - 0.8, Z0], [OX + 0.8, Z0], [OX + 0.8, Z1 - 0.6], [OX - 0.8, Z1 - 0.6]], 0.025, 1, [0.32, 0.3, 0.28]);

  // Screen: a black frame and a raised stage the speakers stand on.
  const { width: SW, height: SH, y: SY, z: SZ } = VIEWING_SCREEN;
  get("vertexPaint").box(OX, SY, OZ + SZ + 0.03, SW + 0.24, SH + 0.24, 0.05, 0, 1, [0.03, 0.03, 0.04]);
  solid("vertexPaint", OX, 0.15, Z1 - 0.4, 7.4, 0.3, 0.8, 0, [0.12, 0.12, 0.13]);
  for (const side of [-1, 1]) {
    solid("vertexPaint", OX + side * 3.25, 0.85, Z1 - 0.45, 0.5, 1.1, 0.45, 0, [0.05, 0.05, 0.06]);
    for (const y of [0.6, 1.05]) get("chrome").box(OX + side * 3.25, y, Z1 - 0.68, 0.3, 0.3, 0.02, 0, 1, [0.25, 0.25, 0.27]);
  }
  // Side TVs sit in black bezels.
  for (const side of [-1, 1]) get("vertexPaint").box(OX + side * 5.57, 2.05, OZ - 0.2, 0.04, 1.0, 1.72, 0, 1, [0.03, 0.03, 0.04]);

  // Benches: a thick plank on three pairs of legs, a footrail behind.
  for (const row of VIEWING_ROWS) {
    for (const bx of VIEWING_BENCH_X) {
      const [x, z] = [OX + bx, OZ + row];
      solid("wood", x, 0.42, z, VIEWING_BENCH_LENGTH, 0.06, 0.42, 0, [0.55, 0.36, 0.2]);
      for (const lx of [-1.45, 0, 1.45]) {
        for (const lz of [-0.16, 0.16]) get("wood").box(x + lx, 0.2, z + lz, 0.07, 0.4, 0.07, 0, 1, [0.38, 0.24, 0.13]);
      }
      get("wood").box(x, 0.1, z - 0.16, VIEWING_BENCH_LENGTH - 0.2, 0.05, 0.05, 0, 1, [0.38, 0.24, 0.13]);
    }
  }

  // Drinks kiosk by the door: counter, a glass-front fridge glowing blue, crates stacked beside it.
  const [kx, kz] = VIEWING_KIOSK.counter;
  solid("vertexPaint", kx, 0.55, kz, 0.6, 1.1, 1.8, 0, [0.85, 0.12, 0.12]);
  get("vertexPaint").box(kx, 1.12, kz, 0.72, 0.05, 1.9, 0, 1, [0.92, 0.92, 0.9]);
  solid("vertexPaint", OX - HX_ + 0.35, 0.95, OZ - 1.5, 0.6, 1.9, 0.7, 0, [0.85, 0.86, 0.88]);
  get("neon").box(OX - HX_ + 0.66, 1.05, OZ - 1.5, 0.01, 1.4, 0.55, 0, 1, [0.55, 0.8, 1.0]);
  for (const [lx, h] of [[0, 0.3], [0, 0.6], [0.35, 0.3]] as const) get("vertexPaint").box(OX - HX_ + 0.35 + lx, h - 0.15, OZ - 0.7, 0.4, 0.28, 0.3, 0, 1, [0.9, 0.7, 0.1]);
  boxes.push({ x: OX - HX_ + 0.5, z: OZ - 0.7, hx: 0.35, hz: 0.2 });

  // Signs: the name over the screen, the match-day rules by the door, a jersey strip on the east wall.
  sign("Champions Viewing Centre", "Every match live", OX - 2.1, OX + 2.1, SY + SH / 2 + 0.18, OZ + SZ - 0.01, "club");
  sign("Pass ₦1,500 / hour", "Cold drinks at the kiosk", OX + 4.9, OX + 3.3, 1.7, Z0 + 0.03, "plate");
  for (let index = 0; index < 4; index += 1) {
    const z = OZ + 1.6 + index * 0.75;
    const colour: Rgb = ([[0.88, 0.15, 0.17], [0.11, 0.31, 0.7], [0.99, 0.88, 0.0], [0.04, 0.4, 0.2]] as Rgb[])[index]!;
    get("vertexPaint").box(OX + HX_ - 0.03, 1.75, z, 0.02, 0.55, 0.5, 0, 1, colour);
    get("vertexPaint").box(OX + HX_ - 0.035, 1.98, z, 0.02, 0.1, 0.62, 0, 1, colour);
  }
  // Strip lights down the room.
  for (const x of [-2.6, 2.6]) get("lamp").box(OX + x, HEIGHT - 0.03, OZ - 0.2, 0.12, 0.03, 7.5);
}

function dressGym(atlas: SignAtlas, signs: MeshBuilderBatch, { get, solid, model, boxes }: Dresser) {
  const { halfX, back, height: H } = GYM_ROOM;
  const [X0, X1, Z0, Z1] = [OX - halfX, OX + halfX, OZ + FRONT_WALL, OZ + back];
  const wx = (x: number) => OX + x;
  const wz = (z: number) => OZ + z;
  const zone = (x0: number, z0: number, x1: number, z1: number, y: number, color: Rgb) =>
    get("vertexPaint").polygon([[wx(x0), wz(z0)], [wx(x1), wz(z0)], [wx(x1), wz(z1)], [wx(x0), wz(z1)]], y, 1, color);
  zone(-halfX, 7.4, 4.4, back, 0.025, [0.2, 0.24, 0.3]);
  zone(4.8, FRONT_WALL, halfX, back, 0.025, [0.07, 0.07, 0.08]);
  zone(4.4, FRONT_WALL, 4.8, back, 0.03, [0.78, 0.1, 0.1]);
  zone(-3.2, 1.8, 0.2, 4.6, 0.03, [0.36, 0.2, 0.46]);
  zone(-0.9, FRONT_WALL, 0.9, FRONT_WALL + 1.2, 0.03, [0.1, 0.1, 0.1]);

  // Red band round the room and white trim at the skirting.
  for (const [ax, az, bx, bz] of [[X0, Z1, X1, Z1], [X1, Z0, X1, Z1], [X0, Z0, X0, Z1]] as const) {
    const yaw = ax === bx ? Math.PI / 2 : 0;
    const length = Math.hypot(bx - ax, bz - az);
    const [cx, cz] = [(ax + bx) / 2 + (ax === bx ? (ax < OX ? 0.03 : -0.03) : 0), (az + bz) / 2 + (ax === bx ? 0 : -0.03)];
    get("neon").box(cx, 2.85, cz, length, 0.12, 0.02, yaw, 1, [0.9, 0.12, 0.14]);
    get("vertexPaint").box(cx, 0.08, cz, length, 0.16, 0.03, yaw, 1, [0.9, 0.9, 0.9]);
  }

  // Mirror wall with a TV over each treadmill, and the iFitness sign above.
  get("chrome").box(wx(-4.3), 1.1, Z1 - 0.03, 9.2, 1.6, 0.03, 0, 1, [0.82, 0.88, 0.92]);
  for (const x of [-7.6, -5.4, -3.2, -1.0, 2.2]) {
    get("vertexPaint").box(wx(x), 2.35, Z1 - 0.06, 1.1, 0.66, 0.06, 0, 1, [0.05, 0.05, 0.06]);
    get("neon").box(wx(x), 2.35, Z1 - 0.1, 1.0, 0.56, 0.01, 0, 1, x === 2.2 ? [0.95, 0.42, 0.16] : [0.2, 0.55, 0.95]);
  }
  const uv = atlas.get("iFitness", "club", "Lekki · Train hard");
  const [sx0, sx1, sy0] = [wx(-5.6), wx(-0.8), 3.0];
  const sy1 = sy0 + (sx1 - sx0) / SignAtlas.aspect;
  signs.quad([sx0, sy0, Z1 - 0.04], [sx1, sy0, Z1 - 0.04], [sx1, sy1, Z1 - 0.04], [sx0, sy1, Z1 - 0.04], [0, 0, -1], [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]]);

  // Street front: floor-to-ceiling glass either side of the door, with mullions.
  for (const [from, to] of [[-halfX + 0.3, -1.3], [1.3, halfX - 0.3]] as const) {
    get("lamp").quad([wx(to), 0.25, Z0 + 0.02], [wx(from), 0.25, Z0 + 0.02], [wx(from), 3.4, Z0 + 0.02], [wx(to), 3.4, Z0 + 0.02], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (let x = from; x <= to + 0.01; x += (to - from) / 4) get("darkFrame").box(wx(x), 1.82, Z0 + 0.05, 0.08, 3.2, 0.06);
    for (const y of [0.25, 3.4]) get("darkFrame").box(wx((from + to) / 2), y, Z0 + 0.05, to - from + 0.08, 0.08, 0.06);
  }

  // Ceiling: long LED battens over the floor.
  for (const x of [-6.5, -2.5, 1.5, 6.5]) get("lamp").box(wx(x), H - 0.03, wz(3), 0.16, 0.03, 13);

  for (const machine of gymMachines()) {
    const [x, z] = machine.at;
    const [w, h, d] = machine.size;
    if (!model(machine.prop, x, z, machine.yaw)) solid("vertexPaint", x, h / 2, z, w, h, d, machine.yaw, machine.color, false);
    const swap = Math.abs(Math.sin(machine.yaw)) > 0.7;
    boxes.push({ x, z, hx: (swap ? d : w) / 2 - 0.1, hz: (swap ? w : d) / 2 - 0.1 });
  }
  for (const part of pressBenchBoxes()) {
    get(part.steel ? "chrome" : "vertexPaint").box(part.world[0], part.at[1], part.world[1], ...part.size, part.yaw, 1, part.colour);
  }
  boxes.push(...pressBenchFootprints());
  // Weight plates on a tree by the rack, kettlebells along the wall.
  solid("vertexPaint", wx(8.4), 0.6, wz(9.6), 0.12, 1.2, 0.12, 0, [0.2, 0.2, 0.22]);
  for (const [y, size] of [[0.35, 0.45], [0.7, 0.4], [1.0, 0.32]] as const) get("rubber").box(wx(8.4), y, wz(9.6), size, size, 0.06, Math.PI / 2);
  for (let index = 0; index < 6; index += 1) {
    const z = wz(0.8 + index * 0.38);
    get("rubber").box(X1 - 0.3, 0.13, z, 0.22, 0.26, 0.22);
    get("vertexPaint").box(X1 - 0.3, 0.3, z, 0.06, 0.1, 0.16, 0, 1, [0.75, 0.12, 0.14]);
  }
  boxes.push({ x: X1 - 0.3, z: wz(1.75), hx: 0.2, hz: 1.2 });

  // Front desk with the brand strip, a water cooler, lockers by the door.
  const [dx, dz] = GYM_RECEPTION.desk;
  solid("vertexPaint", dx, 0.55, dz, 0.7, 1.1, 2.4, 0, [0.12, 0.12, 0.13]);
  get("vertexPaint").box(dx, 1.12, dz, 0.85, 0.05, 2.5, 0, 1, [0.94, 0.94, 0.92]);
  get("neon").box(dx + 0.36, 0.7, dz, 0.01, 0.12, 2.2, 0, 1, [0.9, 0.12, 0.14]);
  get("vertexPaint").box(dx, 1.2, dz + 0.6, 0.35, 0.22, 0.03, Math.PI / 2, 1, [0.08, 0.08, 0.09]);
  solid("vertexPaint", wx(-8.5), 0.55, wz(0.6), 0.35, 1.1, 0.35, 0, [0.9, 0.92, 0.94]);
  get("neon").box(wx(-8.5), 1.25, wz(0.6), 0.28, 0.32, 0.28, 0, 1, [0.55, 0.78, 0.95]);
  for (let index = 0; index < 6; index += 1) {
    const x = wx(2.2 + index * 0.5);
    get("vertexPaint").box(x, 0.95, Z0 + 0.3, 0.48, 1.9, 0.5, 0, 1, index % 2 ? [0.55, 0.57, 0.6] : [0.48, 0.5, 0.53]);
    get("chrome").box(x + 0.15, 1.1, Z0 + 0.56, 0.03, 0.12, 0.02);
  }
  boxes.push({ x: wx(3.45), z: Z0 + 0.3, hx: 1.5, hz: 0.3 });
  for (const [x, z] of [[-halfX + 0.5, back - 0.5], [halfX - 0.5, FRONT_WALL + 2.2]] as const) {
    if (!model("potted-palm", wx(x), wz(z), 0)) solid("vertexPaint", wx(x), 0.3, wz(z), 0.5, 0.6, 0.5, 0, [0.72, 0.38, 0.24]);
    boxes.push({ x: wx(x), z: wz(z), hx: 0.3, hz: 0.3 });
  }
}

/**
 * Builders for the furniture catalogue beyond the original three pieces. Each takes the piece's centre and yaw;
 * sizes match FURNITURE footprints in packages/shared/src/furniture.ts. Local +z is the back of the piece.
 */
function moreFurniture(
  get: Batch,
  solid: Solid,
  addSpot: (id: InteriorSpot["id"], point: Vec2, label: string) => void,
  addSeat: (at: Vec2, yaw: number, y: number, rest: HomeRest) => void,
): Record<string, (x: number, z: number, yaw: number) => void> {
  const frame = (x: number, z: number, yaw: number) => (lx: number, lz: number): [number, number] => [
    x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];
  const part = (key: string, at: (lx: number, lz: number) => [number, number], yaw: number, lx: number, y: number, lz: number, w: number, h: number, d: number, color?: Rgb, collide = false) => {
    const [px, pz] = at(lx, lz);
    if (collide) solid(key, px, y, pz, w, h, d, yaw, color);
    else get(key).box(px, y, pz, w, h, d, yaw, 1, color);
  };
  const walnut: Rgb = [0.55, 0.36, 0.22];
  return {
    "eko-king-bed": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("wood", at, yaw, 0, 0.2, 0, 2.0, 0.32, 2.2, [0.45, 0.4, 0.38], true);
      part("bedding", at, yaw, 0, 0.48, -0.05, 1.92, 0.26, 2.05);
      part("bedding", at, yaw, 0, 0.62, -0.55, 1.94, 0.06, 1.0, [0.62, 0.55, 0.78]);
      part("bedding", at, yaw, 0, 0.85, 1.12, 2.1, 1.3, 0.14, [0.5, 0.46, 0.56]);
      for (const side of [-0.48, 0.48]) part("bedding", at, yaw, side, 0.68, 0.82, 0.75, 0.16, 0.38, [0.92, 0.92, 0.96]);
      for (const side of [-1.25, 1.25]) {
        part("wood", at, yaw, side, 0.26, 0.85, 0.42, 0.52, 0.42, walnut, true);
        part("lamp", at, yaw, side, 0.66, 0.9, 0.2, 0.26, 0.2);
      }
      addSpot("bed", at(-1.7, -0.4), "Lie down and sleep");
      addSeat(at(0, -1.02), yaw + Math.PI, 0.74, "bed");
    },
    "ikoyi-sectional": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      const grey: Rgb = [0.56, 0.58, 0.62];
      part("bedding", at, yaw, 0, 0.24, 0.55, 2.8, 0.44, 0.9, grey, true);
      part("bedding", at, yaw, 0, 0.7, 0.92, 2.8, 0.55, 0.18, grey);
      part("bedding", at, yaw, -0.95, 0.24, -0.45, 0.9, 0.44, 1.1, grey, true);
      part("bedding", at, yaw, 1.32, 0.55, 0.55, 0.16, 0.36, 0.9, grey);
      for (const lx of [-0.9, 0, 0.9]) part("bedding", at, yaw, lx, 0.58, 0.72, 0.6, 0.38, 0.14, [0.85, 0.72, 0.4]);
      for (const lx of [-0.9, 0, 0.9]) addSeat(at(lx, 0.42), yaw + Math.PI, 0.47, "sofa");
      addSpot("sofa", at(0.5, -0.5), "Sit on the sofa");
    },
    "velvet-armchair": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      const mustard: Rgb = [0.86, 0.62, 0.16];
      part("bedding", at, yaw, 0, 0.24, -0.03, 0.82, 0.4, 0.8, mustard, true);
      part("bedding", at, yaw, 0, 0.68, 0.36, 0.82, 0.6, 0.16, mustard);
      for (const side of [-0.38, 0.38]) part("bedding", at, yaw, side, 0.52, 0, 0.14, 0.24, 0.78, mustard);
      addSeat(at(0, -0.06), yaw + Math.PI, 0.45, "sofa");
      addSpot("sofa", at(0, -0.85), "Sit in the armchair");
    },
    "marble-coffee-table": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("vertexPaint", at, yaw, 0, 0.42, 0, 1.2, 0.06, 0.65, [0.96, 0.95, 0.93], true);
      part("darkFrame", at, yaw, 0, 0.2, 0, 0.8, 0.38, 0.3);
    },
    "dining-set": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("wood", at, yaw, 0, 0.75, 0, 1.8, 0.06, 0.9, walnut, true);
      for (const [lx, lz] of [[-0.82, -0.36], [0.82, -0.36], [-0.82, 0.36], [0.82, 0.36]] as const) part("wood", at, yaw, lx, 0.37, lz, 0.06, 0.72, 0.06, walnut);
      for (const lx of [-0.6, 0, 0.6]) {
        for (const side of [-1, 1]) {
          part("bedding", at, yaw, lx, 0.46, side * 0.7, 0.42, 0.06, 0.42, [0.9, 0.86, 0.78]);
          part("wood", at, yaw, lx, 0.23, side * 0.7, 0.36, 0.44, 0.36, walnut);
          part("wood", at, yaw, lx, 0.72, side * 0.9, 0.42, 0.5, 0.05, walnut);
          addSeat(at(lx, side * 0.66), side > 0 ? yaw + Math.PI : yaw, 0.5, "dining");
        }
      }
      for (const side of [-1, 1]) addSpot("dining", at(0, side * 1.35), "Sit at the dining table");
    },
    "tv-console": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("darkFrame", at, yaw, 0, 0.24, 0, 1.9, 0.48, 0.45, [0.2, 0.18, 0.17], true);
      part("wood", at, yaw, 0, 0.49, 0, 1.92, 0.03, 0.47, walnut);
      part("darkFrame", at, yaw, 0, 1.15, 0.12, 1.46, 0.84, 0.05, [0.03, 0.03, 0.04]);
      part("neon", at, yaw, 0, 1.15, 0.09, 1.38, 0.76, 0.01, [0.08, 0.16, 0.3]);
      part("darkFrame", at, yaw, 0, 0.62, 0.12, 0.3, 0.22, 0.06, [0.05, 0.05, 0.06]);
    },
    "wall-tv": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("wood", at, yaw, 0, 0.42, 0.06, 2.2, 0.08, 0.32, walnut, true);
      part("darkFrame", at, yaw, 0, 0.36, 0.06, 1.1, 0.07, 0.12, [0.06, 0.06, 0.07]);
      part("darkFrame", at, yaw, 0, 1.45, 0.17, 1.9, 1.08, 0.04, [0.02, 0.02, 0.03]);
      part("neon", at, yaw, 0, 1.45, 0.145, 1.84, 1.02, 0.01, [0.1, 0.22, 0.4]);
      for (const side of [-0.95, 0.95]) part("darkFrame", at, yaw, side, 0.9, 0.12, 0.16, 0.9, 0.16, [0.08, 0.08, 0.09]);
    },
    "dressing-table": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      const cream: Rgb = [0.93, 0.88, 0.8];
      part("vertexPaint", at, yaw, 0, 0.74, 0.1, 1.2, 0.05, 0.5, cream, true);
      for (const side of [-0.42, 0.42]) part("vertexPaint", at, yaw, side, 0.37, 0.1, 0.34, 0.72, 0.46, cream);
      part("homeGold", at, yaw, 0, 1.3, 0.3, 0.74, 0.74, 0.03);
      part("chrome", at, yaw, 0, 1.3, 0.28, 0.66, 0.66, 0.02, [0.85, 0.9, 0.95]);
      part("lamp", at, yaw, 0, 1.7, 0.27, 0.5, 0.04, 0.03);
      part("bedding", at, yaw, 0, 0.22, -0.32, 0.42, 0.44, 0.36, [0.8, 0.5, 0.55]);
    },
    wardrobe: (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("vertexPaint", at, yaw, 0, 1.05, 0, 1.7, 2.1, 0.62, [0.86, 0.83, 0.77], true);
      for (const side of [-0.42, 0.42]) part("chrome", at, yaw, side, 1.05, -0.32, 0.8, 1.9, 0.02);
      part("darkFrame", at, yaw, 0, 1.05, -0.33, 0.04, 1.9, 0.02);
    },
    bookshelf: (x, z, yaw) => {
      const at = frame(x, z, yaw);
      for (const side of [-0.48, 0.48]) part("wood", at, yaw, side, 0.95, 0, 0.04, 1.9, 0.38, walnut, true);
      part("wood", at, yaw, 0, 0.95, 0.18, 1.0, 1.9, 0.03, walnut);
      const colours: Rgb[] = [[0.7, 0.2, 0.18], [0.18, 0.35, 0.6], [0.85, 0.75, 0.4], [0.2, 0.5, 0.3], [0.9, 0.9, 0.88]];
      for (let shelf = 0; shelf < 5; shelf += 1) {
        const y = 0.05 + shelf * 0.44;
        part("wood", at, yaw, 0, y, 0, 0.94, 0.03, 0.36, walnut);
        for (let book = 0; book < 6; book += 1) {
          if ((book + shelf) % 4 === 3) continue;
          part("vertexPaint", at, yaw, -0.36 + book * 0.14, y + 0.15, 0.02, 0.1, 0.26 + ((book * 7 + shelf) % 3) * 0.03, 0.24, colours[(book + shelf * 2) % colours.length]);
        }
      }
    },
    "work-desk": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("vertexPaint", at, yaw, 0, 0.74, 0.25, 1.4, 0.05, 0.7, [0.92, 0.92, 0.9], true);
      for (const lx of [-0.66, 0.66]) part("darkFrame", at, yaw, lx, 0.36, 0.25, 0.05, 0.72, 0.64);
      part("darkFrame", at, yaw, 0, 0.78, 0.3, 0.36, 0.02, 0.26, [0.25, 0.26, 0.28]);
      part("darkFrame", at, yaw, 0, 0.9, 0.44, 0.36, 0.24, 0.02, [0.1, 0.12, 0.16]);
      part("bedding", at, yaw, 0, 0.48, -0.32, 0.5, 0.08, 0.5, [0.15, 0.15, 0.17]);
      part("bedding", at, yaw, 0, 0.8, -0.56, 0.48, 0.55, 0.06, [0.15, 0.15, 0.17]);
      part("chrome", at, yaw, 0, 0.23, -0.32, 0.05, 0.46, 0.05);
    },
    "floor-lamp": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("chrome", at, yaw, 0, 0.02, 0, 0.36, 0.04, 0.36, [0.85, 0.7, 0.4], true);
      part("chrome", at, yaw, 0, 0.8, 0, 0.04, 1.56, 0.04, [0.85, 0.7, 0.4]);
      part("lamp", at, yaw, 0, 1.62, 0, 0.42, 0.3, 0.42);
    },
    "potted-palm": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("vertexPaint", at, yaw, 0, 0.25, 0, 0.46, 0.5, 0.46, [0.72, 0.38, 0.24], true);
      part("palmBark", at, yaw, 0, 0.95, 0, 0.07, 1.0, 0.07);
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const angle = (leaf / 6) * Math.PI * 2;
        const [lx, lz] = [Math.cos(angle) * 0.28, Math.sin(angle) * 0.28];
        part("bush", at, yaw + angle, lx, 1.35 + (leaf % 2) * 0.15, lz, 0.62, 0.05, 0.2);
      }
    },
    "aso-rug": (x, z, yaw) => {
      const at = frame(x, z, yaw);
      part("bedding", at, yaw, 0, 0.022, 0, 2.6, 0.012, 1.8, [0.85, 0.65, 0.22]);
      part("bedding", at, yaw, 0, 0.03, 0, 2.36, 0.012, 1.56, [0.2, 0.26, 0.55]);
      for (const lx of [-0.8, 0, 0.8]) part("bedding", at, yaw, lx, 0.037, 0, 0.3, 0.008, 1.2, [0.85, 0.65, 0.22]);
    },
  };
}

type Solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, yaw?: number, color?: [number, number, number], collide?: boolean) => void;
type Rgb = [number, number, number];

function neon(scene: Scene, name: string, color: Color3, disposables: Array<{ dispose(): void }>) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = color.clone();
  disposables.push(material);
  return material;
}

/**
 * A Lagos club: LED wall behind the DJ, neon strips, mirror ball, backlit bar with stools, tiled dance floor, and three
 * red-velvet VIP booths along the east wall. Panels, LEDs and spotlights pulse to the club's tempo.
 */
function buildClub(
  scene: Scene,
  atlas: SignAtlas,
  get: (key: string) => MeshBuilderBatch,
  solid: Solid,
  spots: InteriorSpot[],
  disposables: Array<{ dispose(): void }>,
  club: Club | undefined,
) {
  const accent = Color3.FromHexString(club?.accent ?? "#8a3cff");
  const bpm = club?.bpm ?? 112;
  const marina = club?.id === DUBAI_CLUB;
  const palette = (marina ? ["#d4af37", "#3fd0ff", "#fff4d6", "#7fe3ff"] : [club?.accent ?? "#8a3cff", "#1ec8ff", "#ffd21e", "#ff3df0"]).map((hex) => Color3.FromHexString(hex));
  const seats: ClubSeat[] = [];
  const strips = new MeshBuilderBatch("club neon");
  const stripMaterial = neon(scene, "club neon", accent, disposables);
  const warm = new MeshBuilderBatch("club backlight");
  const warmMaterial = neon(scene, "club backlight", Color3.FromHexString(marina ? "#fff0cc" : "#ffb347"), disposables);

  // Neon: a ceiling cove line round the room and vertical tubes on the side walls.
  for (const [x0, z0, x1, z1] of [
    [OX - HX + 0.04, OZ - HZ, OX - HX + 0.04, OZ + HZ],
    [OX + HX - 0.04, OZ - HZ, OX + HX - 0.04, OZ + HZ],
    [OX - HX, OZ - HZ + 0.04, OX + HX, OZ - HZ + 0.04],
    [OX - HX, OZ + HZ - 0.04, OX + HX, OZ + HZ - 0.04],
  ] as const) {
    strips.box((x0 + x1) / 2, HEIGHT - 0.12, (z0 + z1) / 2, Math.max(0.04, Math.abs(x1 - x0)), 0.05, Math.max(0.04, Math.abs(z1 - z0)));
  }
  for (let z = OZ - HZ + 1.2; z < OZ + HZ - 0.6; z += 1.8) strips.box(OX + HX - 0.05, 1.6, z, 0.04, 2.2, 0.06);
  for (let x = OX - 3.6; x <= OX + 3.6; x += 2.4) if (Math.abs(x - INTERIOR_EXIT[0]) > 1) strips.box(x, 1.6, OZ - HZ + 0.05, 0.06, 2.2, 0.04);

  // Bar: dark counter with an LED kick strip, polished top, stools, and a backlit bottle wall.
  const [barX, barZ] = CLUB_LAYOUT.bar;
  const counterX = barX - 0.85;
  solid("darkFrame", counterX, 0.55, barZ, 0.6, 1.1, 4.2, 0, [0.1, 0.09, 0.12]);
  get("chrome").box(counterX, 1.12, barZ, 0.72, 0.04, 4.3, 0, 1, [0.85, 0.75, 0.5]);
  strips.box(counterX + 0.31, 0.12, barZ, 0.02, 0.05, 4.1);
  warm.box(OX - HX + 0.03, 1.65, barZ, 0.02, 1.3, 3.8);
  for (const shelfY of [1.2, 1.6, 2.0]) {
    get("chrome").box(OX - HX + 0.18, shelfY, barZ, 0.3, 0.03, 3.6, 0, 1, [0.7, 0.7, 0.72]);
    for (let index = 0; index < 11; index += 1) {
      const colour = [[0.12, 0.3, 0.12], [0.45, 0.25, 0.08], [0.8, 0.8, 0.85], [0.1, 0.1, 0.1]][(index + Math.round(shelfY * 10)) % 4]!;
      get("chrome").box(OX - HX + 0.18, shelfY + 0.15, barZ - 1.7 + index * 0.34, 0.08, 0.27, 0.08, 0, 1, colour as Rgb);
    }
  }
  for (const offset of [-1.5, -0.5, 0.5, 1.5]) {
    get("chrome").box(barX - 0.25, 0.38, barZ + offset, 0.05, 0.76, 0.05, 0, 1, marina ? [0.85, 0.68, 0.25] : undefined);
    get("chrome").box(barX - 0.25, 0.02, barZ + offset, 0.3, 0.03, 0.3, 0, 1, marina ? [0.85, 0.68, 0.25] : undefined);
    get("fabric").box(barX - 0.25, 0.78, barZ + offset, 0.38, 0.08, 0.38, 0, 1, marina ? [0.93, 0.91, 0.87] : [0.08, 0.08, 0.1]);
    seats.push({ at: [barX - 0.25, barZ + offset], yaw: -Math.PI / 2, y: 0.82, stool: true });
  }
  spots.push({ id: "bar", point: [barX, barZ], label: "Order at the bar" });
  for (const offset of [-1.5, 1.5]) spots.push({ id: "stool", point: [barX + 0.35, barZ + offset], label: "Sit on a bar stool" });

  // DJ booth with decks and a lit front panel, flanked by stacked speakers, in front of the LED wall.
  const [djX, djZ] = CLUB_LAYOUT.dj;
  solid("darkFrame", djX, 0.55, djZ, 2.4, 1.1, 0.8, 0, [0.08, 0.08, 0.09]);
  strips.box(djX, 0.55, djZ - 0.41, 2.2, 0.08, 0.02);
  for (const side of [-0.55, 0.55]) {
    get("darkFrame").box(djX + side, 1.13, djZ, 0.5, 0.05, 0.42, 0, 1, [0.18, 0.18, 0.2]);
    get("chrome").box(djX + side, 1.17, djZ, 0.22, 0.02, 0.22, 0, 1, [0.6, 0.6, 0.62]);
  }
  get("darkFrame").box(djX, 1.15, djZ, 0.36, 0.08, 0.3, 0, 1, [0.12, 0.12, 0.14]);
  for (const side of [-1, 1]) {
    solid("darkFrame", djX + side * 2.0, 0.9, djZ + 0.2, 0.8, 1.8, 0.7, 0, [0.07, 0.07, 0.08]);
    for (const [y, size] of [[1.4, 0.3], [0.7, 0.55]] as const) get("chrome").box(djX + side * 2.0, y, djZ - 0.16, size, size, 0.04, 0, 1, [0.2, 0.2, 0.22]);
  }
  const ledSize = { w: 512, h: 168 };
  const led = new DynamicTexture("club led wall", { width: ledSize.w, height: ledSize.h }, scene, false);
  led.wrapV = Texture.WRAP_ADDRESSMODE;
  led.vScale = -1;
  const ledMaterial = new StandardMaterial("club led wall", scene);
  ledMaterial.disableLighting = true;
  ledMaterial.emissiveTexture = led;
  ledMaterial.diffuseColor = Color3.Black();
  const ledPlane = MeshBuilder.CreatePlane("club led wall", { width: 6.4, height: 2.1 }, scene);
  ledPlane.position.set(djX, 1.95, OZ + HZ - 0.03);
  ledPlane.material = ledMaterial;
  disposables.push(led, ledMaterial, ledPlane);
  const ledContext = led.getContext() as CanvasRenderingContext2D;

  // Dance floor panels.
  const [floorX, floorZ] = CLUB_LAYOUT.floor.centre;
  const [halfX, halfZ] = CLUB_LAYOUT.floor.half;
  const columns = 6;
  const rows = 5;
  const sizeX = (halfX * 2) / columns;
  const sizeZ = (halfZ * 2) / rows;
  const panels = palette.map((colour, index) => neon(scene, `club floor ${index}`, colour, disposables));
  const panelBatches = panels.map((_, index) => new MeshBuilderBatch(`club floor ${index}`));
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = floorX - halfX + (column + 0.5) * sizeX;
      const z = floorZ - halfZ + (row + 0.5) * sizeZ;
      panelBatches[(column + row * 2) % panels.length]!.box(x, 0.03, z, sizeX - 0.06, 0.02, sizeZ - 0.06);
    }
  }
  panelBatches.forEach((batch, index) => {
    const mesh = batch.build(scene, panels[index]!);
    if (mesh) disposables.push(mesh);
  });
  spots.push({ id: "dance", point: [floorX, floorZ], label: "Dance" });

  // Mirror ball over the floor.
  const ballMaterial = new PBRMaterial("club mirror ball", scene);
  ballMaterial.metallic = 1;
  ballMaterial.roughness = 0.15;
  ballMaterial.albedoColor = new Color3(0.9, 0.9, 0.95);
  ballMaterial.emissiveColor = new Color3(0.25, 0.25, 0.3);
  const ball = marina ? new TransformNode("club chandelier", scene) : MeshBuilder.CreateSphere("club mirror ball", { diameter: 0.5, segments: 6 }, scene);
  if (ball instanceof Mesh) {
    ball.convertToFlatShadedMesh();
    ball.material = ballMaterial;
  }
  ball.position.set(floorX, HEIGHT - 0.55, floorZ);
  const chain = MeshBuilder.CreateCylinder("club mirror ball chain", { height: 0.3, diameter: 0.02 }, scene);
  chain.position.set(floorX, HEIGHT - 0.15, floorZ);
  chain.material = ballMaterial;
  disposables.push(ballMaterial, ball, chain);
  if (marina) {
    // Pearl's crystal chandelier: three gold rings hung with glowing drops over the floor.
    const goldTrim = new PBRMaterial("club chandelier gold", scene);
    goldTrim.albedoColor = new Color3(0.85, 0.66, 0.24);
    goldTrim.metallic = 1;
    goldTrim.roughness = 0.25;
    const crystal = neon(scene, "club chandelier crystal", Color3.FromHexString("#fff6dc"), disposables);
    disposables.push(goldTrim);
    const drops = new MeshBuilderBatch("club chandelier drops");
    for (const [index, radius] of [0.75, 0.5, 0.25].entries()) {
      const ring = MeshBuilder.CreateTorus(`club chandelier ring ${index}`, { diameter: radius * 2, thickness: 0.035, tessellation: 28 }, scene);
      ring.position.y = -index * 0.22;
      ring.material = goldTrim;
      ring.parent = ball;
      const count = Math.round(radius * 24);
      for (let drop = 0; drop < count; drop += 1) {
        const angle = (drop / count) * Math.PI * 2;
        drops.box(floorX + Math.cos(angle) * radius, HEIGHT - 0.55 - index * 0.22 - 0.12, floorZ + Math.sin(angle) * radius, 0.04, 0.16, 0.04);
      }
    }
    const dropMesh = drops.build(scene, crystal);
    if (dropMesh) disposables.push(dropMesh);
  }

  // VIP booths: carpet, velvet sofa against the wall, low table with a lit top, and a table number plate.
  const velvet: Rgb = marina ? [0.96, 0.93, 0.86] : [0.36, 0.04, 0.1];
  const upholstery = marina ? "plaster" : "fabric";
  const tableTop = new MeshBuilderBatch("club vip tables");
  const tableMaterial = neon(scene, "club vip tables", Color3.FromHexString("#fff3d6"), disposables);
  const plates = new MeshBuilderBatch("club vip plates");
  const vipX = OX + HX - 3.0;
  get("fabric").polygon([[vipX, OZ - HZ + 0.3], [OX + HX, OZ - HZ + 0.3], [OX + HX, OZ + HZ - 0.6], [vipX, OZ + HZ - 0.6]], 0.035, 1, marina ? [0.05, 0.12, 0.28] : [0.18, 0.02, 0.05]);
  strips.box(vipX, 0.05, OZ + 0.15, 0.04, 0.03, HZ * 2 - 0.9);
  for (const table of CLUB_TABLES) {
    const [sx, sz] = table.sofa;
    const [tx, tz] = table.table;
    solid(upholstery, sx, 0.24, sz, 0.8, 0.45, 2.2, 0, velvet);
    get(upholstery).box(sx + 0.36, 0.75, sz, 0.18, 0.7, 2.2, 0, 1, velvet);
    get(upholstery).box(sx - 0.05, 0.55, sz - 1.15, 0.9, 0.35, 0.16, 0, 1, velvet);
    get(upholstery).box(sx - 0.05, 0.55, sz + 1.15, 0.9, 0.35, 0.16, 0, 1, velvet);
    if (marina) get("chrome").box(sx + 0.36, 1.11, sz, 0.2, 0.03, 2.24, 0, 1, [0.85, 0.66, 0.24]);
    for (const dz of [-0.5, 0.5]) seats.push({ at: [sx - 0.12, sz + dz], yaw: -Math.PI / 2, y: 0.47, stool: false, table: table.no });
    solid("darkFrame", tx, 0.22, tz, 0.7, 0.44, 1.3, 0, marina ? [0.9, 0.88, 0.84] : [0.06, 0.06, 0.07]);
    tableTop.box(tx, 0.455, tz, 0.72, 0.02, 1.32);
    const uv = atlas.get(`VIP ${table.no}`, "plate", "Bottle service");
    const plateY = 2.2;
    const half = 0.45;
    plates.quad(
      [OX + HX - 0.03, plateY, tz + half],
      [OX + HX - 0.03, plateY, tz - half],
      [OX + HX - 0.03, plateY + (half * 2) / SignAtlas.aspect, tz - half],
      [OX + HX - 0.03, plateY + (half * 2) / SignAtlas.aspect, tz + half],
      [-1, 0, 0],
      [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
    );
    spots.push({ id: `table-${table.no}`, point: table.spot, label: `VIP table ${table.no}` });
  }
  const fish: Array<{ mesh: Mesh; lane: number; speed: number; phase: number }> = [];
  let animateFish: (seconds: number) => void = () => {};
  if (marina) {
    // A floor-to-ceiling aquarium on the entrance wall, gold-framed, with tropical fish, and palms in the corners.
    const [tankX0, tankX1] = [OX - HX + 0.6, INTERIOR_EXIT[0] - 1.0];
    const tankZ = OZ - HZ + 0.06;
    const water = neon(scene, "club aquarium", Color3.FromHexString("#0e6fa8"), disposables);
    const tank = MeshBuilder.CreatePlane("club aquarium", { width: tankX1 - tankX0, height: 2.1 }, scene);
    tank.position.set((tankX0 + tankX1) / 2, 1.3, tankZ);
    tank.rotation.y = Math.PI;
    tank.material = water;
    disposables.push(tank);
    get("chrome").box((tankX0 + tankX1) / 2, 0.22, tankZ + 0.06, tankX1 - tankX0 + 0.16, 0.08, 0.1, 0, 1, [0.85, 0.66, 0.24]);
    get("chrome").box((tankX0 + tankX1) / 2, 2.38, tankZ + 0.06, tankX1 - tankX0 + 0.16, 0.08, 0.1, 0, 1, [0.85, 0.66, 0.24]);
    for (const x of [tankX0 - 0.04, tankX1 + 0.04]) get("chrome").box(x, 1.3, tankZ + 0.06, 0.08, 2.24, 0.1, 0, 1, [0.85, 0.66, 0.24]);
    for (let index = 0; index < 7; index += 1) get("bush").box(tankX0 + 0.3 + index * 0.45, 0.4 + (index % 3) * 0.08, tankZ + 0.02, 0.08, 0.3 + (index % 3) * 0.15, 0.02);
    const fishColours = ["#ff8a1e", "#ffd21e", "#ff4f6d", "#4fe0ff"];
    for (let index = 0; index < 9; index += 1) {
      const body = MeshBuilder.CreateSphere(`club fish ${index}`, { diameterX: 0.22, diameterY: 0.1, diameterZ: 0.02, segments: 6 }, scene);
      body.material = neon(scene, `club fish ${index}`, Color3.FromHexString(fishColours[index % fishColours.length]!), disposables);
      body.isPickable = false;
      disposables.push(body);
      fish.push({ mesh: body, lane: 0.55 + (index % 5) * 0.35, speed: 0.15 + (index % 4) * 0.07, phase: index * 1.7 });
    }
    const fishRange = { x0: tankX0 + 0.2, x1: tankX1 - 0.2, z: tankZ + 0.03 };
    animateFish = (seconds) => {
      for (const entry of fish) {
        const span = fishRange.x1 - fishRange.x0;
        const travel = (seconds * entry.speed + entry.phase) % 2;
        const forward = travel < 1;
        const t = forward ? travel : 2 - travel;
        entry.mesh.position.set(fishRange.x0 + span * t, entry.lane + Math.sin(seconds * 1.3 + entry.phase) * 0.08, fishRange.z);
        entry.mesh.rotation.y = forward ? 0 : Math.PI;
      }
    };
    for (const [px, pz] of [[OX - HX + 0.45, OZ + HZ - 0.45], [OX + HX - 0.45, OZ - HZ + 0.45], [INTERIOR_EXIT[0] + 2.8, OZ - HZ + 0.45]] as const) {
      get("chrome").box(px, 0.25, pz, 0.46, 0.5, 0.46, 0, 1, [0.85, 0.66, 0.24]);
      get("palmBark").box(px, 0.62, pz, 0.06, 0.3, 0.06);
      for (const [index, [y, size]] of ([[0.95, 0.6], [1.35, 0.48], [1.7, 0.34], [1.98, 0.18]] as const).entries()) {
        get("bush").box(px, y, pz, size, size * 0.8, size, index % 2 ? Math.PI / 4 : 0);
      }
    }
    const pearl = atlas.get("PEARL", "plate", "Dubai Marina · The Walk");
    const half = 1.1;
    const signY = 2.45;
    const signX = (tankX0 + tankX1) / 2;
    plates.quad(
      [signX + half, signY, tankZ + 0.02],
      [signX - half, signY, tankZ + 0.02],
      [signX - half, signY + (half * 2) / SignAtlas.aspect, tankZ + 0.02],
      [signX + half, signY + (half * 2) / SignAtlas.aspect, tankZ + 0.02],
      [0, 0, 1],
      [[pearl.u0, pearl.v0], [pearl.u1, pearl.v0], [pearl.u1, pearl.v1], [pearl.u0, pearl.v1]],
    );
  }
  for (const [batch, material] of [[strips, stripMaterial], [warm, warmMaterial], [tableTop, tableMaterial], [plates, atlas.material]] as const) {
    const mesh = batch.build(scene, material);
    if (mesh) disposables.push(mesh);
  }

  const beams = palette.slice(0, 3).map((color, index) => {
    const beam = new PointLight(`club spot ${index}`, new Vector3(floorX, HEIGHT - 0.4, floorZ), scene);
    beam.diffuse = color.clone();
    beam.range = 7;
    beam.intensity = 6;
    disposables.push(beam);
    return beam;
  });
  const vipLight = new PointLight("club vip light", new Vector3(OX + HX - 1.6, HEIGHT - 0.5, OZ), scene);
  vipLight.diffuse = Color3.FromHexString(marina ? "#ffd89a" : "#ff5a7a");
  vipLight.intensity = 4;
  vipLight.range = 6;
  disposables.push(vipLight);

  // Bottles on each table, with sparklers on the showpiece bottles for a few seconds after they arrive.
  const spark = neon(scene, "club sparkler", Color3.FromHexString("#fff2b0"), disposables);
  const tableBottles = new Map<number, { ids: string; root: TransformNode; sparks: Array<{ mesh: ReturnType<typeof MeshBuilder.CreateBox>; until: number }> }>();
  let clock = 0;
  const setBottles = (no: number, bottles: Array<{ id: string; itemId: string }>) => {
    const table = CLUB_TABLES.find((entry) => entry.no === no);
    if (!table) return;
    const ids = bottles.map((bottle) => bottle.id).join(",");
    const previous = tableBottles.get(no);
    if (previous?.ids === ids) return;
    const known = new Set(previous?.ids.split(",") ?? []);
    previous?.root.dispose();
    const root = new TransformNode(`club table ${no} bottles`, scene);
    const sparks: Array<{ mesh: ReturnType<typeof MeshBuilder.CreateBox>; until: number }> = [];
    bottles.forEach((bottle, index) => {
      const [tx, tz] = table.table;
      const x = tx + (index % 2 ? 0.15 : -0.15);
      const z = tz - 0.45 + Math.floor(index / 2) * 0.42;
      const model = buildBottle(scene, bottle.itemId);
      model.position.set(x, 0.465, z);
      model.rotation.y = index * 1.3;
      model.parent = root;
      if (bottleById.get(bottle.itemId)?.sparkler && !known.has(bottle.id)) {
        const flare = MeshBuilder.CreateBox(`sparkler ${bottle.id}`, { width: 0.012, height: 0.16, depth: 0.012 }, scene);
        flare.position.set(x, 0.465 + 0.46, z);
        flare.material = spark;
        flare.parent = root;
        const tip = MeshBuilder.CreateSphere(`sparkler tip ${bottle.id}`, { diameter: 0.045, segments: 4 }, scene);
        tip.position.y = 0.09;
        tip.material = spark;
        tip.parent = flare;
        sparks.push({ mesh: flare, until: clock + 12 });
      }
    });
    tableBottles.set(no, { ids, root, sparks });
  };
  disposables.push({ dispose: () => tableBottles.forEach((entry) => entry.root.dispose()) });

  let lastLed = -1;
  let party = { until: -1, table: 0 };
  const celebrate = (no: number) => {
    party = { until: clock + 8, table: no };
  };
  let shout = { lines: [] as string[], until: -1 };
  const announce = (lines: string[], seconds: number) => {
    shout = { lines, until: clock + seconds };
  };
  const animate = (seconds: number) => {
    clock = seconds;
    const beat = (seconds * bpm) / 60;
    const partying = seconds < party.until;
    const pulse = partying ? Math.pow(1 - ((beat * 2) % 1), 2) : Math.pow(1 - (beat % 1), 2.5);
    const step = Math.floor(beat);
    panels.forEach((material, index) => {
      const colour = palette[(index + step) % palette.length]!;
      const level = 0.25 + 0.75 * (index % 2 === step % 2 ? pulse : 0.35);
      material.emissiveColor.set(colour.r * level, colour.g * level, colour.b * level);
    });
    const glow = 0.55 + 0.45 * pulse;
    const stripColour = palette[Math.floor(beat / 8) % palette.length]!;
    stripMaterial.emissiveColor.set(stripColour.r * glow, stripColour.g * glow, stripColour.b * glow);
    beams.forEach((beam, index) => {
      const angle = seconds * 0.9 + (index * Math.PI * 2) / beams.length;
      beam.position.set(floorX + Math.cos(angle) * halfX * 0.8, HEIGHT - 0.4, floorZ + Math.sin(angle) * halfZ * 0.8);
      beam.intensity = partying ? 6 + 14 * pulse : 3 + 7 * pulse;
    });
    vipLight.intensity = partying ? 8 + 10 * pulse : 4;
    if (partying) {
      const strobe = Math.floor(seconds * 12) % 3 === 0;
      stripMaterial.emissiveColor.set(strobe ? 1 : 0.9, strobe ? 1 : 0.75, strobe ? 1 : 0.2);
    }
    ball.rotation.y = seconds * (marina ? 0.1 : 0.6);
    animateFish(seconds);
    for (const entry of tableBottles.values()) {
      for (const flare of entry.sparks) {
        const live = seconds < flare.until;
        flare.mesh.setEnabled(live);
        if (live) flare.mesh.getChildMeshes()[0]?.scaling.setAll(0.6 + Math.random() * 1.2);
      }
    }
    if (seconds - lastLed > 1 / 15) {
      lastLed = seconds;
      ledContext.fillStyle = "#05030a";
      ledContext.fillRect(0, 0, ledSize.w, ledSize.h);
      const bars = 24;
      for (let index = 0; index < bars; index += 1) {
        const wave = 0.5 + 0.5 * Math.sin(seconds * 3 + index * 0.55) * Math.cos(seconds * 1.3 + index * 0.21);
        const height = (0.2 + 0.8 * wave * (0.55 + 0.45 * pulse)) * ledSize.h;
        const colour = palette[(index + Math.floor(beat / 4)) % palette.length]!;
        ledContext.fillStyle = colour.toHexString();
        ledContext.fillRect(index * (ledSize.w / bars) + 1, ledSize.h - height, ledSize.w / bars - 2, height);
      }
      if (seconds < shout.until && shout.lines.length) {
        // Bottle-service call-out: gold lettering flashing on the beat over the equaliser, names in white.
        ledContext.fillStyle = `rgba(5,3,10,${0.55 + 0.25 * pulse})`;
        ledContext.fillRect(0, 0, ledSize.w, ledSize.h);
        ledContext.textAlign = "center";
        // The speakers stand in front of the lower third of the wall, so the call-out keeps to the top.
        const lines = shout.lines.slice(0, 3);
        const size = lines.length > 2 ? 24 : 34;
        lines.forEach((line, index) => {
          const y = 12 + size + index * (size + 4);
          ledContext.font = `900 ${size}px Inter, Arial, sans-serif`;
          ledContext.fillStyle = index === lines.length - 1 ? "#ffffff" : step % 2 ? "#ffd84a" : "#ffb21e";
          ledContext.shadowColor = "#ffcf40";
          ledContext.shadowBlur = 12 * pulse;
          ledContext.fillText(line, ledSize.w / 2, y, ledSize.w - 24);
        });
        ledContext.shadowBlur = 0;
      } else {
        ledContext.fillStyle = "rgba(255,255,255,0.9)";
        ledContext.font = "bold 34px Inter, Arial, sans-serif";
        ledContext.textAlign = "center";
        ledContext.fillText(partying ? `BOTTLE SERVICE · VIP ${party.table}` : club ? club.dj.toUpperCase() : "LIVE", ledSize.w / 2, 44);
      }
      led.update(false);
    }
  };
  return { animate, setBottles, celebrate, announce, seats };
}
