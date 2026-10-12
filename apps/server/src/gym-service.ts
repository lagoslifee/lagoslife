import type { Pool, PoolClient } from "pg";
import { EXERCISES, fitnessNow, getPlace, GYM, type ExerciseId, type GymStatus } from "@lagos-living/shared";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";
import { isNear, usersNear } from "./player-presence.js";
import { profileEvents } from "./profile-service.js";

type GymRow = { fitness: number; trained_at: Date | null; gym_member_until: Date | null; gym_exercise: ExerciseId | null; gym_set_started_at: Date | null; energy: number };

const gymDoor = () => getPlace(GYM.placeId).door;

async function gymRow(userId: string, lock = false, client: Pool | PoolClient = pool) {
  await client.query(`INSERT INTO player_profile (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  const { rows } = await client.query<GymRow>(
    `SELECT fitness, trained_at, gym_member_until, gym_exercise, gym_set_started_at, energy FROM player_profile WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0]!;
}

/** Current fitness (after fading) for building the avatar; 0 for anyone who has never trained. */
export async function loadFitness(userId: string) {
  const { rows } = await pool.query<{ fitness: number; trained_at: Date | null }>(`SELECT fitness, trained_at FROM player_profile WHERE user_id = $1`, [userId]);
  return rows[0] ? fitnessNow(rows[0].fitness, rows[0].trained_at) : 0;
}

export async function gymStatus(userId: string): Promise<GymStatus> {
  const row = await gymRow(userId);
  const others = usersNear(gymDoor(), GYM.nearMetres).filter((id) => id !== userId);
  const names = others.length
    ? (await pool.query<{ name: string }>(`SELECT COALESCE("displayUsername", username, name) AS name FROM "user" WHERE id = ANY($1) ORDER BY 1 LIMIT 20`, [others])).rows.map((r) => r.name)
    : [];
  const live = row.gym_exercise && row.gym_set_started_at && Date.now() - row.gym_set_started_at.getTime() < GYM.setExpirySeconds * 1_000;
  return {
    fitness: fitnessNow(row.fitness, row.trained_at),
    memberUntil: row.gym_member_until && row.gym_member_until.getTime() > Date.now() ? row.gym_member_until.toISOString() : null,
    set: live ? { exercise: row.gym_exercise!, endsAt: new Date(row.gym_set_started_at!.getTime() + GYM.setSeconds * 1_000).toISOString() } : null,
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

/** Starts a timed set on one machine. Members only, at the gym, with enough energy left. */
export async function startSet(userId: string, exercise: ExerciseId) {
  return withTransaction(async (client) => {
    const row = await gymRow(userId, true, client);
    if (!row.gym_member_until || row.gym_member_until.getTime() <= Date.now()) {
      throw new EconomyError(`Members only. Join ${GYM.name} for ₦${GYM.monthlyFee.toLocaleString("en-NG")} a month.`, 403);
    }
    if (!isNear(userId, gymDoor(), GYM.nearMetres)) throw new EconomyError(`Go to ${GYM.name} on Admiralty Way to train.`, 409);
    if (row.energy < GYM.minimumEnergy) throw new EconomyError("You're too tired to train. Eat something or rest at home first.", 409);
    await client.query(`UPDATE player_profile SET gym_exercise = $2, gym_set_started_at = NOW(), updated_at = NOW() WHERE user_id = $1`, [userId, exercise]);
    return { exercise, endsAt: new Date(Date.now() + GYM.setSeconds * 1_000).toISOString(), name: EXERCISES[exercise].name };
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
    if (!isNear(userId, gymDoor(), GYM.nearMetres)) return { counted: false as const, reason: "You left the gym before the set was done." };
    const fitness = Math.min(1, fitnessNow(row.fitness, row.trained_at) + GYM.gainPerSet);
    const updated = await client.query<{ energy: number }>(
      `UPDATE player_profile SET fitness = $2, trained_at = NOW(), energy = GREATEST(0, energy - $3), updated_at = NOW() WHERE user_id = $1 RETURNING energy`,
      [userId, fitness, GYM.energyPerSet],
    );
    return { counted: true as const, fitness, energy: Number(updated.rows[0]!.energy) };
  });
  if (result.counted) profileEvents.emit("build", userId, result.fitness);
  return result;
}
