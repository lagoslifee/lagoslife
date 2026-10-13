import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { getVehicleModel, twoWheeled, VEHICLE_MODELS, vehicleSeats, type VehicleModel } from "@lagos-living/shared";
import type { Materials } from "./materials";

// Served from the game's own origin rather than Babylon's CDN.
MeshoptCompression.Configuration = { decoder: { url: "/vendor/meshopt_decoder.js" } };

type Part = "glass" | "trim" | "chrome" | "interior" | "plate" | "headOff" | "headOn" | "tailOff" | "tailOn" | "tailBrake" | "reverse" | "wheel" | "steer" | "fork";
type Station = readonly [z: number, bottom: number, top: number, half: number];
type Cabin = { belt: number; roof: number; zA: number; zB: number; zC: number; zD: number; tumble: number };

/** Side profiles as fractions of length (z, rear -0.5 to front 0.5), height and half-width. */
const PROFILES: Record<Exclude<VehicleModel["body"], "bicycle" | "motorbike">, { lower: Station[]; cabin: Cabin }> = {
  hatch: {
    lower: [[-0.5, 0.25, 0.52, 0.9], [-0.47, 0.19, 0.57, 0.98], [-0.2, 0.17, 0.57, 1], [0.15, 0.17, 0.56, 1], [0.4, 0.19, 0.5, 0.98], [0.5, 0.25, 0.44, 0.9]],
    cabin: { belt: 0.56, roof: 0.99, zA: 0.17, zB: -0.03, zC: -0.42, zD: -0.48, tumble: 0.82 },
  },
  saloon: {
    lower: [[-0.5, 0.26, 0.55, 0.9], [-0.47, 0.19, 0.6, 0.97], [-0.2, 0.17, 0.6, 1], [0.2, 0.17, 0.58, 1], [0.43, 0.19, 0.52, 0.97], [0.5, 0.26, 0.46, 0.9]],
    cabin: { belt: 0.58, roof: 0.99, zA: 0.2, zB: 0.04, zC: -0.2, zD: -0.33, tumble: 0.82 },
  },
  suv: {
    lower: [[-0.5, 0.3, 0.54, 0.93], [-0.48, 0.23, 0.58, 0.98], [0.2, 0.23, 0.58, 1], [0.42, 0.25, 0.55, 0.98], [0.5, 0.31, 0.5, 0.92]],
    cabin: { belt: 0.57, roof: 0.99, zA: 0.25, zB: 0.12, zC: -0.44, zD: -0.47, tumble: 0.88 },
  },
  pickup: {
    lower: [[-0.5, 0.3, 0.42, 0.95], [-0.1, 0.27, 0.42, 1], [-0.085, 0.26, 0.57, 1], [0.42, 0.27, 0.55, 0.98], [0.5, 0.32, 0.5, 0.92]],
    cabin: { belt: 0.56, roof: 0.99, zA: 0.23, zB: 0.11, zC: -0.06, zD: -0.08, tumble: 0.88 },
  },
  van: {
    lower: [[-0.5, 0.18, 0.44, 0.96], [-0.48, 0.15, 0.47, 1], [0.38, 0.15, 0.47, 1], [0.5, 0.2, 0.43, 0.94]],
    cabin: { belt: 0.46, roof: 0.99, zA: 0.48, zB: 0.3, zC: -0.48, zD: -0.49, tumble: 0.93 },
  },
};

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

function box(scene: Scene, width: number, height: number, depth: number, x: number, y: number, z: number, rotationX = 0) {
  const mesh = MeshBuilder.CreateBox("vehicle part", { width, height, depth }, scene);
  mesh.bakeTransformIntoVertices(Matrix.RotationX(rotationX).multiply(Matrix.Translation(x, y, z)));
  return mesh;
}

function ribbon(scene: Scene, pathArray: Vector3[][], closePath = false) {
  return MeshBuilder.CreateRibbon("vehicle panel", { pathArray, closePath, sideOrientation: Mesh.DOUBLESIDE }, scene);
}

function tube(scene: Scene, from: Vector3, to: Vector3, radius: number) {
  return MeshBuilder.CreateTube("vehicle tube", { path: [from, to], radius, tessellation: 8, cap: Mesh.CAP_ALL }, scene);
}

function centre(ring: Vector3[]) {
  const sum = ring.reduce((total, point) => total.addInPlace(point), Vector3.Zero());
  return sum.scaleInPlace(1 / ring.length);
}

/** Lofted lower body with flat end caps (duplicate rings keep the cap edges sharp). */
function lowerBody(scene: Scene, model: VehicleModel, stations: Station[]) {
  const { length: L, height: H, width: W } = model;
  const rings = stations.map(([zf, bf, tf, hf]) => {
    const z = zf * L;
    const b = bf * H;
    const t = tf * H;
    const h = (hf * W) / 2;
    const r = Math.min(0.1, (t - b) * 0.25);
    return [v(-h * 0.9, b, z), v(-h, b + r, z), v(-h, t - r, z), v(-h * 0.93, t, z), v(h * 0.93, t, z), v(h, t - r, z), v(h, b + r, z), v(h * 0.9, b, z)];
  });
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  const cap = (ring: Vector3[]) => ring.map(() => centre(ring));
  const copy = (ring: Vector3[]) => ring.map((point) => point.clone());
  return ribbon(scene, [cap(first), copy(first), ...rings, copy(last), cap(last)], true);
}

function buildCar(scene: Scene, model: VehicleModel, parts: Record<Part, Mesh[]>, paint: Mesh[]) {
  const { length: L, width: W, height: H, wheelRadius: R } = model;
  const body = model.body as keyof typeof PROFILES;
  const { lower, cabin } = PROFILES[body];
  paint.push(lowerBody(scene, model, [...lower]));

  const yb = cabin.belt * H - 0.02;
  const yr = cabin.roof * H;
  const hb = (W / 2) * 0.94;
  const hr = hb * cabin.tumble;
  const [zA, zB, zC, zD] = [cabin.zA * L, cabin.zB * L, cabin.zC * L, cabin.zD * L];
  const half = (y: number) => hb + (hr - hb) * ((y - yb) / (yr - yb));
  const zFront = (y: number) => zA + (zB - zA) * ((y - yb) / (yr - yb));
  const zRear = (y: number) => zD + (zC - zD) * ((y - yb) / (yr - yb));
  const crown = 0.035;
  const cabinRing = (z: number, y: number) => {
    const h = half(y);
    const lift = ((y - yb) / (yr - yb)) * crown;
    return [v(-hb, yb, z), v(-h, y, z), v(0, y + lift, z), v(h, y, z), v(hb, yb, z)];
  };
  paint.push(ribbon(scene, [cabinRing(zD, yb), cabinRing(zC, yr), cabinRing((zB + zC) / 2, yr), cabinRing(zB, yr), cabinRing(zA, yb)]));

  const out = 0.012;
  const lowY = yb + 0.06;
  const highY = yr - 0.07;
  const sideAt = (y: number, z: number, side: number) => v(side * (half(y) + out), y, z);
  for (const side of [-1, 1]) {
    parts.glass.push(ribbon(scene, [
      [sideAt(lowY, zRear(lowY) + 0.1, side), sideAt(lowY, zFront(lowY) - 0.1, side)],
      [sideAt(highY, zRear(highY) + 0.1, side), sideAt(highY, zFront(highY) - 0.1, side)],
    ]));
    const pillarSpan = zFront(highY) - zRear(highY);
    const pillars = body === "van" ? 3 : model.seats > 2 && body !== "pickup" ? 1 : 0;
    for (let index = 1; index <= pillars; index += 1) {
      const z = zRear(highY) + (pillarSpan * index) / (pillars + 1) + (body === "van" ? 0 : pillarSpan * 0.08);
      paint.push(box(scene, 0.03, highY - lowY + 0.04, 0.09, side * (half((lowY + highY) / 2) + out + 0.006), (lowY + highY) / 2, z));
    }
    paint.push(box(scene, 0.07, 0.07, 0.14, side * (hb + 0.07), yb + 0.08, zA - 0.12));
    parts.trim.push(box(scene, 0.012, 0.05, 0.12, side * (hb + 0.1), yb + 0.08, zA - 0.12));
    parts.chrome.push(box(scene, 0.02, 0.025, 0.12, side * (W / 2 + 0.006), yb - 0.07, (zA + zB) / 2 - 0.25));
    if (model.seats > 2 && body !== "pickup") parts.chrome.push(box(scene, 0.02, 0.025, 0.12, side * (W / 2 + 0.006), yb - 0.07, (zB + zC) / 2 - 0.1));
  }
  const slopePanel = (zBase: number, zTop: number, inset: number) => {
    const sy = yr - yb;
    const sz = zTop - zBase;
    const len = Math.hypot(sy, sz);
    const n = v(0, Math.abs(sz) / len, (zBase > zTop ? 1 : -1) * (sy / len)).scale(out);
    const at = (u: number, side: number) => {
      const y = yb + sy * u;
      return v(side * half(y) * inset, y, zBase + sz * u).addInPlace(n);
    };
    return ribbon(scene, [[at(0.07, -1), at(0.07, 1)], [at(0.9, -1), at(0.9, 1)]]);
  };
  parts.glass.push(slopePanel(zA, zB, 0.92));
  parts.glass.push(slopePanel(zD, zC, body === "saloon" ? 0.9 : 0.86));

  if (body === "pickup") {
    const bedFront = zD - 0.04;
    const bedLength = bedFront + L / 2 - 0.04;
    const bedZ = bedFront - bedLength / 2;
    const floor = 0.42 * H;
    const wall = 0.57 * H - floor;
    for (const side of [-1, 1]) paint.push(box(scene, 0.06, wall, bedLength, side * (W / 2 - 0.03), floor + wall / 2, bedZ));
    paint.push(box(scene, W, wall, 0.06, 0, floor + wall / 2, -L / 2 + 0.03));
    paint.push(box(scene, W, wall, 0.06, 0, floor + wall / 2, bedFront));
    parts.trim.push(box(scene, W - 0.12, 0.02, bedLength, 0, floor + 0.01, bedZ));
  }

  const front = lower[lower.length - 1]!;
  const rear = lower[0]!;
  const noseTop = front[2] * H;
  const tailTop = rear[2] * H;
  const bumperY = (front[1] * H + noseTop) / 2 - 0.06;
  parts.trim.push(box(scene, W * 0.96, 0.15, 0.12, 0, front[1] * H + 0.09, L / 2 - 0.02));
  parts.trim.push(box(scene, W * 0.96, 0.15, 0.12, 0, rear[1] * H + 0.09, -L / 2 + 0.02));
  parts.trim.push(box(scene, W * 0.34, Math.min(0.16, (noseTop - bumperY) * 0.7), 0.04, 0, (bumperY + noseTop) / 2, L / 2 + 0.005));
  parts.plate.push(box(scene, 0.4, 0.12, 0.02, 0, front[1] * H + 0.12, L / 2 + 0.05));
  parts.plate.push(box(scene, 0.4, 0.12, 0.02, 0, Math.max(rear[1] * H + 0.32, tailTop - 0.24), -L / 2 - 0.005));
  for (const side of [-1, 1]) {
    const headY = noseTop - 0.08;
    parts.headOff.push(box(scene, W * 0.2, 0.09, 0.05, side * W * 0.32, headY, L / 2 + 0.0));
    parts.headOn.push(box(scene, W * 0.2, 0.09, 0.05, side * W * 0.32, headY, L / 2 + 0.004));
    const tailY = tailTop - 0.1;
    const tail = (z: number) => box(scene, W * 0.18, 0.12, 0.05, side * W * 0.35, tailY, -L / 2 + z);
    parts.tailOff.push(tail(0));
    parts.tailOn.push(tail(-0.003));
    parts.tailBrake.push(tail(-0.006));
    parts.chrome.push(box(scene, 0.07, 0.07, 0.04, side * W * 0.2, tailY, -L / 2 + 0.004));
    parts.reverse.push(box(scene, 0.07, 0.07, 0.04, side * W * 0.2, tailY, -L / 2 - 0.002));
  }

  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const arch = MeshBuilder.CreateCylinder("wheel arch", { diameter: R * 2.25, height: 0.02, tessellation: 18 }, scene);
    arch.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(x * (W / 2 + 0.004), R, z * (model.wheelbase / 2))));
    parts.trim.push(arch);
  }

  const seats = vehicleSeats(model);
  const floorY = lower[1]![1] * H + 0.08;
  for (const seat of seats) {
    parts.interior.push(box(scene, 0.46, 0.12, 0.46, seat.x, floorY + 0.22, seat.z));
    parts.interior.push(box(scene, 0.46, 0.56, 0.1, seat.x, floorY + 0.55, seat.z - 0.25, -0.12));
  }
  parts.interior.push(box(scene, W * 0.84, 0.16, 0.3, 0, yb - 0.04, seats[0]!.z + 0.78));
  parts.interior.push(box(scene, W * 0.84, 0.08, Math.abs(zA - zD) * 0.9, 0, floorY, (zA + zD) / 2));
}

function buildBicycle(scene: Scene, model: VehicleModel, parts: Record<Part, Mesh[]>, paint: Mesh[]) {
  const R = model.wheelRadius;
  const half = model.wheelbase / 2;
  const bottom = v(0, R * 0.95, -0.02);
  const seatTop = v(0, 0.92, -0.2);
  const headTop = v(0, 0.88, half - 0.12);
  const headLow = v(0, 0.66, half - 0.08);
  const rearAxle = v(0, R, -half);
  paint.push(tube(scene, bottom, seatTop, 0.022));
  paint.push(tube(scene, bottom, headLow, 0.026));
  paint.push(tube(scene, seatTop.add(v(0, -0.08, 0.01)), headTop, 0.022));
  for (const side of [-1, 1]) {
    paint.push(tube(scene, bottom.add(v(side * 0.03, 0, 0)), rearAxle.add(v(side * 0.05, 0, 0)), 0.013));
    paint.push(tube(scene, seatTop.add(v(side * 0.02, -0.06, 0)), rearAxle.add(v(side * 0.05, 0, 0)), 0.011));
  }
  parts.interior.push(box(scene, 0.13, 0.05, 0.26, 0, 0.97, -0.22));
  parts.chrome.push(tube(scene, v(0, 0.92, -0.21), v(0, 0.96, -0.22), 0.012));
  const crank = MeshBuilder.CreateCylinder("chainring", { diameter: 0.2, height: 0.02, tessellation: 16 }, scene);
  crank.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(0.06, R * 0.95, -0.02)));
  parts.chrome.push(crank);
  parts.trim.push(box(scene, 0.2, 0.025, 0.06, 0, R * 0.95 - 0.1, 0.06));
  parts.trim.push(box(scene, 0.2, 0.025, 0.06, 0, R * 0.95 + 0.1, -0.1));
  parts.tailOff.push(box(scene, 0.06, 0.04, 0.03, 0, 0.84, -0.3));
  parts.tailOn.push(box(scene, 0.06, 0.04, 0.03, 0, 0.84, -0.303));
  parts.tailBrake.push(box(scene, 0.06, 0.04, 0.03, 0, 0.84, -0.306));

  const fork = parts.fork;
  for (const side of [-1, 1]) fork.push(tube(scene, v(side * 0.04, 0.66 - R, 0.02), v(side * 0.05, 0, 0), 0.012));
  fork.push(tube(scene, v(0, 0.66 - R, 0.02), v(0, 0.92 - R, -0.04), 0.02));
  fork.push(tube(scene, v(-0.3, 0.95 - R, -0.1), v(0.3, 0.95 - R, -0.1), 0.014));
  fork.push(tube(scene, v(0, 0.92 - R, -0.04), v(0, 0.95 - R, -0.1), 0.015));
  for (const side of [-1, 1]) fork.push(box(scene, 0.1, 0.035, 0.035, side * 0.3, 0.95 - R, -0.1));
  parts.headOff.push(box(scene, 0.07, 0.05, 0.03, 0, 0.82 - R, 0.03));
  parts.headOn.push(box(scene, 0.07, 0.05, 0.03, 0, 0.82 - R, 0.033));
}

/**
 * A motorbike: engine block and exhaust low in the frame, a painted tank and tail, the seat for rider and passenger,
 * and on the faster bikes a fairing with a small screen. The fork and bars turn with the front wheel.
 */
function buildMotorbike(scene: Scene, model: VehicleModel, parts: Record<Part, Mesh[]>, paint: Mesh[]) {
  const R = model.wheelRadius;
  const half = model.wheelbase / 2;
  const sport = model.price >= 1_000_000;
  const ellipsoid = (dx: number, dy: number, dz: number, x: number, y: number, z: number, tilt = 0) => {
    const mesh = MeshBuilder.CreateSphere("bike shell", { diameterX: dx, diameterY: dy, diameterZ: dz, segments: 10 }, scene);
    mesh.bakeTransformIntoVertices(Matrix.RotationX(tilt).multiply(Matrix.Translation(x, y, z)));
    return mesh;
  };
  const head = v(0, 0.98, half - 0.2);
  const pivot = v(0, 0.5, -0.22);
  paint.push(tube(scene, head, pivot, 0.035));
  paint.push(tube(scene, head.add(v(0, -0.12, 0)), v(0, 0.36, 0.12), 0.03));
  paint.push(tube(scene, pivot, v(0, 0.86, -0.7), 0.028));
  paint.push(tube(scene, v(0, 0.9, -0.1), v(0, 0.86, -0.7), 0.026));
  paint.push(ellipsoid(0.36, 0.24, 0.52, 0, 0.98, 0.14, -0.12));
  paint.push(ellipsoid(0.24, sport ? 0.16 : 0.1, 0.5, 0, sport ? 0.97 : 0.88, -0.64, sport ? -0.2 : 0));
  if (sport) {
    paint.push(ellipsoid(0.3, 0.3, 0.56, 0, 0.84, half - 0.18, 0.5));
    paint.push(ellipsoid(0.3, 0.26, 0.72, 0, 0.56, 0.1, 0.1));
    parts.glass.push(box(scene, 0.24, 0.18, 0.02, 0, 1.08, half - 0.08, -0.85));
  } else {
    for (const side of [-1, 1]) paint.push(box(scene, 0.04, 0.16, 0.24, side * 0.15, 0.7, -0.2));
  }
  parts.interior.push(box(scene, 0.27, 0.08, sport ? 0.44 : 0.66, 0, sport ? 0.93 : 0.93, sport ? -0.26 : -0.34));
  parts.trim.push(box(scene, 0.3, 0.28, 0.4, 0, 0.45, 0.04));
  parts.trim.push(ellipsoid(0.22, 0.2, 0.2, 0, 0.36, -0.12));
  for (const side of [-1, 1]) parts.trim.push(tube(scene, v(side * 0.11, 0.5, -0.22), v(side * 0.1, R, -half), 0.025));
  parts.trim.push(tube(scene, v(0, 0.84, -0.78), v(0, 0.62, -half - 0.22), 0.03));
  parts.chrome.push(tube(scene, v(0.12, 0.3, 0.18), v(0.17, 0.3, -0.3), 0.032));
  parts.chrome.push(tube(scene, v(0.17, 0.3, -0.3), v(0.2, sport ? 0.62 : 0.42, -0.82), sport ? 0.05 : 0.04));
  parts.plate.push(box(scene, 0.2, 0.12, 0.012, 0, 0.6, -half - 0.24, -0.35));
  const tailY = sport ? 0.94 : 0.86;
  parts.tailOff.push(box(scene, 0.12, 0.05, 0.03, 0, tailY, -0.88));
  parts.tailOn.push(box(scene, 0.12, 0.05, 0.03, 0, tailY, -0.883));
  parts.tailBrake.push(box(scene, 0.12, 0.05, 0.03, 0, tailY, -0.886));
  const lampY = sport ? 0.84 : 0.9;
  const lampZ = sport ? half + 0.09 : half - 0.06;
  parts.headOff.push(box(scene, sport ? 0.2 : 0.14, sport ? 0.06 : 0.12, 0.04, 0, lampY, lampZ));
  parts.headOn.push(box(scene, sport ? 0.2 : 0.14, sport ? 0.06 : 0.12, 0.04, 0, lampY, lampZ + 0.004));

  const fork = parts.fork;
  for (const side of [-1, 1]) fork.push(tube(scene, v(side * 0.08, 0, 0), v(side * 0.08, 0.66, -0.2), 0.03));
  fork.push(box(scene, 0.22, 0.05, 0.08, 0, 0.66, -0.2));
  const bar = sport ? 0.24 : 0.36;
  const barY = sport ? 0.68 : 0.8;
  fork.push(tube(scene, v(-bar, barY, -0.26), v(bar, barY, -0.26), 0.016));
  if (!sport) fork.push(tube(scene, v(0, 0.66, -0.2), v(0, barY, -0.26), 0.02));
  for (const side of [-1, 1]) fork.push(tube(scene, v(side * bar, barY, -0.26), v(side * (bar + 0.1), barY, -0.27), 0.022));
  fork.push(box(scene, 0.12, 0.03, 0.42, 0, R + 0.06, 0.02, 0.15));
}

/** One wheel: dark tyre and pale spoked rim in a single vertex-coloured mesh, so spin is visible. */
function buildWheel(scene: Scene, model: VehicleModel) {
  const R = model.wheelRadius;
  const bike = model.body === "bicycle";
  const moto = model.body === "motorbike";
  const width = bike ? 0.04 : moto ? 0.13 : 0.2;
  const rimR = bike ? R * 0.92 : moto ? R * 0.68 : R * 0.62;
  const tyre = MeshBuilder.CreateCylinder("tyre", { diameter: R * 2, height: width, tessellation: bike ? 20 : 22 }, scene);
  const rim = MeshBuilder.CreateCylinder("rim", { diameter: rimR * 2, height: width + 0.012, tessellation: 18 }, scene);
  const hub = MeshBuilder.CreateCylinder("hub", { diameter: bike ? 0.06 : rimR * 0.4, height: width + 0.03, tessellation: 10 }, scene);
  const spokes: Mesh[] = [];
  const count = bike ? 16 : 5;
  for (let index = 0; index < count; index += 1) {
    const spoke = MeshBuilder.CreateBox("spoke", { width: bike ? 0.004 : 0.06, height: width + (bike ? 0.004 : 0.02), depth: rimR * 1.9 }, scene);
    spoke.bakeTransformIntoVertices(Matrix.RotationY((index / count) * Math.PI));
    spokes.push(spoke);
  }
  const colour = (mesh: Mesh, hex: string) => {
    const c = Color4.FromHexString(`${hex}ff`);
    const count = mesh.getTotalVertices();
    const colours = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) colours.set([c.r, c.g, c.b, 1], index * 4);
    mesh.setVerticesData("color", colours);
    return mesh;
  };
  const pieces = [colour(tyre, "#151515")];
  if (bike) {
    const rimRing = MeshBuilder.CreateTorus("rim ring", { diameter: rimR * 2, thickness: 0.02, tessellation: 20 }, scene);
    tyre.dispose();
    const tyreRing = MeshBuilder.CreateTorus("tyre ring", { diameter: R * 2 - 0.04, thickness: 0.045, tessellation: 22 }, scene);
    pieces[0] = colour(tyreRing, "#151515");
    pieces.push(colour(rimRing, "#b8bcc2"));
    rim.dispose();
  } else {
    pieces.push(colour(rim, "#2a2c30"));
  }
  pieces.push(colour(hub, "#c9ccd0"), ...spokes.map((spoke) => colour(spoke, bike ? "#d0d3d8" : "#b8bcc2")));
  const wheel = Mesh.MergeMeshes(pieces, true, true)!;
  wheel.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2));
  return wheel;
}

/**
 * A smooth alloy wheel in one vertex-coloured mesh, used in place of a modelled car's own low-poly wheel: round tyre
 * with bulged sidewalls, dark barrel, bright rim lip, five twin spokes, hub, lug nuts, brake disc and caliper. The
 * face is on the -x side once rotated (like the modelled wheels), so right-hand wheels are turned about Y.
 */
function buildAlloyWheel(scene: Scene, radius: number, width: number, sporty: boolean) {
  const R = radius;
  const W = Math.max(0.12, width);
  const rimR = R * 0.68;
  const face = W / 2;
  const colour = (mesh: Mesh, hex: string) => {
    const c = Color4.FromHexString(`${hex}ff`);
    const count = mesh.getTotalVertices();
    const colours = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) colours.set([c.r, c.g, c.b, 1], index * 4);
    mesh.setVerticesData("color", colours);
    return mesh;
  };
  const at = (mesh: Mesh, matrix: Matrix) => {
    mesh.bakeTransformIntoVertices(matrix);
    return mesh;
  };
  const spokeHex = sporty ? "#3b3e44" : "#c9cdd3";
  const pieces: Mesh[] = [
    colour(MeshBuilder.CreateCylinder("tyre tread", { diameter: R * 2, height: W * 0.78, tessellation: 40 }, scene), "#131313"),
    ...[-1, 1].map((side) =>
      colour(at(MeshBuilder.CreateTorus("tyre wall", { diameter: R * 2 - W * 0.22, thickness: W * 0.22, tessellation: 40 }, scene), Matrix.Translation(0, side * W * 0.36, 0)), "#161616"),
    ),
    colour(MeshBuilder.CreateCylinder("tyre wall face", { diameter: R * 1.86, height: W * 0.96, tessellation: 40 }, scene), "#1b1b1b"),
    colour(MeshBuilder.CreateCylinder("rim barrel", { diameter: rimR * 2, height: W * 0.98, tessellation: 32 }, scene), "#24262a"),
    colour(at(MeshBuilder.CreateTorus("rim lip", { diameter: rimR * 2, thickness: R * 0.05, tessellation: 36 }, scene), Matrix.Translation(0, face, 0)), "#e3e6ea"),
    colour(at(MeshBuilder.CreateCylinder("brake disc", { diameter: rimR * 1.55, height: 0.025, tessellation: 28 }, scene), Matrix.Translation(0, face - W * 0.4, 0)), "#7a7c80"),
    colour(at(MeshBuilder.CreateBox("caliper", { width: rimR * 0.35, height: 0.06, depth: rimR * 0.5 }, scene), Matrix.Translation(0, face - W * 0.32, rimR * 0.58)), sporty ? "#c8102e" : "#3a3a3d"),
    colour(at(MeshBuilder.CreateCylinder("hub", { diameter: rimR * 0.42, height: 0.05, tessellation: 18 }, scene), Matrix.Translation(0, face - 0.01, 0)), spokeHex),
    colour(at(MeshBuilder.CreateCylinder("centre cap", { diameter: rimR * 0.2, height: 0.06, tessellation: 14 }, scene), Matrix.Translation(0, face, 0)), "#1c1d20"),
  ];
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    for (const offset of [-0.15, 0.15]) {
      const spoke = MeshBuilder.CreateBox("spoke", { width: rimR * 0.17, height: 0.045, depth: rimR * 0.8 }, scene);
      pieces.push(colour(at(spoke, Matrix.Translation(0, face - 0.012, rimR * 0.58).multiply(Matrix.RotationY(angle + offset))), spokeHex));
    }
    const nut = MeshBuilder.CreateCylinder("lug nut", { diameter: rimR * 0.06, height: 0.07, tessellation: 6 }, scene);
    pieces.push(colour(at(nut, Matrix.Translation(0, face, rimR * 0.13).multiply(Matrix.RotationY(angle + Math.PI / 5))), "#e8eaed"));
  }
  const wheel = Mesh.MergeMeshes(pieces, true, true)!;
  wheel.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2));
  return wheel;
}

const PARTS: Part[] = ["glass", "trim", "chrome", "interior", "plate", "headOff", "headOn", "tailOff", "tailOn", "tailBrake", "reverse", "wheel", "steer", "fork"];

function steeringWheel(scene: Scene) {
  const rim = MeshBuilder.CreateTorus("steering wheel", { diameter: 0.38, thickness: 0.035, tessellation: 20 }, scene);
  const bar = MeshBuilder.CreateBox("steering spoke", { width: 0.34, height: 0.02, depth: 0.05 }, scene);
  const boss = MeshBuilder.CreateCylinder("steering boss", { diameter: 0.09, height: 0.04, tessellation: 10 }, scene);
  return [rim, bar, boss];
}

function templateSource(mesh: Mesh, name: string) {
  mesh.name = name;
  mesh.isPickable = false;
  mesh.position.y = -1000;
  return mesh;
}

function buildTemplate(scene: Scene, model: VehicleModel): Template {
  const parts = Object.fromEntries(PARTS.map((part) => [part, [] as Mesh[]])) as Record<Part, Mesh[]>;
  const paint: Mesh[] = [];
  if (model.body === "bicycle") buildBicycle(scene, model, parts, paint);
  else if (model.body === "motorbike") buildMotorbike(scene, model, parts, paint);
  else buildCar(scene, model, parts, paint);
  parts.wheel.push(buildWheel(scene, model));
  if (!twoWheeled(model)) parts.steer.push(...steeringWheel(scene));
  const merge = (meshes: Mesh[], name: string) => (meshes.length ? templateSource(Mesh.MergeMeshes(meshes, true, true)!, `${model.id} ${name}`) : null);
  const sources = {} as Record<Part, Mesh | null>;
  for (const part of PARTS) sources[part] = merge(parts[part], part);
  const body = merge(paint, "paint")!;
  body.setEnabled(false);
  return { body, sources, looks: {}, modelled: false };
}

/**
 * Template from a modelled GLB (see scripts/assets/build-vehicles.mjs). Its meshes are baked into vehicle space,
 * so they instance exactly like the procedural parts; lamp meshes are shared by their off/on/brake states.
 */
function assetTemplate(scene: Scene, model: VehicleModel, container: AssetContainer, looks: { palette: Material; cabin: Material; glass: Material; paint: PaintLook | null }): Template {
  container.addAllToScene();
  const meshes = new Map<string, Mesh>();
  for (const mesh of container.meshes) {
    if (!(mesh instanceof Mesh) || !mesh.getTotalVertices()) continue;
    const world = mesh.computeWorldMatrix(true).clone();
    mesh.parent = null;
    mesh.rotationQuaternion = null;
    mesh.position.setAll(0);
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.bakeTransformIntoVertices(world);
    meshes.set(mesh.name, mesh);
  }
  for (const mesh of container.meshes) if (!meshes.has(mesh.name)) mesh.dispose();
  for (const material of container.materials.slice()) material.dispose(false, false);
  const take = (name: string, part: Part, copy = false) => {
    const mesh = meshes.get(name);
    if (!mesh) return null;
    return templateSource(copy ? mesh.clone(`${name} ${part}`, null)! : mesh, `${model.id} ${part}`);
  };
  const sources = Object.fromEntries(PARTS.map((part) => [part, null])) as Record<Part, Mesh | null>;
  sources.glass = take("glass", "glass");
  sources.trim = take("trim", "trim");
  sources.plate = take("plate", "plate");
  sources.interior = take("interior", "interior");
  const modelledWheel = meshes.get("wheel");
  if (modelledWheel) {
    const { minimum, maximum } = modelledWheel.refreshBoundingInfo().getBoundingInfo().boundingBox;
    const wheel = buildAlloyWheel(scene, Math.max(maximum.y - minimum.y, maximum.z - minimum.z) / 2, maximum.x - minimum.x, model.category === "sports");
    wheel.bakeTransformIntoVertices(Matrix.Translation((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, (minimum.z + maximum.z) / 2));
    modelledWheel.dispose();
    sources.wheel = templateSource(wheel, `${model.id} wheel`);
  }
  sources.headOn = take("headlamp", "headOn", true);
  sources.headOff = take("headlamp", "headOff");
  sources.tailOn = take("taillamp", "tailOn", true);
  sources.tailBrake = take("taillamp", "tailBrake", true);
  sources.tailOff = take("taillamp", "tailOff");
  sources.steer = templateSource(Mesh.MergeMeshes(steeringWheel(scene), true, true)!, `${model.id} steer`);
  const body = templateSource(meshes.get("paint")!, `${model.id} paint`);
  body.setEnabled(false);
  const textured = looks.paint ? { headOff: looks.palette, tailOff: looks.palette } : {};
  return { body, sources, looks: { trim: looks.palette, interior: looks.cabin, glass: looks.glass, ...textured }, modelled: true, paint: looks.paint };
}

/** Baked paint detail (white) that the chosen colour tints, with the model's own normal map. */
type PaintLook = { albedo: BaseTexture; bump: BaseTexture | null; invertX: boolean; invertY: boolean };
type Template = { body: Mesh; sources: Record<Part, Mesh | null>; looks: Partial<Record<Part, Material>>; modelled: boolean; paint?: PaintLook | null };
type Sample = { t: number; x: number; z: number; yaw: number };
type Wheel = { pivot: TransformNode; spin: TransformNode; front: boolean };

const ROLL_GAIN = 0.009;

export class VehicleView {
  readonly root: TransformNode;
  readonly model: VehicleModel;
  readonly body: TransformNode;
  private samples: Sample[] = [];
  private wheels: Wheel[] = [];
  private steering: TransformNode | null = null;
  private fork: TransformNode | null = null;
  private lamps: Partial<Record<Part, InstancedMesh>> = {};
  private details: InstancedMesh[] = [];
  private roll = 0;
  /** Pedal crank angle (radians) for bicycles, advanced by riding speed. */
  crank = 0;
  private pitch = 0;
  private steerAngle = 0;
  private lightsOn = false;
  /** Drawn from a modelled asset (its cabin layout applies) rather than the procedural fallback. */
  modelled = false;
  private last: { x: number; z: number; yaw: number; speed: number } | null = null;

  constructor(
    readonly id: string,
    readonly meshes: AbstractMesh[],
    root: TransformNode,
    model: VehicleModel,
  ) {
    this.root = root;
    this.model = model;
    this.body = new TransformNode(`${id} body`, root.getScene());
    this.body.parent = root;
  }

  attach(template: Template, paint: Mesh) {
    const { sources } = template;
    this.modelled = template.modelled;
    const model = this.model;
    paint.parent = this.body;
    const instance = (part: Part, parent: TransformNode) => {
      const source = sources[part];
      if (!source) return null;
      const mesh = source.createInstance(`${this.id} ${part}`);
      mesh.parent = parent;
      mesh.position.y = 0;
      mesh.isPickable = false;
      return mesh;
    };
    for (const part of ["glass", "trim", "chrome", "plate"] as Part[]) instance(part, this.body);
    const interior = instance("interior", this.body);
    if (interior) this.details.push(interior);
    for (const part of ["headOff", "headOn", "tailOff", "tailOn", "tailBrake", "reverse"] as Part[]) {
      const lamp = instance(part, this.body);
      if (lamp) this.lamps[part] = lamp;
    }
    const R = model.wheelRadius;
    const bike = twoWheeled(model);
    const track = bike ? 0 : (model.asset?.track ?? model.width / 2 + 0.015 - 0.1);
    for (const [x, z] of bike ? ([[0, 1], [0, -1]] as const) : ([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const)) {
      const pivot = new TransformNode(`${this.id} wheel pivot`, this.root.getScene());
      pivot.parent = this.root;
      pivot.position.set(x * track, R, z * (model.wheelbase / 2));
      const spin = new TransformNode(`${this.id} wheel spin`, this.root.getScene());
      spin.parent = pivot;
      const wheel = instance("wheel", spin);
      // Modelled wheels face outward on the left; turning one about Y puts its face outward on the right.
      if (wheel && template.modelled && x > 0) wheel.rotation.y = Math.PI;
      this.wheels.push({ pivot, spin, front: z > 0 });
      if (bike && z > 0) {
        const fork = instance("fork", pivot);
        if (fork) this.fork = pivot;
      }
    }
    if (!bike) {
      const seat = vehicleSeats(model)[0]!;
      const profile = PROFILES[model.body as keyof typeof PROFILES];
      const column = new TransformNode(`${this.id} steering column`, this.root.getScene());
      column.parent = this.body;
      const steering = template.modelled ? model.asset?.steering : undefined;
      if (steering) column.position.set(steering.x, steering.y, steering.z);
      else column.position.set(seat.x, profile.cabin.belt * model.height + 0.02, seat.z + 0.5);
      column.rotation.x = -1.13;
      const spin = new TransformNode(`${this.id} steering`, this.root.getScene());
      spin.parent = column;
      const wheel = instance("steer", spin);
      if (wheel) this.details.push(wheel);
      this.steering = spin;
    }
    this.setLights(false);
    this.showBrake(false, false);
  }

  get x() {
    return this.root.position.x;
  }

  get z() {
    return this.root.position.z;
  }

  get yaw() {
    return this.root.rotation.y;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, yaw, roll);
  }

  setLights(on: boolean) {
    this.lightsOn = on;
    this.lamps.headOff?.setEnabled(!on);
    this.lamps.headOn?.setEnabled(on);
  }

  get lights() {
    return this.lightsOn;
  }

  private showBrake(braking: boolean, reversing: boolean) {
    this.lamps.tailBrake?.setEnabled(braking);
    this.lamps.tailOn?.setEnabled(!braking && this.lightsOn);
    this.lamps.tailOff?.setEnabled(!braking && !this.lightsOn);
    this.lamps.reverse?.setEnabled(reversing);
  }

  /** Interior and steering wheel are only worth drawing up close. */
  setDetail(near: boolean) {
    for (const mesh of this.details) mesh.setEnabled(near);
  }

  /**
   * Wheel spin and steer, lamps, and a gentle critically damped body roll/pitch.
   * Values come from the local car simulation, or are estimated from pose changes for others.
   */
  animate(dt: number, motion: { speed: number; steer: number; braking: boolean; accel: number; yawRate: number }) {
    if (dt <= 0) return;
    const model = this.model;
    const bike = twoWheeled(model);
    // Roughly 2.4 wheel turns per crank turn; coasting freewheels instead of back-pedalling.
    if (model.body === "bicycle" && motion.speed > 0.2 && motion.accel > -0.5) this.crank = (this.crank + (motion.speed * dt) / model.wheelRadius / 2.4) % (Math.PI * 2);
    for (const wheel of this.wheels) {
      wheel.spin.rotation.x = (wheel.spin.rotation.x + (motion.speed * dt) / model.wheelRadius) % (Math.PI * 2);
      if (wheel.front) wheel.pivot.rotation.y = motion.steer;
    }
    if (this.steering) this.steering.rotation.y = -motion.steer * 7;
    if (this.fork) this.fork.rotation.y = motion.steer;
    const lateral = motion.speed * motion.yawRate;
    const rollTarget = bike ? Math.max(-0.35, Math.min(0.35, -lateral * 0.06)) : Math.max(-0.05, Math.min(0.05, lateral * ROLL_GAIN));
    const pitchTarget = bike ? 0 : Math.max(-0.035, Math.min(0.035, -motion.accel * 0.005));
    const settle = 1 - Math.exp(-dt * (bike ? 6 : 4.5));
    this.roll += (rollTarget - this.roll) * settle;
    this.pitch += (pitchTarget - this.pitch) * settle;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.showBrake(motion.braking, motion.speed < -0.2);
  }

  /** Estimates motion from successive poses (remote or parked vehicles) and animates. */
  track(dt: number) {
    const { x, z, yaw } = this;
    const last = this.last;
    if (!last || dt <= 0) {
      this.last = { x, z, yaw, speed: 0 };
      return;
    }
    const forward = (x - last.x) * Math.sin(yaw) + (z - last.z) * Math.cos(yaw);
    const measured = Math.abs(forward) > 8 ? 0 : forward / dt;
    const speed = last.speed + (measured - last.speed) * Math.min(1, dt * 6);
    let dyaw = yaw - last.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const yawRate = dyaw / dt;
    const target = Math.abs(speed) > 0.5 ? Math.atan((yawRate * this.model.wheelbase) / speed) : 0;
    this.steerAngle += (Math.max(-this.model.maxSteer, Math.min(this.model.maxSteer, target)) - this.steerAngle) * Math.min(1, dt * 5);
    const accel = (speed - last.speed) / dt;
    this.last = { x, z, yaw, speed };
    this.animate(dt, { speed, steer: this.steerAngle, braking: accel < -2 && Math.abs(speed) > 0.5, accel, yawRate });
  }

  /** Estimated forward speed for vehicles animated from poses (0 until tracked). */
  get speed() {
    return this.last?.speed ?? 0;
  }

  /** World-space seat position and heading, for drawing the driver and passengers. */
  seat(index: number) {
    const seats = vehicleSeats(this.model);
    const seat = seats[Math.min(index, seats.length - 1)]!;
    const yaw = this.yaw;
    const x = this.x + Math.cos(yaw) * seat.x + Math.sin(yaw) * seat.z;
    const z = this.z - Math.sin(yaw) * seat.x + Math.cos(yaw) * seat.z;
    return { x, z, yaw };
  }

  /** Height of the avatar root when seated, relative to the ground. */
  seatHeight(index = 0) {
    if (this.modelled && this.model.asset) return this.model.asset.seats[Math.min(index, this.model.asset.seats.length - 1)]!.y;
    if (this.model.body === "bicycle") return 0.5;
    if (this.model.body === "motorbike") return index === 0 ? 0.6 : 0.68;
    const profile = PROFILES[this.model.body as keyof typeof PROFILES];
    return Math.max(0, profile.lower[1]![1] * this.model.height - 0.12);
  }

  push(t: number, x: number, z: number, yaw: number) {
    const last = this.samples.at(-1);
    if (last && Math.hypot(last.x - x, last.z - z) > 40) this.samples = [];
    this.samples.push({ t, x, z, yaw });
    if (this.samples.length > 10) this.samples.shift();
  }

  /** Interpolated pose ~120 ms in the past, matching remote players. */
  sample(now: number) {
    const samples = this.samples;
    if (!samples.length) return null;
    const renderTime = now - 120;
    let a = samples[0]!;
    let b = samples[samples.length - 1]!;
    for (let index = 1; index < samples.length; index += 1) {
      if (samples[index]!.t >= renderTime) {
        a = samples[index - 1]!;
        b = samples[index]!;
        break;
      }
    }
    const t = Math.max(0, Math.min(1, (renderTime - a.t) / Math.max(1, b.t - a.t)));
    let dyaw = b.yaw - a.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + dyaw * t };
  }

  /** Pushes a walker's circle out of the car's oriented footprint. */
  pushOut(px: number, pz: number, radius: number): [number, number] {
    const yaw = this.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dx = px - this.x;
    const dz = pz - this.z;
    const along = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    const halfL = this.model.length / 2 + radius;
    const halfW = this.model.width / 2 + radius;
    if (Math.abs(along) >= halfL || Math.abs(across) >= halfW) return [px, pz];
    const pushAlong = halfL - Math.abs(along);
    const pushAcross = halfW - Math.abs(across);
    if (pushAcross < pushAlong) {
      const shift = Math.sign(across || 1) * pushAcross;
      return [px + fz * shift, pz - fx * shift];
    }
    const shift = Math.sign(along || 1) * pushAlong;
    return [px + fx * shift, pz + fz * shift];
  }

  dispose() {
    this.root.dispose(false, false);
  }
}

export class VehicleFactory {
  private templates = new Map<string, Template>();
  private fallbacks = new Map<string, Template>();
  private loading = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private paints = new Map<string, PBRMaterial>();
  private looks: Record<Part, Material>;
  private carGlass: PBRMaterial;

  constructor(
    private readonly scene: Scene,
    materials: Pick<Materials, "glass" | "chrome">,
  ) {
    const pbr = (name: string, hex: string, options: { roughness?: number; metallic?: number; emissive?: string; unlit?: boolean } = {}) => {
      const material = new PBRMaterial(name, scene);
      material.albedoColor = Color3.FromHexString(hex);
      material.roughness = options.roughness ?? 0.5;
      material.metallic = options.metallic ?? 0;
      if (options.emissive) material.emissiveColor = Color3.FromHexString(options.emissive);
      if (options.unlit) material.unlit = true;
      return material;
    };
    const wheel = pbr("vehicle wheel", "#ffffff", { roughness: 0.55, metallic: 0.25 });
    this.carGlass = pbr("car glass", "#1a2427", { roughness: 0.05, metallic: 0.2 });
    this.carGlass.alpha = 0.45;
    this.carGlass.backFaceCulling = false;
    this.looks = {
      glass: materials.glass,
      trim: pbr("vehicle trim", "#141518", { roughness: 0.7 }),
      chrome: materials.chrome,
      interior: pbr("vehicle interior", "#2a2622", { roughness: 0.85 }),
      plate: pbr("number plate", "#f1f1ea", { roughness: 0.6, emissive: "#202020" }),
      headOff: pbr("headlamp", "#d8dcdf", { roughness: 0.1, metallic: 0.6 }),
      headOn: pbr("headlamp lit", "#fff6dc", { emissive: "#fff3d0", unlit: true }),
      tailOff: pbr("tail lamp", "#7a0d10", { roughness: 0.25, emissive: "#2a0204" }),
      tailOn: pbr("tail lamp lit", "#c4161c", { emissive: "#a00c10", unlit: true }),
      tailBrake: pbr("brake lamp", "#ff2a2a", { emissive: "#ff2020", unlit: true }),
      reverse: pbr("reverse lamp", "#ffffff", { emissive: "#f4f4f4", unlit: true }),
      wheel,
      steer: pbr("steering wheel", "#1a1a1a", { roughness: 0.6 }),
      fork: materials.chrome,
    };
  }

  private paint(hex: string, modelId: string, look?: PaintLook | null) {
    const key = look ? `${modelId} ${hex}` : hex;
    let material = this.paints.get(key);
    if (!material) {
      material = new PBRMaterial(`vehicle paint ${key}`, this.scene);
      material.albedoColor = Color3.FromHexString(hex);
      material.metallic = 0.6;
      material.roughness = 0.28;
      material.clearCoat.isEnabled = true;
      material.clearCoat.intensity = 0.6;
      if (look) {
        material.albedoTexture = look.albedo;
        material.bumpTexture = look.bump;
        material.invertNormalMapX = look.invertX;
        material.invertNormalMapY = look.invertY;
        material.metallic = 0.45;
      }
      this.paints.set(key, material);
    }
    return material;
  }

  /**
   * Loads the given modelled vehicles up front (all of them if omitted); others download the first time they are
   * needed. Any that fail fall back to their procedural design.
   */
  static async load(scene: Scene, materials: Pick<Materials, "glass" | "chrome">, modelIds?: readonly string[]) {
    const factory = new VehicleFactory(scene, materials);
    await Promise.all((modelIds ?? VEHICLE_MODELS.map((model) => model.id)).map((id) => factory.ensure(id)));
    return factory;
  }

  /** Downloads a modelled vehicle once; resolves when `create` will use it (or its fallback, if it failed). */
  ensure(modelId: string): Promise<void> {
    const model = getVehicleModel(modelId);
    if (!model.asset || this.templates.has(model.id) || this.failed.has(model.id)) return Promise.resolve();
    let pending = this.loading.get(model.id);
    if (!pending) {
      pending = this.loadAsset(model).catch(() => {
        this.failed.add(model.id);
      });
      this.loading.set(model.id, pending);
    }
    return pending;
  }

  /** Whether `create` would draw this model as it should look right now. */
  ready(modelId: string) {
    const model = getVehicleModel(modelId);
    return !model.asset || this.templates.has(model.id) || this.failed.has(model.id);
  }

  private async loadAsset(model: VehicleModel) {
    const container = await LoadAssetContainerAsync(model.asset!.url, this.scene);
    const source = container.materials.find((material) => material.name === "trim") as PBRMaterial | undefined;
    const albedo = source?.albedoTexture ?? null;
    const palette = new PBRMaterial(`${model.id} palette`, this.scene);
    palette.albedoTexture = albedo;
    palette.roughness = 0.6;
    palette.metallic = 0.05;
    let paint: PaintLook | null = null;
    if (model.asset!.paintTexture && source) {
      palette.bumpTexture = source.bumpTexture;
      palette.invertNormalMapX = source.invertNormalMapX;
      palette.invertNormalMapY = source.invertNormalMapY;
      palette.metallicTexture = source.metallicTexture;
      palette.useRoughnessFromMetallicTextureGreen = true;
      palette.useMetallnessFromMetallicTextureBlue = true;
      palette.useRoughnessFromMetallicTextureAlpha = false;
      palette.metallic = 1;
      palette.roughness = 1;
      const painted = container.materials.find((material) => material.name === "paint") as PBRMaterial | undefined;
      if (painted?.albedoTexture) {
        paint = { albedo: painted.albedoTexture, bump: painted.bumpTexture, invertX: painted.invertNormalMapX, invertY: painted.invertNormalMapY };
      }
    }
    const cabin = new PBRMaterial(`${model.id} cabin`, this.scene);
    cabin.albedoColor = Color3.White();
    cabin.roughness = 0.9;
    cabin.backFaceCulling = false;
    const template = assetTemplate(this.scene, model, container, { palette, cabin, glass: this.carGlass, paint });
    this.dress(template);
    this.templates.set(model.id, template);
  }

  private dress(template: Template) {
    for (const part of PARTS) {
      const source = template.sources[part];
      if (!source) continue;
      source.material = template.looks[part] ?? this.looks[part];
      if (part === "wheel") source.useVertexColors = true;
    }
  }

  private template(model: VehicleModel) {
    const loaded = this.templates.get(model.id);
    if (loaded) return loaded;
    const waiting = Boolean(model.asset) && !this.failed.has(model.id);
    if (waiting) void this.ensure(model.id);
    let template = this.fallbacks.get(model.id);
    if (!template) {
      template = buildTemplate(this.scene, model);
      this.dress(template);
      // A stand-in for a model still downloading must not replace it once it arrives.
      if (waiting) this.fallbacks.set(model.id, template);
      else this.templates.set(model.id, template);
    }
    return template;
  }

  create(id: string, modelId: string, colour: string) {
    const model = getVehicleModel(modelId);
    const template = this.template(model);
    const root = new TransformNode(`vehicle ${id}`, this.scene);
    const paint = template.body.clone(`${id} paint`, null)!;
    paint.setEnabled(true);
    paint.position.y = 0;
    paint.material = this.paint(colour, model.id, template.paint);
    const view = new VehicleView(id, [paint], root, model);
    view.attach(template, paint);
    return view;
  }
}
