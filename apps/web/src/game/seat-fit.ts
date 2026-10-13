import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Vec2 } from "@lagos-living/shared";
import type { ClubSeat } from "./interior";

/** How far the hips sit in front of a backrest, and above the cushion. */
const HIP_FROM_BACK = 0.2;
const SIT_ABOVE_CUSHION = 0;
/** On a deep seat, the hips stay this far back from the front edge, so the knees bend just over the edge. */
const KNEES_FROM_FRONT = 0.36;
/** A body lying on its back: the root (at the soles) sits this far above the mattress, and this far in from its foot edge (the feet just over it, so the head clears the pillows). */
export const LIE_ABOVE_MATTRESS = 0.09;
const LIE_FROM_FOOT = -0.06;

/**
 * Moves seats built for the box version of a piece onto the Meshy model that stands in for it, by dropping rays onto
 * the model: a sofa seat goes onto the cushion, just in front of the backrest; a bed place goes onto the mattress top
 * at its foot edge; a dining seat goes onto the model's chair. Returns the dining seats the model has no chair for;
 * other seats the model has no surface for are left alone.
 */
export function fitSeats(model: TransformNode, seats: ClubSeat[]): ClubSeat[] {
  const meshes = new Set<AbstractMesh>(model.getChildMeshes());
  if (!meshes.size) return [];
  const ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 3);
  const top = (x: number, z: number) => {
    ray.origin.set(x, 2.6, z);
    let best = 0;
    for (const mesh of meshes) {
      if (!mesh.getTotalVertices()) continue;
      const hit = ray.intersectsMesh(mesh as never, false);
      if (hit.hit && hit.pickedPoint) best = Math.max(best, hit.pickedPoint.y);
    }
    return best;
  };
  const missing: ClubSeat[] = [];
  const chairs: Vec2[] = [];
  for (const seat of seats) {
    const fx = Math.sin(seat.yaw);
    const fz = Math.cos(seat.yaw);
    if (seat.rest === "dining") {
      // A chair: the flat seat nearest where the box chair stood, or no seat at all if the model has no chair there.
      const grid = new Map<string, { x: number; z: number; h: number; i: number; j: number }>();
      for (let i = -8; i <= 8; i += 1) {
        for (let j = -8; j <= 8; j += 1) {
          const [lateral, d] = [i * 0.05, j * 0.05];
          const x = seat.at[0] + fx * d + fz * lateral;
          const z = seat.at[1] + fz * d - fx * lateral;
          const h = top(x, z);
          if (h >= 0.36 && h <= 0.58) grid.set(`${i},${j}`, { x, z, h, i, j });
        }
      }
      const height = mode([...grid.values()].map((point) => point.h));
      // The chair is the patch of seat-height points nearest where the box chair stood.
      const flat = height === null ? [] : [...grid.values()].filter((point) => Math.abs(point.h - height) < 0.05);
      const nearest = flat.reduce<(typeof flat)[number] | null>((best, point) => (!best || Math.hypot(point.i, point.j) < Math.hypot(best.i, best.j) ? point : best), null);
      const patch = new Set<string>();
      const queue = nearest ? [nearest] : [];
      const isFlat = new Set(flat.map((point) => `${point.i},${point.j}`));
      while (queue.length) {
        const point = queue.pop()!;
        const key = `${point.i},${point.j}`;
        if (patch.has(key)) continue;
        patch.add(key);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const next = `${point.i + di},${point.j + dj}`;
          if (isFlat.has(next) && !patch.has(next)) queue.push(grid.get(next)!);
        }
      }
      const points = [...patch].map((key) => grid.get(key)!);
      const centre: Vec2 = points.length ? [points.reduce((sum, point) => sum + point.x, 0) / points.length, points.reduce((sum, point) => sum + point.z, 0) / points.length] : seat.at;
      if (points.length < 6 || chairs.some((chair) => Math.hypot(chair[0] - centre[0], chair[1] - centre[1]) < 0.25)) {
        missing.push(seat);
        continue;
      }
      chairs.push(centre);
      seat.at = centre;
      seat.y = height! + SIT_ABOVE_CUSHION;
      continue;
    }
    const along = (d: number): Vec2 => [seat.at[0] + fx * d, seat.at[1] + fz * d];
    const lying = seat.rest === "bed";
    const from = lying ? -1.9 : -0.8;
    const to = lying ? 0.6 : 0.8;
    const samples: Array<{ d: number; h: number }> = [];
    for (let d = from; d <= to + 1e-6; d += 0.04) samples.push({ d, h: top(...along(d)) });
    const band = lying ? [0.3, 0.95] : [0.28, 0.66];
    const surface = mode(samples.map((sample) => sample.h).filter((h) => h >= band[0]! && h <= band[1]!));
    if (surface === null) continue;
    // The run of samples on that surface nearest where the box seat was.
    const flat = samples.map((sample) => Math.abs(sample.h - surface) < 0.07);
    let start = samples.reduce((best, sample, index) => (flat[index] && Math.abs(sample.d) < Math.abs(samples[best]!.d) ? index : best), flat.indexOf(true));
    if (start < 0) continue;
    let end = start;
    while (start > 0 && flat[start - 1]) start -= 1;
    while (end < samples.length - 1 && flat[end + 1]) end += 1;
    const back = samples[start]!.d;
    const front = samples[end]!.d;
    if (lying) {
      seat.at = along(front - LIE_FROM_FOOT);
      seat.y = surface + LIE_ABOVE_MATTRESS;
      // The mattress width across the middle of the body, for the duvet.
      const [mx, mz] = along(front - 0.9);
      let left = 0;
      let right = 0;
      while (left < 1.2 && Math.abs(top(mx - fz * (left + 0.04), mz + fx * (left + 0.04)) - surface) < 0.1) left += 0.04;
      while (right < 1.2 && Math.abs(top(mx + fz * (right + 0.04), mz - fx * (right + 0.04)) - surface) < 0.1) right += 0.04;
      if (left > 0.3 && right > 0.3) seat.width = Math.min(left, right) * 2;
    } else {
      seat.at = along(Math.min(Math.max(back + HIP_FROM_BACK, front - KNEES_FROM_FRONT), (back + front) / 2 + 0.1));
      seat.y = surface + SIT_ABOVE_CUSHION;
    }
  }
  return missing;
}

/** The most common height (to 3 cm) among `values`: the flat top of a cushion or mattress, not a pillow or arm. */
function mode(values: number[]) {
  if (!values.length) return null;
  const counts = new Map<number, number[]>();
  for (const value of values) {
    const key = Math.round(value / 0.03);
    counts.set(key, [...(counts.get(key) ?? []), value]);
  }
  const best = [...counts.values()].sort((a, b) => b.length - a.length)[0]!;
  return best.reduce((sum, value) => sum + value, 0) / best.length;
}
