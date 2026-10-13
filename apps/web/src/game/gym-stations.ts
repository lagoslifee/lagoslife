import { INTERIOR_ORIGIN, type ExerciseId, type Vec2 } from "@lagos-living/shared";
import type { Workout } from "./avatar";
import { PRESS_BENCH, pressBenchParts, turned } from "./gym-gear";
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
  /** Where the member stands, sits or runs during a set, the way they face, and how high off the floor. */
  at: Vec2;
  yaw: number;
  lift: number;
  motion: "walk" | "sit" | "idle";
  speed: number;
  /** Where to stand to pick this machine. */
  spot: Vec2;
  /** On the back along the bench (the bench press), rather than upright. */
  lying?: boolean;
  /** The bar or dumbbells used, and for a bar where it waits on the hooks between sets. */
  gear?: "barbell" | "dumbbells";
  racked?: { x: number; y: number; z: number; yaw: number };
};

/** A regular training on their own: what they do and how, so the floor is never empty. */
export type GymRegular = { at: Vec2; yaw: number; lift: number; motion: "walk" | "sit" | "idle"; speed: number; workout: Workout | "bike" | "stretch"; seed: number; lying?: boolean; gear?: { kind: "barbell" | "dumbbells"; kg: number } };

const TREADMILL_Z = 9.0;
const treadmill = (x: number): GymMachine => ({ prop: "treadmill", at: world(x, TREADMILL_Z), yaw: Math.PI, size: [1.44, 1.27, 1.9], color: [0.12, 0.12, 0.13] });
const bike = (x: number): GymMachine => ({ prop: "exercise-bike", at: world(x, TREADMILL_Z - 0.2), yaw: Math.PI / 2, size: [1.26, 1.61, 0.76], color: [0.14, 0.14, 0.15] });
const racks = {
  dumbbells: { prop: "dumbbell-rack", at: world(8.3, -2.4), yaw: -Math.PI / 2, size: [1.5, 1.13, 0.82], color: [0.16, 0.16, 0.17] },
  squat: { prop: "squat-rack", at: world(7.6, 6.3), yaw: -Math.PI / 2, size: [1.28, 1.7, 1.9], color: [0.12, 0.12, 0.13] },
} satisfies Record<string, GymMachine>;

/** Treadmill runners face the mirrors on the back wall, a little forward of the belt's middle and up on the deck. */
function runnerOn(machine: GymMachine): Pick<GymStation, "at" | "yaw" | "lift" | "motion" | "speed"> {
  return { at: [machine.at[0], machine.at[1] + 0.15], yaw: 0, lift: 0.22, motion: "walk", speed: 3.2 };
}

/** Flat benches with uprights against the right wall: the head end (and the hooks) toward the wall, feet into the room. */
export const PRESS_BENCHES: Array<{ at: Vec2; yaw: number }> = [
  { at: world(6.6, 2.6), yaw: -Math.PI / 2 },
  { at: world(6.6, -0.2), yaw: -Math.PI / 2 },
];
const benchPoint = (bench: { at: Vec2; yaw: number }, localX: number, localZ: number) => turned(bench.at[0], bench.at[1], bench.yaw, localX, localZ);
/** Lying on a press bench: the lifter's root, so the shoulders rest by the hooks and the feet reach the floor. */
function benchLifter(bench: { at: Vec2; yaw: number }): Pick<GymStation, "at" | "yaw" | "lift" | "motion" | "speed" | "lying"> {
  return { at: benchPoint(bench, 0, PRESS_BENCH.lifter.z), yaw: bench.yaw, lift: PRESS_BENCH.lifter.y, motion: "idle", speed: 0, lying: true };
}
/** The press bench frames as boxes in the gym, for the room to merge into its geometry. */
export function pressBenchBoxes() {
  return PRESS_BENCHES.flatMap((bench) =>
    pressBenchParts().map((part) => ({ ...part, world: benchPoint(bench, part.at[0], part.at[2]), yaw: bench.yaw })),
  );
}
/** What you bump into on a press bench: the pad and the uprights. */
export function pressBenchFootprints() {
  return PRESS_BENCHES.map((bench) => {
    const [x, z] = benchPoint(bench, 0, -0.05);
    const swap = Math.abs(Math.sin(bench.yaw)) > 0.7;
    return { x, z, hx: swap ? 0.62 : 0.55, hz: swap ? 0.55 : 0.62 };
  });
}
const TREADMILLS = [-7.6, -5.4, -3.2, -1.0].map(treadmill);
const BIKES = [1.4, 3.0].map(bike);

/** The machines the player trains on: the third treadmill, the bench nearest the door, the squat rack and the dumbbell rack. */
export function gymStations(): GymStation[] {
  const run = TREADMILLS[2]!;
  const press = PRESS_BENCHES[1]!;
  const [hookX, hookZ] = benchPoint(press, 0, PRESS_BENCH.rack.z);
  return [
    { exercise: "treadmill", ...runnerOn(run), spot: [run.at[0], run.at[1] - 1.5] },
    {
      exercise: "bench",
      ...benchLifter(press),
      spot: benchPoint(press, 0.75, 1.1),
      gear: "barbell",
      racked: { x: hookX, y: PRESS_BENCH.rack.y, z: hookZ, yaw: press.yaw },
    },
    { exercise: "squat", at: [racks.squat.at[0] - 0.2, racks.squat.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "idle", speed: 0, spot: [racks.squat.at[0] - 1.6, racks.squat.at[1]], gear: "barbell" },
    { exercise: "dumbbells", at: [racks.dumbbells.at[0] - 0.95, racks.dumbbells.at[1]], yaw: -Math.PI / 2, lift: 0, motion: "idle", speed: 0, spot: [racks.dumbbells.at[0] - 1.9, racks.dumbbells.at[1]], gear: "dumbbells" },
  ];
}

/** Every Meshy machine on the floor (the press benches are built from boxes, see `pressBenchBoxes`). */
export function gymMachines(): GymMachine[] {
  return [...TREADMILLS, ...BIKES, racks.dumbbells, racks.squat];
}

/** Members already training when you walk in: runners either side of yours, two on the bikes, one benching, one curling, one stretching. */
export function gymRegulars(): GymRegular[] {
  const [first, second, , fourth] = TREADMILLS;
  const [left, right] = BIKES;
  return [
    { ...runnerOn(first!), workout: "treadmill", seed: 301 },
    { ...runnerOn(second!), speed: 2.2, workout: "treadmill", seed: 302 },
    { ...runnerOn(fourth!), speed: 3.8, workout: "treadmill", seed: 303 },
    { at: left!.at, yaw: 0, lift: 0.82, motion: "sit", speed: 0, workout: "bike", seed: 304 },
    { at: right!.at, yaw: 0, lift: 0.82, motion: "sit", speed: 0, workout: "bike", seed: 305 },
    { ...benchLifter(PRESS_BENCHES[0]!), workout: "bench", seed: 306, gear: { kind: "barbell", kg: 80 } },
    { at: world(6.6, -3.8), yaw: -Math.PI / 2, lift: 0, motion: "idle", speed: 0, workout: "dumbbells", seed: 307, gear: { kind: "dumbbells", kg: 14 } },
    { at: world(-1.5, 3.2), yaw: Math.PI / 4, lift: 0, motion: "idle", speed: 0, workout: "stretch", seed: 308 },
  ];
}

/** Behind the front desk, facing the way in. */
export const GYM_RECEPTION = { desk: world(-5.6, -2.4), staff: world(-6.5, -2.4), spot: world(-4.4, -2.4) } as const;
