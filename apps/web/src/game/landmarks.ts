import type { Place, Vec2 } from "@lagos-living/shared";
import type { MeshBuilderBatch, V3 } from "./geometry";

type Color = [number, number, number];
type Get = (material: string) => MeshBuilderBatch;

/** Mapped places drawn with their own architecture instead of the generic Lagos block. */
export type LandmarkKind = "church" | "mosque" | "club" | "modern" | "terminal" | "showroom" | "gym";

export function landmarkFor(place: Place | undefined): LandmarkKind | null {
  if (!place) return null;
  if (place.kind === "worship") return /mosque/i.test(place.name) ? "mosque" : "church";
  if (place.kind === "club") return "club";
  if (place.kind === "sale" || place.kind === "rental") return "modern";
  if (place.kind === "airport") return "terminal";
  if (place.kind === "dealership") return "showroom";
  if (place.kind === "gym") return "gym";
  return null;
}

export const LANDMARK_PAINT: Record<LandmarkKind, Color> = {
  church: [0.96, 0.95, 0.91],
  mosque: [0.97, 0.95, 0.88],
  club: [0.07, 0.07, 0.09],
  modern: [0.97, 0.97, 0.96],
  terminal: [0.9, 0.91, 0.92],
  showroom: [0.13, 0.14, 0.16],
  gym: [0.12, 0.12, 0.14],
};

export const LANDMARK_TRIM: Record<LandmarkKind, Color> = {
  church: [0.85, 0.82, 0.74],
  mosque: [0.82, 0.78, 0.66],
  club: [0.12, 0.12, 0.14],
  modern: [0.22, 0.22, 0.24],
  terminal: [0.75, 0.77, 0.8],
  showroom: [0.78, 0.8, 0.82],
  gym: [0.86, 0.14, 0.16],
};

const GOLD: Color = [0.86, 0.68, 0.26];
const DOME_GREEN: Color = [0.1, 0.44, 0.31];
const SLATE: Color = [0.27, 0.29, 0.33];
const CLAY: Color = [0.48, 0.2, 0.15];

/** A door-edge frame: the door point, outward normal n, edge direction e and the yaw that faces n. */
export type Facade = { x: number; z: number; nx: number; nz: number; ex: number; ez: number; yaw: number };
/** The building's oriented box (u is the long axis) and wall height. */
export type Footprint = { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number; height: number };

function outward(p: V3, q: V3, r: V3, centre: V3): V3 {
  const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2];
  const bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const mx = (p[0] + q[0] + r[0]) / 3 - centre[0];
  const my = (p[1] + q[1] + r[1]) / 3 - centre[1];
  const mz = (p[2] + q[2] + r[2]) / 3 - centre[2];
  if (nx * mx + ny * my + nz * mz < 0) [nx, ny, nz] = [-nx, -ny, -nz];
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/** Four-sided spire or pyramid cap over a square of half-size `half` centred at (x, z). */
function pyramid(batch: MeshBuilderBatch, x: number, z: number, yaw: number, half: number, y0: number, rise: number, color: Color) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (u: number, v: number): V3 => [x + u * c + v * s, y0, z - u * s + v * c];
  const ring = [corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half)];
  const apex: V3 = [x, y0 + rise, z];
  const centre: V3 = [x, y0 + rise * 0.3, z];
  ring.forEach((p, index) => {
    const q = ring[(index + 1) % 4]!;
    batch.triangle(p, q, apex, outward(p, q, apex, centre), [[0, 0], [1, 0], [0.5, 1]], color);
  });
}

/** Tall pointed-arch windows along an edge, leaving room around the door. */
export function archedWindows(get: Get, a: Vec2, b: Vec2, height: number, skip: { t: number; half: number } | null) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 2.6) return;
  const ex = (b[0] - a[0]) / length;
  const ez = (b[1] - a[1]) / length;
  const nx = ez;
  const nz = -ex;
  const yaw = Math.atan2(nx, nz);
  const count = Math.max(1, Math.floor((length - 1) / 3));
  const step = length / count;
  const sill = 1.3;
  const tall = Math.max(1.6, Math.min(3.6, height - sill - 1.3));
  const half = 0.45;
  const glass = get("glass");
  const frame = get("darkFrame");
  const trim = get("concrete");
  for (let column = 0; column < count; column += 1) {
    const t = (column + 0.5) * step;
    if (skip && Math.abs(t - skip.t) < skip.half) continue;
    const wx = a[0] + ex * t + nx * 0.03;
    const wz = a[1] + ez * t + nz * 0.03;
    const top = sill + tall;
    glass.quad([wx - ex * half, sill, wz - ez * half], [wx + ex * half, sill, wz + ez * half], [wx + ex * half, top, wz + ez * half], [wx - ex * half, top, wz - ez * half], [nx, 0, nz], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    glass.triangle([wx - ex * half, top, wz - ez * half], [wx + ex * half, top, wz + ez * half], [wx, top + 0.6, wz], [nx, 0, nz], [[0, 0], [1, 0], [0.5, 1]]);
    for (const side of [-1, 1]) frame.box(wx + ex * side * (half + 0.05) + nx * 0.05, sill + tall / 2, wz + ez * side * (half + 0.05) + nz * 0.05, 0.1, tall, 0.12, yaw);
    frame.box(wx + nx * 0.05, sill + tall / 2, wz + nz * 0.05, 0.05, tall, 0.06, yaw);
    trim.box(wx + nx * 0.1, sill - 0.05, wz + nz * 0.1, half * 2 + 0.4, 0.1, 0.24, yaw);
  }
}

/** A tall arched double door with steps, for churches and mosques. */
export function worshipDoor(get: Get, f: Facade) {
  const width = 2.0;
  const tall = 3.0;
  const wood = get("wood");
  const corner = (side: number, y: number): V3 => [f.x + f.ex * side * (width / 2) + f.nx * 0.05, y, f.z + f.ez * side * (width / 2) + f.nz * 0.05];
  wood.quad(corner(-1, 0.45), corner(1, 0.45), corner(1, tall), corner(-1, tall), [f.nx, 0, f.nz], [[0, 0], [1, 0], [1, 2], [0, 2]]);
  wood.triangle(corner(-1, tall), corner(1, tall), [f.x + f.nx * 0.05, tall + 0.9, f.z + f.nz * 0.05], [f.nx, 0, f.nz], [[0, 0], [1, 0], [0.5, 1]]);
  const frame = get("concrete");
  for (const side of [-1, 1]) frame.box(f.x + f.ex * side * (width / 2 + 0.15) + f.nx * 0.12, (tall + 0.45) / 2 + 0.2, f.z + f.ez * side * (width / 2 + 0.15) + f.nz * 0.12, 0.3, tall + 0.3, 0.24, f.yaw);
  get("darkFrame").box(f.x + f.nx * 0.07, (tall + 0.45) / 2, f.z + f.nz * 0.07, 0.04, tall - 0.45, 0.04, f.yaw);
  frame.box(f.x + f.nx * 0.8, 0.15, f.z + f.nz * 0.8, width + 1.6, 0.3, 1.6, f.yaw, 1, [0.8, 0.78, 0.74]);
  frame.box(f.x + f.nx * 1.7, 0.08, f.z + f.nz * 1.7, width + 2.2, 0.16, 0.8, f.yaw, 1, [0.8, 0.78, 0.74]);
}

/** Gable roof in clay tiles along the long axis, with plastered gable ends. */
export function gableRoof(get: Get, fp: Footprint, paint: Color) {
  const { cx, cz, ux, uz } = fp;
  const vx = -uz;
  const vz = ux;
  const at = (u: number, v: number, y: number): V3 => [cx + ux * u + vx * v, y, cz + uz * u + vz * v];
  const eave = fp.height;
  const hu = fp.hu + 0.4;
  const hv = fp.hv + 0.5;
  const rise = fp.hv * 0.75;
  const roof = get("roof");
  const centre = at(0, 0, eave);
  const quad = (p: V3, q: V3, r: V3, s: V3) => roof.quad(p, q, r, s, outward(p, q, r, centre), [[0, 0], [hu * 2, 0], [hu * 2, hv], [0, hv]], CLAY);
  quad(at(-hu, -hv, eave - 0.3), at(hu, -hv, eave - 0.3), at(hu, 0, eave + rise), at(-hu, 0, eave + rise));
  quad(at(hu, hv, eave - 0.3), at(-hu, hv, eave - 0.3), at(-hu, 0, eave + rise), at(hu, 0, eave + rise));
  const walls = get("plaster");
  for (const side of [-1, 1]) {
    const u = side * fp.hu;
    const p = at(u, -fp.hv, eave);
    const q = at(u, fp.hv, eave);
    const apex = at(u, 0, eave + rise - 0.05);
    walls.triangle(p, q, apex, [ux * side, 0, uz * side], [[0, 0], [fp.hv * 2, 0], [fp.hv, rise]], paint);
    // A small round window high in each gable.
    const [wx, , wz] = at(u + side * 0.04, 0, 0);
    get("glass").box(wx, eave + rise * 0.4, wz, 0.9, 0.9, 0.04, Math.atan2(ux * side, uz * side));
  }
}

/** Corner of the door edge farther from the door, stepped inside the footprint by `inset`. */
function farCorner(a: Vec2, b: Vec2, doorT: number, f: Facade, inset: number): Vec2 {
  const [x, z] = doorT < 0.5 ? b : a;
  const along = doorT < 0.5 ? -1 : 1;
  return [x + f.ex * along * inset - f.nx * inset, z + f.ez * along * inset - f.nz * inset];
}

/** Bell tower at the front corner, belfry openings, a slate spire and a gold cross. */
export function churchTower(get: Get, a: Vec2, b: Vec2, doorT: number, f: Facade, height: number, paint: Color) {
  // Stands 0.25 m proud of the walls so it covers the windows behind it.
  const [tx, tz] = farCorner(a, b, doorT, f, 1.6);
  const size = 3.7;
  const top = height + 6;
  const walls = get("plaster");
  walls.box(tx, top / 2, tz, size, top, size, f.yaw, 2.5, paint);
  const dark = get("gate");
  dark.box(tx, top - 1.6, tz, 1.0, 1.6, size + 0.04, f.yaw);
  dark.box(tx, top - 1.6, tz, size + 0.04, 1.6, 1.0, f.yaw);
  const trim = get("concrete");
  trim.box(tx, top + 0.12, tz, size + 0.4, 0.25, size + 0.4, f.yaw, 1, [0.9, 0.88, 0.82]);
  trim.box(tx, height + 0.1, tz, size + 0.2, 0.2, size + 0.2, f.yaw, 1, [0.9, 0.88, 0.82]);
  pyramid(get("roof"), tx, tz, f.yaw, size / 2, top + 0.25, 5.5, SLATE);
  const cross = get("vertexPaint");
  const apex = top + 0.25 + 5.5;
  cross.box(tx, apex + 0.85, tz, 0.14, 1.8, 0.14, f.yaw, 1, GOLD);
  cross.box(tx, apex + 1.25, tz, 1.0, 0.14, 0.14, f.yaw, 1, GOLD);
  // A clock face on the front of the tower.
  get("acUnit").box(tx + f.nx * (size / 2 + 0.02), top - 3.6, tz + f.nz * (size / 2 + 0.02), 1.1, 1.1, 0.04, f.yaw);
  get("darkFrame").box(tx + f.nx * (size / 2 + 0.05), top - 3.45, tz + f.nz * (size / 2 + 0.05), 0.05, 0.4, 0.02, f.yaw);
}

/** A drum and hemispherical dome over the prayer hall, and a minaret with a balcony at the front corner. */
export function mosqueDomeAndMinaret(get: Get, fp: Footprint, a: Vec2, b: Vec2, doorT: number, f: Facade, height: number, paint: Color) {
  const radius = Math.max(2.2, Math.min(6, Math.min(fp.hu, fp.hv) * 0.62));
  const walls = get("plaster");
  const sides = 16;
  const drumTop = height + 1.5;
  for (let index = 0; index < sides; index += 1) {
    const a0 = (index / sides) * Math.PI * 2;
    const a1 = ((index + 1) / sides) * Math.PI * 2;
    walls.wall(fp.cx + Math.cos(a1) * radius, fp.cz + Math.sin(a1) * radius, fp.cx + Math.cos(a0) * radius, fp.cz + Math.sin(a0) * radius, height, drumTop, 2.5, paint);
  }
  const dome = get("vertexPaint");
  const rings = 7;
  const point = (ring: number, segment: number): V3 => {
    const phi = (ring / rings) * (Math.PI / 2);
    const theta = (segment / sides) * Math.PI * 2;
    return [fp.cx + Math.cos(theta) * Math.cos(phi) * radius, drumTop + Math.sin(phi) * radius * 1.05, fp.cz + Math.sin(theta) * Math.cos(phi) * radius];
  };
  const centre: V3 = [fp.cx, drumTop, fp.cz];
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < sides; segment += 1) {
      const p = point(ring, segment);
      const q = point(ring, segment + 1);
      const r = point(ring + 1, segment + 1);
      const s = point(ring + 1, segment);
      if (ring === rings - 1) dome.triangle(p, q, r, outward(p, q, r, centre), [[0, 0], [1, 0], [0.5, 1]], DOME_GREEN);
      else dome.quad(p, q, r, s, outward(p, q, r, centre), [[0, 0], [1, 0], [1, 1], [0, 1]], DOME_GREEN);
    }
  }
  const crown = drumTop + radius * 1.05;
  dome.box(fp.cx, crown + 0.5, fp.cz, 0.14, 1.0, 0.14, 0, 1, GOLD);
  dome.box(fp.cx, crown + 0.7, fp.cz, 0.36, 0.36, 0.36, Math.PI / 4, 1, GOLD);

  // A slim round minaret with a balcony ring and a pointed green cap, standing at the far front corner.
  const [mx, mz] = farCorner(a, b, doorT, f, 1.1);
  const shaftR = 1.0;
  const top = height + 12;
  const ring = (r: number, y0: number, y1: number, batch: MeshBuilderBatch, tile: number, color: Color) => {
    for (let index = 0; index < 12; index += 1) {
      const a0 = (index / 12) * Math.PI * 2;
      const a1 = ((index + 1) / 12) * Math.PI * 2;
      batch.wall(mx + Math.cos(a1) * r, mz + Math.sin(a1) * r, mx + Math.cos(a0) * r, mz + Math.sin(a0) * r, y0, y1, tile, color);
    }
  };
  ring(shaftR, 0, top, walls, 2.5, paint);
  const stone: Color = [0.9, 0.88, 0.82];
  const trim = get("concrete");
  ring(shaftR + 0.6, height + 7.8, height + 8.1, trim, 1, stone);
  trim.polygon(Array.from({ length: 12 }, (_, index) => [mx + Math.cos((index / 12) * Math.PI * 2) * (shaftR + 0.6), mz + Math.sin((index / 12) * Math.PI * 2) * (shaftR + 0.6)] as Vec2), height + 8.1, 1, stone);
  ring(shaftR + 0.55, height + 8.1, height + 8.6, get("darkFrame"), 1, [0.2, 0.2, 0.2]);
  ring(shaftR + 0.2, top, top + 0.25, trim, 1, stone);
  const apex: V3 = [mx, top + 3.4, mz];
  for (let index = 0; index < 12; index += 1) {
    const a0 = (index / 12) * Math.PI * 2;
    const a1 = ((index + 1) / 12) * Math.PI * 2;
    const p: V3 = [mx + Math.cos(a0) * (shaftR + 0.2), top + 0.25, mz + Math.sin(a0) * (shaftR + 0.2)];
    const q: V3 = [mx + Math.cos(a1) * (shaftR + 0.2), top + 0.25, mz + Math.sin(a1) * (shaftR + 0.2)];
    dome.triangle(p, q, apex, outward(p, q, apex, [mx, top, mz]), [[0, 0], [1, 0], [0.5, 1]], DOME_GREEN);
  }
  dome.box(mx, top + 3.8, mz, 0.12, 0.8, 0.12, f.yaw, 1, GOLD);
  for (let row = 1; row <= 3; row += 1) get("glass").box(mx + f.nx * (shaftR + 0.01), height + row * 2.2, mz + f.nz * (shaftR + 0.01), 0.35, 1.0, 0.02, f.yaw);
}

/**
 * Nightclub entrance: black double doors framed in neon, neon lines along the facade, a lit canopy, a red carpet and a
 * rope line. The sign is drawn by the caller from the sign atlas.
 */
export function clubFront(get: Get, f: Facade, edge: { a: Vec2; b: Vec2 }, height: number, accent: Color) {
  const doorWidth = 2.2;
  const doorTall = 2.7;
  const neon = get("neon");
  get("gate").box(f.x + f.nx * 0.05, 0.45 + doorTall / 2, f.z + f.nz * 0.05, doorWidth, doorTall, 0.1, f.yaw);
  get("chrome").box(f.x + f.nx * 0.12, 1.5, f.z + f.nz * 0.12, 0.05, 0.9, 0.05, f.yaw);
  for (const side of [-1, 1]) neon.box(f.x + f.ex * side * (doorWidth / 2 + 0.1) + f.nx * 0.08, 0.45 + doorTall / 2, f.z + f.ez * side * (doorWidth / 2 + 0.1) + f.nz * 0.08, 0.08, doorTall + 0.2, 0.06, f.yaw, 1, accent);
  neon.box(f.x + f.nx * 0.08, 0.45 + doorTall + 0.1, f.z + f.nz * 0.08, doorWidth + 0.28, 0.08, 0.06, f.yaw, 1, accent);

  const [ax, az] = edge.a;
  const [bx, bz] = edge.b;
  const length = Math.hypot(bx - ax, bz - az);
  const mx = (ax + bx) / 2 + f.nx * 0.06;
  const mz = (az + bz) / 2 + f.nz * 0.06;
  for (const y of [0.55, height - 0.35]) neon.box(mx, y, mz, length - 0.3, 0.07, 0.05, f.yaw, 1, accent);
  for (const [px, pz] of [edge.a, edge.b]) {
    const inX = (mx - px) / length * 0.3;
    const inZ = (mz - pz) / length * 0.3;
    neon.box(px + inX * 2 + f.nx * 0.06, height / 2, pz + inZ * 2 + f.nz * 0.06, 0.07, height - 0.9, 0.05, f.yaw, 1, [1, 1, 1]);
  }

  const canopyDepth = 2.4;
  get("gate").box(f.x + f.nx * (canopyDepth / 2), 3.3, f.z + f.nz * (canopyDepth / 2), doorWidth + 2.6, 0.22, canopyDepth, f.yaw);
  get("lamp").box(f.x + f.nx * (canopyDepth / 2), 3.18, f.z + f.nz * (canopyDepth / 2), doorWidth + 2.2, 0.03, canopyDepth - 0.4, f.yaw);
  neon.box(f.x + f.nx * canopyDepth, 3.3, f.z + f.nz * canopyDepth, doorWidth + 2.62, 0.08, 0.04, f.yaw, 1, accent);

  const carpetLength = 5.5;
  get("carpet").box(f.x + f.nx * (carpetLength / 2), 0.1, f.z + f.nz * (carpetLength / 2), 1.7, 0.2, carpetLength, f.yaw);
  const chrome = get("chrome");
  const rope = get("carpet");
  for (const side of [-1, 1]) {
    const lateral = side * 1.15;
    const posts: Vec2[] = [];
    for (let along = 1.2; along <= carpetLength - 0.3; along += 1.4) {
      const px = f.x + f.nx * along + f.ex * lateral;
      const pz = f.z + f.nz * along + f.ez * lateral;
      posts.push([px, pz]);
      chrome.box(px, 0.5, pz, 0.06, 1.0, 0.06, f.yaw);
      chrome.box(px, 0.03, pz, 0.32, 0.06, 0.32, f.yaw);
      chrome.box(px, 1.02, pz, 0.12, 0.08, 0.12, f.yaw);
    }
    for (let index = 1; index < posts.length; index += 1) {
      const [px, pz] = posts[index - 1]!;
      const [qx, qz] = posts[index]!;
      rope.box((px + qx) / 2, 0.86, (pz + qz) / 2, 0.05, 0.05, Math.hypot(qx - px, qz - pz) - 0.06, f.yaw);
    }
  }
}

/** Modern-house details: a cantilevered entrance canopy, a timber-clad panel, wall lights, planters and a paved path. */
export function modernFront(get: Get, f: Facade, edgeLength: number, doorOffset: number) {
  const canopyWidth = Math.min(edgeLength - 0.6, 6);
  get("concrete").box(f.x + f.nx * 1.1, 3.05, f.z + f.nz * 1.1, canopyWidth, 0.24, 2.2, f.yaw, 1, [0.97, 0.97, 0.96]);
  get("darkFrame").box(f.x + f.nx * 2.2, 3.05, f.z + f.nz * 2.2, canopyWidth + 0.02, 0.26, 0.04, f.yaw);
  const cladSide = doorOffset > 0 ? -1 : 1;
  const cladAt = Math.min(2.6, Math.max(1.6, edgeLength / 2 - 1.4));
  get("wood").box(f.x + f.ex * cladSide * cladAt + f.nx * 0.05, 2.9, f.z + f.ez * cladSide * cladAt + f.nz * 0.05, 1.6, 5.4, 0.08, f.yaw);
  for (let slat = -3; slat <= 3; slat += 1) {
    get("darkFrame").box(f.x + f.ex * (cladSide * cladAt + slat * 0.22) + f.nx * 0.1, 2.9, f.z + f.ez * (cladSide * cladAt + slat * 0.22) + f.nz * 0.1, 0.02, 5.4, 0.02, f.yaw);
  }
  for (const side of [-1, 1]) {
    get("lamp").box(f.x + f.ex * side * 0.95 + f.nx * 0.08, 2.2, f.z + f.ez * side * 0.95 + f.nz * 0.08, 0.12, 0.4, 0.1, f.yaw);
    const px = f.x + f.ex * side * 1.9 + f.nx * 0.7;
    const pz = f.z + f.ez * side * 1.9 + f.nz * 0.7;
    get("concrete").box(px, 0.3, pz, 1.0, 0.6, 0.6, f.yaw, 1, [0.3, 0.3, 0.32]);
    get("bush").box(px, 0.8, pz, 0.85, 0.5, 0.45, f.yaw);
  }
  get("pavers").box(f.x + f.nx * 1.8, 0.05, f.z + f.nz * 1.8, 1.6, 0.1, 3.6, f.yaw);
}

/** Square-section beam between two 3D points (wheel rims, spokes, legs, camel necks). */
export function beam(batch: MeshBuilderBatch, p: V3, q: V3, thickness: number, color?: Color) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const dz = q[2] - p[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.01) return;
  const d: V3 = [dx / length, dy / length, dz / length];
  const ref: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u: V3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(...u);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const h = thickness / 2;
  const corner = (base: V3, a: number, b: number): V3 => [base[0] + (u[0] * a + v[0] * b) * h, base[1] + (u[1] * a + v[1] * b) * h, base[2] + (u[2] * a + v[2] * b) * h];
  const signs: Array<[number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let index = 0; index < 4; index += 1) {
    const [a0, b0] = signs[index]!;
    const [a1, b1] = signs[(index + 1) % 4]!;
    const normal: V3 = [(u[0] * (a0 + a1) + v[0] * (b0 + b1)) / 2, (u[1] * (a0 + a1) + v[1] * (b0 + b1)) / 2, (u[2] * (a0 + a1) + v[2] * (b0 + b1)) / 2];
    batch.quad(corner(p, a0, b0), corner(p, a1, b1), corner(q, a1, b1), corner(q, a0, b0), normal, [[0, 0], [1, 0], [1, length], [0, length]], color);
  }
}

/** Airport terminal frontage: a full-height glass wall on the door edge, a deep cantilevered canopy on slim columns and a kerbside drop-off strip. */
export function terminalFront(get: Get, f: Facade, edge: { a: Vec2; b: Vec2 }, height: number) {
  const [ax, az] = edge.a;
  const [bx, bz] = edge.b;
  const length = Math.hypot(bx - ax, bz - az);
  const span = Math.min(length - 1, 60);
  const mid: Vec2 = [f.x, f.z];
  const glass = get("glass");
  const corner = (along: number, y: number): V3 => [mid[0] + f.ex * along + f.nx * 0.05, y, mid[1] + f.ez * along + f.nz * 0.05];
  glass.quad(corner(-span / 2, 0.2), corner(span / 2, 0.2), corner(span / 2, height - 0.6), corner(-span / 2, height - 0.6), [f.nx, 0, f.nz], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const frame = get("darkFrame");
  for (let along = -span / 2; along <= span / 2 + 0.01; along += span / Math.max(1, Math.round(span / 3))) {
    frame.box(mid[0] + f.ex * along + f.nx * 0.1, height / 2, mid[1] + f.ez * along + f.nz * 0.1, 0.12, height - 0.4, 0.14, f.yaw, 1, undefined, true);
  }
  for (const y of [3.4, height - 0.6]) frame.box(mid[0] + f.nx * 0.1, y, mid[1] + f.nz * 0.1, span, 0.16, 0.16, f.yaw, 1, undefined, true);
  const depth = 9;
  const canopy = get("concrete");
  canopy.box(mid[0] + f.nx * (depth / 2), height - 0.2, mid[1] + f.nz * (depth / 2), span + 4, 0.5, depth, f.yaw, 2, [1.3, 1.31, 1.32]);
  get("lamp").box(mid[0] + f.nx * (depth / 2), height - 0.47, mid[1] + f.nz * (depth / 2), span + 2, 0.03, depth - 2, f.yaw);
  const columns = get("frame");
  for (let along = -span / 2 + 2; along <= span / 2 - 1.9; along += 12) {
    columns.box(mid[0] + f.ex * along + f.nx * (depth - 1), (height - 0.45) / 2, mid[1] + f.ez * along + f.nz * (depth - 1), 0.5, height - 0.45, 0.5, f.yaw);
  }
  get("pavers").box(mid[0] + f.nx * 3, 0.08, mid[1] + f.nz * 3, span, 0.16, 6, f.yaw, 2);
}

/**
 * Observation wheel: twin rims braced together, cable spokes from both ends of the hub, capsules outside the rim and
 * two A-frame legs. `yaw` is the direction of the wheel plane, `height` its top.
 */
export function observationWheel(get: Get, centre: Vec2, yaw: number, height: number) {
  const radius = height * 0.45;
  const hubY = height - radius - 4;
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const nx = Math.cos(yaw);
  const nz = -Math.sin(yaw);
  const at = (angle: number, r: number, side: number): V3 => [
    centre[0] + ax * Math.cos(angle) * r + nx * side,
    hubY + Math.sin(angle) * r,
    centre[1] + az * Math.cos(angle) * r + nz * side,
  ];
  const steel = get("frame");
  const white: Color = [0.95, 0.96, 0.97];
  const segments = 48;
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    for (const side of [-3, 3]) beam(steel, at(a0, radius, side), at(a1, radius, side), 1.6, white);
    beam(steel, at(a0, radius, -3), at(a1, radius, 3), 0.5, white);
  }
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    beam(steel, at(0, 0, -7), at(angle, radius, 3), 0.25, white);
    beam(steel, at(0, 0, 7), at(angle, radius, -3), 0.25, white);
  }
  steel.box(centre[0], hubY, centre[1], 15, 7, 7, yaw, 2, white);
  for (let index = 0; index < segments; index += 1) {
    const angle = ((index + 0.5) / segments) * Math.PI * 2;
    const [x, y, z] = at(angle, radius + 3.4, 0);
    get("glass").box(x, y, z, 9, 3.6, 3.6, yaw);
    steel.box(x, y, z, 9.4, 0.5, 3.8, yaw, 1, white);
  }
  const neon = get("neon");
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    beam(neon, at(a0, radius + 0.9, 0), at(a1, radius + 0.9, 0), 0.25, [0.85, 0.95, 1]);
  }
  for (const side of [-1, 1]) {
    for (const along of [-1, 1]) {
      const foot: V3 = [centre[0] + ax * along * radius * 0.42 + nx * side * radius * 0.22, 0, centre[1] + az * along * radius * 0.42 + nz * side * radius * 0.22];
      beam(steel, foot, at(0, 0, side * 8), 3.2, white);
    }
  }
}

/**
 * A Bedouin-style camp behind its gate: striped tents in a horseshoe, carpets and cushions, a fire pit with flames,
 * lanterns on posts and a few camels resting outside. `facing` points from the camp out through the gate.
 * Returns obstacle circles (x, z, r) for poles, the fire and the camels.
 */
export function desertCamp(get: Get, gate: Vec2, facing: number): Array<[number, number, number]> {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const rx = fz;
  const rz = -fx;
  const cx = gate[0] - fx * 26;
  const cz = gate[1] - fz * 26;
  const obstacles: Array<[number, number, number]> = [];
  const local = (u: number, v: number): Vec2 => [cx + rx * u + fx * v, cz + rz * u + fz * v];
  const stripes: Color[][] = [
    [[0.62, 0.16, 0.12], [0.95, 0.9, 0.8]],
    [[0.36, 0.22, 0.12], [0.92, 0.84, 0.68]],
    [[0.12, 0.3, 0.36], [0.94, 0.9, 0.82]],
  ];
  const tents: Array<{ u: number; v: number; yaw: number; w: number; d: number }> = [
    { u: 0, v: -14, yaw: facing, w: 14, d: 7 },
    { u: -14, v: -2, yaw: facing + Math.PI / 2, w: 11, d: 6 },
    { u: 14, v: -2, yaw: facing - Math.PI / 2, w: 11, d: 6 },
    { u: -12, v: 12, yaw: facing + Math.PI * 0.8, w: 8, d: 5 },
  ];
  const canvas = get("canvas");
  const wood = get("wood");
  const paint = get("vertexPaint");
  tents.forEach((tent, tentIndex) => {
    const [tx, tz] = local(tent.u, tent.v);
    const ox = Math.sin(tent.yaw);
    const oz = Math.cos(tent.yaw);
    const sx = oz;
    const sz = -ox;
    const p = (s: number, o: number, y: number): V3 => [tx + sx * s + ox * o, y, tz + sz * s + oz * o];
    const colors = stripes[tentIndex % stripes.length]!;
    const bands = Math.round(tent.w / 1.2);
    for (let band = 0; band < bands; band += 1) {
      const s0 = -tent.w / 2 + (tent.w * band) / bands;
      const s1 = s0 + tent.w / bands;
      const color = colors[band % 2]!;
      canvas.quad(p(s0, -tent.d / 2, 3.6), p(s1, -tent.d / 2, 3.6), p(s1, 0, 2.6), p(s0, 0, 2.6), [ox * -0.3, 0.95, oz * -0.3], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
      canvas.quad(p(s0, 0, 2.6), p(s1, 0, 2.6), p(s1, tent.d / 2, 2.2), p(s0, tent.d / 2, 2.2), [ox * 0.2, 0.98, oz * 0.2], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
    }
    canvas.quad(p(-tent.w / 2, -tent.d / 2, 0), p(tent.w / 2, -tent.d / 2, 0), p(tent.w / 2, -tent.d / 2, 3.6), p(-tent.w / 2, -tent.d / 2, 3.6), [ox, 0, oz], [[0, 0], [1, 0], [1, 1], [0, 1]], colors[1]);
    for (const s of [-tent.w / 2, 0, tent.w / 2]) {
      for (const o of [-tent.d / 2, tent.d / 2]) {
        const [px, , pz] = p(s, o, 0);
        const top = o < 0 ? 3.6 : 2.2;
        wood.box(px, top / 2, pz, 0.14, top, 0.14, tent.yaw);
        obstacles.push([px, pz, 0.15]);
      }
    }
    const [mx, , mz] = p(0, 0, 0);
    get("carpet").box(mx, 0.03, mz, tent.w - 1, 0.04, tent.d - 0.6, tent.yaw, 2);
    paint.box(mx, 0.035, mz, tent.w - 2, 0.04, tent.d - 1.6, tent.yaw, 1, [0.78, 0.55, 0.18]);
    for (let s = -tent.w / 2 + 1; s <= tent.w / 2 - 1; s += 1.4) {
      const [qx, , qz] = p(s, -tent.d / 2 + 0.6, 0);
      const hue = (Math.round(s * 7) + tentIndex) % 3;
      paint.box(qx, 0.25, qz, 1.1, 0.4, 0.7, tent.yaw, 1, hue === 0 ? [0.55, 0.12, 0.16] : hue === 1 ? [0.85, 0.65, 0.2] : [0.15, 0.3, 0.45]);
    }
    const [lx, , lz] = p(0, 0.6, 0);
    wood.box(lx, 0.22, lz, 2.2, 0.08, 1.0, tent.yaw);
    wood.box(lx, 0.1, lz, 1.9, 0.2, 0.8, tent.yaw);
  });
  // Fire pit: a ring of stones, crossed logs and flames.
  const stones = get("concrete");
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    stones.box(cx + Math.cos(angle) * 1.3, 0.18, cz + Math.sin(angle) * 1.3, 0.5, 0.36, 0.4, angle, 1, [0.42, 0.38, 0.34]);
  }
  for (const angle of [0.3, 1.4, 2.5]) wood.box(cx, 0.15, cz, 1.6, 0.18, 0.18, angle);
  const flames = get("neon");
  const flame = (ox: number, oz: number, tall: number, color: Color) => {
    const apex: V3 = [cx + ox, tall, cz + oz];
    const ring: V3[] = [0, 1, 2].map((k) => [cx + ox + Math.cos((k / 3) * Math.PI * 2) * 0.35, 0.2, cz + oz + Math.sin((k / 3) * Math.PI * 2) * 0.35]);
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % 3]!;
      flames.triangle(p, q, apex, outward(p, q, apex, [cx + ox, 0.5, cz + oz]), [[0, 0], [1, 0], [0.5, 1]], color);
    });
  };
  flame(0, 0, 1.5, [1, 0.55, 0.12]);
  flame(0.25, 0.1, 1.0, [1, 0.8, 0.25]);
  flame(-0.2, -0.15, 1.1, [1, 0.42, 0.08]);
  obstacles.push([cx, cz, 1.6]);
  // Lanterns on posts round the open square and either side of the gate.
  const lanternAt = (x: number, z: number) => {
    wood.box(x, 1.1, z, 0.1, 2.2, 0.1, facing);
    get("darkFrame").box(x, 2.35, z, 0.36, 0.08, 0.36, facing);
    flames.box(x, 2.12, z, 0.26, 0.36, 0.26, facing, 1, [1, 0.78, 0.4]);
    obstacles.push([x, z, 0.12]);
  };
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + 0.2;
    const [x, z] = local(Math.cos(angle) * 8, Math.sin(angle) * 8);
    lanternAt(x, z);
  }
  for (const side of [-1, 1]) lanternAt(gate[0] + rx * side * 2.4 - fx * 0.5, gate[1] + rz * side * 2.4 - fz * 0.5);
  // Camels resting outside the horseshoe.
  for (const [u, v, turn] of [[20, 14, 0.6], [24, 8, 2.2], [18, 22, -0.9]] as const) {
    const [x, z] = local(u, v);
    camel(get, x, z, facing + turn);
    obstacles.push([x, z, 1.4]);
  }
  return obstacles;
}

/** A standing dromedary built from a few blocks: body, hump, legs, a curved neck and the head. */
export function camel(get: Get, x: number, z: number, yaw: number) {
  const paint = get("vertexPaint");
  const coat: Color = [0.72, 0.53, 0.33];
  const dark: Color = [0.5, 0.36, 0.22];
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  const p = (along: number, y: number, side = 0): V3 => [x + fx * along + rx * side, y, z + fz * along + rz * side];
  paint.box(x, 1.75, z, 0.75, 0.7, 1.9, yaw, 1, coat);
  paint.box(x - fx * 0.1, 2.25, z - fz * 0.1, 0.6, 0.45, 0.9, yaw, 1, coat);
  paint.box(x - fx * 0.1, 2.52, z - fz * 0.1, 0.4, 0.2, 0.5, yaw, 1, coat);
  for (const along of [-0.7, 0.7]) for (const side of [-0.22, 0.22]) beam(paint, p(along, 1.45, side), p(along, 0, side), 0.18, dark);
  beam(paint, p(0.85, 1.85), p(1.35, 2.5), 0.3, coat);
  beam(paint, p(1.35, 2.5), p(1.4, 2.95), 0.26, coat);
  paint.box(x + fx * 1.6, 2.95, z + fz * 1.6, 0.26, 0.26, 0.6, yaw, 1, coat);
  beam(paint, p(-0.95, 1.9), p(-1.05, 1.2), 0.06, dark);
}

/** A smooth, slightly lopsided sand dune: an elliptical mound with its steep slip face on the lee side. */
export function dune(batch: MeshBuilderBatch, x: number, z: number, yaw: number, ru: number, rv: number, tall: number, tint: Color) {
  const segments = 14;
  const rings = 4;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const point = (ring: number, segment: number): V3 => {
    const t = ring / rings;
    const angle = (segment / segments) * Math.PI * 2;
    const lee = Math.cos(angle) > 0 ? 0.7 : 1.15;
    const u = Math.cos(angle) * ru * (1 - t) * lee;
    const v = Math.sin(angle) * rv * (1 - t);
    const y = tall * Math.sin((t * Math.PI) / 2) - 0.05;
    return [x + u * c + v * s, y, z - u * s + v * c];
  };
  const centre: V3 = [x, -tall, z];
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const p0 = point(ring, segment);
      const p1 = point(ring, segment + 1);
      const p2 = point(ring + 1, segment + 1);
      const p3 = point(ring + 1, segment);
      const shade = 1 - ring * 0.03;
      const color: Color = [tint[0] * shade, tint[1] * shade, tint[2] * shade];
      if (ring === rings - 1) batch.triangle(p0, p1, p2, outward(p0, p1, p2, centre), [[p0[0] / 6, p0[2] / 6], [p1[0] / 6, p1[2] / 6], [p2[0] / 6, p2[2] / 6]], color);
      else batch.quad(p0, p1, p2, p3, outward(p0, p1, p2, centre), [[p0[0] / 6, p0[2] / 6], [p1[0] / 6, p1[2] / 6], [p2[0] / 6, p2[2] / 6], [p3[0] / 6, p3[2] / 6]], color);
    }
  }
}

/** A short timber jetty from the quay out over the water and a moored dhow alongside it. */
export function dhowPier(get: Get, quay: Vec2, facing: number) {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const rx = fz;
  const rz = -fx;
  const wood = get("wood");
  const length = 16;
  const mx = quay[0] + fx * (length / 2 + 0.5);
  const mz = quay[1] + fz * (length / 2 + 0.5);
  wood.box(mx, 0.35, mz, 3.2, 0.2, length, facing, 1, [1.15, 1.05, 0.95]);
  for (let along = 1; along <= length; along += 3) {
    for (const side of [-1.5, 1.5]) {
      const px = quay[0] + fx * along + rx * side;
      const pz = quay[1] + fz * along + rz * side;
      wood.box(px, -0.6, pz, 0.25, 2, 0.25, facing);
      get("chrome").box(px, 0.85, pz, 0.06, 0.9, 0.06, facing);
    }
  }
  for (const side of [-1.5, 1.5]) get("chrome").box(mx + rx * side, 1.28, mz + rz * side, 0.06, 0.06, length, facing);
  // The dhow: a timber hull with a raised stern, a shade canopy and a mast with a furled sail.
  const bx = mx + rx * 4.2;
  const bz = mz + rz * 4.2;
  const hull: Color = [0.55, 0.33, 0.18];
  wood.box(bx, 0.2, bz, 3.6, 1.4, 12, facing, 1, hull);
  wood.box(bx - fx * 5, 0.9, bz - fz * 5, 3.6, 0.6, 2.4, facing, 1, hull);
  const p = (along: number, side: number, y: number): V3 => [bx + fx * along + rx * side, y, bz + fz * along + rz * side];
  for (const side of [-1.8, 1.8]) wood.quad(p(6, side, -0.5), p(8.4, 0, 0.9), p(8.4, 0, 0.9), p(6, side, 0.9), [rx * Math.sign(side), 0, rz * Math.sign(side)], [[0, 0], [1, 0], [1, 1], [0, 1]], hull);
  wood.triangle(p(6, -1.8, 0.9), p(6, 1.8, 0.9), p(8.4, 0, 0.9), [0, 1, 0], [[0, 0], [1, 0], [0.5, 1]], [0.7, 0.5, 0.3]);
  wood.box(bx, 0.92, bz, 3.3, 0.06, 11.6, facing, 1, [0.78, 0.6, 0.4]);
  get("canvas").box(bx - fx * 1.5, 2.6, bz - fz * 1.5, 3.4, 0.08, 6, facing, 1, [0.95, 0.92, 0.84]);
  for (const along of [-4.3, 1.3]) for (const side of [-1.5, 1.5]) wood.box(bx + fx * along + rx * side, 1.75, bz + fz * along + rz * side, 0.1, 1.7, 0.1, facing);
  wood.box(bx + fx * 2.5, 4.5, bz + fz * 2.5, 0.22, 7.5, 0.22, facing);
  beam(get("canvas"), p(4.8, 0, 2), p(0.5, 0, 8), 0.45, [0.93, 0.9, 0.82]);
}

/** Beach umbrella with two loungers under it. */
export function beachShade(get: Get, x: number, z: number, yaw: number, color: Color) {
  get("pole").box(x, 1.25, z, 0.07, 2.5, 0.07, yaw);
  const canvas = get("canvas");
  const apex: V3 = [x, 2.75, z];
  for (let index = 0; index < 8; index += 1) {
    const a0 = (index / 8) * Math.PI * 2 + yaw;
    const a1 = ((index + 1) / 8) * Math.PI * 2 + yaw;
    const p: V3 = [x + Math.cos(a0) * 1.6, 2.2, z + Math.sin(a0) * 1.6];
    const q: V3 = [x + Math.cos(a1) * 1.6, 2.2, z + Math.sin(a1) * 1.6];
    canvas.triangle(p, q, apex, outward(p, q, apex, [x, 2, z]), [[0, 0], [1, 0], [0.5, 1]], index % 2 ? color : [0.97, 0.97, 0.95]);
  }
  const paint = get("vertexPaint");
  for (const side of [-0.75, 0.75]) {
    const lx = x + Math.cos(yaw) * side;
    const lz = z - Math.sin(yaw) * side;
    paint.box(lx, 0.32, lz, 0.6, 0.08, 1.9, yaw, 1, [0.96, 0.96, 0.94]);
    paint.box(lx + Math.sin(yaw) * 0.85, 0.55, lz + Math.cos(yaw) * 0.85, 0.6, 0.45, 0.08, yaw, 1, [0.96, 0.96, 0.94]);
  }
}
