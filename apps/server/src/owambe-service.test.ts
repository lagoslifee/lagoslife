import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neighbourhoodParty, OWAMBE, OWAMBE_GROUND, owambeTables, walkable } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { currentOwambe, hostOwambe, servePlate } = await import("./owambe-service.js");
await import("./world-footprints.js");

const makeUser = (tag: string) => ({ id: `${tag}-${randomUUID()}`, username: `${tag}${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const host = makeUser("celebrant");
const guest = makeUser("guest");
const START = 2_000_000;
const balance = async (userId: string) => Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);
// Far in the future, so the booking never collides with a real one on the shared test database.
const NOW = Date.UTC(2031, 0, 1, 12);

beforeAll(async () => {
  for (const user of [host, guest]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $4, $4)`,
      [user.id, user.username, `${user.username}@example.test`, user.username],
    );
    await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
    await pool.query(`INSERT INTO player_profile (user_id, hunger, energy) VALUES ($1, 20, 50) ON CONFLICT (user_id) DO UPDATE SET hunger = 20, energy = 50`, [user.id]);
  }
});
afterAll(async () => {
  await pool.query(`DELETE FROM owambe_booking WHERE host_user_id = $1`, [host.id]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[host.id, guest.id]]);
});

describe("owambe", () => {
  it("sets every chair and the kitchen on open ground", () => {
    for (const table of owambeTables()) for (const seat of table.seats) expect(walkable(seat.at[0], seat.at[1], 0.6)).toBe(true);
    expect(walkable(OWAMBE_GROUND.centre[0] + 13.5, OWAMBE_GROUND.centre[1] - 6, 0.6)).toBe(true);
  });

  it("lets one resident book the ground at a time and charges them the catering", async () => {
    expect((await currentOwambe(NOW)).host).toBeNull();
    const booked = await hostOwambe(host.id, { kind: "birthday", celebrant: "Iya Basira at 65", idempotencyKey: randomUUID() }, NOW);
    expect(booked.balance).toBe(START - OWAMBE.hostPrice.birthday);
    const party = await currentOwambe(NOW + 60_000);
    expect(party).toMatchObject({ kind: "birthday", celebrant: "Iya Basira at 65", host: host.username });
    await expect(hostOwambe(guest.id, { kind: "wedding", celebrant: "Ada & Emeka", idempotencyKey: randomUUID() }, NOW + 60_000)).rejects.toThrow(/booked/);
    expect(await balance(guest.id)).toBe(START);
    expect((await currentOwambe(NOW + OWAMBE.partyMs + 1)).host).toBeNull();
    expect(neighbourhoodParty(NOW).endsAt - neighbourhoodParty(NOW).startsAt).toBe(OWAMBE.partyMs);
  });

  it("feeds a guest for free, one plate every few minutes", async () => {
    const first = await servePlate(guest.id, "amala", NOW);
    expect(first).toMatchObject({ served: true, hunger: 20 + OWAMBE.hunger });
    const again = await servePlate(guest.id, "jollof", NOW + 30_000);
    expect(again.served).toBe(false);
    expect((await servePlate(guest.id, "jollof", NOW + OWAMBE.plateEveryMs + 1)).served).toBe(true);
    expect(await balance(guest.id)).toBe(START);
  });
});
