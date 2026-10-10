import { COMMUNITY, getPlace, lagosDay } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCommunityStatus, visitQuietPlace, volunteerShift } from "./community-service.js";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { setPlayerPosition } from "./player-presence.js";

const users = [0, 1, 2].map(() => ({
  id: `community-user-${randomUUID()}`,
  username: `com${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [reader, worshipper, volunteer] = users as [(typeof users)[0], (typeof users)[0], (typeof users)[0]];
const library = getPlace("ikoyi-reading-room");
const church = getPlace("grace-assembly");
const mosque = getPlace("al-noor-mosque");
const park = getPlace("muri-okunola-park");
const hall = getPlace("island-community-hall");

async function setEnergy(userId: string, energy: number) {
  await pool.query(`UPDATE player_profile SET energy = $2 WHERE user_id = $1`, [userId, energy]);
}

async function balance(userId: string) {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Community Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await getEconomyState(user.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("quiet places", () => {
  it("only counts a visit made at the venue", async () => {
    setPlayerPosition(reader.id, 0, 0);
    await expect(visitQuietPlace(reader.id, library.id)).rejects.toThrow(`Go to ${library.name}`);
  });

  it("refuses places that are not community venues", async () => {
    setPlayerPosition(reader.id, ...getPlace("mama-titi-buka").door);
    await expect(visitQuietPlace(reader.id, "mama-titi-buka")).rejects.toThrow("not a community venue");
    setPlayerPosition(reader.id, ...hall.door);
    await expect(visitQuietPlace(reader.id, hall.id)).rejects.toThrow("not a community venue");
  });

  it("gives the library, a church, a mosque and a park exactly the same effect", async () => {
    const gains: number[] = [];
    for (const [index, place] of [library, church, mosque, park].entries()) {
      const user = index % 2 === 0 ? reader : worshipper;
      await pool.query(`DELETE FROM community_visit WHERE user_id = $1`, [user.id]);
      await setEnergy(user.id, 50);
      setPlayerPosition(user.id, ...place.door);
      const result = await visitQuietPlace(user.id, place.id);
      expect(result.rested).toBe(true);
      gains.push(result.needs.energy - 50);
    }
    expect(gains).toEqual([COMMUNITY.quietVisitEnergy, COMMUNITY.quietVisitEnergy, COMMUNITY.quietVisitEnergy, COMMUNITY.quietVisitEnergy]);
  });

  it("shares one cooldown across every quiet place, and visits stay optional during it", async () => {
    await pool.query(`DELETE FROM community_visit WHERE user_id = $1`, [reader.id]);
    await setEnergy(reader.id, 40);
    setPlayerPosition(reader.id, ...library.door);
    const first = await visitQuietPlace(reader.id, library.id);
    expect(first.energyGain).toBe(COMMUNITY.quietVisitEnergy);
    expect(first.status.quietReadyAt).not.toBeNull();
    setPlayerPosition(reader.id, ...church.door);
    const second = await visitQuietPlace(reader.id, church.id);
    expect([second.rested, second.energyGain, second.needs.energy]).toEqual([false, 0, 40 + COMMUNITY.quietVisitEnergy]);
    await pool.query(
      `UPDATE community_visit SET created_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`,
      [reader.id, COMMUNITY.quietVisitCooldownMs / 1_000 + 5],
    );
    expect((await getCommunityStatus(reader.id)).quietReadyAt).toBeNull();
    const third = await visitQuietPlace(reader.id, church.id);
    expect(third.energyGain).toBe(COMMUNITY.quietVisitEnergy);
  });

  it("serialises simultaneous visits so the energy is only given once", async () => {
    await pool.query(`DELETE FROM community_visit WHERE user_id = $1`, [worshipper.id]);
    await setEnergy(worshipper.id, 30);
    setPlayerPosition(worshipper.id, ...park.door);
    const results = await Promise.all([0, 1, 2].map(() => visitQuietPlace(worshipper.id, park.id)));
    expect(results.filter(({ rested }) => rested)).toHaveLength(1);
    expect(Math.max(...results.map(({ needs }) => needs.energy))).toBe(30 + COMMUNITY.quietVisitEnergy);
  });

  it("never lifts energy above 100", async () => {
    await pool.query(`DELETE FROM community_visit WHERE user_id = $1`, [reader.id]);
    await setEnergy(reader.id, 97);
    setPlayerPosition(reader.id, ...library.door);
    const result = await visitQuietPlace(reader.id, library.id);
    expect([result.energyGain, result.needs.energy]).toEqual([3, 100]);
  });
});

describe("community hall volunteering", () => {
  it("must be done at the hall", async () => {
    setPlayerPosition(volunteer.id, ...library.door);
    await expect(volunteerShift(volunteer.id, hall.id)).rejects.toThrow(`Go to ${hall.name}`);
  });

  it("turns away a resident who is too tired", async () => {
    await setEnergy(volunteer.id, COMMUNITY.volunteerMinimumEnergy - 1);
    setPlayerPosition(volunteer.id, ...hall.door);
    await expect(volunteerShift(volunteer.id, hall.id)).rejects.toThrow("too tired");
  });

  it("pays one shift per Lagos day even when the request is repeated at once", async () => {
    await setEnergy(volunteer.id, 60);
    setPlayerPosition(volunteer.id, ...hall.door);
    const before = await balance(volunteer.id);
    const results = await Promise.all([0, 1, 2].map(() => volunteerShift(volunteer.id, hall.id)));
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(await balance(volunteer.id)).toBe(before + COMMUNITY.volunteerWage);
    const wages = await pool.query(`SELECT amount FROM game_transaction WHERE user_id = $1 AND kind = 'community_wage'`, [volunteer.id]);
    expect(wages.rows.map((row) => Number(row.amount))).toEqual([COMMUNITY.volunteerWage]);
    const paid = results.find(({ replayed }) => !replayed)!;
    expect(paid.needs.energy).toBe(60 - COMMUNITY.volunteerEnergyCost);
    expect(paid.status.volunteeredToday).toBe(true);
    const again = await volunteerShift(volunteer.id, hall.id);
    expect([again.replayed, again.wage]).toEqual([true, 0]);
  });

  it("opens a new shift on the next Lagos day", async () => {
    await pool.query(
      `UPDATE community_visit SET lagos_day = lagos_day - 1 WHERE user_id = $1 AND kind = 'volunteer'`,
      [volunteer.id],
    );
    await pool.query(
      `UPDATE game_transaction SET idempotency_key = idempotency_key || ':moved' WHERE user_id = $1 AND kind = 'community_wage'`,
      [volunteer.id],
    );
    expect((await getCommunityStatus(volunteer.id)).volunteeredToday).toBe(false);
    const next = await volunteerShift(volunteer.id, hall.id);
    expect(next.replayed).toBe(false);
    expect((await getCommunityStatus(volunteer.id)).volunteerDays).toBe(2);
  });
});

describe("lagosDay", () => {
  it("rolls over at midnight West Africa Time (UTC+1)", () => {
    expect(lagosDay(Date.UTC(2026, 9, 10, 22, 59))).toBe("2026-10-10");
    expect(lagosDay(Date.UTC(2026, 9, 10, 23, 0))).toBe("2026-10-11");
  });
});
