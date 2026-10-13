import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXERCISES, fitnessNow, getPlace, GYM, gymLocation, INTERIOR_SPAWN, maxLiftKg, setEnergyCost, setGain } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { finishSet, gymStatus, hireTrainer, joinGym, startSet } = await import("./gym-service.js");
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

  it("only trains inside the gym (not on the street outside), and a set counts once its time is up", async () => {
    setPlayerPosition(user.id, door[0] + 500, door[1]);
    await expect(startSet(user.id, "bench")).rejects.toThrow(/Go inside/);
    setPlayerPosition(user.id, door[0], door[1]);
    await expect(startSet(user.id, "bench")).rejects.toThrow(/Go inside/);
    setPlayerPosition(user.id, INTERIOR_SPAWN[0], INTERIOR_SPAWN[1], gymLocation());
    expect(await startSet(user.id, "bench")).toMatchObject({ kg: maxLiftKg("bench", 0) });
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
    setPlayerPosition(user.id, INTERIOR_SPAWN[0], INTERIOR_SPAWN[1], gymLocation());
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

  it("only lets you lift what your training allows; heavier sets build more", async () => {
    setPlayerPosition(user.id, INTERIOR_SPAWN[0], INTERIOR_SPAWN[1], gymLocation());
    await pool.query(`UPDATE player_profile SET energy = 100, fitness = 0, trained_at = NOW() WHERE user_id = $1`, [user.id]);
    await expect(startSet(user.id, "bench", 140)).rejects.toThrow(/too heavy for you yet: you can lift up to 40 kg/);
    await expect(startSet(user.id, "bench", 33)).rejects.toThrow(/5 kg steps/);
    expect(await startSet(user.id, "bench", 20)).toMatchObject({ kg: 20 });
    await pool.query(`UPDATE player_profile SET gym_set_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, GYM.setSeconds + 1]);
    const light = await finishSet(user.id);
    expect(light).toMatchObject({ counted: true, kg: 20, cost: setEnergyCost("bench", 0, 20) });
    expect(setGain("bench", 0, 20)).toBeLessThan(setGain("bench", 0, 40));
    expect(setEnergyCost("bench", 0, 20)).toBeLessThan(setEnergyCost("bench", 0, 40));
    expect(light.counted && light.fitness).toBeCloseTo(setGain("bench", 0, 20));

    await pool.query(`UPDATE player_profile SET fitness = 1, trained_at = NOW() WHERE user_id = $1`, [user.id]);
    expect(await startSet(user.id, "bench", 140)).toMatchObject({ kg: 140 });
    expect(maxLiftKg("dumbbells", 0)).toBe(10);
    expect(maxLiftKg("dumbbells", 0.5)).toBe(22);
    expect(maxLiftKg("treadmill", 1)).toBeNull();
  });

  it("hires a trainer for an hour who spots one weight above your limit and makes each set count for more", async () => {
    setPlayerPosition(user.id, door[0], door[1]);
    await expect(hireTrainer(user.id, randomUUID())).rejects.toThrow(/Come inside/);
    setPlayerPosition(user.id, INTERIOR_SPAWN[0], INTERIOR_SPAWN[1], gymLocation());
    await pool.query(`UPDATE player_profile SET energy = 100, fitness = 0, trained_at = NOW(), gym_exercise = NULL WHERE user_id = $1`, [user.id]);
    await expect(startSet(user.id, "squat", 55)).rejects.toThrow(/too heavy/);
    const before = Number((await pool.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1`, [user.id])).rows[0]!.balance);
    const hired = await hireTrainer(user.id, randomUUID());
    expect(hired.charged).toBe(GYM.trainer.fee);
    expect(hired.balance).toBe(before - GYM.trainer.fee);
    expect((await hireTrainer(user.id, randomUUID())).charged).toBe(0);
    expect((await gymStatus(user.id)).trainerUntil).not.toBeNull();
    expect(maxLiftKg("squat", 0, true)).toBe(55);
    expect(await startSet(user.id, "squat", 55)).toMatchObject({ kg: 55 });
    // Switching machines mid-set starts the new one.
    expect(await startSet(user.id, "dumbbells", 10)).toMatchObject({ exercise: "dumbbells", kg: 10 });
    await pool.query(`UPDATE player_profile SET gym_set_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, GYM.setSeconds + 1]);
    const coached = await finishSet(user.id);
    expect(coached).toMatchObject({ counted: true, coached: true, kg: 10 });
    expect(coached.counted && coached.fitness).toBeCloseTo(setGain("dumbbells", 0, 10, true));
    expect(setGain("dumbbells", 0, 10, true)).toBeCloseTo(setGain("dumbbells", 0, 10) * (1 + GYM.trainer.gainBonus));
  });

  it("holds fitness for the grace days, then fades it", () => {
    const now = Date.now();
    expect(fitnessNow(0.5, new Date(now - (GYM.graceDays - 1) * 86_400_000), now)).toBe(0.5);
    expect(fitnessNow(0.5, new Date(now - (GYM.graceDays + 2) * 86_400_000), now)).toBeCloseTo(0.5 - 2 * GYM.fadePerDay);
  });
});
