import { REST, restGain, type RestResult } from "@lagos-living/shared";
import { pool } from "./database.js";
import { EconomyError, ensureProfile, withTransaction } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";

/** Sitting down or lying on the bed starts the clock. */
export async function startRest(userId: string) {
  const position = getPlayerPosition(userId);
  if (!position || !REST.locations.test(position.location)) throw new EconomyError("Rest inside your home or hotel room.");
  await ensureProfile(pool, userId);
  await pool.query(`UPDATE player_profile SET rest_started_at = NOW(), rest_location = $2 WHERE user_id = $1`, [userId, position.location]);
  return { started: true };
}

/** Standing up pays out the rest, as long as the player is still in the room they sat down in. */
export async function finishRest(userId: string): Promise<RestResult> {
  const here = getPlayerPosition(userId)?.location ?? null;
  return withTransaction(async (client) => {
    await ensureProfile(client, userId);
    const { rows } = await client.query<{ seconds: number | null; rest_location: string | null; energy: number; hunger: number }>(
      `SELECT EXTRACT(EPOCH FROM NOW() - rest_started_at)::float AS seconds, rest_location, energy, hunger
       FROM player_profile WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const rest = rows[0]!;
    const earned = rest.seconds != null && rest.rest_location === here ? restGain(rest.seconds) : 0;
    const energy = Math.min(100, Number(rest.energy) + earned);
    await client.query(
      `UPDATE player_profile SET energy = $2, rest_started_at = NULL, rest_location = NULL, updated_at = NOW() WHERE user_id = $1`,
      [userId, energy],
    );
    return { gained: energy - Number(rest.energy), hunger: Number(rest.hunger), energy };
  });
}
