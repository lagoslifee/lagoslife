import lagos from "./generated/lagos-world.json" with { type: "json" };

export type Vec2 = [number, number];

export type PlaceKind =
  | "starter_home"
  | "rental"
  | "sale"
  | "job"
  | "food"
  | "shop"
  | "furniture"
  | "delivery"
  | "dealership"
  | "mechanic"
  | "library"
  | "worship"
  | "community"
  | "park"
  | "club"
  | "police"
  | "security"
  | "airport"
  | "consulate"
  | "hotel"
  | "restaurant"
  | "cafe"
  | "boutique"
  | "souvenir"
  | "lounge"
  | "beach"
  | "marina"
  | "photo"
  | "desert"
  | "car_rental"
  | "tourism";

export type Place = {
  id: string;
  kind: PlaceKind;
  name: string;
  street: string;
  district: DistrictId;
  /** Mapped footprint the place occupies; null for open areas (parks, the beach) and open spots (piers, viewpoints, the desert camp). */
  buildingId: number | null;
  areaId?: number;
  door: Vec2;
  facade: Vec2;
  facing: number;
  frontage: number;
  /** Kerbside parking point on the place's street and the yaw along the near lane. */
  kerb: Vec2;
  kerbYaw: number;
};

export type TransitStop = {
  id: string;
  name: string;
  s: number;
  pole: Vec2;
  alight: Vec2;
};

export type DistrictId = "lekki-phase-1" | "link-bridge" | "ikoyi" | "victoria-island" | "dubai-marina" | "dubai-desert";
/** Separate parts of the one world map, joined only by flights: Lagos and the Dubai holiday region far to its south. */
export type RegionId = "lagos" | "dubai";
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
export type District = {
  id: DistrictId;
  name: string;
  lga: string;
  region: RegionId;
  rect: Rect;
};

/** Bounds of every district in both regions. */
export const WORLD_BOUNDS = lagos.bounds;
/** District bounds of each region. */
export const REGION_BOUNDS = lagos.regions as Record<RegionId, Rect>;
export const DISTRICTS = lagos.districts as District[];
export const LAGOS_DISTRICTS = DISTRICTS.filter((district) => district.region === "lagos");
/** Dubai Marina & JBR (from OpenStreetMap) and the fictional desert camp, which no road joins to the Marina. */
export const DUBAI_DISTRICTS = DISTRICTS.filter((district) => district.region === "dubai");
/** Edge length of a streamed world tile in metres. */
export const TILE_SIZE = lagos.tileSize;

export function districtAt(x: number, z: number): District | null {
  return DISTRICTS.find(({ rect }) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) ?? null;
}

/** Which region a point belongs to: its district's, or by latitude in the open sea between them (Dubai lies south of z = -4000). */
export function regionAt(x: number, z: number): RegionId {
  return districtAt(x, z)?.region ?? (z < -4000 ? "dubai" : "lagos");
}

export function tileKeyAt(x: number, z: number) {
  return `${Math.floor(x / TILE_SIZE)}_${Math.floor(z / TILE_SIZE)}`;
}

export type TransitRoute = {
  routeId: string;
  routeName: string;
  routeNumber: string;
  fare: number;
  length: number;
  points: Vec2[];
  stops: TransitStop[];
};
/** Danfo loops; the first is the Lekki route new residents start beside. */
export const ROUTES = lagos.routes as unknown as TransitRoute[];
export const routeById = new Map(ROUTES.map((route) => [route.routeId, route]));
/** Every stop with the route that serves it; stop ids are unique across routes. */
export const STOPS = ROUTES.flatMap((route) => route.stops.map((stop) => ({ ...stop, route })));
export const stopById = new Map(STOPS.map((stop) => [stop.id, stop]));

export function getRoute(id: string) {
  const route = routeById.get(id);
  if (!route) throw new Error(`Unknown route ${id}`);
  return route;
}

export function nearestStop(x: number, z: number) {
  return STOPS.reduce((best, stop) =>
    Math.hypot(stop.alight[0] - x, stop.alight[1] - z) < Math.hypot(best.alight[0] - x, best.alight[1] - z) ? stop : best,
  );
}

/** Short stop label without the street prefix, e.g. "Kayode Animashaun (Eastbound)". */
export function stopLabel(name: string) {
  return name.slice(name.indexOf(" · ") + 3);
}

export const PLACES = lagos.places as unknown as Place[];
export const placeById = new Map(PLACES.map((place) => [place.id, place]));

export function getPlace(id: string) {
  const place = placeById.get(id);
  if (!place) throw new Error(`Unknown place ${id}`);
  return place;
}

/** Movement tuning in metres and seconds; shared so client and server agree. */
export const MOVEMENT = {
  walkSpeed: 1.5,
  jogSpeed: 3.5,
  sprintSpeed: 6,
  acceleration: 22,
  deceleration: 28,
  turnRate: 14,
  radius: 0.32,
};

export const INTERACTION_RANGE = 3.2;

const cumulativeByRoute = new Map(
  ROUTES.map((route) => {
    const cumulative = [0];
    for (let index = 1; index <= route.points.length; index += 1) {
      const a = route.points[index - 1]!;
      const b = route.points[index % route.points.length]!;
      cumulative.push(cumulative[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return [route, cumulative];
  }),
);

function cumulativeOf(route: TransitRoute) {
  const cumulative = cumulativeByRoute.get(route);
  if (!cumulative) throw new Error(`Unknown route ${route.routeId}`);
  return cumulative;
}

export function routeLength(route: TransitRoute) {
  return cumulativeOf(route).at(-1)!;
}

/** Position and heading on a danfo loop at distance s (wraps). */
export function sampleRoute(route: TransitRoute, s: number) {
  const cumulative = cumulativeOf(route);
  const length = cumulative.at(-1)!;
  const wrapped = ((s % length) + length) % length;
  let index = 0;
  while (index < route.points.length - 1 && cumulative[index + 1]! < wrapped) index += 1;
  const a = route.points[index]!;
  const b = route.points[(index + 1) % route.points.length]!;
  const segment = cumulative[index + 1]! - cumulative[index]!;
  const t = segment > 0 ? (wrapped - cumulative[index]!) / segment : 0;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
  };
}

export function routeDistanceAhead(route: TransitRoute, from: number, to: number) {
  const length = routeLength(route);
  return (((to - from) % length) + length) % length;
}

type Footprint = { id: number; points: Vec2[]; minX: number; maxX: number; minZ: number; maxZ: number };
const CELL = 32;
const footprintGrid = new Map<string, Footprint[]>();
const registeredFootprints = new Set<number>();

/**
 * Adds building footprints to the collision grid. The server registers every
 * tile at startup; the browser registers tiles as they stream in.
 */
export function registerFootprints(buildings: Array<{ id: number; points: Vec2[] }>) {
  for (const building of buildings) {
    if (registeredFootprints.has(building.id)) continue;
    registeredFootprints.add(building.id);
    const xs = building.points.map(([x]) => x);
    const zs = building.points.map(([, z]) => z);
    const footprint: Footprint = {
      id: building.id,
      points: building.points,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
    for (let cx = Math.floor(footprint.minX / CELL); cx <= Math.floor(footprint.maxX / CELL); cx += 1) {
      for (let cz = Math.floor(footprint.minZ / CELL); cz <= Math.floor(footprint.maxZ / CELL); cz += 1) {
        const key = `${cx}:${cz}`;
        const list = footprintGrid.get(key) ?? [];
        list.push(footprint);
        footprintGrid.set(key, list);
      }
    }
  }
}

export function unregisterFootprint(id: number) {
  if (!registeredFootprints.delete(id)) return;
  for (const [key, list] of footprintGrid) {
    const kept = list.filter((footprint) => footprint.id !== id);
    if (kept.length !== list.length) footprintGrid.set(key, kept);
  }
}

export function registeredFootprintCount() {
  return registeredFootprints.size;
}

export function nearbyFootprints(x: number, z: number) {
  return footprintGrid.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) ?? [];
}

function pointInPolygon(x: number, z: number, points: Vec2[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point is more than `tolerance` metres inside a building footprint. */
export function insideBuilding(x: number, z: number, tolerance = 0.6) {
  for (const footprint of nearbyFootprints(x, z)) {
    if (x < footprint.minX || x > footprint.maxX || z < footprint.minZ || z > footprint.maxZ) continue;
    if (!pointInPolygon(x, z, footprint.points)) continue;
    let nearestEdge = Infinity;
    for (let i = 0; i < footprint.points.length; i += 1) {
      const a = footprint.points[i]!;
      const b = footprint.points[(i + 1) % footprint.points.length]!;
      nearestEdge = Math.min(nearestEdge, distanceToSegment(x, z, a, b));
    }
    if (nearestEdge > tolerance) return true;
  }
  return false;
}

export function distanceToSegment(x: number, z: number, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}

/**
 * Pushes a circle out of nearby building footprints. Returns the corrected
 * position. Used by the client controller every frame.
 */
export function resolveBuildingCollision(x: number, z: number, radius = MOVEMENT.radius): Vec2 {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const footprint of nearbyFootprints(px, pz)) {
      if (
        px < footprint.minX - radius ||
        px > footprint.maxX + radius ||
        pz < footprint.minZ - radius ||
        pz > footprint.maxZ + radius
      ) {
        continue;
      }
      const inside = pointInPolygon(px, pz, footprint.points);
      let best = { distance: Infinity, nx: 0, nz: 0, qx: 0, qz: 0 };
      for (let i = 0; i < footprint.points.length; i += 1) {
        const a = footprint.points[i]!;
        const b = footprint.points[(i + 1) % footprint.points.length]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const lengthSquared = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSquared));
        const qx = a[0] + dx * t;
        const qz = a[1] + dz * t;
        const distance = Math.hypot(px - qx, pz - qz);
        if (distance < best.distance) best = { distance, nx: px - qx, nz: pz - qz, qx, qz };
      }
      if (inside) {
        const length = Math.hypot(best.nx, best.nz) || 1;
        px = best.qx - (best.nx / length) * radius;
        pz = best.qz - (best.nz / length) * radius;
      } else if (best.distance < radius) {
        const length = best.distance || 1;
        px = best.qx + (best.nx / length) * radius;
        pz = best.qz + (best.nz / length) * radius;
      }
    }
  }
  return [px, pz];
}

export const SAFE_POINTS: Array<{ id: string; label: string; point: Vec2 }> = [
  { id: "starter-home", label: "Kayode Court Hostel", point: getPlace("starter-home").door },
  ...STOPS.map((stop) => ({ id: `stop:${stop.id}`, label: stop.name, point: stop.alight })),
  { id: "swift-parcel-hub", label: "Swift Parcel Hub", point: getPlace("swift-parcel-hub").door },
  ...PLACES.filter((place) => place.district === "ikoyi" || place.district === "victoria-island" || place.district.startsWith("dubai-")).map((place) => ({
    id: place.id,
    label: place.name,
    point: place.door,
  })),
];

export function nearestSafePoint(x: number, z: number) {
  let best = SAFE_POINTS[0]!;
  let bestDistance = Infinity;
  for (const safe of SAFE_POINTS) {
    const distance = Math.hypot(safe.point[0] - x, safe.point[1] - z);
    if (distance < bestDistance) {
      best = safe;
      bestDistance = distance;
    }
  }
  return best;
}

/** Inside one of the playable district rectangles. */
export function withinWorld(x: number, z: number) {
  return districtAt(x, z) !== null;
}

type BitGrid = { originX: number; originZ: number; cell: number; cols: number; rows: number; bits: string };
function decodeGrid(grid: BitGrid) {
  const binary = atob(grid.bits);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const stride = grid.cols + 1;
  const sample = (col: number, row: number) => {
    if (col < 0 || row < 0 || col > grid.cols || row > grid.rows) return 0;
    const index = row * stride + col;
    return (bytes[index >> 3]! >> (index & 7)) & 1;
  };
  /** Bilinear blend of the four surrounding samples, so edges match the rendered shoreline. */
  return (x: number, z: number) => {
    const u = (x - grid.originX) / grid.cell;
    const v = (z - grid.originZ) / grid.cell;
    const col = Math.floor(u);
    const row = Math.floor(v);
    const fu = u - col;
    const fv = v - row;
    const value =
      sample(col, row) * (1 - fu) * (1 - fv) +
      sample(col + 1, row) * fu * (1 - fv) +
      sample(col, row + 1) * (1 - fu) * fv +
      sample(col + 1, row + 1) * fu * fv;
    return value > 0.5;
  };
}

type Deck = { id: number; half: number; points: Vec2[]; minX: number; maxX: number; minZ: number; maxZ: number };
const DECKS: Deck[] = (lagos.decks as Array<{ id: number; half: number; points: Vec2[] }>).map((deck) => ({
  ...deck,
  minX: Math.min(...deck.points.map((point) => point[0])) - deck.half,
  maxX: Math.max(...deck.points.map((point) => point[0])) + deck.half,
  minZ: Math.min(...deck.points.map((point) => point[1])) - deck.half,
  maxZ: Math.max(...deck.points.map((point) => point[1])) + deck.half,
}));

/** On a bridge deck, inside its parapets. */
export function onBridgeDeck(x: number, z: number) {
  for (const deck of DECKS) {
    if (x < deck.minX || x > deck.maxX || z < deck.minZ || z > deck.maxZ) continue;
    for (let index = 1; index < deck.points.length; index += 1) {
      const [ax, az] = deck.points[index - 1]!;
      const [bx, bz] = deck.points[index]!;
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= deck.half) return true;
    }
  }
  return false;
}

const openWater = decodeGrid(lagos.blocked as BitGrid);

/** Open water (lagoon, creek, channel) off any road or bridge deck: residents and cars can't go there. */
export function blockedByWater(x: number, z: number) {
  return openWater(x, z) && !onBridgeDeck(x, z);
}

/** Interiors live far outside the street map so they never overlap it. */
export const INTERIOR_ORIGIN: Vec2 = [5000, 5000];
export const INTERIOR_SPAWN: Vec2 = [INTERIOR_ORIGIN[0] + 0, INTERIOR_ORIGIN[1] - 3.2];
export const INTERIOR_EXIT: Vec2 = [INTERIOR_ORIGIN[0] + 0, INTERIOR_ORIGIN[1] - 4.4];
export const INTERIOR_HALF: Vec2 = [5.6, 4.8];

/** Somewhere a resident may stand: inside a district, not on open water, not inside a building. */
export function walkable(x: number, z: number, buildingTolerance = 0.6) {
  return withinWorld(x, z) && !blockedByWater(x, z) && !insideBuilding(x, z, buildingTolerance);
}
