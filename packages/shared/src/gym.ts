import { z } from "zod";
import { INTERIOR_HALF } from "./world.js";

/**
 * iFitness Lekki (fictional), paid in game naira. Members go inside and train in timed sets on the machines; each
 * finished set raises fitness, which shapes the avatar from an ordinary build (0) to a fully trained one (1). Fitness
 * holds for a few days without training and then slowly fades. Training costs energy, and the fitter you are the less
 * each set (and each shift at work) takes out of you.
 */
export const GYM = {
  placeId: "ifitness-lekki",
  name: "iFitness Lekki",
  monthlyFee: 25_000,
  membershipDays: 30,
  /** How long one set takes, in real seconds. */
  setSeconds: 40,
  /** A set must be finished within this long of starting or it doesn't count. */
  setExpirySeconds: 180,
  gainPerSet: 0.04,
  minimumEnergy: 10,
  /** At full fitness a set (or a work shift) costs this share less energy than for an untrained body. */
  staminaAtFullFitness: 0.5,
  /** Days without training before fitness starts to fade, and how much it fades each day after that. */
  graceDays: 3,
  fadePerDay: 0.03,
  /** Members train within this distance of the gym door, and count as "at the gym" for others. */
  nearMetres: 40,
} as const;

export const exerciseIds = ["treadmill", "bench", "dumbbells"] as const;
export type ExerciseId = (typeof exerciseIds)[number];
export const EXERCISES: Record<ExerciseId, { name: string; emoji: string; blurb: string; energy: number }> = {
  treadmill: { name: "Treadmill run", emoji: "🏃", blurb: "Cardio: 40 seconds at a steady pace. Hardest on your energy.", energy: 12 },
  bench: { name: "Bench press", emoji: "🏋️", blurb: "Chest and arms: one heavy set.", energy: 8 },
  dumbbells: { name: "Dumbbell curls", emoji: "💪", blurb: "Arms and shoulders: one set.", energy: 6 },
};

/** How much less tiring effort is at this fitness: 1 for an untrained body, down to `1 - staminaAtFullFitness`. */
export function staminaFactor(fitness: number) {
  return 1 - Math.max(0, Math.min(1, fitness)) * GYM.staminaAtFullFitness;
}

/** Energy one set of `exercise` costs at this fitness. */
export function setEnergyCost(exercise: ExerciseId, fitness: number) {
  return Math.max(1, Math.round(EXERCISES[exercise].energy * staminaFactor(fitness)));
}

export const gymLocation = (placeId: string = GYM.placeId) => `gym:${placeId}`;

/** The training floor inside iFitness, in metres from the interior origin; the entrance is on the front wall. */
export const GYM_ROOM = { halfX: 9, back: 11, height: 4.2 } as const;

export function insideGym(x: number, z: number) {
  return Math.abs(x) <= GYM_ROOM.halfX && z >= -INTERIOR_HALF[1] && z <= GYM_ROOM.back;
}

export const gymSetSchema = z.object({ exercise: z.enum(exerciseIds) });

/** Fitness after fading for the days since the last set. */
export function fitnessNow(fitness: number, trainedAt: Date | null, now = Date.now()) {
  if (!trainedAt) return fitness;
  const idleDays = (now - trainedAt.getTime()) / 86_400_000 - GYM.graceDays;
  return Math.max(0, Math.min(1, fitness - Math.max(0, idleDays) * GYM.fadePerDay));
}

export type GymStatus = {
  fitness: number;
  energy: number;
  memberUntil: string | null;
  set: { exercise: ExerciseId; endsAt: string } | null;
  /** Other residents at the gym right now. */
  peopleHere: string[];
};
