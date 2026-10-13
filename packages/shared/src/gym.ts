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
  /** A personal trainer for an hour: counts your reps, spots you one weight above your limit, and each set builds more. */
  trainer: { fee: 12_000, minutes: 60, gainBonus: 0.5, name: "Coach Tunde" },
  /** Seconds per rep on the lifts, so a 40-second set is ten reps. */
  repSeconds: 4,
} as const;

export const exerciseIds = ["treadmill", "bench", "squat", "dumbbells"] as const;
export type ExerciseId = (typeof exerciseIds)[number];
export const EXERCISES: Record<ExerciseId, { name: string; emoji: string; blurb: string; energy: number }> = {
  treadmill: { name: "Treadmill run", emoji: "🏃", blurb: "Cardio: 40 seconds at a steady pace. Hardest on your energy.", energy: 12 },
  bench: { name: "Bench press", emoji: "🏋️", blurb: "Chest and arms: lie back, lower the bar to your chest and press it up.", energy: 8 },
  squat: { name: "Barbell squat", emoji: "🦵", blurb: "Legs and core: bar across your back, sit down deep and drive up.", energy: 10 },
  dumbbells: { name: "Dumbbell curls", emoji: "💪", blurb: "Biceps: a dumbbell in each hand, curl up and lower slowly.", energy: 6 },
};

/**
 * Weights on the lifting machines. What you can safely lift grows with fitness, from `untrained` to `trained` kg, like
 * real training: you can't walk in and bench 140. A heavier set (closer to your limit) builds more and tires you more.
 */
const steps = (from: number, to: number, by: number) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, index) => from + index * by);
export const LIFTS: Partial<Record<ExerciseId, { unit: string; weights: readonly number[]; step: number; untrained: number; trained: number }>> = {
  bench: { unit: "kg on the bar", weights: steps(20, 160, 5), step: 5, untrained: 40, trained: 140 },
  squat: { unit: "kg on the bar", weights: steps(20, 200, 5), step: 5, untrained: 50, trained: 180 },
  dumbbells: { unit: "kg each hand", weights: steps(2, 40, 2), step: 2, untrained: 10, trained: 36 },
};

/**
 * The heaviest weight on offer you can lift at this fitness, or null for machines without weights. With a trainer
 * spotting you, one weight more.
 */
export function maxLiftKg(exercise: ExerciseId, fitness: number, spotted = false) {
  const lift = LIFTS[exercise];
  if (!lift) return null;
  const limit = lift.untrained + (lift.trained - lift.untrained) * Math.max(0, Math.min(1, fitness));
  let index = 0;
  lift.weights.forEach((kg, at) => {
    if (kg <= limit + 1e-9) index = at;
  });
  return lift.weights[Math.min(lift.weights.length - 1, index + (spotted ? 1 : 0))]!;
}

/** How hard a set is, 0..1 of your current limit; 1 for machines without weights. */
function effort(exercise: ExerciseId, fitness: number, kg?: number | null) {
  const max = maxLiftKg(exercise, fitness);
  if (max === null || !kg) return 1;
  return Math.max(0, Math.min(1, kg / max));
}

/** Fitness one finished set adds: the full gain at your limit, half for the lightest weights, more with a trainer. */
export function setGain(exercise: ExerciseId, fitness: number, kg?: number | null, coached = false) {
  return GYM.gainPerSet * (LIFTS[exercise] && kg ? 0.5 + 0.5 * Math.min(1, effort(exercise, fitness, kg)) : 1) * (coached ? 1 + GYM.trainer.gainBonus : 1);
}

/** Why this weight can't be lifted (not offered, or heavier than your training allows), or null when it can. */
export function liftProblem(exercise: ExerciseId, fitness: number, kg: number, spotted = false) {
  const lift = LIFTS[exercise];
  if (!lift) return null;
  if (!lift.weights.includes(kg)) return `Load the bar in ${lift.step} kg steps, from ${lift.weights[0]} to ${lift.weights[lift.weights.length - 1]} kg.`;
  const max = maxLiftKg(exercise, fitness, spotted)!;
  if (kg > max) return `${kg} kg is too heavy for you yet: you can lift up to ${max} kg${spotted ? " with your trainer spotting" : ""}. Keep training and your limit goes up.`;
  return null;
}

/** How much less tiring effort is at this fitness: 1 for an untrained body, down to `1 - staminaAtFullFitness`. */
export function staminaFactor(fitness: number) {
  return 1 - Math.max(0, Math.min(1, fitness)) * GYM.staminaAtFullFitness;
}

/** Energy one set of `exercise` costs at this fitness; with weights, a set near your limit costs the full amount and a light one less. */
export function setEnergyCost(exercise: ExerciseId, fitness: number, kg?: number | null) {
  const load = LIFTS[exercise] && kg ? 0.6 + 0.4 * effort(exercise, fitness, kg) : 1;
  return Math.max(1, Math.round(EXERCISES[exercise].energy * staminaFactor(fitness) * load));
}

export const gymLocation = (placeId: string = GYM.placeId) => `gym:${placeId}`;

/** The training floor inside iFitness, in metres from the interior origin; the entrance is on the front wall. */
export const GYM_ROOM = { halfX: 9, back: 11, height: 4.2 } as const;

export function insideGym(x: number, z: number) {
  return Math.abs(x) <= GYM_ROOM.halfX && z >= -INTERIOR_HALF[1] && z <= GYM_ROOM.back;
}

export const gymSetSchema = z.object({ exercise: z.enum(exerciseIds), kg: z.number().int().positive().max(500).optional() });

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
  /** When the personal trainer you hired goes home, or null without one. */
  trainerUntil: string | null;
  set: { exercise: ExerciseId; endsAt: string; kg: number | null } | null;
  /** Other residents at the gym right now. */
  peopleHere: string[];
};
