import { COMMUNITY, GYM, type CommunityStatus, lagosDay, placeById, QUIET_PLACE_KINDS, type QuietPlaceKind } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { creditWallet, EconomyError, ensureProfile, ensureWallet, VENDOR_RANGE, withTransaction } from "./economy-service.js";
import { isNear } from "./player-presence.js";

const KERB_RANGE = 3;

function communityPlace(placeId: string, kinds: readonly string[]) {
  const place = placeById.get(placeId);
  if (!place || !kinds.includes(place.kind)) throw new EconomyError("That is not a community venue.", 404);
  return place;
}

function requireAtVenue(userId: string, place: { name: string; street: string; door: readonly [number, number]; kerb: readonly [number, number] }) {
  if (!isNear(userId, place.door, VENDOR_RANGE) && !isNear(userId, place.kerb, KERB_RANGE)) {
    throw new EconomyError(`Go to ${place.name} on ${place.street} first.`, 409);
  }
}

async function readStatus(client: PoolClient | typeof pool, userId: string, now: number): Promise<CommunityStatus> {
  const result = await client.query(
    `SELECT
       (SELECT MAX(created_at) FROM community_visit WHERE user_id = $1 AND kind = 'quiet' AND rested) AS "lastRestful",
       (SELECT place_id FROM community_visit WHERE user_id = $1 AND kind = 'quiet' ORDER BY created_at DESC LIMIT 1) AS "lastQuietPlaceId",
       (SELECT COUNT(*)::INTEGER FROM community_visit WHERE user_id = $1 AND kind = 'quiet') AS "quietVisits",
       (SELECT COUNT(*)::INTEGER FROM community_visit WHERE user_id = $1 AND kind = 'volunteer') AS "volunteerDays",
       EXISTS (SELECT 1 FROM community_visit WHERE user_id = $1 AND kind = 'volunteer' AND lagos_day = $2::date) AS "volunteeredToday"`,
    [userId, lagosDay(now)],
  );
  const row = result.rows[0];
  const readyAt = row.lastRestful ? new Date(row.lastRestful).getTime() + COMMUNITY.quietVisitCooldownMs : 0;
  return {
    quietReadyAt: readyAt > now ? new Date(readyAt).toISOString() : null,
    lastQuietPlaceId: row.lastQuietPlaceId ?? null,
    volunteeredToday: Boolean(row.volunteeredToday),
    volunteerDays: row.volunteerDays,
    quietVisits: row.quietVisits,
  };
}

export function getCommunityStatus(userId: string) {
  return readStatus(pool, userId, Date.now());
}

/**
 * Spend some quiet time at a library, park or place of worship. Every quiet place gives the same energy on one
 * shared cooldown; visiting during the cooldown is still recorded (and allowed) but gives nothing extra.
 */
export async function visitQuietPlace(userId: string, placeId: string) {
  const place = communityPlace(placeId, QUIET_PLACE_KINDS);
  requireAtVenue(userId, place);
  return withTransaction(async (client) => {
    await ensureProfile(client, userId);
    const profile = await client.query(`SELECT energy FROM player_profile WHERE user_id = $1 FOR UPDATE`, [userId]);
    const now = Date.now();
    const before = await readStatus(client, userId, now);
    const energyBefore = Number(profile.rows[0].energy);
    const gain = before.quietReadyAt ? 0 : Math.min(COMMUNITY.quietVisitEnergy, 100 - energyBefore);
    const rested = !before.quietReadyAt;
    const updated = await client.query(
      `UPDATE player_profile SET energy = LEAST(100, energy + $2), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, gain],
    );
    await client.query(
      `INSERT INTO community_visit (id, user_id, place_id, kind, lagos_day, energy_delta, rested)
       VALUES ($1, $2, $3, 'quiet', $4::date, $5, $6)`,
      [randomUUID(), userId, place.id, lagosDay(now), gain, rested],
    );
    return {
      place: { id: place.id, name: place.name, kind: place.kind as QuietPlaceKind },
      rested,
      energyGain: gain,
      needs: { hunger: Number(updated.rows[0].hunger), energy: Number(updated.rows[0].energy) },
      status: await readStatus(client, userId, now),
    };
  });
}

/** One paid volunteer shift at the community hall per Lagos calendar day; repeats return the first result. */
export async function volunteerShift(userId: string, placeId: string) {
  const place = communityPlace(placeId, ["community"]);
  requireAtVenue(userId, place);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await ensureProfile(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const profile = await client.query(`SELECT hunger, energy FROM player_profile WHERE user_id = $1 FOR UPDATE`, [userId]);
    const now = Date.now();
    const day = lagosDay(now);
    const existing = await client.query(
      `SELECT wage FROM community_visit WHERE user_id = $1 AND kind = 'volunteer' AND lagos_day = $2::date`,
      [userId, day],
    );
    if (existing.rowCount) {
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      return {
        replayed: true,
        wage: 0,
        balance: Number(wallet.rows[0].balance),
        needs: { hunger: Number(profile.rows[0].hunger), energy: Number(profile.rows[0].energy) },
        status: await readStatus(client, userId, now),
      };
    }
    if (Number(profile.rows[0].energy) < COMMUNITY.volunteerMinimumEnergy) {
      throw new EconomyError("You are too tired to volunteer. Rest first.", 409);
    }
    await client.query(
      `INSERT INTO community_visit (id, user_id, place_id, kind, lagos_day, energy_delta, wage)
       VALUES ($1, $2, $3, 'volunteer', $4::date, $5, $6)`,
      [randomUUID(), userId, place.id, day, -COMMUNITY.volunteerEnergyCost, COMMUNITY.volunteerWage],
    );
    const balance = await creditWallet(
      client,
      userId,
      COMMUNITY.volunteerWage,
      "community_wage",
      `Volunteer shift · ${place.name}`,
      `volunteer:${userId}:${day}`,
    );
    const updated = await client.query(
      `UPDATE player_profile
       SET energy = GREATEST(0, energy - ROUND($2 * (1 - LEAST(1, GREATEST(0, fitness)) * $4))), hunger = GREATEST(0, hunger - $3), updated_at = NOW()
       WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, COMMUNITY.volunteerEnergyCost, COMMUNITY.volunteerHungerCost, GYM.staminaAtFullFitness],
    );
    return {
      replayed: false,
      wage: COMMUNITY.volunteerWage,
      balance,
      needs: { hunger: Number(updated.rows[0].hunger), energy: Number(updated.rows[0].energy) },
      status: await readStatus(client, userId, now),
    };
  });
}
