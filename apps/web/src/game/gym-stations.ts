import { GYM, getPlace, type ExerciseId, type Vec2 } from "@lagos-living/shared";
import type { PropId } from "./props";

export type GymStation = {
  exercise: ExerciseId;
  prop: PropId;
  propAt: Vec2;
  propYaw: number;
  /** Where the member stands, sits or runs during a set, the way they face, and how high off the ground. */
  at: Vec2;
  yaw: number;
  lift: number;
  motion: "walk" | "sit" | "idle";
  speed: number;
};

/**
 * The training floor in front of iFitness: dumbbells and bench to one side of the entrance path, the treadmill on the
 * other, all a few metres out from the door so the way in stays clear.
 */
export function gymStations(): GymStation[] {
  const place = getPlace(GYM.placeId);
  const dx = place.kerb[0] - place.door[0];
  const dz = place.kerb[1] - place.door[1];
  const length = Math.hypot(dx, dz) || 1;
  const [fx, fz] = [dx / length, dz / length];
  const out = Math.min(4, Math.max(2.5, length * 0.3));
  const at = (side: number, forward = 0): Vec2 => [place.door[0] + fx * (out + forward) - fz * side, place.door[1] + fz * (out + forward) + fx * side];
  const street = Math.atan2(fx, fz);
  return [
    { exercise: "dumbbells", prop: "dumbbell-rack", propAt: at(-5.6, -0.9), propYaw: street, at: at(-5.6), yaw: street, lift: 0, motion: "idle", speed: 0 },
    { exercise: "bench", prop: "weight-bench", propAt: at(-2.8, -0.2), propYaw: street, at: at(-2.8), yaw: street, lift: 0, motion: "sit", speed: 0 },
    { exercise: "treadmill", prop: "treadmill", propAt: at(3.4), propYaw: street, at: at(3.4, -0.15), yaw: street + Math.PI, lift: 0.22, motion: "walk", speed: 3.2 },
  ];
}
