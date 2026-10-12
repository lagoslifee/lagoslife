import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXERCISES, fitnessNow, getPlace, GYM, gymLocation, INTERIOR_SPAWN, setEnergyCost } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { finishSet, gymStatus, joinGym, startSet } = await import("./gym-service.js");
const { setPlayerPosition } = await import("./player-presence.js");
const { profileEvents } = await import("./profile-service.js");

const user = { id: `gym-${randomUUID()}`, username: `gym${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const START = 1_000_000;
const door = getPlace(GYM.placeId).door;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Gym Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
  await pool.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = $2`, [user.id, START]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("gym", () => {
  it("is members only, and a membership is charged once per key", async () => {
    setPlayerPosition(user.id, door[0], door[1]);
    await expect(startSet(user.id, "bench")).rejects.toThrow(/Members only/);
    const key = randomUUID();
    const first = await joinGym(user.id, key);
    const again = await joinGym(user.id, key);
    expect(first.balance).toBe(START - GYM.monthlyFee);
    expect(again.balance).toBe(first.balance);
    expect((await gymStatus(user.id)).memberUntil).not.toBeNull();
  });

  it("only trains at the gym, and a set counts once its time is up", async () => {
    setPlayerPosition(user.id, door[0] + 500, door[1]);
    await expect(startSet(user.id, "bench")).rejects.toThrow(/Go inside/);
    setPlayerPosition(user.id, door[0], door[1]);
    await startSet(user.id, "bench");
    await expect(finishSet(user.id)).rejects.toThrow(/Keep going/);
    await pool.query(`UPDATE player_profile SET gym_set_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, GYM.setSeconds + 1]);
    const builds: number[] = [];
    const listener = (id: string, build: number) => id === user.id && builds.push(build);
    profileEvents.on("build", listener);
    const result = await finishSet(user.id);
    profileEvents.off("build", listener);
    expect(result).toMatchObject({ counted: true, fitness: GYM.gainPerSet });
    expect(builds).toEqual([GYM.gainPerSet]);
    await expect(finishSet(user.id)).rejects.toThrow(/Start a set/);
  });

  it("doesn't count a set if you walk off before it's done", async () => {
    await startSet(user.id, "treadmill");
    await pool.query(`UPDATE player_profile SET gym_set_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, GYM.setSeconds + 1]);
    setPlayerPosition(user.id, door[0] + 500, door[1]);
    expect(await finishSet(user.id)).toMatchObject({ counted: false });
    expect((await gymStatus(user.id)).fitness).toBeCloseTo(GYM.gainPerSet);
  });

  it("trains inside the gym, and the fitter you are the less energy a set takes", async () => {
    setPlayerPosition(user.id, INTERIOR_SPAWN[0], INTERIOR_SPAWN[1], gymLocation());
    await pool.query(`UPDATE player_profile SET energy = 100, fitness = 1, trained_at = NOW() WHERE user_id = $1`, [user.id]);
    await startSet(user.id, "treadmill");
    await pool.query(`UPDATE player_profile SET gym_set_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, GYM.setSeconds + 1]);
    const trained = await finishSet(user.id);
    expect(trained).toMatchObject({ counted: true, cost: setEnergyCost("treadmill", 1), energy: 100 - setEnergyCost("treadmill", 1) });
    expect(setEnergyCost("treadmill", 1)).toBeLessThan(setEnergyCost("treadmill", 0));
    expect(setEnergyCost("treadmill", 0)).toBe(EXERCISES.treadmill.energy);
    expect(setEnergyCost("treadmill", 0)).toBeGreaterThan(setEnergyCost("dumbbells", 0));
  });

  it("holds fitness for the grace days, then fades it", () => {
    const now = Date.now();
    expect(fitnessNow(0.5, new Date(now - (GYM.graceDays - 1) * 86_400_000), now)).toBe(0.5);
    expect(fitnessNow(0.5, new Date(now - (GYM.graceDays + 2) * 86_400_000), now)).toBeCloseTo(0.5 - 2 * GYM.fadePerDay);
  });
});
