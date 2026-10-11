import { CLUB_LAYOUT, clubLocation, clubMenuById, CLUBS, type ClubStatus, lagosNight, lagosNightEndsAt, NIGHTLIFE, placeById } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, VENDOR_RANGE, withTransaction } from "./economy-service.js";
import { isNear } from "./player-presence.js";

export function clubPlace(placeId: string) {
  const place = placeById.get(placeId);
  const club = CLUBS[placeId];
  if (!place || place.kind !== "club" || !club) throw new EconomyError("That is not a club.", 404);
  return { place, club };
}

async function readStatus(client: PoolClient | typeof pool, userId: string, placeId: string, now: number): Promise<ClubStatus> {
  const result = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM club_entry WHERE user_id = $1 AND place_id = $2 AND lagos_night = $3::date) AS wristband,
       (SELECT COUNT(*)::INTEGER FROM club_entry WHERE user_id = $1 AND place_id = $2) AS nights`,
    [userId, placeId, lagosNight(now)],
  );
  return {
    placeId,
    wristband: Boolean(result.rows[0].wristband),
    validUntil: new Date(lagosNightEndsAt(now)).toISOString(),
    nights: result.rows[0].nights,
  };
}

export async function getClubStatus(userId: string, placeId: string) {
  clubPlace(placeId);
  return readStatus(pool, userId, placeId, Date.now());
}

export async function hasWristband(userId: string, placeId: string) {
  return (await readStatus(pool, userId, placeId, Date.now())).wristband;
}

/** Pays tonight's cover at the door. Buying again the same night charges nothing and returns the same wristband. */
export async function buyWristband(userId: string, placeId: string) {
  const { place, club } = clubPlace(placeId);
  if (!isNear(userId, place.door, VENDOR_RANGE)) throw new EconomyError(`Go to the door of ${place.name} on ${place.street} first.`, 409);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const now = Date.now();
    const night = lagosNight(now);
    const before = await readStatus(client, userId, placeId, now);
    if (before.wristband) {
      const wallet = await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
      return { charged: 0, balance: Number(wallet.rows[0].balance), status: before };
    }
    const balance = await debitWallet(client, userId, club.cover, "club_cover", `Cover · ${place.name}`, `club:${userId}:${placeId}:${night}`, { placeId });
    await client.query(
      `INSERT INTO club_entry (id, user_id, place_id, lagos_night, cover) VALUES ($1, $2, $3, $4::date, $5)`,
      [randomUUID(), userId, placeId, night, club.cover],
    );
    return { charged: club.cover, balance, status: await readStatus(client, userId, placeId, now) };
  });
}

/** Buys a drink or snack at the bar inside the club; repeating an idempotency key returns the first result. */
export async function orderAtBar(userId: string, placeId: string, itemId: string, idempotencyKey: string) {
  const { place } = clubPlace(placeId);
  const item = clubMenuById.get(itemId);
  if (!item) throw new EconomyError("The bar doesn't serve that.", 404);
  if (!isNear(userId, CLUB_LAYOUT.bar, NIGHTLIFE.barRange, clubLocation(placeId))) throw new EconomyError("Walk up to the bar to order.", 409);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await ensureProfile(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT item_id FROM club_order WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) {
      const [wallet, profile] = await Promise.all([
        client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]),
        client.query(`SELECT hunger, energy FROM player_profile WHERE user_id = $1`, [userId]),
      ]);
      return { replayed: true, item, balance: Number(wallet.rows[0].balance), needs: { hunger: Number(profile.rows[0].hunger), energy: Number(profile.rows[0].energy) } };
    }
    const balance = await debitWallet(client, userId, item.price, "club_order", `${item.name} · ${place.name}`, idempotencyKey, { placeId, itemId });
    await client.query(
      `INSERT INTO club_order (id, user_id, place_id, item_id, price, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, placeId, item.id, item.price, idempotencyKey],
    );
    const updated = await client.query(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW()
       WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, item.hunger, item.energy],
    );
    return { replayed: false, item, balance, needs: { hunger: Number(updated.rows[0].hunger), energy: Number(updated.rows[0].energy) } };
  });
}
