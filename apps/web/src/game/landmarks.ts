import type { Place, Vec2 } from "@lagos-living/shared";
import type { MeshBuilderBatch, V3 } from "./geometry";

type Color = [number, number, number];
type Get = (material: string) => MeshBuilderBatch;

/** Mapped places drawn with their own architecture instead of the generic Lagos block. */
export type LandmarkKind = "church" | "mosque" | "club" | "modern";

export function landmarkFor(place: Place | undefined): LandmarkKind | null {
  if (!place) return null;
  if (place.kind === "worship") return /mosque/i.test(place.name) ? "mosque" : "church";
  if (place.kind === "club") return "club";
  if (place.kind === "sale" || place.kind === "rental") return "modern";
  return null;
}

export const LANDMARK_PAINT: Record<LandmarkKind, Color> = {
  church: [0.96, 0.95, 0.91],
  mosque: [0.97, 0.95, 0.88],
  club: [0.07, 0.07, 0.09],
  modern: [0.97, 0.97, 0.96],
};

export const LANDMARK_TRIM: Record<LandmarkKind, Color> = {
  church: [0.85, 0.82, 0.74],
  mosque: [0.82, 0.78, 0.66],
  club: [0.12, 0.12, 0.14],
  modern: [0.22, 0.22, 0.24],
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
