import { cabinSeats, INTERIOR_ORIGIN, seatPoint } from "@lagos-living/shared";
import type { MeshBuilderBatch } from "./geometry";

type V3 = [number, number, number];
type Rgb = [number, number, number];

const [OX, OZ] = INTERIOR_ORIGIN;
const UV: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Inside face of the fuselage tube (radius 2 across, 1.8 high, centred 0.55 up) at a height. */
export const cabinWallX = (y: number) => 2 * Math.sqrt(Math.max(0, 1 - ((y - 0.55) / 1.8) ** 2));

const PLASTIC: Rgb = [0.74, 0.74, 0.72];
const TRIM: Rgb = [0.2, 0.21, 0.23];
const ECONOMY_CLOTH: Rgb = [0.12, 0.2, 0.4];
const LEATHER: Rgb = [0.36, 0.23, 0.15];
const HEADREST: Rgb = [0.95, 0.95, 0.92];
const AIRLINE_GREEN: Rgb = [0.0, 0.5, 0.3];
const SCREENS: Rgb[] = [[0.08, 0.22, 0.42], [0.36, 0.22, 0.1], [0.06, 0.3, 0.24], [0.28, 0.1, 0.3]];

/** A box whose top leans back (towards -z) by `angle`, like a reclined seat back. */
function leaning(batch: MeshBuilderBatch, x: number, y: number, z: number, w: number, h: number, d: number, angle: number, color: Rgb) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const p = (lx: number, ly: number, lz: number): V3 => [x + lx, y + ly * c + lz * s, z - ly * s + lz * c];
  const [hw, hh, hd] = [w / 2, h / 2, d / 2];
  const up: V3 = [0, c, -s];
  const ahead: V3 = [0, s, c];
  const faces: Array<[V3, V3, V3, V3, V3]> = [
    [p(-hw, -hh, hd), p(hw, -hh, hd), p(hw, hh, hd), p(-hw, hh, hd), ahead],
    [p(hw, -hh, -hd), p(-hw, -hh, -hd), p(-hw, hh, -hd), p(hw, hh, -hd), [0, -s, -c]],
    [p(hw, -hh, hd), p(hw, -hh, -hd), p(hw, hh, -hd), p(hw, hh, hd), [1, 0, 0]],
    [p(-hw, -hh, -hd), p(-hw, -hh, hd), p(-hw, hh, hd), p(-hw, hh, -hd), [-1, 0, 0]],
    [p(-hw, hh, hd), p(hw, hh, hd), p(hw, hh, -hd), p(-hw, hh, -hd), up],
    [p(-hw, -hh, -hd), p(hw, -hh, -hd), p(hw, -hh, hd), p(-hw, -hh, hd), [0, -c, s]],
  ];
  for (const [a, b, e, f, n] of faces) batch.quad(a, b, e, f, n, UV, color);
}

/** Sweeps a cross-section (x, y) along the cabin from z0 to z1, faces turned towards `towards`. */
function sweep(batch: MeshBuilderBatch, profile: Array<[number, number]>, z0: number, z1: number, towards: [number, number], color: Rgb) {
  for (let index = 0; index + 1 < profile.length; index += 1) {
    const [ax, ay] = profile[index]!;
    const [bx, by] = profile[index + 1]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
    if (nx * (towards[0] - (ax + bx) / 2) + ny * (towards[1] - (ay + by) / 2) < 0) [nx, ny] = [-nx, -ny];
    batch.quad([OX + ax, ay, OZ + z0], [OX + bx, by, OZ + z0], [OX + bx, by, OZ + z1], [OX + ax, ay, OZ + z1], [nx, ny, 0], UV, color);
  }
}

/** A rounded rectangle laid on the curved side wall, `inset` in from the skin. */
function onWall(batch: MeshBuilderBatch, side: number, z: number, y: number, w: number, h: number, radius: number, inset: number, color?: Rgb) {
  const r = Math.min(radius, w / 2, h / 2);
  const ring: Array<[number, number]> = [];
  const corners: Array<[number, number, number]> = [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, Math.PI / 2], [-(w / 2 - r), -(h / 2 - r), Math.PI], [w / 2 - r, -(h / 2 - r), Math.PI * 1.5]];
  for (const [cu, cv, start] of corners) {
    for (let step = 0; step <= 4; step += 1) {
      const angle = start + (step / 4) * (Math.PI / 2);
      ring.push([cu + Math.cos(angle) * r, cv + Math.sin(angle) * r]);
    }
  }
  const at = (u: number, v: number): V3 => [OX + side * (cabinWallX(y + v) - inset), y + v, OZ + z + u];
  const normal: V3 = [-side, 0, 0];
  const centre = at(0, 0);
  for (let index = 0; index < ring.length; index += 1) {
    const [u0, v0] = ring[index]!;
    const [u1, v1] = ring[(index + 1) % ring.length]!;
    batch.triangle(centre, at(u0, v0), at(u1, v1), normal, [[0.5, 0.5], [0.5 + u0 / w, 0.5 + v0 / h], [0.5 + u1 / w, 0.5 + v1 / h]], color);
  }
}

/** Economy: three-abreast seats with cloth cushions, reclined backs, white headrest covers, armrests and the screen and tray on the back. */
function economySeat(get: (key: string) => MeshBuilderBatch, sx: number, sz: number, screen: Rgb) {
  const cloth = get("bedding");
  const plastic = get("vertexPaint");
  const back = 0.2;
  cloth.box(sx, 0.385, sz + 0.02, 0.42, 0.13, 0.46, 0, 1, ECONOMY_CLOTH);
  cloth.box(sx, 0.37, sz + 0.25, 0.4, 0.1, 0.06, 0, 1, ECONOMY_CLOTH.map((c) => c * 0.85) as Rgb);
  plastic.box(sx, 0.3, sz + 0.02, 0.42, 0.05, 0.44, 0, 1, TRIM);
  leaning(cloth, sx, 0.82, sz - 0.25, 0.42, 0.7, 0.1, back, ECONOMY_CLOTH);
  leaning(plastic, sx, 0.81, sz - 0.31, 0.43, 0.74, 0.03, back, PLASTIC);
  leaning(cloth, sx, 1.2, sz - 0.33, 0.36, 0.17, 0.12, back, ECONOMY_CLOTH);
  leaning(cloth, sx, 1.18, sz - 0.265, 0.32, 0.16, 0.012, back, HEADREST);
  leaning(cloth, sx, 1.24, sz - 0.278, 0.32, 0.025, 0.012, back, AIRLINE_GREEN);
  // Back of the seat, as the row behind sees it: screen, tray table and seat pocket, each `out` proud of the shell.
  const behind = (y: number, out: number) => sz - 0.31 - (y - 0.81) * Math.tan(back) - 0.015 - out;
  leaning(plastic, sx, 0.98, behind(0.98, 0.004), 0.28, 0.19, 0.008, back, TRIM);
  leaning(get("neon"), sx, 0.98, behind(0.98, 0.012), 0.24, 0.15, 0.006, back, screen);
  leaning(get("neon"), sx - 0.04, 0.925, behind(0.925, 0.016), 0.14, 0.012, 0.004, back, screen.map((c) => Math.min(1, c * 2.2)) as Rgb);
  leaning(plastic, sx, 0.72, behind(0.72, 0.006), 0.34, 0.24, 0.012, back, [0.6, 0.6, 0.59]);
  leaning(plastic, sx, 0.8, behind(0.8, 0.016), 0.05, 0.02, 0.01, back, TRIM);
  leaning(cloth, sx, 0.52, behind(0.52, 0.015), 0.34, 0.12, 0.03, back, ECONOMY_CLOTH.map((c) => c * 0.7) as Rgb);
}

function economyCabin(get: (key: string) => MeshBuilderBatch) {
  const plastic = get("vertexPaint");
  const seats = cabinSeats("economy");
  seats.forEach((seat, index) => {
    const [sx, sz] = seatPoint(seat);
    economySeat(get, sx, sz, SCREENS[(index * 7 + Math.floor(index / 6)) % SCREENS.length]!);
  });
  const rows = new Set(seats.map((seat) => seatPoint(seat)[1]));
  for (const sz of rows) {
    for (const side of [-1, 1]) {
      for (const ax of [0.26, 0.7, 1.14, 1.58]) {
        plastic.box(OX + side * ax, 0.62, sz + 0.02, 0.05, 0.05, 0.4, 0, 1, TRIM);
        plastic.box(OX + side * ax, 0.52, sz - 0.12, 0.03, 0.16, 0.06, 0, 1, TRIM);
      }
      // One frame under each block of three: two legs and a rail.
      for (const lx of [0.42, 1.4]) plastic.box(OX + side * lx, 0.14, sz + 0.02, 0.04, 0.28, 0.42, 0, 1, [0.35, 0.36, 0.38]);
      plastic.box(OX + side * 0.91, 0.25, sz + 0.02, 1.1, 0.04, 0.04, 0, 1, [0.35, 0.36, 0.38]);
    }
  }
}

/** Business: lie-flat leather seats in pods, a wooden console, a footrest and a big screen ahead of each. */
function businessCabin(get: (key: string) => MeshBuilderBatch) {
  const leather = get("bedding");
  const plastic = get("vertexPaint");
  const wood = get("wood");
  cabinSeats("business").forEach((seat, index) => {
    const [sx, sz] = seatPoint(seat);
    const outward = sx > OX ? 1 : -1;
    const window = Math.abs(sx - OX) > 0.9;
    leather.box(sx, 0.385, sz + 0.02, 0.6, 0.13, 0.68, 0, 1, LEATHER);
    leather.box(sx, 0.36, sz + 0.37, 0.58, 0.1, 0.06, 0, 1, LEATHER.map((c) => c * 0.82) as Rgb);
    plastic.box(sx, 0.17, sz, 0.5, 0.34, 0.6, 0, 1, TRIM);
    leaning(leather, sx, 0.86, sz - 0.37, 0.6, 0.82, 0.14, 0.24, LEATHER);
    leaning(leather, sx, 1.33, sz - 0.48, 0.44, 0.2, 0.14, 0.24, LEATHER.map((c) => c * 0.85) as Rgb);
    leaning(leather, sx, 1.31, sz - 0.4, 0.36, 0.17, 0.012, 0.24, HEADREST);
    // Shell round the back and the outer side, the console towards the window or the aisle.
    leaning(plastic, sx, 0.66, sz - 0.56, 0.72, 1.3, 0.05, 0.12, [0.9, 0.89, 0.86]);
    plastic.box(sx + outward * 0.36, 0.5, sz - 0.05, 0.04, 1.0, 1.0, 0, 1, [0.9, 0.89, 0.86]);
    wood.box(sx + outward * 0.36, 0.62, sz - 0.02, 0.14, 0.05, 0.9, 0, 1, [1, 0.92, 0.82]);
    get("neon").box(sx + outward * 0.36, 0.66, sz + 0.3, 0.06, 0.03, 0.08, 0, 1, [0.8, 0.7, 0.5]);
    plastic.box(sx - outward * 0.33, 0.58, sz + 0.05, 0.07, 0.1, 0.62, 0, 1, TRIM);
    // Footrest and the screen on its arm, facing the seat.
    leather.box(sx, 0.3, sz + 0.86, 0.46, 0.18, 0.36, 0, 1, LEATHER.map((c) => c * 0.75) as Rgb);
    plastic.box(sx, 0.15, sz + 0.86, 0.4, 0.3, 0.32, 0, 1, TRIM);
    plastic.box(sx, 0.62, sz + 1.12, 0.05, 0.62, 0.05, 0, 1, TRIM);
    plastic.box(sx, 1.0, sz + 1.1, 0.56, 0.34, 0.03, 0, 1, TRIM);
    get("neon").box(sx, 1.0, sz + 1.084, 0.52, 0.3, 0.005, 0, 1, SCREENS[index % SCREENS.length]!.map((c) => c * 1.3) as Rgb);
    if (window) get("neon").box(sx + outward * 0.3, 1.0, sz - 0.1, 0.02, 0.06, 0.06, 0, 1, [0.9, 0.8, 0.6]);
  });
}

/** Overhead bins following the curve of the roof, the passenger service units under them and the ceiling between. */
function binsAndCeiling(get: (key: string) => MeshBuilderBatch, z0: number, z1: number) {
  const panel = get("vertexPaint");
  for (const side of [-1, 1]) {
    const s = (x: number) => side * x;
    const under = 1.74;
    const wall = cabinWallX(under) - 0.02;
    sweep(panel, [[s(0.92), under], [s(0.88), 1.86], [s(0.85), 2.0], [s(0.86), 2.12]], z0, z1, [s(0), 1.2], [0.94, 0.94, 0.92]);
    // The undersides catch the cabin light bouncing off the seats, so they are lit evenly rather than left in shadow.
    sweep(get("neon"), [[s(0.92), under], [s(wall), under]], z0, z1, [s(1.2), 1.0], [0.46, 0.46, 0.47]);
    sweep(get("neon"), [[s(0.92), under - 0.01], [s(0.94), under - 0.04], [s(1.48), under - 0.04]], z0, z1, [s(1.2), 1.0], [0.56, 0.56, 0.57]);
    for (let z = z0 + 1.64; z < z1; z += 1.64) {
      sweep(get("darkFrame"), [[s(0.915), under + 0.02], [s(0.875), 1.86], [s(0.845), 2.0], [s(0.855), 2.1]], z - 0.008, z + 0.008, [s(0), 1.2], [1, 1, 1]);
      get("chrome").box(OX + s(0.905), 1.79, OZ + z - 0.82, 0.02, 0.04, 0.22, 0, 1, [1, 1, 1]);
    }
  }
  // Centre ceiling panel between the bins, raised so the cove lights wash over it.
  sweep(get("neon"), [[-0.86, 2.2], [-0.4, 2.27], [0.4, 2.27], [0.86, 2.2]], z0, z1, [0, 1.0], [0.7, 0.7, 0.72]);
  // Reading lights and the seat-belt and no-smoking signs over every row.
  const rows = [...new Set([...cabinSeats("economy"), ...cabinSeats("business")].map((seat) => seatPoint(seat)[1]))];
  for (const z of rows) {
    for (const side of [-1, 1]) {
      for (const lx of [1.0, 1.18, 1.36]) get("neon").box(OX + side * lx, 1.695, z + 0.05, 0.05, 0.012, 0.05, 0, 1, [0.9, 0.86, 0.74]);
      get("neon").box(OX + side * 1.18, 1.695, z + 0.16, 0.16, 0.012, 0.05, 0, 1, [0.1, 0.12, 0.16]);
      panel.box(OX + side * 1.18, 1.69, z - 0.06, 0.08, 0.02, 0.08, 0, 1, [0.6, 0.6, 0.6]);
    }
  }
}

/** Windows set into the wall with a bezel, the sky through the glass and the blind part-drawn on some. */
function windows(get: (key: string) => MeshBuilderBatch, glass: MeshBuilderBatch, halfLength: number) {
  const bezel = get("vertexPaint");
  const at: number[] = [];
  for (const seat of cabinSeats("economy")) if (seat.endsWith("A")) at.push(seatPoint(seat)[1] - OZ - 0.05);
  for (const seat of cabinSeats("business")) if (seat.endsWith("A")) at.push(seatPoint(seat)[1] - OZ - 0.42, seatPoint(seat)[1] - OZ + 0.42);
  at.forEach((z, index) => {
    if (Math.abs(z) > halfLength - 1) return;
    for (const side of [-1, 1]) {
      onWall(bezel, side, z, 1.24, 0.38, 0.52, 0.16, 0.012, [0.82, 0.82, 0.8]);
      onWall(bezel, side, z, 1.24, 0.3, 0.44, 0.13, 0.02, [0.55, 0.56, 0.57]);
      onWall(glass, side, z, 1.24, 0.25, 0.37, 0.11, 0.026);
      const drawn = [0, 0.35, 0, 0.7, 0.15, 0, 1, 0.5][(index * 3 + (side > 0 ? 1 : 0) * 5) % 8]!;
      if (drawn > 0) onWall(bezel, side, z, 1.24 + 0.37 / 2 - (0.37 * drawn) / 2, 0.255, 0.37 * drawn, 0.06, 0.032, [0.93, 0.93, 0.9]);
    }
  });
}

/**
 * Fits out the airliner cabin inside the fuselage: carpet and floor path lights, both cabins of seats, overhead bins,
 * windows, the bulkhead between business and economy, the galley at the front and the lavatories at the back.
 */
export function fitAirlinerCabin(get: (key: string) => MeshBuilderBatch, glass: MeshBuilderBatch, halfLength: number) {
  const P = (x: number, z: number): [number, number] => [OX + x, OZ + z];
  const HZ = halfLength;
  const floorX = cabinWallX(0.02) - 0.02;
  get("bedding").polygon([P(-floorX, -HZ), P(floorX, -HZ), P(floorX, HZ), P(-floorX, HZ)], 0.025, 1, [0.2, 0.23, 0.33]);
  get("bedding").polygon([P(-0.36, -HZ), P(0.36, -HZ), P(0.36, HZ), P(-0.36, HZ)], 0.03, 1, [0.46, 0.12, 0.16]);
  get("bedding").polygon([P(-0.36, 4.1), P(0.36, 4.1), P(0.36, HZ), P(-0.36, HZ)], 0.032, 1, [0.32, 0.2, 0.14]);
  for (let z = -HZ + 1; z < HZ - 1; z += 0.9) for (const side of [-1, 1]) get("neon").box(OX + side * 0.37, 0.035, OZ + z, 0.02, 0.01, 0.12, 0, 1, [0.75, 0.5, 0.18]);
  // Lower side-wall lining under the windows.
  for (const side of [-1, 1]) {
    const profile: Array<[number, number]> = [];
    for (let y = 0.03; y <= 0.95; y += 0.115) profile.push([side * (cabinWallX(y) - 0.008), y]);
    sweep(get("vertexPaint"), profile, -HZ + 0.8, HZ - 1.05, [0, 1.0], [0.78, 0.78, 0.76]);
  }
  economyCabin(get);
  businessCabin(get);
  binsAndCeiling(get, -HZ + 0.8, HZ - 1.05);
  windows(get, glass, HZ);

  // Bulkhead between the cabins: wood facing business, a curtain tied back each side of the aisle, exit signs.
  for (const side of [-1, 1]) {
    get("vertexPaint").box(OX + side * 1.2, 1.2, OZ + 4.0, 1.4, 2.3, 0.08, 0, 1, [0.88, 0.87, 0.84]);
    get("wood").box(OX + side * 1.2, 0.95, OZ + 4.045, 1.3, 1.5, 0.01, 0, 1, [1, 0.9, 0.8]);
    get("bedding").box(OX + side * 0.44, 1.05, OZ + 3.98, 0.12, 2.0, 0.1, 0, 1, [0.1, 0.13, 0.25]);
    get("neon").box(OX + side * 0.62, 2.12, OZ + 3.95, 0.16, 0.06, 0.01, 0, 1, [0.1, 0.75, 0.3]);
  }
  get("chrome").box(OX, 2.15, OZ + 3.98, 1.0, 0.02, 0.02, 0, 1, [1, 1, 1]);

  // Galley: steel cart bays and ovens behind a worktop, closed to the ceiling above.
  const gz = HZ - 0.6;
  get("chrome").box(OX, 0.5, OZ + gz, 3.4, 1.0, 0.9, 0, 1, [0.92, 0.93, 0.95]);
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) get("darkFrame").box(OX + x, 0.5, OZ + gz - 0.455, 0.02, 0.96, 0.01, 0, 1, [1, 1, 1]);
  for (const x of [-0.9, -0.3, 0.3, 0.9]) get("chrome").box(OX + x, 0.82, OZ + gz - 0.465, 0.24, 0.03, 0.02, 0, 1, [0.7, 0.7, 0.72]);
  get("vertexPaint").box(OX, 1.03, OZ + gz - 0.05, 3.4, 0.05, 1.0, 0, 1, [0.93, 0.93, 0.92]);
  get("vertexPaint").box(OX, 1.75, OZ + gz + 0.2, 3.4, 1.1, 0.5, 0, 1, [0.86, 0.86, 0.84]);
  for (const x of [-1.05, -0.35, 0.35, 1.05]) {
    for (const y of [1.4, 1.75]) {
      get("chrome").box(OX + x, y, OZ + gz - 0.06, 0.6, 0.28, 0.02, 0, 1, [0.9, 0.9, 0.92]);
      get("darkFrame").box(OX + x, y, OZ + gz - 0.075, 0.42, 0.14, 0.01, 0, 1, [1, 1, 1]);
    }
  }

  // Two lavatories at the back, both showing vacant.
  get("vertexPaint").box(OX, 1.1, OZ - HZ + 0.5, 3.6, 2.2, 0.6, 0, 1, [0.9, 0.9, 0.88]);
  for (const x of [-0.6, 0.6]) {
    get("vertexPaint").box(OX + x, 1.0, OZ - HZ + 0.81, 0.66, 1.95, 0.02, 0, 1, [0.8, 0.8, 0.78]);
    get("darkFrame").box(OX + x, 1.0, OZ - HZ + 0.8, 0.7, 1.99, 0.01, 0, 1, [1, 1, 1]);
    get("chrome").box(OX + x + (x < 0 ? 0.22 : -0.22), 1.0, OZ - HZ + 0.83, 0.03, 0.12, 0.02, 0, 1, [1, 1, 1]);
    get("neon").box(OX + x, 1.6, OZ - HZ + 0.83, 0.14, 0.05, 0.01, 0, 1, [0.1, 0.7, 0.25]);
  }
}
