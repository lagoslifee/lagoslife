import { INTERIOR_ORIGIN, type ExerciseId, type Vec2 } from "@lagos-living/shared";
import type { Workout } from "./avatar";
import type { PropId } from "./props";

const [OX, OZ] = INTERIOR_ORIGIN;
const world = (x: number, z: number): Vec2 => [OX + x, OZ + z];

/**
 * One machine on the iFitness floor. `size` is width (along the model's x), height and depth: the box drawn when the
 * model hasn't loaded, and what you bump into. Models face +Z, so `yaw` turns their front.
 */
export type GymMachine = { prop: PropId; at: Vec2; yaw: number; size: [number, number, number]; color: [number, number, number] };

export type GymStation = {
  exercise: ExerciseId;
  machine: GymMachine;
  /** Where the member stands, sits or runs during a set, the way they face, and how high off the floor. */
  at: Vec2;
  yaw: number;
  lift: number;
  motion: "walk" | "sit" | "idle";
  speed: number;
  /** Where to stand to pick this machine. */
  spot: Vec2;
};

/** A regular training on their own: what they do and how, so the floor is never empty. */
export type GymRegular = { at: Vec2; yaw: number; lift: number; motion: "walk" | "sit" | "idle"; speed: number; workout: Workout | "bike" | "stretch"; seed: number };

const TREADMILL_Z = 9.0;
const treadmill = (x: number): GymMachine => ({ prop: "treadmill", at: world(x, TREADMILL_Z), yaw: Math.PI, size: [1.44, 1.27, 1.9], color: [0.12, 0.12, 0.13] });
const bike = (x: number): GymMachine => ({ prop: "exercise-bike", at: world(x, TREADMILL_Z - 0.2), yaw: Math.PI / 2, size: [1.26, 1.61, 0.76], color: [0.14, 0.14, 0.15] });
const bench = (x: number, z: number): GymMachine => ({ prop: "weight-bench", at: world(x, z), yaw: -Math.PI / 2, size: [2.1, 1.25, 0.78], color: [0.1, 0.1, 0.11] });
const racks = {
  dumbbells: { prop: "dumbbell-rack", at: world(8.3, -2.4), yaw: -Math.PI / 2, size: [1.5, 1.13, 0.82], color: [0.16, 0.16, 0.17] },
  squat: { prop: "squat-rack", at: world(7.6, 6.3), yaw: -Math.PI / 2, size: [1.28, 1.7, 1.9], color: [0.12, 0.12, 0.13] },
} satisfies Record<string, GymMachine>;

/** Treadmill runners face the mirrors on the back wall, a little forward of the belt's middle and up on the deck. */
function runnerOn(machine: GymMachine): Pick<GymStation, "at" | "yaw" | "lift" | "motion" | "speed"> {
  return { at: [machine.at[0], machine.at[1] + 0.15], yaw: 0, lift: 0.22, motion: "walk", speed: 3.2 };
}

const BENCHES = [bench(6.0, 2.6), bench(6.0, -0.2)];
const TREADMILLS = [-7.6, -5.4, -3.2, -1.0].map(treadmill);
const BIKES = [1.4, 3.0].map(bike);

/** The machines the player trains on: the third treadmill, the bench nearest the door, and the dumbbell rack. */
export function gymStations(): GymStation[] {
  const run = TREADMILLS[2]!;
  const press = BENCHES[1]!;
  return [
    { exercise: "treadmill", machine: run, ...runnerOn(run), spot: [run.at[0], run.at[1] - 1.5] },
    { exercise: "bench", machine: press, at: [press.at[0] - 0.2, press.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "sit", speed: 0, spot: [press.at[0] - 1.3, press.at[1]] },
    { exercise: "dumbbells", machine: racks.dumbbells, at: [racks.dumbbells.at[0] - 0.95, racks.dumbbells.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "idle", speed: 0, spot: [racks.dumbbells.at[0] - 1.9, racks.dumbbells.at[1]] },
  ];
}

/** Everything on the floor, the player's stations included. */
export function gymMachines(): GymMachine[] {
  return [...TREADMILLS, ...BIKES, ...BENCHES, racks.dumbbells, racks.squat];
}

/** Members already training when you walk in: runners either side of yours, two on the bikes, one benching, one in the rack, one stretching. */
export function gymRegulars(): GymRegular[] {
  const [first, second, , fourth] = TREADMILLS;
  const [left, right] = BIKES;
  return [
    { ...runnerOn(first!), workout: "treadmill", seed: 301 },
    { ...runnerOn(second!), speed: 2.2, workout: "treadmill", seed: 302 },
    { ...runnerOn(fourth!), speed: 3.8, workout: "treadmill", seed: 303 },
    { at: left!.at, yaw: 0, lift: 0.82, motion: "sit", speed: 0, workout: "bike", seed: 304 },
    { at: right!.at, yaw: 0, lift: 0.82, motion: "sit", speed: 0, workout: "bike", seed: 305 },
    { at: [BENCHES[0]!.at[0] - 0.2, BENCHES[0]!.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "sit", speed: 0, workout: "bench", seed: 306 },
    { at: [racks.squat.at[0] - 0.2, racks.squat.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "idle", speed: 0, workout: "bench", seed: 307 },
    { at: world(-1.5, 3.2), yaw: Math.PI / 4, lift: 0, motion: "idle", speed: 0, workout: "stretch", seed: 308 },
  ];
}

/** Behind the front desk, facing the way in. */
export const GYM_RECEPTION = { desk: world(-5.6, -2.4), staff: world(-6.5, -2.4), spot: world(-4.4, -2.4) } as const;
