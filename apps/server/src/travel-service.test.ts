import { CABINS, HOTELS, INTERIOR_ORIGIN, TRAVEL_LAYOUTS, VISA_PLANS } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";
import {
  advanceLeg,
  applyVisa,
  bookHotel,
  buyTicket,
  cancelTicket,
  clearImmigration,
  endHotelStay,
  payActivity,
  travelStatus,
  tripRecord,
} from "./travel-service.js";

const users = [0, 1].map(() => ({
  id: `travel-user-${randomUUID()}`,
  username: `trv${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [traveller, other] = users as [(typeof users)[0], (typeof users)[0]];
const counter = TRAVEL_LAYOUTS.consulate.spots.counter!;

async function balance(userId: string) {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Travel Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await getEconomyState(user.id);
    await pool.query(`UPDATE wallet SET balance = 1000000 WHERE user_id = $1`, [user.id]);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("Lagos to Dubai travel", () => {
  it("only issues a visa at the consular counter, and charges the fee once", async () => {
    setPlayerPosition(traveller.id, 0, 0);
    await expect(applyVisa(traveller.id, "single-14", "visa-1")).rejects.toThrow("counter");
    setPlayerPosition(traveller.id, INTERIOR_ORIGIN[0] + counter[0], INTERIOR_ORIGIN[1] + counter[1], "consulate");
    const start = await balance(traveller.id);
    const first = await applyVisa(traveller.id, "single-14", "visa-1");
    const again = await applyVisa(traveller.id, "single-14", "visa-1");
    expect(again.replayed).toBe(true);
    expect(again.visa.id).toBe(first.visa.id);
    expect(await balance(traveller.id)).toBe(start - VISA_PLANS["single-14"].fee);
  });

  it("explains how to get a visa before selling a ticket", async () => {
    await expect(buyTicket(other.id, "economy", "t-other")).rejects.toThrow("Consular Office");
  });

  it("sells a return ticket once, refunds it in full straight after, then flies the whole trip", async () => {
    const start = await balance(traveller.id);
    const bought = await buyTicket(traveller.id, "business", "ticket-1");
    expect((await buyTicket(traveller.id, "business", "ticket-1")).replayed).toBe(true);
    expect(bought.ticket.seat).toMatch(/^[1-3][ACDF]$/);
    expect(await balance(traveller.id)).toBe(start - CABINS.business.fare);
    const cancelled = await cancelTicket(traveller.id, bought.ticket.id);
    expect(cancelled.refund).toBe(CABINS.business.fare);
    expect((await cancelTicket(traveller.id, bought.ticket.id)).replayed).toBe(true);
    expect(await balance(traveller.id)).toBe(start);

    const ticket = (await buyTicket(traveller.id, "economy", "ticket-2")).ticket;
    await expect(advanceLeg(traveller.id, "outbound", "boarded")).rejects.toThrow("Check in");
    await advanceLeg(traveller.id, "outbound", "checked_in");
    await pool.query(`UPDATE travel_visa SET ready_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`, [traveller.id]);
    const flight = { id: randomUUID(), seat: ticket.seat, departAt: Date.now(), arriveAt: Date.now() + 60_000 };
    await advanceLeg(traveller.id, "outbound", "boarded", flight);
    expect((await tripRecord(traveller.id))?.flight?.id).toBe(flight.id);
    await expect(cancelTicket(traveller.id, ticket.id)).rejects.toThrow("can't be cancelled");
    await advanceLeg(traveller.id, "outbound", "flown");
    expect((await clearImmigration(traveller.id)).visitsLeft).toBe(0);
    expect((await clearImmigration(traveller.id)).already).toBe(true);

    const afterFlight = await balance(traveller.id);
    const hotel = HOTELS[0]!;
    const room = hotel.rooms[0]!;
    const booked = await bookHotel(traveller.id, hotel.id, room.type, 1, "hotel-1");
    expect((await bookHotel(traveller.id, hotel.id, room.type, 1, "hotel-1")).replayed).toBe(true);
    expect(await balance(traveller.id)).toBe(afterFlight - room.perNight);
    await payActivity(traveller.id, "dhow-cruise", "dhow-1");
    await payActivity(traveller.id, "dhow-cruise", "dhow-1");
    const afterTour = await balance(traveller.id);
    expect(afterTour).toBe(afterFlight - room.perNight - 12_000);
    expect((await endHotelStay(traveller.id, booked.booking.id)).refund).toBe(room.perNight);

    await advanceLeg(traveller.id, "return", "checked_in");
    await advanceLeg(traveller.id, "return", "boarded", { ...flight, id: randomUUID() });
    await advanceLeg(traveller.id, "return", "flown");
    expect(await tripRecord(traveller.id)).toBeNull();
    const status = await travelStatus(traveller.id);
    expect(status.tickets.find((entry) => entry.id === ticket.id)?.return).toBe("flown");
  });
});
