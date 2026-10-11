import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { chargeRide, closeRide, refundOrphanedRides } from "./ride-service.js";

const user = { id: `ride-user-${randomUUID()}`, username: `ride${randomUUID().replaceAll("-", "").slice(0, 12)}` };

async function balance() {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Ride Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("rides across a server restart", () => {
  it("refunds a paid ride no room is running exactly once, and leaves settled and live rides alone", async () => {
    const lost = randomUUID();
    const settled = randomUUID();
    const live = randomUUID();
    await chargeRide(user.id, 1_500, "Ikoyi", randomUUID(), lost);
    await chargeRide(user.id, 900, "Yaba", randomUUID(), settled);
    await closeRide(settled);
    const before = await chargeRide(user.id, 700, "VI", randomUUID(), live);

    const [first, second] = await Promise.all([refundOrphanedRides(user.id, live), refundOrphanedRides(user.id, live)]);
    expect(first + second).toBe(1_500);
    expect(await balance()).toBe(before + 1_500);
    expect(await refundOrphanedRides(user.id, live)).toBe(0);
    const open = await pool.query(`SELECT ride_id FROM ride_open WHERE user_id = $1`, [user.id]);
    expect(open.rows.map((row) => row.ride_id)).toEqual([live]);
  });
});
