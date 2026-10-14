import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIRCRAFT_RULES, aircraftById } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { buyAircraft, hangar, ownAircraft, payHop } = await import("./aircraft-service.js");
const { sprayCelebrant } = await import("./owambe-service.js");

const makeUser = (tag: string) => ({ id: `${tag}-${randomUUID()}`, username: `${tag.slice(0, 2)}${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const elite = makeUser("aircraft");
const host = makeUser("owhost");
const balance = async (id: string) => Number((await pool.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [id])).rows[0]!.balance);
const heli = aircraftById.get("robinson-r44")!;
const jet = aircraftById.get("embraer-phenom-300")!;

beforeAll(async () => {
  for (const user of [elite, host]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Aircraft Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [elite.id, heli.price + jet.price + 10_000_000]);
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO UPDATE SET balance = 0`, [host.id]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM owambe_booking WHERE host_user_id = $1`, [host.id]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[elite.id, host.id]]);
});

describe("helicopters and private jets", () => {
  it("buys once per key with a 5N- tail number and charges the full price", async () => {
    const start = await balance(elite.id);
    const key = randomUUID();
    const [first, again] = await Promise.all([buyAircraft(elite.id, heli.id, key), buyAircraft(elite.id, heli.id, key)]);
    expect(first.aircraft.id).toBe(again.aircraft.id);
    expect(first.aircraft.tail).toMatch(/^5N-[A-Z]{3}$/);
    expect(await balance(elite.id)).toBe(start - heli.price);
    await expect(buyAircraft(elite.id, "concorde", randomUUID())).rejects.toThrow(/isn't for sale/);
  });

  it("refuses what the wallet can't cover and caps the hangar", async () => {
    await expect(buyAircraft(elite.id, "gulfstream-g650er", randomUUID())).rejects.toThrow();
    await buyAircraft(elite.id, jet.id, randomUUID());
    expect((await hangar(elite.id)).length).toBe(2);
    await pool.query(`UPDATE wallet SET balance = $2 WHERE user_id = $1`, [elite.id, heli.price * 3]);
    for (let index = (await hangar(elite.id)).length; index < AIRCRAFT_RULES.maxOwned; index += 1) await buyAircraft(elite.id, heli.id, randomUUID());
    await expect(buyAircraft(elite.id, heli.id, randomUUID())).rejects.toThrow(/limit/);
  });

  it("only flies the owner's aircraft of the right kind, and charges each hop", async () => {
    const owned = await hangar(elite.id);
    const chopper = owned.find((entry) => entry.modelId === heli.id)!;
    const plane = owned.find((entry) => entry.modelId === jet.id)!;
    await expect(ownAircraft(host.id, chopper.id, "helicopter")).rejects.toThrow(/isn't in your hangar/);
    await expect(ownAircraft(elite.id, plane.id, "helicopter")).rejects.toThrow(/runway/);
    const before = await balance(elite.id);
    await payHop(elite.id, chopper.id, "Lekki Phase 1");
    expect(await balance(elite.id)).toBe(before - heli.tripCost);
  });
});

describe("spraying the celebrants", () => {
  it("pays the host at a resident's party, and nobody when you spray your own", async () => {
    await pool.query(`INSERT INTO owambe_booking (id, host_user_id, kind, celebrant, starts_at, ends_at) VALUES ($1, $2, 'birthday', 'Test Celebrant', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '20 minutes')`, [randomUUID(), host.id]);
    const before = await balance(elite.id);
    const sprayed = await sprayCelebrant(elite.id, 20_000);
    expect(sprayed.celebrant).toBe("Test Celebrant");
    expect(await balance(elite.id)).toBe(before - 20_000);
    expect(await balance(host.id)).toBe(20_000);
    await pool.query(`UPDATE wallet SET balance = 5000 WHERE user_id = $1`, [host.id]);
    const own = await sprayCelebrant(host.id, 5_000);
    expect(own.hostUserId).toBeNull();
    expect(await balance(host.id)).toBe(0);
    await expect(sprayCelebrant(host.id, 5_000)).rejects.toThrow();
  });
});
