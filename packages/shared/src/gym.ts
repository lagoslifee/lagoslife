import { z } from "zod";

/**
 * iFitness Lekki (fictional), paid in game naira. Members train in timed sets on the equipment outside the gym; each
 * finished set raises fitness, which shapes the avatar from an ordinary build (0) to a fully trained one (1). Fitness
 * holds for a few days without training and then slowly fades.
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
  energyPerSet: 8,
  minimumEnergy: 10,
  /** Days without training before fitness starts to fade, and how much it fades each day after that. */
  graceDays: 3,
  fadePerDay: 0.03,
  /** Members train within this distance of the gym door, and count as "at the gym" for others. */
  nearMetres: 40,
} as const;

export const exerciseIds = ["treadmill", "bench", "dumbbells"] as const;
export type ExerciseId = (typeof exerciseIds)[number];
export const EXERCISES: Record<ExerciseId, { name: string; emoji: string; blurb: string }> = {
  treadmill: { name: "Treadmill run", emoji: "🏃", blurb: "Cardio: 40 seconds at a steady pace." },
  bench: { name: "Bench press", emoji: "🏋️", blurb: "Chest and arms: one heavy set." },
  dumbbells: { name: "Dumbbell curls", emoji: "💪", blurb: "Arms and shoulders: one set." },
};

export const gymSetSchema = z.object({ exercise: z.enum(exerciseIds) });

/** Fitness after fading for the days since the last set. */
export function fitnessNow(fitness: number, trainedAt: Date | null, now = Date.now()) {
  if (!trainedAt) return fitness;
  const idleDays = (now - trainedAt.getTime()) / 86_400_000 - GYM.graceDays;
  return Math.max(0, Math.min(1, fitness - Math.max(0, idleDays) * GYM.fadePerDay));
}

export type GymStatus = {
  fitness: number;
  memberUntil: string | null;
  set: { exercise: ExerciseId; endsAt: string } | null;
  /** Other residents at the gym right now. */
  peopleHere: string[];
};
