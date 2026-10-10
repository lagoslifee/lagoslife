import lekki from "./generated/lekki-world.json" with { type: "json" };

export type Vec2 = [number, number];

export type PlaceKind =
  | "starter_home"
  | "rental"
  | "sale"
  | "job"
  | "food"
  | "shop"
  | "furniture"
  | "delivery";

export type Place = {
  id: string;
  kind: PlaceKind;
  name: string;
  street: string;
  buildingId: number;
  door: Vec2;
  facade: Vec2;
  facing: number;
  frontage: number;
};

export type TransitStop = {
  id: string;
  name: string;
  s: number;
  pole: Vec2;
  alight: Vec2;
};

export const WORLD_BOUNDS = lekki.bounds;
export const TRANSIT = lekki.transit as unknown as {
  routeId: string;
  routeName: string;
  routeNumber: string;
  fare: number;
  length: number;
  points: Vec2[];
  stops: TransitStop[];
};
export const PLACES = lekki.places as unknown as Place[];
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

const routeCumulative: number[] = [0];
for (let index = 1; index <= TRANSIT.points.length; index += 1) {
  const a = TRANSIT.points[index - 1]!;
  const b = TRANSIT.points[index % TRANSIT.points.length]!;
  routeCumulative.push(routeCumulative[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
}

export function routeLength() {
  return routeCumulative.at(-1)!;
}

/** Position and heading on the danfo loop at distance s (wraps). */
export function sampleRoute(s: number) {
  const length = routeLength();
  const wrapped = ((s % length) + length) % length;
  let index = 0;
  while (index < TRANSIT.points.length - 1 && routeCumulative[index + 1]! < wrapped) index += 1;
  const a = TRANSIT.points[index]!;
  const b = TRANSIT.points[(index + 1) % TRANSIT.points.length]!;
  const segment = routeCumulative[index + 1]! - routeCumulative[index]!;
  const t = segment > 0 ? (wrapped - routeCumulative[index]!) / segment : 0;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
  };
}

export function routeDistanceAhead(from: number, to: number) {
  const length = routeLength();
  return (((to - from) % length) + length) % length;
}

type Footprint = { id: number; points: Vec2[]; minX: number; maxX: number; minZ: number; maxZ: number };
const CELL = 32;
const footprintGrid = new Map<string, Footprint[]>();
for (const building of lekki.buildings as unknown as Array<{ id: number; points: Vec2[] }>) {
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
  ...TRANSIT.stops.map((stop) => ({ id: `stop:${stop.id}`, label: stop.name, point: stop.alight })),
  { id: "swift-parcel-hub", label: "Swift Parcel Hub", point: getPlace("swift-parcel-hub").door },
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

export function withinWorld(x: number, z: number) {
  return (
    x >= WORLD_BOUNDS.minX &&
    x <= WORLD_BOUNDS.maxX &&
    z >= WORLD_BOUNDS.minZ &&
    z <= WORLD_BOUNDS.maxZ
  );
}

/** Interiors live far outside the street map so they never overlap it. */
export const INTERIOR_ORIGIN: Vec2 = [5000, 5000];
export const INTERIOR_SPAWN: Vec2 = [INTERIOR_ORIGIN[0] + 0, INTERIOR_ORIGIN[1] - 3.2];
export const INTERIOR_EXIT: Vec2 = [INTERIOR_ORIGIN[0] + 0, INTERIOR_ORIGIN[1] - 4.4];
export const INTERIOR_HALF: Vec2 = [5.6, 4.8];
