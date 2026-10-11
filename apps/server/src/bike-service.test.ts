import { BIKE_RENTAL, rentalUsage } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeRental, parkRental, returnRental, startRental } from "./bike-service.js";
import { pool } from "./database.js";

const user = { id: `bike-user-${randomUUID()}`, username: `bike${randomUUID().replaceAll("-", "").slice(0, 12)}` };

async function balance() {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
     VALUES ($1, 'Bike Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("bike hire", () => {
  it("holds the deposit, allows one hire at a time, and refunds the unused deposit exactly once", async () => {
    const { rental, balance: afterUnlock } = await startRental(user.id, "adebayo", randomUUID());
    const opening = afterUnlock + BIKE_RENTAL.unlockFee + BIKE_RENTAL.deposit;
    expect(await balance()).toBe(opening - BIKE_RENTAL.unlockFee - BIKE_RENTAL.deposit);
    await expect(startRental(user.id, "kayode", randomUUID())).rejects.toThrow("already have a hired bike");

    await parkRental(rental.id, 10, 20, 1.5);
    expect(await activeRental(user.id)).toMatchObject({ id: rental.id, x: 10, z: 20, yaw: 1.5 });

    const endedAt = rental.startedAt + 7 * 60_000 + 5_000;
    const result = await returnRental(user.id, rental.id, "kayode", endedAt);
    expect(result).toMatchObject(rentalUsage(rental.startedAt, endedAt));
    expect(result.refund).toBe(BIKE_RENTAL.deposit - 8 * BIKE_RENTAL.perMinute);
    expect(await balance()).toBe(opening - BIKE_RENTAL.unlockFee - 8 * BIKE_RENTAL.perMinute);
    await expect(returnRental(user.id, rental.id, "kayode", endedAt)).rejects.toThrow("already been returned");
    expect(await activeRental(user.id)).toBeNull();
  });

  it("keeps the whole deposit for a very long hire but never more", async () => {
    const before = await balance();
    const { rental } = await startRental(user.id, "falomo", randomUUID());
    const result = await returnRental(user.id, rental.id, "falomo", rental.startedAt + 6 * 3_600_000);
    expect(result.refund).toBe(0);
    expect(await balance()).toBe(before - BIKE_RENTAL.unlockFee - BIKE_RENTAL.deposit);
  });
});
