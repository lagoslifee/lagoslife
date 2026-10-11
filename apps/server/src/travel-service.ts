import {
  ACTIVITIES,
  CABINS,
  cabinSeats,
  CAR_RENTAL,
  hotelById,
  hotelRoom,
  INTERIOR_ORIGIN,
  RENTAL_CARS,
  ROOFTOP_MENU,
  ROOM_SERVICE,
  TRAVEL,
  TRAVEL_LAYOUTS,
  TRAVEL_PLACES,
  VISA_PLANS,
  placeById,
  type ActivityId,
  type CabinClass,
  type HotelBookingState,
  type InviteState,
  type Leg,
  type LegStatus,
  type RoomType,
  type TicketState,
  type TravelStatus,
  type VisaPlan,
  type VisaState,
} from "@lagos-living/shared";
import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureProfile, ensureWallet, withTransaction } from "./economy-service.js";
import { isNear } from "./player-presence.js";
import { findResident, hiddenPlayers } from "./safety-service.js";

type Db = PoolClient | typeof pool;

/** `invite` (toUserId, fromName): tells the live room to alert an invited player. */
export const travelEvents = new EventEmitter();
travelEvents.setMaxListeners(50);
const NAME = `COALESCE(u."displayUsername", u.username, u.name)`;
const HOUR = 3_600_000;
const NIGHT_MS = TRAVEL.hotelNightHours * HOUR;

const reference = (prefix: string) => `${prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

async function lockWallet(client: PoolClient, userId: string) {
  await ensureWallet(client, userId);
  await client.query(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
}

async function balanceOf(db: Db, userId: string) {
  const result = await db.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0]?.balance ?? 0);
}

function atCounter(userId: string, location: string, interior: keyof typeof TRAVEL_LAYOUTS, spot: string) {
  const offset = TRAVEL_LAYOUTS[interior].spots[spot];
  if (!offset) return false;
  return isNear(userId, [INTERIOR_ORIGIN[0] + offset[0], INTERIOR_ORIGIN[1] + offset[1]], TRAVEL.counterRange + 0.6, location);
}

function nearPlace(userId: string, placeId: string, range = 14) {
  const place = placeById.get(placeId);
  return Boolean(place && (isNear(userId, place.door, range) || isNear(userId, place.kerb, range)));
}

/* ---------- Visas ---------- */

function visaState(row: Record<string, unknown>, now = Date.now()): VisaState {
  const plan = row.plan as VisaPlan;
  const readyAt = new Date(row.ready_at as string).getTime();
  const validUntil = new Date(row.valid_until as string).getTime();
  const visitsTotal = Number(row.visits_total);
  const visitsUsed = Number(row.visits_used);
  return {
    id: String(row.id),
    plan,
    name: VISA_PLANS[plan]?.name ?? plan,
    visitsTotal,
    visitsUsed,
    status: now < readyAt ? "processing" : now > validUntil || visitsUsed >= visitsTotal ? "expired" : "issued",
    readyAt: new Date(readyAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    reference: `DTC-${String(row.id).slice(0, 6).toUpperCase()}`,
  };
}

async function usableVisa(db: Db, userId: string, now = Date.now()) {
  const result = await db.query(`SELECT * FROM travel_visa WHERE user_id = $1 ORDER BY applied_at DESC`, [userId]);
  const visas = result.rows.map((row) => visaState(row, now));
  return { current: visas.find((visa) => visa.status === "issued") ?? visas.find((visa) => visa.status === "processing") ?? null, all: visas };
}

export async function applyVisa(userId: string, plan: VisaPlan, idempotencyKey: string) {
  if (!atCounter(userId, "consulate", "consulate", "counter")) {
    throw new EconomyError("Apply at the counter inside the Dubai Travel Consular Office.", 409);
  }
  const details = VISA_PLANS[plan];
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT * FROM travel_visa WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { visa: visaState(replay.rows[0]), balance: await balanceOf(client, userId), replayed: true };
    const { current } = await usableVisa(client, userId);
    if (current && current.visitsUsed < current.visitsTotal) {
      throw new EconomyError(current.status === "processing" ? "Your visa is already being processed." : `You already hold a valid visa (${current.visitsTotal - current.visitsUsed} visit${current.visitsTotal - current.visitsUsed === 1 ? "" : "s"} left).`, 409);
    }
    const id = randomUUID();
    const now = Date.now();
    const balance = await debitWallet(client, userId, details.fee, "visa_fee", `${details.name} (game roleplay)`, `visa:${idempotencyKey}`, { plan });
    const inserted = await client.query(
      `INSERT INTO travel_visa (id, user_id, plan, visits_total, fee, ready_at, valid_until, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, userId, plan, details.visits, details.fee, new Date(now + TRAVEL.visaProcessingSeconds * 1_000), new Date(now + details.days * 24 * HOUR), idempotencyKey],
    );
    return { visa: visaState(inserted.rows[0], now), balance, replayed: false };
  });
}

/* ---------- Tickets ---------- */

async function ticketStates(db: Db, userId: string): Promise<TicketState[]> {
  const result = await db.query(`SELECT * FROM travel_ticket WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]);
  const parties = [...new Set(result.rows.map((row) => String(row.party_id)))];
  const mates = parties.length
    ? await db.query(
        `SELECT t.party_id, ${NAME} AS name FROM travel_ticket t JOIN "user" u ON u.id = t.user_id
         WHERE t.party_id = ANY($1) AND t.user_id <> $2 AND t.cancelled_at IS NULL`,
        [parties, userId],
      )
    : { rows: [] as Array<Record<string, unknown>> };
  return result.rows.map((row) => ({
    id: String(row.id),
    reference: `LL-${String(row.id).slice(0, 6).toUpperCase()}`,
    cabin: row.cabin as CabinClass,
    fare: Number(row.fare),
    seat: String(row.seat),
    partyId: String(row.party_id),
    outbound: row.outbound_status as LegStatus,
    return: row.return_status as LegStatus,
    immigrationDone: Boolean(row.immigration_at),
    createdAt: iso(row.created_at)!,
    cancelledAt: iso(row.cancelled_at),
    refunded: Number(row.refunded),
    companions: mates.rows.filter((mate) => mate.party_id === row.party_id).map((mate) => String(mate.name)),
  }));
}

const isActive = (ticket: TicketState) => !ticket.cancelledAt && ticket.return !== "flown";

export async function activeTicket(userId: string, db: Db = pool) {
  return (await ticketStates(db, userId)).find(isActive) ?? null;
}

async function requireVisaForBooking(db: Db, userId: string) {
  const { current } = await usableVisa(db, userId);
  if (!current) {
    throw new EconomyError(
      "You need a Dubai visit visa first. Visit the Dubai Travel Consular Office — Game Roleplay (Map → Dubai Consular Office) to apply. It takes a few seconds.",
      409,
    );
  }
  return current;
}

async function createTicket(client: PoolClient, userId: string, cabin: CabinClass, fare: number, partyId: string | null, idempotencyKey: string, label: string) {
  const visa = await requireVisaForBooking(client, userId);
  const seats = cabinSeats(cabin);
  const seat = seats[Math.floor(Math.random() * seats.length)]!;
  const id = randomUUID();
  const balance = await debitWallet(client, userId, fare, "flight_ticket", label, `ticket:${idempotencyKey}`, { cabin });
  await client.query(
    `INSERT INTO travel_ticket (id, user_id, party_id, cabin, fare, seat, visa_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, userId, partyId ?? id, cabin, fare, seat, visa.id, idempotencyKey],
  );
  return { id, balance };
}

export async function buyTicket(userId: string, cabin: CabinClass, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT id FROM travel_ticket WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) {
      const ticket = (await ticketStates(client, userId)).find((entry) => entry.id === replay.rows[0].id)!;
      return { ticket, balance: await balanceOf(client, userId), replayed: true };
    }
    if (await activeTicket(userId, client)) throw new EconomyError("You already have a return ticket. Use it or cancel it first.", 409);
    const fare = CABINS[cabin].fare;
    const { id, balance } = await createTicket(client, userId, cabin, fare, null, idempotencyKey, `Return flight Lagos ⇄ Dubai · ${CABINS[cabin].name}`);
    const ticket = (await ticketStates(client, userId)).find((entry) => entry.id === id)!;
    return { ticket, balance, replayed: false };
  });
}

/** Refund for cancelling now; null when the ticket can no longer be cancelled. */
export function ticketRefund(ticket: Pick<TicketState, "fare" | "createdAt" | "outbound" | "cancelledAt">, now = Date.now()) {
  if (ticket.cancelledAt || (ticket.outbound !== "booked" && ticket.outbound !== "checked_in")) return null;
  const free = now - new Date(ticket.createdAt).getTime() <= TRAVEL.freeCancelMinutes * 60_000;
  return free ? ticket.fare : Math.round((ticket.fare * (1 - TRAVEL.cancelFeeRate)) / 50) * 50;
}

export async function cancelTicket(userId: string, ticketId: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const row = await client.query(`SELECT * FROM travel_ticket WHERE id = $1 AND user_id = $2 FOR UPDATE`, [ticketId, userId]);
    if (!row.rowCount) throw new EconomyError("Ticket not found.", 404);
    const ticket = (await ticketStates(client, userId)).find((entry) => entry.id === ticketId)!;
    if (ticket.cancelledAt) return { refund: ticket.refunded, balance: await balanceOf(client, userId), replayed: true };
    const refund = ticketRefund(ticket);
    if (refund === null) throw new EconomyError("This ticket can't be cancelled after the outbound flight has boarded. Your return flight stays valid.", 409);
    await client.query(
      `UPDATE travel_ticket SET outbound_status = 'cancelled', return_status = 'cancelled', cancelled_at = NOW(), refunded = $2 WHERE id = $1`,
      [ticketId, refund],
    );
    await client.query(`UPDATE travel_invite SET status = 'cancelled', responded_at = NOW() WHERE ticket_id = $1 AND status = 'pending'`, [ticketId]);
    const balance = refund > 0 ? await creditWallet(client, userId, refund, "flight_refund", `Flight refund ${ticket.reference}`, `ticket-refund:${ticketId}`) : await balanceOf(client, userId);
    return { refund, balance, replayed: false };
  });
}

/** Moves one leg of the active ticket forward; returns the updated row, or throws with a reason the player can act on. */
export async function advanceLeg(userId: string, leg: Leg, to: "checked_in" | "boarded" | "flown", flight?: { id: string; seat: string; departAt: number; arriveAt: number }) {
  return withTransaction(async (client) => {
    const row = await client.query(
      `SELECT * FROM travel_ticket WHERE user_id = $1 AND cancelled_at IS NULL AND return_status <> 'flown' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    const ticket = row.rows[0];
    if (!ticket) throw new EconomyError("You don't have a ticket. Buy one at the ticket desk or in Phone → Travel.", 409);
    const column = leg === "outbound" ? "outbound_status" : "return_status";
    const status = ticket[column] as LegStatus;
    if (leg === "return" && ticket.outbound_status !== "flown") throw new EconomyError("Your return flight is from Dubai.", 409);
    const order: LegStatus[] = ["booked", "checked_in", "boarded", "flown"];
    if (order.indexOf(status) >= order.indexOf(to)) return { ticketId: String(ticket.id), cabin: ticket.cabin as CabinClass, seat: String(ticket.flight_seat ?? ticket.seat), status, changed: false };
    if (to === "boarded" && status !== "checked_in") throw new EconomyError("Check in at the counter before going to the gate.", 409);
    if (to === "boarded" && leg === "outbound") {
      const { current } = await usableVisa(client, userId);
      if (!current || current.status !== "issued") throw new EconomyError("Your visa isn't ready yet. Wait for the consular office to finish processing it.", 409);
    }
    if (to === "boarded" && flight) {
      await client.query(
        `UPDATE travel_ticket SET ${column} = 'boarded', flight_id = $2, flight_leg = $3, flight_seat = $4, depart_at = $5, arrive_at = $6 WHERE id = $1`,
        [ticket.id, flight.id, leg, flight.seat, new Date(flight.departAt), new Date(flight.arriveAt)],
      );
    } else if (to === "flown") {
      await client.query(`UPDATE travel_ticket SET ${column} = 'flown', flight_id = NULL WHERE id = $1`, [ticket.id]);
    } else {
      await client.query(`UPDATE travel_ticket SET ${column} = $2 WHERE id = $1`, [ticket.id, to]);
    }
    return { ticketId: String(ticket.id), cabin: ticket.cabin as CabinClass, seat: String(flight?.seat ?? ticket.flight_seat ?? ticket.seat), status: to, changed: true };
  });
}

/** Where a player's trip stands, from the database alone (used on join and after a restart). */
export async function tripRecord(userId: string) {
  const result = await pool.query(
    `SELECT * FROM travel_ticket WHERE user_id = $1 AND cancelled_at IS NULL AND return_status <> 'flown' ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ticketId: String(row.id),
    partyId: String(row.party_id),
    cabin: row.cabin as CabinClass,
    seat: String(row.seat),
    outbound: row.outbound_status as LegStatus,
    return: row.return_status as LegStatus,
    flight: row.flight_id
      ? { id: String(row.flight_id), leg: row.flight_leg as Leg, seat: String(row.flight_seat ?? row.seat), departAt: new Date(row.depart_at).getTime(), arriveAt: new Date(row.arrive_at).getTime() }
      : null,
    immigrationDone: Boolean(row.immigration_at),
  };
}

/** Immigration on arrival in Dubai: uses one visit of the visa, once per ticket. */
export async function clearImmigration(userId: string) {
  return withTransaction(async (client) => {
    const row = await client.query(
      `SELECT * FROM travel_ticket WHERE user_id = $1 AND cancelled_at IS NULL AND outbound_status = 'flown' AND return_status <> 'flown' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    const ticket = row.rows[0];
    if (!ticket) throw new EconomyError("There is no arrival to clear.", 409);
    if (ticket.immigration_at) return { already: true, visitsLeft: null as number | null };
    const visa = await client.query(
      `SELECT * FROM travel_visa WHERE user_id = $1 AND ready_at <= NOW() AND visits_used < visits_total ORDER BY (id = $2) DESC, applied_at DESC LIMIT 1 FOR UPDATE`,
      [userId, ticket.visa_id],
    );
    let visitsLeft: number | null = null;
    if (visa.rowCount) {
      await client.query(`UPDATE travel_visa SET visits_used = visits_used + 1 WHERE id = $1`, [visa.rows[0].id]);
      visitsLeft = Number(visa.rows[0].visits_total) - Number(visa.rows[0].visits_used) - 1;
    }
    await client.query(`UPDATE travel_ticket SET immigration_at = NOW() WHERE id = $1`, [ticket.id]);
    return { already: false, visitsLeft };
  });
}

/* ---------- Invitations ---------- */

export async function inviteFriend(userId: string, ticketId: string, userName: string) {
  const friend = await findResident(userName);
  if (friend.id === userId) throw new EconomyError("You can't invite yourself.", 409);
  if ((await hiddenPlayers(userId)).has(friend.id)) throw new EconomyError(`You can't invite ${friend.name}.`, 409);
  return withTransaction(async (client) => {
    const ticket = (await ticketStates(client, userId)).find((entry) => entry.id === ticketId);
    if (!ticket || !isActive(ticket)) throw new EconomyError("Invite friends from an active ticket.", 409);
    if (ticket.outbound !== "booked" && ticket.outbound !== "checked_in") throw new EconomyError("Friends can only join before the outbound flight.", 409);
    const pending = await client.query(`SELECT COUNT(*)::INTEGER AS n FROM travel_invite WHERE ticket_id = $1 AND status = 'pending' AND expires_at > NOW()`, [ticketId]);
    if (pending.rows[0].n >= TRAVEL.maxInvites) throw new EconomyError(`At most ${TRAVEL.maxInvites} invitations can be open at once.`, 409);
    const existing = await client.query(`SELECT 1 FROM travel_invite WHERE ticket_id = $1 AND to_user_id = $2 AND status = 'pending' AND expires_at > NOW()`, [ticketId, friend.id]);
    if (existing.rowCount) throw new EconomyError(`${friend.name} already has an invitation from you.`, 409);
    await client.query(`UPDATE travel_invite SET status = 'expired' WHERE ticket_id = $1 AND to_user_id = $2 AND status = 'pending'`, [ticketId, friend.id]);
    const id = randomUUID();
    await client.query(
      `INSERT INTO travel_invite (id, ticket_id, from_user_id, to_user_id, cabin, fare, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ticketId, userId, friend.id, ticket.cabin, CABINS[ticket.cabin].fare, new Date(Date.now() + TRAVEL.inviteMinutes * 60_000)],
    );
    return { id, friendName: friend.name, friendId: friend.id };
  });
}

/** Only the invited player is charged, and only when they accept. */
export async function answerInvite(userId: string, inviteId: string, accept: boolean, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const row = await client.query(`SELECT * FROM travel_invite WHERE id = $1 AND to_user_id = $2 FOR UPDATE`, [inviteId, userId]);
    const invite = row.rows[0];
    if (!invite) throw new EconomyError("Invitation not found.", 404);
    if (invite.status === "accepted" && accept) return { status: "accepted" as const, balance: await balanceOf(client, userId), replayed: true };
    if (invite.status !== "pending" || new Date(invite.expires_at).getTime() < Date.now()) throw new EconomyError("That invitation is no longer open.", 409);
    if (!accept) {
      await client.query(`UPDATE travel_invite SET status = 'declined', responded_at = NOW() WHERE id = $1`, [inviteId]);
      return { status: "declined" as const, balance: await balanceOf(client, userId), replayed: false };
    }
    const host = await client.query(`SELECT * FROM travel_ticket WHERE id = $1`, [invite.ticket_id]);
    const hostTicket = host.rows[0];
    if (!hostTicket || hostTicket.cancelled_at || !["booked", "checked_in"].includes(hostTicket.outbound_status)) throw new EconomyError("Your friend's trip has already left or was cancelled.", 409);
    if (await activeTicket(userId, client)) throw new EconomyError("You already have a ticket. Cancel it first to join this trip.", 409);
    const { balance } = await createTicket(client, userId, invite.cabin as CabinClass, Number(invite.fare), String(hostTicket.party_id), idempotencyKey, `Return flight Lagos ⇄ Dubai · ${CABINS[invite.cabin as CabinClass].name} (group trip)`);
    await client.query(`UPDATE travel_invite SET status = 'accepted', responded_at = NOW() WHERE id = $1`, [inviteId]);
    return { status: "accepted" as const, balance, replayed: false };
  });
}

async function inviteStates(db: Db, userId: string): Promise<InviteState[]> {
  await db.query(`UPDATE travel_invite SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW() AND (to_user_id = $1 OR from_user_id = $1)`, [userId]);
  const result = await db.query(
    `SELECT i.*, ${NAME.replace(/u\./g, "f.")} AS from_name, ${NAME.replace(/u\./g, "t.")} AS to_name
     FROM travel_invite i JOIN "user" f ON f.id = i.from_user_id JOIN "user" t ON t.id = i.to_user_id
     WHERE i.to_user_id = $1 OR i.from_user_id = $1 ORDER BY i.created_at DESC LIMIT 20`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    fromName: String(row.from_name),
    toName: String(row.to_name),
    cabin: row.cabin as CabinClass,
    fare: Number(row.fare),
    status: row.status,
    createdAt: iso(row.created_at)!,
    incoming: row.to_user_id === userId,
  }));
}

/* ---------- Hotels ---------- */

/** Ends stays whose time is up and returns anything left in the room safe to the owner's bag. Safe to call often. */
export async function settleHotels(db: Db, userId?: string) {
  const ended = await db.query(
    `UPDATE hotel_booking SET status = CASE WHEN status = 'checked_in' THEN 'checked_out' ELSE 'expired' END
     WHERE status IN ('booked', 'checked_in') AND ends_at < NOW() ${userId ? "AND user_id = $1" : ""}
     RETURNING id, user_id`,
    userId ? [userId] : [],
  );
  for (const row of ended.rows) await returnStorage(db, String(row.id), String(row.user_id));
}

async function returnStorage(db: Db, bookingId: string, ownerId: string) {
  const items = await db.query(`DELETE FROM hotel_storage WHERE booking_id = $1 RETURNING item_id, quantity`, [bookingId]);
  for (const item of items.rows) {
    await db.query(
      `INSERT INTO inventory_item (user_id, item_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = inventory_item.quantity + EXCLUDED.quantity`,
      [ownerId, item.item_id, item.quantity],
    );
  }
}

async function bookingStates(db: Db, userId: string): Promise<HotelBookingState[]> {
  const result = await db.query(
    `SELECT b.*, ${NAME} AS owner_name FROM hotel_booking b JOIN "user" u ON u.id = b.user_id
     WHERE b.user_id = $1 OR b.id IN (SELECT booking_id FROM hotel_guest WHERE user_id = $1)
     ORDER BY b.created_at DESC LIMIT 20`,
    [userId],
  );
  const ids = result.rows.map((row) => String(row.id));
  const [guests, storage] = ids.length
    ? await Promise.all([
        db.query(`SELECT g.booking_id, ${NAME} AS name FROM hotel_guest g JOIN "user" u ON u.id = g.user_id WHERE g.booking_id = ANY($1)`, [ids]),
        db.query(`SELECT s.booking_id, s.item_id, s.quantity, c.name FROM hotel_storage s JOIN shop_catalog c ON c.id = s.item_id WHERE s.booking_id = ANY($1)`, [ids]),
      ])
    : [{ rows: [] as Array<Record<string, unknown>> }, { rows: [] as Array<Record<string, unknown>> }];
  return result.rows.map((row) => {
    const hotel = hotelById.get(String(row.hotel_id));
    const room = hotelRoom(String(row.hotel_id), row.room_type as RoomType);
    const mine = row.user_id === userId;
    return {
      id: String(row.id),
      hotelId: String(row.hotel_id),
      hotelName: hotel?.name ?? String(row.hotel_id),
      roomType: row.room_type as RoomType,
      roomName: room?.name ?? String(row.room_type),
      nights: Number(row.nights),
      price: Number(row.price),
      status: row.status,
      startsAt: iso(row.starts_at)!,
      endsAt: iso(row.ends_at)!,
      keyCode: mine || row.status === "checked_in" ? (row.key_code as string | null) : null,
      guests: guests.rows.filter((guest) => guest.booking_id === row.id).map((guest) => String(guest.name)),
      mine,
      ownerName: String(row.owner_name),
      storage: mine ? storage.rows.filter((item) => item.booking_id === row.id).map((item) => ({ itemId: String(item.item_id), name: String(item.name), quantity: Number(item.quantity) })) : [],
    };
  });
}

const liveBooking = (booking: HotelBookingState) => booking.status === "booked" || booking.status === "checked_in";

export async function bookHotel(userId: string, hotelId: string, roomType: RoomType, nights: number, idempotencyKey: string) {
  const hotel = hotelById.get(hotelId);
  const room = hotelRoom(hotelId, roomType);
  if (!hotel || !room) throw new EconomyError("That room type isn't offered at this hotel.", 404);
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    await settleHotels(client, userId);
    const replay = await client.query(`SELECT id FROM hotel_booking WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { booking: (await bookingStates(client, userId)).find((entry) => entry.id === replay.rows[0].id)!, balance: await balanceOf(client, userId), replayed: true };
    if ((await bookingStates(client, userId)).some((booking) => booking.mine && liveBooking(booking))) throw new EconomyError("You already have a hotel booking. Check out or cancel it first.", 409);
    const price = room.perNight * nights;
    const id = randomUUID();
    const balance = await debitWallet(client, userId, price, "hotel_stay", `${hotel.name} · ${room.name} · ${nights} night${nights === 1 ? "" : "s"}`, `hotel:${idempotencyKey}`, { hotelId, roomType, nights });
    await client.query(
      `INSERT INTO hotel_booking (id, user_id, hotel_id, room_type, nights, price, ends_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, hotelId, roomType, nights, price, new Date(Date.now() + nights * NIGHT_MS), idempotencyKey],
    );
    return { booking: (await bookingStates(client, userId)).find((entry) => entry.id === id)!, balance, replayed: false };
  });
}

async function ownBooking(client: PoolClient, userId: string, bookingId: string) {
  await settleHotels(client, userId);
  const row = await client.query(`SELECT * FROM hotel_booking WHERE id = $1 AND user_id = $2 FOR UPDATE`, [bookingId, userId]);
  if (!row.rowCount) throw new EconomyError("Booking not found.", 404);
  return row.rows[0];
}

export async function checkInHotel(userId: string, bookingId: string) {
  return withTransaction(async (client) => {
    const booking = await ownBooking(client, userId, bookingId);
    if (!nearPlace(userId, String(booking.hotel_id), 16)) throw new EconomyError(`Check in at the ${hotelById.get(String(booking.hotel_id))?.name ?? "hotel"} reception.`, 409);
    if (booking.status === "checked_in") return { keyCode: String(booking.key_code), replayed: true };
    if (booking.status !== "booked") throw new EconomyError("This booking has ended.", 409);
    const floor = 3 + Math.floor(Math.random() * 30);
    const keyCode = `Room ${floor}${String(1 + Math.floor(Math.random() * 20)).padStart(2, "0")} · key ${randomBytes(2).toString("hex").toUpperCase()}`;
    await client.query(`UPDATE hotel_booking SET status = 'checked_in', checked_in_at = NOW(), key_code = $2 WHERE id = $1`, [bookingId, keyCode]);
    return { keyCode, replayed: false };
  });
}

/** Unused whole nights, refundable on checkout or cancellation. Before check-in the whole stay is refundable. */
export function hotelRefund(booking: { status: string; price: number; nights: number; ends_at: Date | string }, now = Date.now()) {
  if (booking.status === "booked") return booking.price;
  if (booking.status !== "checked_in") return 0;
  const left = Math.floor(Math.max(0, new Date(booking.ends_at).getTime() - now) / NIGHT_MS);
  return Math.min(booking.price, left * Math.round(booking.price / booking.nights));
}

export async function endHotelStay(userId: string, bookingId: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const booking = await ownBooking(client, userId, bookingId);
    if (booking.status !== "booked" && booking.status !== "checked_in") return { refund: 0, balance: await balanceOf(client, userId), replayed: true, status: booking.status as string };
    const refund = hotelRefund({ status: booking.status, price: Number(booking.price), nights: Number(booking.nights), ends_at: booking.ends_at });
    const status = booking.status === "booked" ? "cancelled" : "checked_out";
    await client.query(`UPDATE hotel_booking SET status = $2, refunded = $3 WHERE id = $1`, [bookingId, status, refund]);
    await returnStorage(client, bookingId, userId);
    const hotel = hotelById.get(String(booking.hotel_id))?.name ?? "hotel";
    const balance = refund > 0 ? await creditWallet(client, userId, refund, "hotel_refund", `${hotel} · unused nights`, `hotel-refund:${bookingId}`) : await balanceOf(client, userId);
    return { refund, balance, replayed: false, status };
  });
}

export async function extendHotelStay(userId: string, bookingId: string, nights: number, idempotencyKey: string) {
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `hotel-extend:${idempotencyKey}`]);
    if (replay.rowCount) return { balance: await balanceOf(client, userId), replayed: true };
    const booking = await ownBooking(client, userId, bookingId);
    if (booking.status !== "booked" && booking.status !== "checked_in") throw new EconomyError("This stay has already ended.", 409);
    if (Number(booking.nights) + nights > TRAVEL.maxNights * 2) throw new EconomyError("That's the longest stay the hotel takes at once.", 409);
    const room = hotelRoom(String(booking.hotel_id), booking.room_type as RoomType)!;
    const price = room.perNight * nights;
    const balance = await debitWallet(client, userId, price, "hotel_stay", `${hotelById.get(String(booking.hotel_id))?.name} · ${nights} more night${nights === 1 ? "" : "s"}`, `hotel-extend:${idempotencyKey}`, { bookingId, nights });
    await client.query(
      `UPDATE hotel_booking SET nights = nights + $2, price = price + $3, ends_at = ends_at + ($2 * INTERVAL '${TRAVEL.hotelNightHours} hours') WHERE id = $1`,
      [bookingId, nights, price],
    );
    return { balance, replayed: false };
  });
}

export async function setHotelGuest(userId: string, bookingId: string, userName: string, invited: boolean) {
  const guest = await findResident(userName);
  if (guest.id === userId) throw new EconomyError("It's already your room.", 409);
  if (invited && (await hiddenPlayers(userId)).has(guest.id)) throw new EconomyError(`You can't invite ${guest.name}.`, 409);
  return withTransaction(async (client) => {
    const booking = await ownBooking(client, userId, bookingId);
    if (booking.status !== "booked" && booking.status !== "checked_in") throw new EconomyError("This stay has ended.", 409);
    if (invited) {
      const room = hotelRoom(String(booking.hotel_id), booking.room_type as RoomType)!;
      const count = await client.query(`SELECT COUNT(*)::INTEGER AS n FROM hotel_guest WHERE booking_id = $1`, [bookingId]);
      if (count.rows[0].n >= room.capacity - 1) throw new EconomyError(`This room sleeps ${room.capacity}.`, 409);
      await client.query(`INSERT INTO hotel_guest (booking_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [bookingId, guest.id]);
    } else {
      await client.query(`DELETE FROM hotel_guest WHERE booking_id = $1 AND user_id = $2`, [bookingId, guest.id]);
    }
    return { name: guest.name };
  });
}

/** Owner or invited guest of a live booking; returns the hotel for the door check. */
export async function hotelAccess(userId: string, bookingId: string) {
  await settleHotels(pool);
  const result = await pool.query(
    `SELECT b.hotel_id, b.room_type, b.status, b.user_id FROM hotel_booking b
     WHERE b.id = $1 AND b.status IN ('booked', 'checked_in')
       AND (b.user_id = $2 OR EXISTS (SELECT 1 FROM hotel_guest g WHERE g.booking_id = b.id AND g.user_id = $2))`,
    [bookingId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { hotelId: String(row.hotel_id), roomType: row.room_type as RoomType, checkedIn: row.status === "checked_in", owner: row.user_id === userId };
}

export async function moveStorage(userId: string, bookingId: string, itemId: string, direction: "in" | "out") {
  return withTransaction(async (client) => {
    const booking = await ownBooking(client, userId, bookingId);
    if (booking.status !== "checked_in") throw new EconomyError("Check in to use the room safe.", 409);
    if (direction === "in") {
      const item = await client.query(`SELECT quantity FROM inventory_item WHERE user_id = $1 AND item_id = $2 FOR UPDATE`, [userId, itemId]);
      if (!item.rowCount) throw new EconomyError("You aren't carrying that.", 404);
      if (Number(item.rows[0].quantity) <= 1) await client.query(`DELETE FROM inventory_item WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
      else await client.query(`UPDATE inventory_item SET quantity = quantity - 1 WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
      await client.query(
        `INSERT INTO hotel_storage (booking_id, item_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (booking_id, item_id) DO UPDATE SET quantity = hotel_storage.quantity + 1`,
        [bookingId, itemId],
      );
    } else {
      const item = await client.query(`SELECT quantity FROM hotel_storage WHERE booking_id = $1 AND item_id = $2 FOR UPDATE`, [bookingId, itemId]);
      if (!item.rowCount) throw new EconomyError("That isn't in the safe.", 404);
      if (Number(item.rows[0].quantity) <= 1) await client.query(`DELETE FROM hotel_storage WHERE booking_id = $1 AND item_id = $2`, [bookingId, itemId]);
      else await client.query(`UPDATE hotel_storage SET quantity = quantity - 1 WHERE booking_id = $1 AND item_id = $2`, [bookingId, itemId]);
      await client.query(
        `INSERT INTO inventory_item (user_id, item_id) VALUES ($1, $2)
         ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = inventory_item.quantity + 1`,
        [userId, itemId],
      );
    }
    return { ok: true };
  });
}

/* ---------- Food, activities and rentals ---------- */

export async function orderTravelFood(userId: string, menu: "room-service" | "rooftop", itemId: string, bookingId: string | undefined, idempotencyKey: string) {
  const list = menu === "room-service" ? ROOM_SERVICE : ROOFTOP_MENU;
  const item = list.find((entry) => entry.id === itemId);
  if (!item) throw new EconomyError("That isn't on the menu.", 404);
  if (menu === "room-service") {
    if (!bookingId || !isNear(userId, [INTERIOR_ORIGIN[0], INTERIOR_ORIGIN[1]], 12, `hotel:${bookingId}`)) throw new EconomyError("Order room service from inside your hotel room.", 409);
  } else if (!isNear(userId, [INTERIOR_ORIGIN[0], INTERIOR_ORIGIN[1]], 14, "rooftop")) {
    throw new EconomyError("Order at the Skyline rooftop lounge.", 409);
  }
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `travel-order:${idempotencyKey}`]);
    if (replay.rowCount) return { balance: await balanceOf(client, userId), replayed: true, name: item.name, needs: null };
    const balance = await debitWallet(client, userId, item.price, "travel_order", `${menu === "room-service" ? "Room service" : "Skyline rooftop"} · ${item.name}`, `travel-order:${idempotencyKey}`, { itemId });
    await ensureProfile(client, userId);
    const needs = await client.query(
      `UPDATE player_profile SET hunger = LEAST(100, hunger + $2), energy = LEAST(100, energy + $3), updated_at = NOW() WHERE user_id = $1 RETURNING hunger, energy`,
      [userId, item.hunger, item.energy],
    );
    return { balance, replayed: false, name: item.name, needs: needs.rows[0] as { hunger: number; energy: number } };
  });
}

export async function payActivity(userId: string, activity: ActivityId, idempotencyKey: string) {
  const details = ACTIVITIES[activity];
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT id FROM travel_activity WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { id: String(replay.rows[0].id), balance: await balanceOf(client, userId), replayed: true };
    const id = randomUUID();
    const balance = await debitWallet(client, userId, details.price, "travel_activity", details.name, `activity:${idempotencyKey}`, { activity });
    await client.query(`INSERT INTO travel_activity (id, user_id, activity, price, idempotency_key) VALUES ($1, $2, $3, $4, $5)`, [id, userId, activity, details.price, idempotencyKey]);
    return { id, balance, replayed: false };
  });
}

export async function rentCar(userId: string, modelId: string, hours: number, idempotencyKey: string) {
  const offer = RENTAL_CARS.find((car) => car.modelId === modelId);
  if (!offer) throw new EconomyError("That car isn't available for hire.", 404);
  if (hours > CAR_RENTAL.maxHours) throw new EconomyError(`Hire for up to ${CAR_RENTAL.maxHours} hours.`, 409);
  return withTransaction(async (client) => {
    await lockWallet(client, userId);
    const replay = await client.query(`SELECT id, ends_at FROM travel_activity WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    if (replay.rowCount) return { id: String(replay.rows[0].id), endsAt: new Date(replay.rows[0].ends_at).getTime(), balance: await balanceOf(client, userId), replayed: true };
    const live = await client.query(`SELECT 1 FROM travel_activity WHERE user_id = $1 AND activity = 'car-rental' AND ends_at > NOW()`, [userId]);
    if (live.rowCount) throw new EconomyError("You already have a hire car. Return it first.", 409);
    const id = randomUUID();
    const price = offer.perHour * hours;
    const endsAt = Date.now() + hours * HOUR;
    const balance = await debitWallet(client, userId, price, "car_rental", `Dubai car hire · ${hours} h`, `car-rental:${idempotencyKey}`, { modelId, hours });
    await client.query(
      `INSERT INTO travel_activity (id, user_id, activity, price, model_id, ends_at, idempotency_key) VALUES ($1, $2, 'car-rental', $3, $4, $5, $6)`,
      [id, userId, price, modelId, new Date(endsAt), idempotencyKey],
    );
    return { id, endsAt, balance, replayed: false };
  });
}

export async function endCarRental(userId: string) {
  await pool.query(`UPDATE travel_activity SET ends_at = NOW() WHERE user_id = $1 AND activity = 'car-rental' AND ends_at > NOW()`, [userId]);
}

export async function liveCarRental(userId: string) {
  const result = await pool.query(`SELECT id, model_id, ends_at FROM travel_activity WHERE user_id = $1 AND activity = 'car-rental' AND ends_at > NOW() LIMIT 1`, [userId]);
  const row = result.rows[0];
  return row ? { id: String(row.id), modelId: String(row.model_id), endsAt: new Date(row.ends_at).getTime() } : null;
}

export async function recordPhoto(userId: string, spot: string, companions: string[]) {
  const id = randomUUID();
  await pool.query(`INSERT INTO travel_photo (id, user_id, spot, companions) VALUES ($1, $2, $3, $4)`, [id, userId, spot, companions.slice(0, 12)]);
  return { id };
}

/* ---------- Status ---------- */

export async function travelStatus(userId: string): Promise<TravelStatus> {
  await settleHotels(pool, userId);
  const [visas, tickets, invites, bookings, photos, activities, rental] = await Promise.all([
    usableVisa(pool, userId),
    ticketStates(pool, userId),
    inviteStates(pool, userId),
    bookingStates(pool, userId),
    pool.query(`SELECT id, spot, companions, taken_at FROM travel_photo WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 12`, [userId]),
    pool.query(`SELECT activity, created_at FROM travel_activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
    liveCarRental(userId),
  ]);
  return {
    visa: visas.current,
    visas: visas.all,
    ticket: tickets.find(isActive) ?? null,
    tickets,
    invites,
    bookings,
    photos: photos.rows.map((row) => ({ id: String(row.id), spot: String(row.spot), companions: row.companions as string[], takenAt: iso(row.taken_at)! })),
    activities: activities.rows.map((row) => ({ activity: String(row.activity), at: iso(row.created_at)! })),
    rental: rental ? { modelId: rental.modelId, until: new Date(rental.endsAt).toISOString() } : null,
  };
}

