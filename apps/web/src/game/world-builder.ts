import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import {
  districtAt,
  insideBuilding,
  PLACES,
  registerFootprints,
  sampleRoute,
  TRANSIT,
  type Place,
  type Vec2,
} from "@lagos-living/shared";
import { densify, hash, MeshBuilderBatch, offsetPolyline, pointAt, polylineLength, slicePolyline } from "./geometry";
import type { Materials, Quality } from "./materials";
import { SignAtlas, type UvRect } from "./sign-atlas";
import { findJunctions, waterSampler, type WorldArea, type WorldBuilding, type WorldData, type WorldRoad, type WorldTile } from "./street-index";

type Color = [number, number, number];

const PAINTS: Color[] = [
  [0.97, 0.93, 0.84],
  [0.98, 0.97, 0.95],
  [0.9, 0.82, 0.7],
  [0.86, 0.6, 0.47],
  [0.8, 0.8, 0.78],
  [0.98, 0.9, 0.66],
  [0.76, 0.85, 0.92],
  [0.8, 0.87, 0.77],
  [0.97, 0.81, 0.71],
];
const ROOFS: Color[] = [
  [0.6, 0.22, 0.17],
  [0.24, 0.36, 0.6],
  [0.24, 0.44, 0.3],
  [0.34, 0.34, 0.36],
  [0.66, 0.38, 0.22],
];
const SHOP_NAMES = [
  "Eko Fresh Mart",
  "Island Phones Hub",
  "Adunni Hair Studio",
  "Lagoon Laundry",
  "Sunrise Bakery",
  "Admiralty Prints",
  "Chukwu Spare Parts",
  "Omolara Fabrics",
  "Blue Tide Cafe",
  "Peace Provisions",
  "Kola Barbing Salon",
  "Tunde Electricals",
  "Mama Ngozi Foods",
  "Phase One Pharmacy",
  "Golden Fork Grill",
  "Ifeoma Boutique",
];
const SHOP_COLORS = ["#f6efe2", "#ffe7a3", "#d8ecf3", "#fbe0d6", "#e0f0dc"];

export const FLOOR_HEIGHT = 3.2;
const SIDEWALK_Y = 0.16;
const ROAD_Y: Record<string, number> = {
  primary: 0.04,
  primary_link: 0.038,
  tertiary: 0.036,
  unclassified: 0.033,
  residential: 0.03,
  service: 0.028,
};

/** Spatial index of road centreline segments for kerb trimming, height and placement queries. */
export class RoadIndex {
  private grid = new Map<string, Array<{ road: WorldRoad; a: Vec2; b: Vec2; s0: number }>>();
  private readonly cell = 24;

  constructor(readonly roads: WorldRoad[]) {
    for (const road of roads) {
      let s = 0;
      for (let index = 1; index < road.points.length; index += 1) {
        const a = road.points[index - 1]!;
        const b = road.points[index]!;
        const pad = road.width / 2 + 4;
        const segment = { road, a, b, s0: s };
        for (let cx = Math.floor((Math.min(a[0], b[0]) - pad) / this.cell); cx <= Math.floor((Math.max(a[0], b[0]) + pad) / this.cell); cx += 1) {
          for (let cz = Math.floor((Math.min(a[1], b[1]) - pad) / this.cell); cz <= Math.floor((Math.max(a[1], b[1]) + pad) / this.cell); cz += 1) {
            const key = `${cx}:${cz}`;
            const list = this.grid.get(key) ?? [];
            list.push(segment);
            this.grid.set(key, list);
          }
        }
        s += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  }

  /** Nearest carriageway with chainage, signed lateral offset (+ is right of travel) and direction. */
  nearest(x: number, z: number, filter?: (road: WorldRoad) => boolean) {
    let best: { road: WorldRoad; distance: number; s: number; lateral: number; dir: Vec2 } | null = null;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (const segment of this.grid.get(`${Math.floor(x / this.cell) + ox}:${Math.floor(z / this.cell) + oz}`) ?? []) {
          if (filter && !filter(segment.road)) continue;
          const dx = segment.b[0] - segment.a[0];
          const dz = segment.b[1] - segment.a[1];
          const length = Math.hypot(dx, dz) || 1;
          const t = Math.max(0, Math.min(1, ((x - segment.a[0]) * dx + (z - segment.a[1]) * dz) / (length * length)));
          const qx = segment.a[0] + dx * t;
          const qz = segment.a[1] + dz * t;
          const distance = Math.hypot(x - qx, z - qz);
          if (!best || distance < best.distance) {
            const lateral = ((x - qx) * dz - (z - qz) * dx) / length;
            best = { road: segment.road, distance, s: segment.s0 + t * length, lateral, dir: [dx / length, dz / length] };
          }
        }
      }
    }
    return best;
  }

  /** True when the point is on (or within `margin` of) any carriageway other than `exclude`. */
  onAsphalt(x: number, z: number, margin = 0, exclude?: WorldRoad) {
    for (const segment of this.grid.get(`${Math.floor(x / this.cell)}:${Math.floor(z / this.cell)}`) ?? []) {
      if (segment.road === exclude || segment.road.kind === "footway") continue;
      const dx = segment.b[0] - segment.a[0];
      const dz = segment.b[1] - segment.a[1];
      const lengthSquared = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - segment.a[0]) * dx + (z - segment.a[1]) * dz) / lengthSquared));
      if (Math.hypot(segment.a[0] + dx * t - x, segment.a[1] + dz * t - z) < segment.road.width / 2 + margin) return true;
    }
    return false;
  }
}

/** Client-side static obstacles (compound walls, poles, trunks) on a coarse grid. */
export class ObstacleGrid {
  private grid = new Map<string, Array<{ a: Vec2; b: Vec2; r: number }>>();
  private readonly cell = 16;

  add(a: Vec2, b: Vec2, r: number) {
    const item = { a, b, r };
    for (let cx = Math.floor((Math.min(a[0], b[0]) - r) / this.cell); cx <= Math.floor((Math.max(a[0], b[0]) + r) / this.cell); cx += 1) {
      for (let cz = Math.floor((Math.min(a[1], b[1]) - r) / this.cell); cz <= Math.floor((Math.max(a[1], b[1]) + r) / this.cell); cz += 1) {
        const key = `${cx}:${cz}`;
        const list = this.grid.get(key) ?? [];
        list.push(item);
        this.grid.set(key, list);
      }
    }
  }

  resolve(x: number, z: number, radius: number): Vec2 {
    let px = x;
    let pz = z;
    for (const item of this.grid.get(`${Math.floor(px / this.cell)}:${Math.floor(pz / this.cell)}`) ?? []) {
      const dx = item.b[0] - item.a[0];
      const dz = item.b[1] - item.a[1];
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - item.a[0]) * dx + (pz - item.a[1]) * dz) / lengthSquared)) : 0;
      const qx = item.a[0] + dx * t;
      const qz = item.a[1] + dz * t;
      const distance = Math.hypot(px - qx, pz - qz);
      const minimum = item.r + radius;
      if (distance < minimum) {
        const nx = distance > 1e-4 ? (px - qx) / distance : 1;
        const nz = distance > 1e-4 ? (pz - qz) / distance : 0;
        px = qx + nx * minimum;
        pz = qz + nz * minimum;
      }
    }
    return [px, pz];
  }

  blocked(x: number, z: number, radius: number) {
    const [rx, rz] = this.resolve(x, z, radius);
    return Math.hypot(rx - x, rz - z) > 0.01;
  }
}

/** Groups batches by spatial chunk and material key. */
class ChunkSet {
  readonly batches = new Map<string, Map<string, MeshBuilderBatch>>();
  /** Positions are clamped into `[min, max)` so geometry straddling a tile edge stays in that tile's chunks. */
  constructor(readonly size: number, readonly label: string, readonly min: Vec2, readonly max: Vec2) {}

  key(x: number, z: number) {
    const cx = Math.min(Math.max(x, this.min[0]), this.max[0] - 0.01);
    const cz = Math.min(Math.max(z, this.min[1]), this.max[1] - 0.01);
    return `${Math.floor(cx / this.size)}:${Math.floor(cz / this.size)}`;
  }

  get(x: number, z: number, material: string) {
    const key = this.key(x, z);
    let chunk = this.batches.get(key);
    if (!chunk) {
      chunk = new Map();
      this.batches.set(key, chunk);
    }
    let batch = chunk.get(material);
    if (!batch) {
      batch = new MeshBuilderBatch(`${this.label} ${key} ${material}`);
      chunk.set(material, batch);
    }
    return batch;
  }

  build(scene: Scene, materials: Record<string, Material>) {
    const chunks: Array<{ x: number; z: number; meshes: Mesh[] }> = [];
    for (const [key, chunk] of this.batches) {
      const [cx, cz] = key.split(":").map(Number) as [number, number];
      const meshes: Mesh[] = [];
      for (const [materialKey, batch] of chunk) {
        const mesh = batch.build(scene, materials[materialKey]!);
        if (mesh) meshes.push(mesh);
      }
      chunks.push({ x: (cx + 0.5) * this.size, z: (cz + 0.5) * this.size, meshes });
    }
    return chunks;
  }

  /** Chunks whose batches have not been turned into meshes yet; each builds on first use. */
  deferred(scene: Scene, materials: Record<string, Material>): DetailChunk[] {
    return [...this.batches].map(([key, chunk]) => {
      const [cx, cz] = key.split(":").map(Number) as [number, number];
      const entry: DetailChunk = {
        x: (cx + 0.5) * this.size,
        z: (cz + 0.5) * this.size,
        meshes: null,
        build: () => {
          if (entry.meshes) return entry.meshes;
          entry.meshes = [];
          for (const [materialKey, batch] of chunk) {
            const mesh = batch.build(scene, materials[materialKey]!);
            if (mesh) entry.meshes.push(mesh);
          }
          return entry.meshes;
        },
      };
      return entry;
    });
  }
}

type DetailChunk = { x: number; z: number; meshes: Mesh[] | null; build: () => Mesh[] };

function shoelace(points: Vec2[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function centroid(points: Vec2[]): Vec2 {
  const x = points.reduce((total, point) => total + point[0], 0) / points.length;
  const z = points.reduce((total, point) => total + point[1], 0) / points.length;
  return [x, z];
}

/** Minimum-area oriented rectangle using each edge direction as a candidate axis. */
function orientedBox(points: Vec2[]) {
  let best = { area: Infinity, ux: 1, uz: 0, cx: 0, cz: 0, hu: 0, hv: 0 };
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.5) continue;
    const ux = (b[0] - a[0]) / length;
    const uz = (b[1] - a[1]) / length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const point of points) {
      const u = point[0] * ux + point[1] * uz;
      const v = -point[0] * uz + point[1] * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { area, ux, uz, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, hu: (maxU - minU) / 2, hv: (maxV - minV) / 2 };
    }
  }
  return best;
}

/** Adds a text sign quad facing `yaw` (direction the readable face points). */
function textQuad(batch: MeshBuilderBatch, x: number, y: number, z: number, yaw: number, width: number, height: number, uv: UvRect) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const hw = width / 2;
  batch.quad(
    [x - rx * hw, y - height / 2, z - rz * hw],
    [x + rx * hw, y - height / 2, z + rz * hw],
    [x + rx * hw, y + height / 2, z + rz * hw],
    [x - rx * hw, y + height / 2, z - rz * hw],
    [fx, 0, fz],
    [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
  );
}

export type BuiltWorld = {
  roads: RoadIndex;
  obstacles: ObstacleGrid;
  /** Signs in currently loaded tiles. */
  junctionSigns: Array<{ point: Vec2; names: string[]; yaw: number }>;
  placeSigns: Array<{ placeId: string; point: Vec2 }>;
  groundHeight: (x: number, z: number) => number;
  updateDetail: (x: number, z: number) => void;
  /** Queues tiles near the point for loading and releases distant ones. */
  stream: (x: number, z: number) => void;
  /** Builds queued tiles until the time budget is spent. */
  pump: (budgetMs: number) => void;
  /** Tiles within the near radius of the last streamed point that are not built yet. */
  pendingNear: () => number;
  loadedTiles: () => string[];
  mapLayer: () => { buildings: WorldBuilding[]; areas: WorldArea[] };
  stats: { meshes: number; detailChunks: number; windows: number; buildings: number; tiles: number; tileBuildMs: number };
  casters: () => Mesh[];
  onMeshes: ((meshes: Mesh[]) => void) | null;
};

type LoadedTile = {
  key: string;
  meshes: Mesh[];
  detailChunks: DetailChunk[];
  junctionSigns: BuiltWorld["junctionSigns"];
  placeSigns: BuiltWorld["placeSigns"];
  buildings: WorldBuilding[];
  areas: WorldArea[];
  windows: number;
};

export function buildWorld(scene: Scene, data: WorldData, materials: Materials, atlas: SignAtlas, quality: Quality, fetchTile: (key: string) => Promise<WorldTile>): BuiltWorld {
  const roads = new RoadIndex(data.roads.filter((road) => road.kind !== "footway"));
  const obstacles = new ObstacleGrid();
  const materialMap: Record<string, Material> = { ...materials, signs: atlas.material } as unknown as Record<string, Material>;
  const detailRadius = quality === "low" ? 90 : quality === "medium" ? 150 : 220;
  const loadRadius = quality === "low" ? 420 : quality === "medium" ? 520 : 640;
  const TILE = data.tileSize;
  const tileOf = (x: number, z: number) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
  const contentTiles = new Set(data.tiles.map((tile) => tile.key));
  const water = waterSampler(data.water);
  const junctions = findJunctions(data.roads);
  const placeByBuilding = new Map<number, Place>(PLACES.filter((place) => place.buildingId !== null).map((place) => [place.buildingId!, place]));

  // Each road's densified centreline is split into runs of consecutive segments per tile (by segment midpoint).
  const roadParts = new Map<string, Array<{ road: WorldRoad; part: Vec2[] }>>();
  for (const road of data.roads) {
    const dense = densify(road.points, 2);
    let runKey = "";
    let run: Vec2[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const list = roadParts.get(runKey) ?? [];
        list.push({ road, part: run });
        roadParts.set(runKey, list);
      }
      run = [];
    };
    for (let index = 1; index < dense.length; index += 1) {
      const a = dense[index - 1]!;
      const b = dense[index]!;
      const key = tileOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (key !== runKey) {
        flush();
        runKey = key;
        run = [a];
      }
      run.push(b);
    }
    flush();
  }

  // The lagoon is one plane under the whole city; land tiles sit on top of it.
  const lagoon = MeshBuilder.CreateGround("lagoon", { width: 24_000, height: 24_000, subdivisions: 1 }, scene);
  lagoon.position.set((data.bounds.minX + data.bounds.maxX) / 2, -0.45, (data.bounds.minZ + data.bounds.maxZ) / 2);
  lagoon.material = materials.lagoon;
  lagoon.isPickable = false;
  lagoon.freezeWorldMatrix();

  // Frontage compound walls are claimed per road side so neighbours never overlap; results are cached by
  // building so a tile rebuilt after unloading gets the same walls.
  const claimed = new Map<string, Array<[number, number]>>();
  const claimCache = new Map<string, Array<[number, number]>>();
  const claim = (owner: number, key: string, s0: number, s1: number) => {
    const cacheKey = `${owner}|${key}`;
    const cached = claimCache.get(cacheKey);
    if (cached) return cached;
    const list = claimed.get(key) ?? [];
    const pieces: Array<[number, number]> = [[s0, s1]];
    for (const [a, b] of list) {
      for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const [p0, p1] = pieces[index]!;
        if (b <= p0 || a >= p1) continue;
        pieces.splice(index, 1);
        if (a > p0) pieces.push([p0, a]);
        if (b < p1) pieces.push([b, p1]);
      }
    }
    const kept = pieces.filter(([a, b]) => b - a > 1.2);
    list.push(...kept);
    claimed.set(key, list);
    claimCache.set(cacheKey, kept);
    return kept;
  };

  const sidewalkRoads = new Set(["primary", "tertiary", "unclassified", "residential"]);
  const sidewalkWidth = (road: WorldRoad) => (road.kind === "primary" ? 2.6 : road.kind === "tertiary" ? 2.2 : 1.8);
  const obstaclesAdded = new Set<string>();

  /** Matches the shared walkable deck (`DECK_PAD` in the world build) plus the parapet's thickness. */
  const deckHalf = (road: WorldRoad) => road.width / 2 + 1;
  const bridges = data.roads.filter((road) => road.bridge);
  const overWater = (x: number, z: number) => {
    const col = Math.floor((x - data.water.originX) / data.water.cell);
    const row = Math.floor((z - data.water.originZ) / data.water.cell);
    return water(col, row) + water(col + 1, row) + water(col, row + 1) + water(col + 1, row + 1) > 0;
  };
  const insideOtherDeck = (x: number, z: number, exclude: WorldRoad) => {
    for (const road of bridges) {
      if (road === exclude) continue;
      const half = deckHalf(road) - 0.05;
      for (let index = 1; index < road.points.length; index += 1) {
        const [ax, az] = road.points[index - 1]!;
        const [bx, bz] = road.points[index]!;
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < half) return true;
      }
    }
    return false;
  };

  function buildTile(key: string, content: WorldTile | null): LoadedTile {
  const [tx, tz] = key.split("_").map(Number) as [number, number];
  const x0 = tx * TILE;
  const z0 = tz * TILE;
  const inTile = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
  const firstBuild = !obstaclesAdded.has(key);
  obstaclesAdded.add(key);
  const addObstacle = (a: Vec2, b: Vec2, r: number) => {
    if (firstBuild) obstacles.add(a, b, r);
  };
  const base = new ChunkSet(TILE, `base ${key}`, [x0, z0], [x0 + TILE, z0 + TILE]);
  const detail = new ChunkSet(TILE / 2, `detail ${key}`, [x0, z0], [x0 + TILE, z0 + TILE]);
  let windows = 0;
  const palms: Array<[number, number, number]> = [];
  const lights: Array<[number, number, number]> = [];
  const tankInstances: Array<[number, number, number]> = [];
  const placeSigns: BuiltWorld["placeSigns"] = [];

  // Land: full cells merge into row strips; shoreline cells use marching squares on the water samples.
  {
    const grid = data.water;
    const cell = grid.cell;
    const c0 = Math.round((x0 - grid.originX) / cell);
    const r0 = Math.round((z0 - grid.originZ) / cell);
    const n = Math.round(TILE / cell);
    const ground = base.get(x0 + TILE / 2, z0 + TILE / 2, "dirt");
    for (let row = 0; row < n; row += 1) {
      let runStart = -1;
      const zA = grid.originZ + (r0 + row) * cell;
      const zB = zA + cell;
      const flushRun = (end: number) => {
        if (runStart < 0) return;
        const xA = grid.originX + (c0 + runStart) * cell;
        const xB = grid.originX + (c0 + end) * cell;
        ground.polygon([[xA, zA], [xB, zA], [xB, zB], [xA, zB]], 0, 7);
        runStart = -1;
      };
      for (let col = 0; col < n; col += 1) {
        const c = c0 + col;
        const r = r0 + row;
        const corners = [water(c, r), water(c + 1, r), water(c + 1, r + 1), water(c, r + 1)];
        const wet = corners[0]! + corners[1]! + corners[2]! + corners[3]!;
        if (wet === 0) {
          if (runStart < 0) runStart = col;
          continue;
        }
        flushRun(col);
        if (wet === 4) continue;
        const xA = grid.originX + c * cell;
        const xB = xA + cell;
        const points: Vec2[] = [[xA, zA], [xB, zA], [xB, zB], [xA, zB]];
        const ring: Vec2[] = [];
        for (let corner = 0; corner < 4; corner += 1) {
          const next = (corner + 1) % 4;
          const p = points[corner]!;
          const q = points[next]!;
          if (!corners[corner]) ring.push(p);
          if (corners[corner] !== corners[next]) ring.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
        }
        if (ring.length >= 3) ground.polygon(ring, 0, 7);
      }
      flushRun(n);
    }
  }

  for (const area of content?.areas ?? []) {
    const [cx, cz] = centroid(area.points);
    const ring = shoelace(area.points) < 0 ? [...area.points].reverse() : area.points;
    if (["pitch", "recreation_ground", "greenfield", "park", "garden", "golf_course", "grass", "village_green"].includes(area.kind)) {
      base.get(cx, cz, "grass").polygon(ring, 0.012, 5);
    } else if (area.kind === "swimming_pool") {
      base.get(cx, cz, "water").polygon(ring, 0.05, 4);
    } else if (area.kind === "drain") {
      base.get(cx, cz, "drain").polygon(ring, 0.008, 3);
    } else if (area.kind === "construction" || area.kind === "brownfield") {
      base.get(cx, cz, "dirt").polygon(ring, 0.01, 4, [1.05, 0.82, 0.68]);
    }
  }

  for (const { road, part: dense } of roadParts.get(key) ?? []) {
    const [mx, mz] = dense[Math.floor(dense.length / 2)]!;
    if (road.bridge) {
      // Parallel bridge ways (carriageways, footways) merge into one deck; parapets only run along its outer edge.
      const edge = deckHalf(road);
      const concrete = base.get(mx, mz, "concrete");
      concrete.worldRibbon(dense, -edge, edge, 0.012, 4);
      concrete.worldRibbon(dense, -edge, edge, -1.4, 4);
      for (const side of [1, -1]) {
        // Flyovers (Falomo Bridge over its roundabout) are drawn at street level, so parapets only stand over water.
        const keep = offsetPolyline(dense, side * edge).map(([x, z]) => overWater(x, z) && !insideOtherDeck(x, z, road));
        let run: Vec2[] = [];
        const flush = () => {
          if (run.length >= 2) {
            concrete.curtain(run, side * edge, -1.4, 1.05, 2, side < 0);
            concrete.curtain(run, side * (edge - 0.25), 0, 1.05, 2, side > 0);
            concrete.worldRibbon(run, side > 0 ? edge - 0.25 : -edge, side > 0 ? edge : -edge + 0.25, 1.05, 1);
            const line = offsetPolyline(run, side * (edge - 0.12));
            for (let index = 1; index < line.length; index += 1) addObstacle(line[index - 1]!, line[index]!, 0.15);
          }
          run = [];
        };
        dense.forEach((point, index) => {
          if (keep[index]) run.push(point);
          else flush();
        });
        flush();
      }
      const span = polylineLength(dense);
      for (let s = 12; s < span; s += 32) {
        const p = pointAt(dense, s);
        concrete.box(p.x, -3.2, p.z, edge * 1.4, 3.6, 1.6, Math.atan2(p.dx, p.dz) + Math.PI / 2);
      }
    }

    if (road.kind === "footway") {
      base.get(mx, mz, "pavers").worldRibbon(dense, -road.width / 2, road.width / 2, 0.05, 2.5);
      continue;
    }
    const y = ROAD_Y[road.kind] ?? 0.03;
    const asphaltKey = road.kind === "service" || road.kind === "residential" ? "asphaltMinor" : "asphalt";
    for (let start = 0; start < dense.length - 1; start += 40) {
      const piece = dense.slice(start, Math.min(dense.length, start + 41));
      const [px, pz] = piece[Math.floor(piece.length / 2)]!;
      base.get(px, pz, asphaltKey).worldRibbon(piece, -road.width / 2, road.width / 2, y, 6);
    }

    if (sidewalkRoads.has(road.kind) && !road.bridge) {
      const inner = road.width / 2 + 0.55;
      const outer = inner + sidewalkWidth(road);
      for (const side of [1, -1]) {
        const mid = offsetPolyline(dense, side * (inner + outer) / 2);
        const keep = mid.map(([x, z]) => !roads.onAsphalt(x, z, 1.2, road) && !insideBuilding(x, z, 0));
        let run: Vec2[] = [];
        const flush = () => {
          if (run.length >= 2) {
            const [rx, rz] = run[Math.floor(run.length / 2)]!;
            const left = side > 0 ? inner : -outer;
            const right = side > 0 ? outer : -inner;
            base.get(rx, rz, "pavers").worldRibbon(run, left, right, SIDEWALK_Y, 2.2);
            base.get(rx, rz, "concrete").curtain(run, side * inner, 0, SIDEWALK_Y, 1.5, side > 0);
            base.get(rx, rz, "concrete").curtain(run, side * outer, 0, SIDEWALK_Y, 1.5, side < 0);
            const drainLeft = side > 0 ? road.width / 2 : -inner;
            const drainRight = side > 0 ? inner : -road.width / 2;
            base.get(rx, rz, "drain").worldRibbon(run, drainLeft, drainRight, 0.015, 1.2);
          }
          run = [];
        };
        dense.forEach((point, index) => {
          if (keep[index]) run.push(point);
          else flush();
        });
        flush();
      }
    }

    const length = polylineLength(dense);
    const named = Boolean(road.name);
    if (named && road.width >= 6 && road.kind !== "service") {
      const markY = y + 0.006;
      const dashes = (offset: number, dash: number, gap: number) => {
        for (let s = 2; s + dash < length; s += dash + gap) {
          const p = pointAt(dense, s + dash / 2);
          if (roads.onAsphalt(p.x, p.z, 1.5, road)) continue;
          const slice = slicePolyline(dense, s, s + dash);
          base.get(p.x, p.z, "paintWhite").worldRibbon(slice, offset - 0.07, offset + 0.07, markY, 1);
        }
      };
      if (!road.oneway) dashes(0, 3, 4);
      else if (road.kind === "primary") {
        dashes(0, 3, 6);
        for (const edge of [-road.width / 2 + 0.35, road.width / 2 - 0.35]) {
          for (let start = 0; start < dense.length - 1; start += 40) {
            const piece = dense.slice(start, Math.min(dense.length, start + 41));
            const [px, pz] = piece[Math.floor(piece.length / 2)]!;
            base.get(px, pz, "paintWhite").worldRibbon(piece, edge - 0.08, edge + 0.08, markY, 1);
          }
        }
      }
    }

    if (road.kind === "primary") {
      for (let s = 6; s < length; s += 13) {
        const p = pointAt(dense, s);
        const offset = -(road.width / 2 + 2.6);
        const x = p.x + p.dz * offset;
        const z = p.z - p.dx * offset;
        if (roads.onAsphalt(x, z, 1.4) || insideBuilding(x, z, 0)) continue;
        palms.push([x, z, hash(Math.round(x * 13 + z * 7))]);
      }
    }
    if (road.kind === "primary" || road.kind === "tertiary") {
      for (let s = 10; s < length; s += 32) {
        const p = pointAt(dense, s);
        const offset = road.width / 2 + 0.55 + sidewalkWidth(road) - 0.4;
        const x = p.x + p.dz * offset;
        const z = p.z - p.dx * offset;
        if (roads.onAsphalt(x, z, 1.0, road) || insideBuilding(x, z, 0)) continue;
        lights.push([x, z, Math.atan2(-p.dz, p.dx)]);
      }
    }
    if (road.kind === "residential" || road.kind === "unclassified") {
      for (let s = 9; s < length; s += 17) {
        const seed = hash(road.id + Math.round(s));
        if (seed > 0.42) continue;
        const p = pointAt(dense, s);
        const offset = (seed > 0.21 ? 1 : -1) * (road.width / 2 + 0.55 + sidewalkWidth(road) + 0.6);
        const x = p.x + p.dz * offset;
        const z = p.z - p.dx * offset;
        if (roads.onAsphalt(x, z, 1.4) || insideBuilding(x, z, 0.0)) continue;
        palms.push([x, z, seed]);
      }
    }
  }

  // Zebra crossings across the mouths of side streets that meet main roads.
  const tileJunctions = junctions.filter((junction) => inTile(junction.point[0], junction.point[1]));
  for (const junction of tileJunctions) {
    const major = junction.roads.some((road) => road.kind === "primary" || road.kind === "tertiary");
    if (!major) continue;
    for (const road of junction.roads) {
      if (road.kind === "primary" || road.kind === "service") continue;
      const dense = densify(road.points, 2);
      const hit = roads.nearest(junction.point[0], junction.point[1], (candidate) => candidate === road);
      if (!hit) continue;
      const otherWidth = Math.max(...junction.roads.filter((other) => other !== road).map((other) => other.width));
      const length = polylineLength(dense);
      for (const direction of [-1, 1]) {
        const s = hit.s + direction * (otherWidth / 2 + 3.2);
        if (s < 2 || s > length - 2) continue;
        const slice = slicePolyline(dense, s - 1.5, s + 1.5);
        const [px, pz] = slice[0]!;
        for (let lateral = -road.width / 2 + 0.4; lateral + 0.5 < road.width / 2 - 0.3; lateral += 1) {
          base.get(px, pz, "paintWhite").worldRibbon(slice, lateral, lateral + 0.5, (ROAD_Y[road.kind] ?? 0.03) + 0.006, 1);
        }
      }
    }
  }

  for (const building of content?.buildings ?? []) {
    buildBuilding(building);
  }

  function buildBuilding(building: WorldBuilding) {
    const ring = shoelace(building.points) < 0 ? [...building.points].reverse() : building.points;
    const area = Math.abs(shoelace(ring));
    const [cx, cz] = centroid(ring);
    const seed = hash(building.id);
    const place = placeByBuilding.get(building.id);
    let floors = building.levels ?? 0;
    if (!floors) {
      if (building.kind === "office") floors = 4 + Math.floor(seed * 3);
      else if (building.kind === "hotel") floors = 5;
      else if (building.kind === "apartments") floors = 3 + Math.floor(seed * 2);
      else if (building.kind === "church") floors = 2;
      else if (building.kind === "roof") floors = 1;
      else if (area < 110) floors = 1 + Math.floor(seed * 2);
      else if (area > 700) floors = 3 + Math.floor(seed * 2);
      else floors = 2 + Math.floor(seed * 1.6);
    }
    floors = Math.min(floors, 14);
    const height = floors * FLOOR_HEIGHT + 0.3;
    const paint = PAINTS[Math.floor(hash(building.id * 7) * PAINTS.length)]!;
    const trim: Color = hash(building.id * 11) > 0.5 ? [0.98, 0.98, 0.97] : [0.62, 0.6, 0.57];
    const obb = orientedBox(ring);
    const rectangular = area / Math.max(1, obb.area) > 0.86 && ring.length <= 8;
    const hipRoof = building.kind !== "office" && building.kind !== "apartments" && floors <= 2 && rectangular && area < 520 && seed > 0.2;
    const parapet = hipRoof ? 0 : 0.9;
    const frameKey = hash(building.id * 3) > 0.45 ? "frame" : "darkFrame";

    if (building.kind === "roof") {
      // Canopies (fuel stations, car parks): slab on posts.
      base.get(cx, cz, "concrete").polygon(ring, 4.6, 4, trim);
      base.get(cx, cz, "concrete").polygon(ring, 4.4, 4, trim, true);
      for (const [x, z] of ring) base.get(cx, cz, "concrete").box(x, 2.25, z, 0.35, 4.5, 0.35, 0, 1, trim);
      return;
    }

    // Door edge: the edge closest to the nearest street, or the mapped place frontage.
    let doorEdge = 0;
    let doorT = 0.5;
    let bestScore = Infinity;
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 2.6) return;
      const nx = (b[1] - a[1]) / length;
      const nz = -(b[0] - a[0]) / length;
      const mx = (a[0] + b[0]) / 2 + nx * 1.5;
      const mz = (a[1] + b[1]) / 2 + nz * 1.5;
      let score: number;
      if (place) {
        score = Math.hypot(mx - place.facade[0], mz - place.facade[1]);
      } else {
        const near = roads.nearest(mx, mz);
        score = near ? near.distance - Math.min(length, 12) * 0.3 : 999;
      }
      if (score < bestScore) {
        bestScore = score;
        doorEdge = index;
      }
    });
    {
      const a = ring[doorEdge]!;
      const b = ring[(doorEdge + 1) % ring.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (place) {
        const t = ((place.facade[0] - a[0]) * (b[0] - a[0]) + (place.facade[1] - a[1]) * (b[1] - a[1])) / (length * length);
        doorT = Math.max(1 / length, Math.min(1 - 1 / length, t));
      }
    }
    const doorA = ring[doorEdge]!;
    const doorB = ring[(doorEdge + 1) % ring.length]!;
    const doorLength = Math.hypot(doorB[0] - doorA[0], doorB[1] - doorA[1]);
    const doorNx = (doorB[1] - doorA[1]) / doorLength;
    const doorNz = -(doorB[0] - doorA[0]) / doorLength;
    const doorX = doorA[0] + (doorB[0] - doorA[0]) * doorT;
    const doorZ = doorA[1] + (doorB[1] - doorA[1]) * doorT;
    const frontRoad = roads.nearest(doorX + doorNx * 2, doorZ + doorNz * 2);
    const commercialKinds = new Set(["shop", "food", "furniture", "job"]);
    const onMainRoad = frontRoad && (frontRoad.road.kind === "primary" || frontRoad.road.kind === "tertiary" || frontRoad.road.kind === "primary_link") && frontRoad.distance < 32;
    const shopfront =
      (place && commercialKinds.has(place.kind)) ||
      (!place && onMainRoad && building.kind !== "apartments" && building.kind !== "church" && hash(building.id * 5) > 0.25);

    const walls = base.get(cx, cz, "plaster");
    const trimBatch = base.get(cx, cz, "concrete");
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.05) return;
      const nx = (b[1] - a[1]) / length;
      const nz = -(b[0] - a[0]) / length;
      const yawOut = Math.atan2(nx, nz);
      walls.wall(a[0], a[1], b[0], b[1], 0.45, height + parapet, 2.5, paint);
      // Plinth band and floor bands give each storey a readable line.
      const plinth = (y0: number, y1: number, out: number, color: Color, batch: MeshBuilderBatch) => {
        batch.wall(a[0] + nx * out, a[1] + nz * out, b[0] + nx * out, b[1] + nz * out, y0, y1, 1.5, color);
        batch.quad(
          [a[0], y1, a[1]],
          [b[0], y1, b[1]],
          [b[0] + nx * out, y1, b[1] + nz * out],
          [a[0] + nx * out, y1, a[1] + nz * out],
          [0, 1, 0],
          [[0, 0], [length, 0], [length, out], [0, out]],
          color,
        );
      };
      plinth(0, 0.45, 0.06, [0.55, 0.53, 0.5], trimBatch);
      for (let floor = 1; floor < floors; floor += 1) plinth(floor * FLOOR_HEIGHT + 0.1, floor * FLOOR_HEIGHT + 0.3, 0.1, trim, trimBatch);
      if (parapet) {
        const ix = -nx * 0.22;
        const iz = -nz * 0.22;
        walls.wall(b[0] + ix, b[1] + iz, a[0] + ix, a[1] + iz, height, height + parapet, 2.5, paint);
        trimBatch.quad(
          [a[0] + nx * 0.06, height + parapet, a[1] + nz * 0.06],
          [b[0] + nx * 0.06, height + parapet, b[1] + nz * 0.06],
          [b[0] + ix, height + parapet, b[1] + iz],
          [a[0] + ix, height + parapet, a[1] + iz],
          [0, 1, 0],
          [[0, 0], [length, 0], [length, 0.3], [0, 0.3]],
          trim,
        );
      }

      // Windows: flush glass always; frames, sills, grilles, AC units and balconies near the camera.
      if (length < 2.4) return;
      const isDoorEdge = index === doorEdge;
      const windowWidth = building.kind === "office" ? 1.8 : building.kind === "apartments" ? 1.4 : 1.2;
      const spacing = building.kind === "office" ? 2.2 : 2.9;
      const count = Math.max(1, Math.floor((length - 0.8) / spacing));
      const step = length / count;
      const glass = base.get(cx, cz, "glass");
      const frames = detail.get(cx, cz, frameKey);
      const trims = detail.get(cx, cz, "concrete");
      const ex = (b[0] - a[0]) / length;
      const ez = (b[1] - a[1]) / length;
      const towardRoad = roads.nearest((a[0] + b[0]) / 2 + nx * 3, (a[1] + b[1]) / 2 + nz * 3);
      const facesStreet = Boolean(towardRoad && towardRoad.distance < 22);
      for (let floor = 0; floor < floors; floor += 1) {
        if (floor === 0 && isDoorEdge && shopfront) continue;
        const sill = floor * FLOOR_HEIGHT + (floor === 0 ? 1.05 : 0.95);
        const top = sill + 1.4;
        for (let column = 0; column < count; column += 1) {
          const t = (column + 0.5) * step;
          if (floor === 0 && isDoorEdge && Math.abs(t - doorT * length) < 1.7) continue;
          const wx = a[0] + ex * t;
          const wz = a[1] + ez * t;
          const half = windowWidth / 2;
          windows += 1;
          glass.quad(
            [wx - ex * half + nx * 0.03, sill, wz - ez * half + nz * 0.03],
            [wx + ex * half + nx * 0.03, sill, wz + ez * half + nz * 0.03],
            [wx + ex * half + nx * 0.03, top, wz + ez * half + nz * 0.03],
            [wx - ex * half + nx * 0.03, top, wz - ez * half + nz * 0.03],
            [nx, 0, nz],
            [[0, 0], [1, 0], [1, 1], [0, 1]],
          );
          const fx = wx + nx * 0.07;
          const fz = wz + nz * 0.07;
          frames.box(fx, top + 0.05, fz, windowWidth + 0.16, 0.1, 0.14, yawOut, 1, undefined, true);
          frames.box(fx - ex * (half + 0.04), (sill + top) / 2, fz - ez * (half + 0.04), 0.08, top - sill, 0.14, yawOut, 1, undefined, true);
          frames.box(fx + ex * (half + 0.04), (sill + top) / 2, fz + ez * (half + 0.04), 0.08, top - sill, 0.14, yawOut, 1, undefined, true);
          frames.box(wx + nx * 0.05, (sill + top) / 2, wz + nz * 0.05, 0.05, top - sill, 0.06, yawOut, 1, undefined, true);
          trims.box(wx + nx * 0.11, sill - 0.04, wz + nz * 0.11, windowWidth + 0.34, 0.08, 0.22, yawOut, 1, trim, true);
          const variant = hash(building.id * 31 + floor * 7 + column * 13);
          if (floor === 0 && building.kind !== "office" && quality !== "low") {
            const bars = detail.get(cx, cz, "gate");
            for (let bar = 1; bar < 5; bar += 1) {
              const offset = -half + (windowWidth * bar) / 5;
              bars.box(wx + ex * offset + nx * 0.16, (sill + top) / 2, wz + ez * offset + nz * 0.16, 0.025, top - sill, 0.025, yawOut, 1, undefined, true);
            }
            bars.box(wx + nx * 0.16, top - 0.08, wz + nz * 0.16, windowWidth, 0.03, 0.03, yawOut, 1, undefined, true);
            bars.box(wx + nx * 0.16, sill + 0.08, wz + nz * 0.16, windowWidth, 0.03, 0.03, yawOut, 1, undefined, true);
          }
          if (floor >= 1 && variant < 0.24) {
            const side = variant < 0.12 ? -1 : 1;
            const ax = wx + ex * side * (half + 0.55) + nx * 0.17;
            const az = wz + ez * side * (half + 0.55) + nz * 0.17;
            detail.get(cx, cz, "acUnit").box(ax, sill + 0.1, az, 0.82, 0.55, 0.32, yawOut, 1, undefined, true);
            detail.get(cx, cz, "darkFrame").box(ax + nx * 0.165, sill + 0.1, az + nz * 0.165, 0.5, 0.42, 0.01, yawOut, 1, undefined, true);
          }
          const balcony =
            floor >= 1 &&
            facesStreet &&
            length >= 7 &&
            column % 2 === 0 &&
            column > 0 &&
            column < count - 1 &&
            (building.kind === "apartments" || building.kind === "hotel" || (floors >= 3 && seed > 0.35));
          if (balcony) {
            const floorY = floor * FLOOR_HEIGHT + 0.12;
            const span = windowWidth + 1.3;
            trims.box(wx + nx * 0.6, floorY, wz + nz * 0.6, span, 0.16, 1.2, yawOut, 1, trim);
            trims.box(wx + nx * 1.14, floorY + 0.58, wz + nz * 1.14, span, 0.95, 0.1, yawOut, 1, paint);
            trims.box(wx + nx * 0.6 - ex * (span / 2 - 0.05), floorY + 0.58, wz + nz * 0.6 - ez * (span / 2 - 0.05), 0.1, 0.95, 1.1, yawOut, 1, paint);
            trims.box(wx + nx * 0.6 + ex * (span / 2 - 0.05), floorY + 0.58, wz + nz * 0.6 + ez * (span / 2 - 0.05), 0.1, 0.95, 1.1, yawOut, 1, paint);
            frames.box(wx + nx * 1.14, floorY + 1.1, wz + nz * 1.14, span, 0.05, 0.08, yawOut);
          }
        }
      }
    });

    // Roof: hip roof in long-span aluminium for small houses, parapet slab plus tanks otherwise.
    if (hipRoof) {
      const roofColor = ROOFS[Math.floor(hash(building.id * 17) * ROOFS.length)]!;
      const roof = base.get(cx, cz, "roof");
      const overhang = 0.55;
      let { ux, uz, hu, hv } = obb;
      if (hv > hu) {
        [hu, hv] = [hv, hu];
        [ux, uz] = [-uz, ux];
      }
      hu += overhang;
      hv += overhang;
      const vx = -uz;
      const vz = ux;
      const rise = hv * 0.42;
      const ridge = Math.max(0, hu - hv);
      const at = (u: number, v: number, y: number): [number, number, number] => [obb.cx + ux * u + vx * v, y, obb.cz + uz * u + vz * v];
      const eave = height + 0.05;
      const c1 = at(-hu, -hv, eave);
      const c2 = at(hu, -hv, eave);
      const c3 = at(hu, hv, eave);
      const c4 = at(-hu, hv, eave);
      const r1 = at(-ridge, 0, eave + rise);
      const r2 = at(ridge, 0, eave + rise);
      const faceNormal = (p: [number, number, number], q: [number, number, number], r: [number, number, number]): [number, number, number] => {
        const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2];
        const bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        if (ny < 0) [nx, ny, nz] = [-nx, -ny, -nz];
        const length = Math.hypot(nx, ny, nz) || 1;
        return [nx / length, ny / length, nz / length];
      };
      const span = hu * 2;
      roof.quad(c1, c2, r2, r1, faceNormal(c1, c2, r2), [[0, 0], [span / 2, 0], [span / 2 - 0.5, hv], [0.5, hv]], roofColor);
      roof.quad(c3, c4, r1, r2, faceNormal(c3, c4, r1), [[0, 0], [span / 2, 0], [span / 2 - 0.5, hv], [0.5, hv]], roofColor);
      roof.triangle(c2, c3, r2, faceNormal(c2, c3, r2), [[0, 0], [hv, 0], [hv / 2, hv / 2]], roofColor);
      roof.triangle(c4, c1, r1, faceNormal(c4, c1, r1), [[0, 0], [hv, 0], [hv / 2, hv / 2]], roofColor);
      const fascia = base.get(cx, cz, "concrete");
      const corners = [c1, c2, c3, c4];
      corners.forEach((p, index) => {
        const q = corners[(index + 1) % 4]!;
        fascia.wall(p[0], p[2], q[0], q[2], eave - 0.22, eave, 1, trim);
      });
      fascia.polygon(corners.map((p) => [p[0], p[2]] as Vec2), eave - 0.22, 2, [0.92, 0.92, 0.9], true);
    } else {
      base.get(cx, cz, "concrete").polygon(ring, height, 4, [0.72, 0.7, 0.66]);
      if (area > 60) {
        const tanks = 1 + Math.floor(hash(building.id * 23) * (area > 400 ? 3 : 1.6));
        for (let tank = 0; tank < tanks; tank += 1) {
          const ox = (hash(building.id + tank * 3) - 0.5) * Math.min(6, obb.hu);
          const oz = (hash(building.id + tank * 5) - 0.5) * Math.min(6, obb.hv);
          tankInstances.push([obb.cx + obb.ux * ox - obb.uz * oz, height, obb.cz + obb.uz * ox + obb.ux * oz]);
        }
      }
    }

    // Entrance: door leaf, frame, canopy and steps; shops get glazing, fascia and awning.
    const doorYaw = Math.atan2(doorNx, doorNz);
    const ex = (doorB[0] - doorA[0]) / doorLength;
    const ez = (doorB[1] - doorA[1]) / doorLength;
    if (shopfront) {
      const width = Math.min(doorLength - 0.8, 9);
      const centreT = Math.max(width / 2 + 0.4, Math.min(doorLength - width / 2 - 0.4, doorT * doorLength));
      const sx = doorA[0] + ex * centreT;
      const sz = doorA[1] + ez * centreT;
      base.get(cx, cz, "glass").quad(
        [sx - ex * width / 2 + doorNx * 0.03, 0.45, sz - ez * width / 2 + doorNz * 0.03],
        [sx + ex * width / 2 + doorNx * 0.03, 0.45, sz + ez * width / 2 + doorNz * 0.03],
        [sx + ex * width / 2 + doorNx * 0.03, 2.95, sz + ez * width / 2 + doorNz * 0.03],
        [sx - ex * width / 2 + doorNx * 0.03, 2.95, sz - ez * width / 2 + doorNz * 0.03],
        [doorNx, 0, doorNz],
        [[0, 0], [1, 0], [1, 1], [0, 1]],
      );
      const mullions = detail.get(cx, cz, "darkFrame");
      for (let offset = -width / 2; offset <= width / 2 + 0.01; offset += width / Math.max(1, Math.round(width / 2.2))) {
        mullions.box(sx + ex * offset + doorNx * 0.06, 1.7, sz + ez * offset + doorNz * 0.06, 0.08, 2.5, 0.1, doorYaw, 1, undefined, true);
      }
      mullions.box(sx + doorNx * 0.08, 3.08, sz + doorNz * 0.08, width + 0.2, 0.26, 0.2, doorYaw, 1, undefined, true);
      const name = place?.name ?? SHOP_NAMES[Math.floor(hash(building.id * 37) * SHOP_NAMES.length)]!;
      const signColor = SHOP_COLORS[Math.floor(hash(building.id * 19) * SHOP_COLORS.length)]!;
      const uv = atlas.get(name, "shop", place ? place.street : undefined, signColor);
      const signWidth = Math.min(width, 5.6);
      base.get(cx, cz, "concrete").box(sx + doorNx * 0.12, 3.75, sz + doorNz * 0.12, signWidth + 0.3, signWidth / SignAtlas.aspect + 0.25, 0.16, doorYaw, 1, [0.2, 0.2, 0.2], true);
      textQuad(base.get(cx, cz, "signs"), sx + doorNx * 0.205, 3.75, sz + doorNz * 0.205, doorYaw, signWidth, signWidth / SignAtlas.aspect, uv);
      const awningKey = hash(building.id * 29) > 0.5 ? "awningRed" : "awningGreen";
      const awning = detail.get(cx, cz, awningKey);
      const depth = 1.5;
      const p0: [number, number, number] = [sx - ex * width / 2 + doorNx * 0.1, 3.2, sz - ez * width / 2 + doorNz * 0.1];
      const p1: [number, number, number] = [sx + ex * width / 2 + doorNx * 0.1, 3.2, sz + ez * width / 2 + doorNz * 0.1];
      const p2: [number, number, number] = [p1[0] + doorNx * depth, 2.7, p1[2] + doorNz * depth];
      const p3: [number, number, number] = [p0[0] + doorNx * depth, 2.7, p0[2] + doorNz * depth];
      awning.quad(p0, p1, p2, p3, [doorNx * 0.32, 0.95, doorNz * 0.32], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      awning.wall(p3[0], p3[2], p2[0], p2[2], 2.45, 2.7, 1);
    } else {
      const doorWidth = building.kind === "apartments" ? 1.6 : 1.1;
      base.get(cx, cz, "wood").quad(
        [doorX - ex * doorWidth / 2 + doorNx * 0.04, 0.45, doorZ - ez * doorWidth / 2 + doorNz * 0.04],
        [doorX + ex * doorWidth / 2 + doorNx * 0.04, 0.45, doorZ + ez * doorWidth / 2 + doorNz * 0.04],
        [doorX + ex * doorWidth / 2 + doorNx * 0.04, 2.65, doorZ + ez * doorWidth / 2 + doorNz * 0.04],
        [doorX - ex * doorWidth / 2 + doorNx * 0.04, 2.65, doorZ - ez * doorWidth / 2 + doorNz * 0.04],
        [doorNx, 0, doorNz],
        [[0, 0], [1, 0], [1, 2], [0, 2]],
      );
      const frame = detail.get(cx, cz, "darkFrame");
      frame.box(doorX + doorNx * 0.07, 2.72, doorZ + doorNz * 0.07, doorWidth + 0.24, 0.14, 0.14, doorYaw, 1, undefined, true);
      frame.box(doorX - ex * (doorWidth / 2 + 0.06) + doorNx * 0.07, 1.55, doorZ - ez * (doorWidth / 2 + 0.06) + doorNz * 0.07, 0.12, 2.3, 0.14, doorYaw, 1, undefined, true);
      frame.box(doorX + ex * (doorWidth / 2 + 0.06) + doorNx * 0.07, 1.55, doorZ + ez * (doorWidth / 2 + 0.06) + doorNz * 0.07, 0.12, 2.3, 0.14, doorYaw, 1, undefined, true);
      const canopy = detail.get(cx, cz, "concrete");
      canopy.box(doorX + doorNx * 0.55, 3.0, doorZ + doorNz * 0.55, doorWidth + 1.0, 0.14, 1.1, doorYaw, 1, trim);
      canopy.box(doorX + doorNx * 0.4, 0.3, doorZ + doorNz * 0.4, doorWidth + 0.8, 0.3, 0.8, doorYaw, 1, [0.7, 0.68, 0.64], true);
    }

    if (place) {
      placeSigns.push({ placeId: place.id, point: place.door });
      if (place.kind === "rental" || place.kind === "sale") {
        const style = place.kind === "rental" ? "rent" : "sale";
        const uv = atlas.get(place.kind === "rental" ? "FOR RENT" : "FOR SALE", style, place.name);
        const px = place.door[0] + doorNx * 0.6 + ex * 1.8;
        const pz = place.door[1] + doorNz * 0.6 + ez * 1.8;
        const posts = base.get(cx, cz, "pole");
        posts.box(px - ex * 0.7, 1.0, pz - ez * 0.7, 0.07, 2.0, 0.07, doorYaw);
        posts.box(px + ex * 0.7, 1.0, pz + ez * 0.7, 0.07, 2.0, 0.07, doorYaw);
        base.get(cx, cz, "concrete").box(px, 1.75, pz, 1.7, 0.4, 0.04, doorYaw, 1, [0.95, 0.95, 0.95]);
        textQuad(base.get(cx, cz, "signs"), px + doorNx * 0.025, 1.75, pz + doorNz * 0.025, doorYaw, 1.62, 1.62 / SignAtlas.aspect, uv);
        textQuad(base.get(cx, cz, "signs"), px - doorNx * 0.025, 1.75, pz - doorNz * 0.025, doorYaw + Math.PI, 1.62, 1.62 / SignAtlas.aspect, uv);
        addObstacle([px - ex * 0.7, pz - ez * 0.7], [px - ex * 0.7, pz - ez * 0.7], 0.08);
        addObstacle([px + ex * 0.7, pz + ez * 0.7], [px + ex * 0.7, pz + ez * 0.7], 0.08);
      } else if (!shopfront) {
        const uv = atlas.get(place.name, "plate", place.street);
        textQuad(base.get(cx, cz, "signs"), doorX + ex * 1.3 + doorNx * 0.05, 2.0, doorZ + ez * 1.3 + doorNz * 0.05, doorYaw, 1.3, 1.3 / SignAtlas.aspect, uv);
      }
      return;
    }

    // Compound wall along the street frontage, with a gate and sometimes a gatehouse.
    if (shopfront || !frontRoad || frontRoad.road.kind === "service" || building.kind === "church") return;
    const road = frontRoad.road;
    const offset = road.width / 2 + 0.55 + (sidewalkRoads.has(road.kind) ? sidewalkWidth(road) : 0.6) + 0.2;
    const side = frontRoad.lateral >= 0 ? 1 : -1;
    const buildingDistance = Math.min(
      ...ring.map(([x, z]) => roads.nearest(x, z, (candidate) => candidate === road)?.distance ?? 0),
    );
    if (buildingDistance < offset + 1.6) return;
    let s0 = Infinity;
    let s1 = -Infinity;
    for (const [x, z] of ring) {
      const hit = roads.nearest(x, z, (candidate) => candidate === road);
      if (!hit) continue;
      s0 = Math.min(s0, hit.s);
      s1 = Math.max(s1, hit.s);
    }
    const roadDense = densify(road.points, 2);
    s0 = Math.max(0.5, s0 - 2.5);
    s1 = Math.min(polylineLength(roadDense) - 0.5, s1 + 2.5);
    if (s1 - s0 < 4) return;
    const gateHit = roads.nearest(doorX, doorZ, (candidate) => candidate === road);
    const gateS = gateHit ? Math.max(s0 + 2, Math.min(s1 - 2, gateHit.s)) : (s0 + s1) / 2;
    const wallHeight = 2.3;
    const wallPaint: Color = [paint[0] * 0.95, paint[1] * 0.95, paint[2] * 0.95];
    for (const [a, b] of claim(building.id, `${road.id}:${side}`, s0, s1)) {
      const segments: Array<[number, number]> = [];
      if (gateS - 1.7 > a && gateS + 1.7 < b) segments.push([a, gateS - 1.7], [gateS + 1.7, b]);
      else segments.push([a, b]);
      for (const [w0, w1] of segments) {
        if (w1 - w0 < 0.4) continue;
        const line = offsetPolyline(slicePolyline(roadDense, w0, w1), side * offset);
        const valid = line.every(([x, z]) => !insideBuilding(x, z, 0) && !roads.onAsphalt(x, z, 0.3));
        if (!valid) continue;
        const [lx, lz] = line[0]!;
        const wallBatch = base.get(lx, lz, "walls");
        const face = side > 0;
        wallBatch.curtain(line, -0.1 * side, 0, wallHeight, 2.5, !face, wallPaint);
        wallBatch.curtain(line, 0.1 * side, 0, wallHeight, 2.5, face, wallPaint);
        base.get(lx, lz, "concrete").worldRibbon(line, -0.16, 0.16, wallHeight, 1, trim);
        for (let index = 1; index < line.length; index += 1) addObstacle(line[index - 1]!, line[index]!, 0.16);
        const first = line[0]!;
        const last = line.at(-1)!;
        for (const [px, pz] of [first, last]) {
          base.get(lx, lz, "concrete").box(px, wallHeight / 2 + 0.1, pz, 0.45, wallHeight + 0.2, 0.45, 0, 1, trim);
        }
      }
      if (gateS - 1.7 > a && gateS + 1.7 < b) {
        const gp = pointAt(roadDense, gateS);
        const gx = gp.x + gp.dz * side * offset;
        const gz = gp.z - gp.dx * side * offset;
        if (insideBuilding(gx, gz, 0)) continue;
        const gateYaw = Math.atan2(gp.dx, gp.dz) + Math.PI / 2;
        const gate = base.get(gx, gz, "gate");
        gate.box(gx - gp.dx * 0.85, 1.15, gz - gp.dz * 0.85, 0.08, 2.1, 1.65, gateYaw - Math.PI / 2);
        gate.box(gx + gp.dx * 0.85, 1.15, gz + gp.dz * 0.85, 0.08, 2.1, 1.65, gateYaw - Math.PI / 2);
        addObstacle([gx - gp.dx * 1.7, gz - gp.dz * 1.7], [gx + gp.dx * 1.7, gz + gp.dz * 1.7], 0.12);
        for (const sign of [-1, 1]) {
          base.get(gx, gz, "concrete").box(gx + gp.dx * sign * 1.85, 1.35, gz + gp.dz * sign * 1.85, 0.5, 2.7, 0.5, gateYaw, 1, trim);
        }
        if (hash(building.id * 41) > 0.45 && buildingDistance > offset + 3.4) {
          const inward = -side;
          const hx = gx + gp.dx * 3.3 + gp.dz * inward * -1.2;
          const hz = gz + gp.dz * 3.3 - gp.dx * inward * -1.2;
          if (!insideBuilding(hx, hz, 0)) {
            const hut = detail.get(hx, hz, "walls");
            hut.box(hx, 1.2, hz, 1.6, 2.4, 1.6, gateYaw, 2, wallPaint);
            detail.get(hx, hz, "concrete").box(hx, 2.5, hz, 2.0, 0.14, 2.0, gateYaw, 1, trim);
            detail.get(hx, hz, "glass").box(hx, 1.55, hz, 1.62, 0.6, 1.0, gateYaw);
          }
        }
      }
    }
  }

  // Junction street-name signs, one blade per named street.
  const junctionSigns: BuiltWorld["junctionSigns"] = [];
  for (const junction of tileJunctions) {
    const named = junction.roads.filter((road) => road.name);
    if (named.length < 2) continue;
    const dirs = named.slice(0, 2).map((road) => {
      const hit = roads.nearest(junction.point[0], junction.point[1], (candidate) => candidate === road)!;
      return hit.dir;
    });
    const reach = Math.max(...named.map((road) => road.width)) / 2 + 1.9;
    let corner: Vec2 | null = null;
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const vx = dirs[0]![0] * sa + dirs[1]![0] * sb;
      const vz = dirs[0]![1] * sa + dirs[1]![1] * sb;
      const length = Math.hypot(vx, vz) || 1;
      const x = junction.point[0] + (vx / length) * reach * 1.25;
      const z = junction.point[1] + (vz / length) * reach * 1.25;
      if (!roads.onAsphalt(x, z, 0.4) && !insideBuilding(x, z, 0)) {
        corner = [x, z];
        break;
      }
    }
    if (!corner) continue;
    const [px, pz] = corner;
    base.get(px, pz, "pole").box(px, 1.6, pz, 0.08, 3.2, 0.08);
    addObstacle(corner, corner, 0.1);
    named.slice(0, 2).forEach((road, index) => {
      const dir = dirs[index]!;
      const y = 3.0 - index * 0.36;
      const yawAlong = Math.atan2(dir[0], dir[1]);
      const uv = atlas.get(road.name!, "street", districtAt(px, pz)?.name ?? "Lagos");
      const width = 1.7;
      const height = width / SignAtlas.aspect * 1.25;
      const cxBlade = px + dir[0] * (width / 2 - 0.1);
      const czBlade = pz + dir[1] * (width / 2 - 0.1);
      base.get(px, pz, "signGreen").box(cxBlade, y, czBlade, 0.03, height, width, yawAlong);
      const normalYaw = yawAlong + Math.PI / 2;
      const signs = base.get(px, pz, "signs");
      textQuad(signs, cxBlade + Math.sin(normalYaw) * 0.017, y, czBlade + Math.cos(normalYaw) * 0.017, normalYaw, width, height, uv);
      textQuad(signs, cxBlade - Math.sin(normalYaw) * 0.017, y, czBlade - Math.cos(normalYaw) * 0.017, normalYaw + Math.PI, width, height, uv);
    });
    junctionSigns.push({ point: corner, names: named.slice(0, 2).map((road) => road.name!), yaw: Math.atan2(dirs[0]![0], dirs[0]![1]) });
  }

  // Open-area venues (parks): a name board at the gate and benches just inside.
  for (const place of PLACES.filter((candidate) => candidate.buildingId === null && candidate.areaId && inTile(candidate.door[0], candidate.door[1]))) {
    const yaw = place.facing;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = fz;
    const rz = -fx;
    const bx = place.door[0] + rx * 2.2;
    const bz = place.door[1] + rz * 2.2;
    const posts = base.get(bx, bz, "pole");
    posts.box(bx - rx * 0.8, 1.1, bz - rz * 0.8, 0.08, 2.2, 0.08, yaw);
    posts.box(bx + rx * 0.8, 1.1, bz + rz * 0.8, 0.08, 2.2, 0.08, yaw);
    base.get(bx, bz, "signGreen").box(bx, 1.9, bz, 1.9, 0.5, 0.05, yaw);
    const uv = atlas.get(place.name, "plate", place.street);
    textQuad(base.get(bx, bz, "signs"), bx + fx * 0.03, 1.9, bz + fz * 0.03, yaw, 1.8, 1.8 / SignAtlas.aspect, uv);
    textQuad(base.get(bx, bz, "signs"), bx - fx * 0.03, 1.9, bz - fz * 0.03, yaw + Math.PI, 1.8, 1.8 / SignAtlas.aspect, uv);
    addObstacle([bx - rx * 0.8, bz - rz * 0.8], [bx - rx * 0.8, bz - rz * 0.8], 0.08);
    addObstacle([bx + rx * 0.8, bz + rz * 0.8], [bx + rx * 0.8, bz + rz * 0.8], 0.08);
    for (const offset of [-3.5, 3.5]) {
      const sx = place.door[0] - fx * 4 + rx * offset;
      const sz = place.door[1] - fz * 4 + rz * offset;
      base.get(sx, sz, "wood").box(sx, 0.45, sz, 1.8, 0.08, 0.5, yaw);
      base.get(sx, sz, "wood").box(sx - fx * 0.24, 0.75, sz - fz * 0.24, 1.8, 0.4, 0.06, yaw);
      base.get(sx, sz, "gate").box(sx, 0.22, sz, 1.6, 0.44, 0.4, yaw, 1, undefined, true);
      addObstacle([sx - rx * 0.8, sz - rz * 0.8], [sx + rx * 0.8, sz + rz * 0.8], 0.3);
    }
    placeSigns.push({ placeId: place.id, point: place.door });
  }

  // Bus stops: shelter, bench, flag sign and painted bay on the carriageway.
  for (const stop of TRANSIT.stops.filter((candidate) => inTile(candidate.alight[0], candidate.alight[1]))) {
    const heading = (stop as unknown as { heading: number }).heading;
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    const rx = hz;
    const rz = -hx;
    const sx = stop.alight[0] + rx * 1.4;
    const sz = stop.alight[1] + rz * 1.4;
    const yaw = Math.atan2(-rx, -rz);
    const shelter = base.get(sx, sz, "frame");
    for (const along of [-1.7, 1.7]) {
      for (const depth of [-0.55, 0.55]) {
        const x = sx + hx * along + rx * depth;
        const z = sz + hz * along + rz * depth;
        shelter.box(x, 1.3, z, 0.08, 2.6, 0.08, yaw);
        addObstacle([x, z], [x, z], 0.08);
      }
    }
    base.get(sx, sz, "roof").box(sx, 2.65, sz, 4.1, 0.08, 1.7, yaw, 2, [0.24, 0.36, 0.6]);
    base.get(sx, sz, "glass").box(sx + rx * 0.62, 1.45, sz + rz * 0.62, 3.4, 1.7, 0.04, yaw);
    base.get(sx, sz, "wood").box(sx + rx * 0.3, 0.48, sz + rz * 0.3, 3.0, 0.07, 0.42, yaw);
    const routeUv = atlas.get(`${TRANSIT.routeNumber} · ${TRANSIT.routeName}`, "bus", `Fare ₦${TRANSIT.fare} · ${stop.name.replace("Admiralty Way · ", "")}`);
    textQuad(base.get(sx, sz, "signs"), sx - rx * 0.86, 2.35, sz - rz * 0.86, yaw, 3.2, 3.2 / SignAtlas.aspect, routeUv);
    base.get(sx, sz, "paintYellow").box(sx - rx * 0.86 + rx * 0.02, 2.35, sz - rz * 0.86 + rz * 0.02, 3.3, 3.3 / SignAtlas.aspect + 0.08, 0.03, yaw);
    const flagX = stop.pole[0];
    const flagZ = stop.pole[1];
    base.get(flagX, flagZ, "pole").box(flagX, 1.5, flagZ, 0.07, 3.0, 0.07);
    addObstacle([flagX, flagZ], [flagX, flagZ], 0.08);
    const flagUv = atlas.get("BUS STOP", "bus", stop.name.replace("Admiralty Way · ", ""));
    const flagYaw = heading + Math.PI;
    textQuad(base.get(flagX, flagZ, "signs"), flagX + rx * 0.45 + hx * 0.03, 2.75, flagZ + rz * 0.45 + hz * 0.03, heading, 0.9, 0.9 / SignAtlas.aspect * 1.6, flagUv);
    textQuad(base.get(flagX, flagZ, "signs"), flagX + rx * 0.45 - hx * 0.03, 2.75, flagZ + rz * 0.45 - hz * 0.03, flagYaw, 0.9, 0.9 / SignAtlas.aspect * 1.6, flagUv);
    const bay: Vec2[] = [];
    for (let s = stop.s - 9; s <= stop.s + 9; s += 1.5) {
      const pose = sampleRoute(s);
      bay.push([pose.x, pose.z]);
    }
    for (const edge of [-1.2, 1.2]) base.get(sx, sz, "paintYellow").worldRibbon(bay, edge - 0.08, edge + 0.08, 0.047, 1);
  }

  // Instanced vegetation and street furniture.
  const instanced: Mesh[] = [];
  const addInstances = (template: Mesh, matrices: Matrix[]) => {
    if (!matrices.length) {
      template.dispose();
      return;
    }
    const buffer = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, index) => matrix.copyToArray(buffer, index * 16));
    template.doNotSyncBoundingInfo = false;
    template.thinInstanceSetBuffer("matrix", buffer, 16, true);
    template.thinInstanceRefreshBoundingInfo(false);
    template.isPickable = false;
    template.alwaysSelectAsActiveMesh = false;
    instanced.push(template);
  };
  {
    const trunk = MeshBuilder.CreateCylinder("palm trunk", { height: 7, diameterTop: 0.24, diameterBottom: 0.42, tessellation: 7 }, scene);
    trunk.bakeTransformIntoVertices(Matrix.Translation(0, 3.5, 0));
    trunk.material = materials.palmBark;
    const fronds = new MeshBuilderBatch("palm fronds");
    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      const px = -dz;
      const pz = dx;
      const points: Array<[number, number, number]> = [
        [0, 7, 0],
        [dx * 1.4, 7.45, dz * 1.4],
        [dx * 2.6, 7.05, dz * 2.6],
        [dx * 3.3, 6.2, dz * 3.3],
      ];
      for (let segment = 1; segment < points.length; segment += 1) {
        const a = points[segment - 1]!;
        const b = points[segment]!;
        const wa = segment === 1 ? 0.1 : 0.55 - segment * 0.12;
        const wb = 0.55 - segment * 0.14;
        fronds.quad(
          [a[0] - px * wa, a[1], a[2] - pz * wa],
          [a[0] + px * wa, a[1], a[2] + pz * wa],
          [b[0] + px * wb, b[1], b[2] + pz * wb],
          [b[0] - px * wb, b[1], b[2] - pz * wb],
          [0, 1, 0],
          [[0, 0], [1, 0], [1, 1], [0, 1]],
        );
      }
    }
    const frondMesh = fronds.build(scene, materials.palmLeaf)!;
    frondMesh.unfreezeWorldMatrix();
    const matrices = palms.map(([x, z, seed]) => {
      addObstacle([x, z], [x, z], 0.25);
      const scale = 0.8 + seed * 0.45;
      return Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationYawPitchRoll(seed * 6.28, (seed - 0.5) * 0.08, 0), new Vector3(x, 0, z));
    });
    addInstances(trunk, matrices);
    addInstances(frondMesh, matrices.map((matrix) => matrix.clone()));
  }
  {
    const pole = MeshBuilder.CreateCylinder("light pole", { height: 8, diameterTop: 0.1, diameterBottom: 0.2, tessellation: 6 }, scene);
    pole.bakeTransformIntoVertices(Matrix.Translation(0, 4, 0));
    const arm = MeshBuilder.CreateBox("light arm", { width: 0.08, height: 0.08, depth: 1.8 }, scene);
    arm.bakeTransformIntoVertices(Matrix.Translation(0, 7.9, -0.85));
    const merged = Mesh.MergeMeshes([pole, arm], true)!;
    merged.material = materials.pole;
    const head = MeshBuilder.CreateBox("light head", { width: 0.32, height: 0.1, depth: 0.6 }, scene);
    head.bakeTransformIntoVertices(Matrix.Translation(0, 7.85, -1.7));
    head.material = materials.lamp;
    const matrices = lights.map(([x, z, yaw]) => {
      addObstacle([x, z], [x, z], 0.14);
      return Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(yaw, 0, 0), new Vector3(x, 0, z));
    });
    addInstances(merged, matrices);
    addInstances(head, matrices.map((matrix) => matrix.clone()));
  }
  {
    const tank = MeshBuilder.CreateCylinder("water tank", { height: 1.7, diameter: 1.5, tessellation: 12 }, scene);
    tank.bakeTransformIntoVertices(Matrix.Translation(0, 0.85 + 0.35, 0));
    const stand = MeshBuilder.CreateBox("tank stand", { width: 1.6, height: 0.35, depth: 1.6 }, scene);
    stand.bakeTransformIntoVertices(Matrix.Translation(0, 0.175, 0));
    const merged = Mesh.MergeMeshes([tank, stand], true)!;
    merged.material = materials.tank;
    addInstances(merged, tankInstances.map(([x, y, z]) => Matrix.Translation(x, y, z)));
  }

  const baseChunks = base.build(scene, materialMap);
  const detailChunks = detail.deferred(scene, materialMap);
  const meshes = [...baseChunks.flatMap((chunk) => chunk.meshes), ...instanced];
  for (const mesh of meshes) mesh.freezeWorldMatrix();
  return {
    key,
    meshes,
    detailChunks,
    junctionSigns,
    placeSigns,
    buildings: content?.buildings ?? [],
    areas: content?.areas ?? [],
    windows,
  };
  }

  const loaded = new Map<string, LoadedTile>();
  const contents = new Map<string, WorldTile>();
  const fetching = new Set<string>();
  let wanted: string[] = [];
  let nearKeys: string[] = [];
  let tileBuildMs = 0;
  let lastDetailKey = "";
  let focus: Vec2 = [0, 0];
  const world: BuiltWorld = {
    roads,
    obstacles,
    junctionSigns: [],
    placeSigns: [],
    groundHeight,
    updateDetail,
    stream,
    pump,
    pendingNear: () => nearKeys.filter((key) => !loaded.has(key)).length,
    loadedTiles: () => [...loaded.keys()],
    mapLayer: () => ({ buildings: [...loaded.values()].flatMap((tile) => tile.buildings), areas: [...loaded.values()].flatMap((tile) => tile.areas) }),
    stats: { meshes: 0, detailChunks: 0, windows: 0, buildings: 0, tiles: 0, tileBuildMs: 0 },
    casters: () => [...loaded.values()].flatMap((tile) => tile.meshes),
    onMeshes: null,
  };

  function refreshLists() {
    const tiles = [...loaded.values()];
    world.junctionSigns = tiles.flatMap((tile) => tile.junctionSigns);
    world.placeSigns = tiles.flatMap((tile) => tile.placeSigns);
    world.stats = {
      meshes: tiles.reduce((total, tile) => total + tile.meshes.length + tile.detailChunks.reduce((sum, chunk) => sum + (chunk.meshes?.length ?? 0), 0), 0),
      detailChunks: tiles.reduce((total, tile) => total + tile.detailChunks.length, 0),
      windows: tiles.reduce((total, tile) => total + tile.windows, 0),
      buildings: tiles.reduce((total, tile) => total + tile.buildings.length, 0),
      tiles: tiles.length,
      tileBuildMs: Math.round(tileBuildMs),
    };
    lastDetailKey = "";
  }

  function tileDistance(key: string, x: number, z: number) {
    const [tx, tz] = key.split("_").map(Number) as [number, number];
    const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE);
    const dz = Math.max(tz * TILE - z, 0, z - (tz + 1) * TILE);
    return Math.hypot(dx, dz);
  }

  function stream(x: number, z: number) {
    focus = [x, z];
    const span = Math.ceil(loadRadius / TILE) + 1;
    const cx = Math.floor(x / TILE);
    const cz = Math.floor(z / TILE);
    const keys: Array<{ key: string; distance: number }> = [];
    for (let ix = cx - span; ix <= cx + span; ix += 1) {
      for (let iz = cz - span; iz <= cz + span; iz += 1) {
        const key = `${ix}_${iz}`;
        const distance = tileDistance(key, x, z);
        if (distance <= loadRadius) keys.push({ key, distance });
      }
    }
    keys.sort((a, b) => a.distance - b.distance);
    wanted = keys.map(({ key }) => key);
    nearKeys = keys.filter(({ distance }) => distance < 120).map(({ key }) => key);
    for (const key of wanted) {
      if (!contentTiles.has(key) || contents.has(key) || fetching.has(key)) continue;
      fetching.add(key);
      void fetchTile(key)
        .then((tile) => {
          registerFootprints(tile.buildings);
          contents.set(key, tile);
        })
        .catch(() => contents.set(key, { key, buildings: [], areas: [] }))
        .finally(() => fetching.delete(key));
    }
    let released = false;
    for (const [key, tile] of loaded) {
      if (tileDistance(key, x, z) <= loadRadius + TILE * 0.75) continue;
      for (const mesh of tile.meshes) mesh.dispose();
      for (const chunk of tile.detailChunks) for (const mesh of chunk.meshes ?? []) mesh.dispose();
      loaded.delete(key);
      released = true;
    }
    if (released) refreshLists();
  }

  function pump(budgetMs: number) {
    const start = performance.now();
    let built = false;
    for (const key of wanted) {
      if (loaded.has(key)) continue;
      if (contentTiles.has(key) && !contents.has(key)) continue;
      const t0 = performance.now();
      const tile = buildTile(key, contents.get(key) ?? null);
      tileBuildMs += performance.now() - t0;
      loaded.set(key, tile);
      world.onMeshes?.(tile.meshes);
      built = true;
      if (performance.now() - start > budgetMs) break;
    }
    if (built) {
      refreshLists();
      updateDetail(focus[0], focus[1]);
    }
  }

  function updateDetail(x: number, z: number) {
    const key = `${Math.round(x / 10)}:${Math.round(z / 10)}`;
    if (key === lastDetailKey) return;
    lastDetailKey = key;
    for (const tile of loaded.values()) {
      for (const chunk of tile.detailChunks) {
        const near = Math.hypot(chunk.x - x, chunk.z - z) < detailRadius + TILE / 4 + 20;
        if (!near && !chunk.meshes) continue;
        for (const mesh of near ? chunk.build() : chunk.meshes!) if (mesh.isEnabled() !== near) mesh.setEnabled(near);
      }
    }
  }

  function groundHeight(x: number, z: number) {
    const hit = roads.nearest(x, z);
    if (!hit) return 0;
    const half = hit.road.width / 2;
    if (hit.distance < half) return ROAD_Y[hit.road.kind] ?? 0.03;
    if (!sidewalkRoads.has(hit.road.kind)) return 0;
    const inner = half + 0.55;
    const outer = inner + sidewalkWidth(hit.road);
    if (hit.distance >= inner && hit.distance <= outer && !roads.onAsphalt(x, z, 1.2, hit.road)) return SIDEWALK_Y;
    return 0.015;
  }

  return world;
}
