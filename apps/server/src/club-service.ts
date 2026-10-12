import {
  bottleById,
  CLUB_LAYOUT,
  CLUB_TABLES,
  clubLocation,
  clubMenuById,
  CLUBS,
  type ClubStatus,
  type ClubTable,
  lagosNight,
  lagosNightEndsAt,
  NIGHTLIFE,
  placeById,
  TABLE_BOTTLES_SHOWN,
  TABLE_GUESTS_MAX,
} from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { debitWallet, EconomyError, ensureProfile, ensureWallet, VENDOR_RANGE, withTransaction } from "./economy-service.js";
import { getPlayerPosition, isNear } from "./player-presence.js";
import { findResident, hiddenPlayers } from "./safety-service.js";

/** How close to a table's standing spot a resident must be to book it or order to it. */
const TABLE_RANGE = 3;

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

function tableSpec(no: number) {
  const table = CLUB_TABLES.find((entry) => entry.no === no);
  if (!table) throw new EconomyError("That table doesn't exist.", 404);
  return table;
}

const NAME = `COALESCE(u."displayUsername", u.username, u.name)`;

/** Tonight's VIP tables in a club, as `userId` sees them. */
export async function listTables(userId: string, placeId: string, db: PoolClient | typeof pool = pool): Promise<ClubTable[]> {
  clubPlace(placeId);
  const night = lagosNight(Date.now());
  const bookings = await db.query(
    `SELECT b.id, b.table_no, b.owner_user_id, ${NAME} AS owner_name
     FROM club_table_booking b JOIN "user" u ON u.id = b.owner_user_id
     WHERE b.place_id = $1 AND b.lagos_night = $2::date`,
    [placeId, night],
  );
  const ids = bookings.rows.map((row) => String(row.id));
  const [guests, bottles] = await Promise.all([
    db.query(`SELECT g.booking_id, g.user_id, ${NAME} AS name FROM club_table_guest g JOIN "user" u ON u.id = g.user_id WHERE g.booking_id = ANY($1) ORDER BY g.created_at`, [ids]),
    db.query(
      `SELECT * FROM (
         SELECT o.id, o.booking_id, o.item_id, o.created_at, ${NAME} AS by_name,
                ROW_NUMBER() OVER (PARTITION BY o.booking_id ORDER BY o.created_at DESC) AS recent
         FROM club_bottle_order o JOIN "user" u ON u.id = o.user_id WHERE o.booking_id = ANY($1)
       ) ranked WHERE recent <= $2 ORDER BY created_at`,
      [ids, TABLE_BOTTLES_SHOWN],
    ),
  ]);
  return CLUB_TABLES.map(({ no }) => {
    const booking = bookings.rows.find((row) => Number(row.table_no) === no);
    if (!booking) return { no, ownerName: null, mine: false, guest: false, guests: [], bottles: [] };
    const mine = String(booking.owner_user_id) === userId;
    const tableGuests = guests.rows.filter((row) => row.booking_id === booking.id);
    return {
      no,
      ownerName: String(booking.owner_name),
      mine,
      guest: tableGuests.some((row) => String(row.user_id) === userId),
      guests: tableGuests.map((row) => String(row.name)),
      bottles: bottles.rows
        .filter((row) => row.booking_id === booking.id)
        .map((row) => ({ id: String(row.id), itemId: String(row.item_id), byName: String(row.by_name), at: new Date(row.created_at).toISOString() })),
    };
  });
}

async function bookingFor(client: PoolClient, placeId: string, no: number) {
  const result = await client.query(
    `SELECT id, owner_user_id FROM club_table_booking WHERE place_id = $1 AND lagos_night = $2::date AND table_no = $3 FOR UPDATE`,
    [placeId, lagosNight(Date.now()), no],
  );
  return result.rows[0] ? { id: String(result.rows[0].id), ownerId: String(result.rows[0].owner_user_id) } : null;
}

/** Books a free VIP table for tonight. Needs tonight's wristband and the resident standing at the table. */
export async function bookTable(userId: string, placeId: string, no: number) {
  const { place, club } = clubPlace(placeId);
  const table = tableSpec(no);
  if (!(await hasWristband(userId, placeId))) throw new EconomyError("Pay the cover at the door first.", 409);
  if (!isNear(userId, table.spot, TABLE_RANGE, clubLocation(placeId))) throw new EconomyError("Walk over to the table first.", 409);
  const night = lagosNight(Date.now());
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const existing = await bookingFor(client, placeId, no);
    if (existing) {
      if (existing.ownerId === userId) return { charged: 0, tables: await listTables(userId, placeId, client) };
      throw new EconomyError("Someone has already booked that table tonight.", 409);
    }
    const own = await client.query(`SELECT table_no FROM club_table_booking WHERE owner_user_id = $1 AND place_id = $2 AND lagos_night = $3::date`, [userId, placeId, night]);
    if (own.rowCount) throw new EconomyError(`You already have table ${own.rows[0].table_no} tonight.`, 409);
    const balance = await debitWallet(client, userId, club.tablePrice, "club_table", `VIP table ${no} · ${place.name}`, `club-table:${userId}:${placeId}:${night}`, { placeId, table: no });
    await client.query(
      `INSERT INTO club_table_booking (id, place_id, lagos_night, table_no, owner_user_id, price) VALUES ($1, $2, $3::date, $4, $5, $6)`,
      [randomUUID(), placeId, night, no, userId, club.tablePrice],
    );
    return { charged: club.tablePrice, balance, tables: await listTables(userId, placeId, client) };
  });
}

/** The table's owner invites a resident by name; guests can order bottles to the table and are served there. */
export async function setTableGuest(userId: string, placeId: string, no: number, userName: string, invited: boolean) {
  clubPlace(placeId);
  tableSpec(no);
  const guest = await findResident(userName);
  if (guest.id === userId) throw new EconomyError("It's already your table.", 409);
  if (invited && (await hiddenPlayers(userId)).has(guest.id)) throw new EconomyError(`You can't invite ${guest.name}.`, 409);
  return withTransaction(async (client) => {
    const booking = await bookingFor(client, placeId, no);
    if (!booking || booking.ownerId !== userId) throw new EconomyError("Only the person who booked this table can change its guests.", 403);
    if (invited) {
      const count = await client.query(`SELECT COUNT(*)::INTEGER AS n FROM club_table_guest WHERE booking_id = $1`, [booking.id]);
      if (count.rows[0].n >= TABLE_GUESTS_MAX) throw new EconomyError(`A table seats you and ${TABLE_GUESTS_MAX} guests.`, 409);
      await client.query(`INSERT INTO club_table_guest (booking_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [booking.id, guest.id]);
    } else {
      await client.query(`DELETE FROM club_table_guest WHERE booking_id = $1 AND user_id = $2`, [booking.id, guest.id]);
    }
    return { guest: guest.name, tables: await listTables(userId, placeId, client) };
  });
}

/** Orders a bottle to the table; a waiter brings it over. Owner and invited guests only, standing at the table. */
export async function orderBottle(userId: string, placeId: string, no: number, itemId: string, idempotencyKey: string) {
  const { place } = clubPlace(placeId);
  const table = tableSpec(no);
  const item = bottleById.get(itemId);
  if (!item) throw new EconomyError("The bar doesn't have that bottle.", 404);
  if (!isNear(userId, table.spot, TABLE_RANGE, clubLocation(placeId))) throw new EconomyError("Order from your table.", 409);
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
    const replay = await client.query(`SELECT id FROM club_bottle_order WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    const wallet = async () => Number((await client.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);
    if (replay.rowCount) return { replayed: true, item, balance: await wallet(), tables: await listTables(userId, placeId, client) };
    const booking = await bookingFor(client, placeId, no);
    if (!booking) throw new EconomyError("Book the table before ordering bottles.", 409);
    if (booking.ownerId !== userId) {
      const guest = await client.query(`SELECT 1 FROM club_table_guest WHERE booking_id = $1 AND user_id = $2`, [booking.id, userId]);
      if (!guest.rowCount) throw new EconomyError("Ask the table's owner to invite you first.", 403);
    }
    const balance = await debitWallet(client, userId, item.price, "club_bottle", `${item.name} · ${place.name}`, idempotencyKey, { placeId, table: no, itemId });
    await client.query(
      `INSERT INTO club_bottle_order (id, booking_id, user_id, item_id, price, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), booking.id, userId, item.id, item.price, idempotencyKey],
    );
    return { replayed: false, item, balance, tables: await listTables(userId, placeId, client) };
  });
}

/** How long a table's owner can be out of the club (stepping out, or a dropped connection) before the table is cleared. */
export const TABLE_ABSENCE_MS = 60_000;
const absentSince = new Map<string, number>();

/**
 * Clears tonight's VIP tables whose owner has left the club: the booking, its guest list and the bottles go, so
 * another resident can book the table. A short absence is forgiven so a dropped connection doesn't lose the table.
 */
export async function releaseAbandonedTables(now = Date.now()) {
  const bookings = await pool.query<{ id: string; place_id: string; owner_user_id: string }>(
    `SELECT id, place_id, owner_user_id FROM club_table_booking WHERE lagos_night = $1::date`,
    [lagosNight(now)],
  );
  const live = new Set<string>();
  let released = 0;
  for (const booking of bookings.rows) {
    live.add(booking.id);
    if (getPlayerPosition(booking.owner_user_id)?.location === clubLocation(booking.place_id)) {
      absentSince.delete(booking.id);
      continue;
    }
    const since = absentSince.get(booking.id) ?? now;
    absentSince.set(booking.id, since);
    if (now - since < TABLE_ABSENCE_MS) continue;
    await pool.query(`DELETE FROM club_table_booking WHERE id = $1`, [booking.id]);
    absentSince.delete(booking.id);
    released += 1;
  }
  for (const id of absentSince.keys()) if (!live.has(id)) absentSince.delete(id);
  return released;
}

