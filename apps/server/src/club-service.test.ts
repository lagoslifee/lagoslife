import { CLUB_LAYOUT, clubLocation, CLUBS, getPlace } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buyWristband, getClubStatus, hasWristband, orderAtBar } from "./club-service.js";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";

const users = [0, 1].map(() => ({
  id: `club-user-${randomUUID()}`,
  username: `club${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [raver, broke] = users as [(typeof users)[0], (typeof users)[0]];
const club = getPlace("eko-nights");
const cover = CLUBS["eko-nights"]!.cover;

async function balance(userId: string) {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Club Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await getEconomyState(user.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("club door", () => {
  it("refuses places that are not clubs", async () => {
    await expect(getClubStatus(raver.id, "mama-titi-buka")).rejects.toThrow("not a club");
  });

  it("only sells a wristband at the door", async () => {
    setPlayerPosition(raver.id, 0, 0);
    await expect(buyWristband(raver.id, club.id)).rejects.toThrow("Go to the door");
  });

  it("charges the cover once per night", async () => {
    setPlayerPosition(raver.id, ...club.door);
    const start = await balance(raver.id);
    expect(await hasWristband(raver.id, club.id)).toBe(false);
    const first = await buyWristband(raver.id, club.id);
    expect(first.charged).toBe(cover);
    expect(first.status.wristband).toBe(true);
    const second = await buyWristband(raver.id, club.id);
    expect(second.charged).toBe(0);
    expect(await balance(raver.id)).toBe(start - cover);
    expect((await getClubStatus(raver.id, club.id)).nights).toBe(1);
  });

  it("will not let the wallet go negative", async () => {
    await pool.query(`UPDATE wallet SET balance = $2 WHERE user_id = $1`, [broke.id, cover - 1]);
    setPlayerPosition(broke.id, ...club.door);
    await expect(buyWristband(broke.id, club.id)).rejects.toThrow();
    expect(await hasWristband(broke.id, club.id)).toBe(false);
  });
});

describe("club bar", () => {
  it("only serves at the bar inside the club", async () => {
    setPlayerPosition(raver.id, ...CLUB_LAYOUT.bar, "street");
    await expect(orderAtBar(raver.id, club.id, "chapman", randomUUID())).rejects.toThrow("Walk up to the bar");
  });

  it("charges once per idempotency key and feeds the player", async () => {
    setPlayerPosition(raver.id, ...CLUB_LAYOUT.bar, clubLocation(club.id));
    await pool.query(`UPDATE player_profile SET hunger = 50, energy = 50 WHERE user_id = $1`, [raver.id]);
    const before = await balance(raver.id);
    const key = randomUUID();
    const first = await orderAtBar(raver.id, club.id, "small-chops", key);
    expect(first.replayed).toBe(false);
    expect(first.needs.hunger).toBe(70);
    const again = await orderAtBar(raver.id, club.id, "small-chops", key);
    expect(again.replayed).toBe(true);
    expect(await balance(raver.id)).toBe(before - first.item.price);
    await expect(orderAtBar(raver.id, club.id, "champagne", randomUUID())).rejects.toThrow("doesn't serve");
  });
});
