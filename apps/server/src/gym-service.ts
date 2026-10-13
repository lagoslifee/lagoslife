import type { Pool, PoolClient } from "pg";
import { EXERCISES, fitnessNow, GYM, gymLocation, liftProblem, LIFTS, maxLiftKg, setEnergyCost, setGain, venueOf, type ExerciseId, type GymStatus } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import { getPlayerPosition, usersIn } from "./player-presence.js";
import { profileEvents } from "./profile-service.js";

type GymRow = { fitness: number; trained_at: Date | null; gym_member_until: Date | null; gym_exercise: ExerciseId | null; gym_set_started_at: Date | null; gym_set_kg: number | null; energy: number };

/** Sets are only done inside on the machines, never out on the street. */
const atGym = (userId: string) => venueOf(getPlayerPosition(userId)?.location ?? "") === gymLocation();

async function gymRow(userId: string, lock = false, client: Pool | PoolClient = pool) {
  await client.query(`INSERT INTO player_profile (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  const { rows } = await client.query<GymRow>(
    `SELECT fitness, trained_at, gym_member_until, gym_exercise, gym_set_started_at, gym_set_kg, energy FROM player_profile WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0]!;
}

/** Current fitness (after fading) for building the avatar; 0 for anyone who has never trained. */
export async function loadFitness(userId: string) {
  const { rows } = await pool.query<{ fitness: number; trained_at: Date | null }>(`SELECT fitness, trained_at FROM player_profile WHERE user_id = $1`, [userId]);
  return rows[0] ? fitnessNow(rows[0].fitness, rows[0].trained_at) : 0;
}

/** When the trainer hired in the last hour goes home, or null. */
export async function trainerUntil(userId: string, client: Pool | PoolClient = pool) {
  const { rows } = await client.query<{ created_at: Date }>(
    `SELECT created_at FROM game_transaction WHERE user_id = $1 AND kind = 'personal_trainer' AND created_at > NOW() - make_interval(mins => $2) ORDER BY created_at DESC LIMIT 1`,
    [userId, GYM.trainer.minutes],
  );
  return rows[0] ? new Date(rows[0].created_at.getTime() + GYM.trainer.minutes * 60_000) : null;
}

/** Hires the trainer for an hour; members only, at the front desk inside. One already working for you is not charged again. */
export async function hireTrainer(userId: string, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const row = await gymRow(userId, true, client);
    if (!row.gym_member_until || row.gym_member_until.getTime() <= Date.now()) throw new EconomyError(`Join ${GYM.name} first; trainers only work with members.`, 403);
    if (!atGym(userId)) throw new EconomyError(`Come inside ${GYM.name} to meet your trainer.`, 409);
    const charged = (await trainerUntil(userId, client)) ? 0 : GYM.trainer.fee;
    if (charged) await debitWallet(client, userId, charged, "personal_trainer", `${GYM.trainer.name} · ${GYM.trainer.minutes}-minute session`, `trainer:${idempotencyKey}`);
    const balance = Number((await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]!.balance);
    return { charged, balance, trainerUntil: (await trainerUntil(userId, client))!.toISOString() };
  });
}

export async function gymStatus(userId: string): Promise<GymStatus> {
  const row = await gymRow(userId);
  const coach = await trainerUntil(userId);
  const here = getPlayerPosition(userId)?.location;
  const others = usersIn(here && venueOf(here) === gymLocation() ? here : gymLocation()).filter((id) => id !== userId);
  const names = others.length
    ? (await pool.query<{ name: string }>(`SELECT COALESCE("displayUsername", username, name) AS name FROM "user" WHERE id = ANY($1) ORDER BY 1 LIMIT 20`, [others])).rows.map((r) => r.name)
    : [];
  const live = row.gym_exercise && row.gym_set_started_at && Date.now() - row.gym_set_started_at.getTime() < GYM.setExpirySeconds * 1_000;
  return {
    fitness: fitnessNow(row.fitness, row.trained_at),
    energy: Math.round(Number(row.energy)),
    memberUntil: row.gym_member_until && row.gym_member_until.getTime() > Date.now() ? row.gym_member_until.toISOString() : null,
    trainerUntil: coach?.toISOString() ?? null,
    set: live ? { exercise: row.gym_exercise!, endsAt: new Date(row.gym_set_started_at!.getTime() + GYM.setSeconds * 1_000).toISOString(), kg: row.gym_set_kg } : null,
    peopleHere: names,
  };
}

/** Pays for 30 days, added on to any membership still running. */
export async function joinGym(userId: string, idempotencyKey: string) {
  const key = `gym:${idempotencyKey}`;
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT 1 FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    await gymRow(userId, true, client);
    const done = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, key]);
    if (!done.rowCount) {
      await debitWallet(client, userId, GYM.monthlyFee, "gym_membership", `${GYM.name} · ${GYM.membershipDays}-day membership`, key);
      await client.query(
        `UPDATE player_profile SET gym_member_until = GREATEST(COALESCE(gym_member_until, NOW()), NOW()) + make_interval(days => $2), updated_at = NOW() WHERE user_id = $1`,
        [userId, GYM.membershipDays],
      );
    }
    const balance = Number((await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0]!.balance);
    return { balance };
  });
}

/** Starts a timed set on one machine. Members only, inside the gym, with enough energy left, and a weight your training allows (the heaviest you can lift if none is given). */
export async function startSet(userId: string, exercise: ExerciseId, kg?: number) {
  return withTransaction(async (client) => {
    const row = await gymRow(userId, true, client);
    if (!row.gym_member_until || row.gym_member_until.getTime() <= Date.now()) {
      throw new EconomyError(`Members only. Join ${GYM.name} for ₦${GYM.monthlyFee.toLocaleString("en-NG")} a month.`, 403);
    }
    if (!atGym(userId)) throw new EconomyError(`Go inside ${GYM.name} on Admiralty Way to train.`, 409);
    const fitness = fitnessNow(row.fitness, row.trained_at);
    const spotted = Boolean(await trainerUntil(userId, client));
    const weight = LIFTS[exercise] ? (kg ?? maxLiftKg(exercise, fitness)!) : null;
    const tooHeavy = weight === null ? null : liftProblem(exercise, fitness, weight, spotted);
    if (tooHeavy) throw new EconomyError(tooHeavy, 409);
    const cost = setEnergyCost(exercise, fitness, weight);
    if (row.energy < Math.max(GYM.minimumEnergy, cost)) {
      throw new EconomyError(`You're too tired for that (${EXERCISES[exercise].name} needs ${cost} energy, you have ${row.energy}). Eat something or rest at home first.`, 409);
    }
    await client.query(`UPDATE player_profile SET gym_exercise = $2, gym_set_started_at = NOW(), gym_set_kg = $3, updated_at = NOW() WHERE user_id = $1`, [userId, exercise, weight]);
    return { exercise, kg: weight, endsAt: new Date(Date.now() + GYM.setSeconds * 1_000).toISOString(), name: EXERCISES[exercise].name };
  });
}

/** Counts a set once its time is up, if you stayed at the gym; tells the room so everyone sees the new build. */
export async function finishSet(userId: string) {
  const result = await withTransaction(async (client) => {
    const row = await gymRow(userId, true, client);
    if (!row.gym_exercise || !row.gym_set_started_at) throw new EconomyError("Start a set first.", 409);
    const elapsed = (Date.now() - row.gym_set_started_at.getTime()) / 1_000;
    if (elapsed < GYM.setSeconds - 1) throw new EconomyError(`Keep going: ${Math.ceil(GYM.setSeconds - elapsed)} seconds left in this set.`, 409);
    await client.query(`UPDATE player_profile SET gym_exercise = NULL, gym_set_started_at = NULL WHERE user_id = $1`, [userId]);
    if (elapsed > GYM.setExpirySeconds) return { counted: false as const, reason: "That set timed out. Start another." };
    if (!atGym(userId)) return { counted: false as const, reason: "You left the gym before the set was done." };
    const before = fitnessNow(row.fitness, row.trained_at);
    const coached = Boolean(await trainerUntil(userId, client));
    const fitness = Math.min(1, before + setGain(row.gym_exercise, before, row.gym_set_kg, coached));
    const cost = setEnergyCost(row.gym_exercise, before, row.gym_set_kg);
    const updated = await client.query<{ energy: number }>(
      `UPDATE player_profile SET fitness = $2, trained_at = NOW(), energy = GREATEST(0, energy - $3), updated_at = NOW() WHERE user_id = $1 RETURNING energy`,
      [userId, fitness, cost],
    );
    return { counted: true as const, fitness, energy: Number(updated.rows[0]!.energy), cost, kg: row.gym_set_kg, coached };
  });
  if (result.counted) profileEvents.emit("build", userId, result.fitness);
  return result;
}
