import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REST } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { finishRest, startRest } = await import("./home-living-service.js");
const { setPlayerPosition } = await import("./player-presence.js");

const user = { id: `rest-${randomUUID()}`, username: `rest${randomUUID().replaceAll("-", "").slice(0, 12)}` };
const sitFor = (seconds: number) =>
  pool.query(`UPDATE player_profile SET rest_started_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [user.id, seconds]);
const setEnergy = (energy: number) => pool.query(`UPDATE player_profile SET energy = $2 WHERE user_id = $1`, [user.id, energy]);

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Rest Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("resting at home", () => {
  it("only starts indoors at home", async () => {
    setPlayerPosition(user.id, 0, 0, "street");
    await expect(startRest(user.id)).rejects.toThrow(/home or hotel/);
  });

  it("pays energy for the time seated, capped at 100", async () => {
    setPlayerPosition(user.id, 0, 0, `starter:${user.id}`);
    await startRest(user.id);
    await setEnergy(40);
    await sitFor(120);
    expect(await finishRest(user.id)).toMatchObject({ gained: 2 * REST.energyPerMinute, energy: 40 + 2 * REST.energyPerMinute });
    expect((await finishRest(user.id)).gained).toBe(0);
    await startRest(user.id);
    await setEnergy(95);
    await sitFor(REST.maxMinutes * 60 * 3);
    expect(await finishRest(user.id)).toMatchObject({ gained: 5, energy: 100 });
  });

  it("pays nothing if you left the room before standing up", async () => {
    await startRest(user.id);
    await setEnergy(30);
    await sitFor(300);
    setPlayerPosition(user.id, 0, 0, "street");
    expect(await finishRest(user.id)).toMatchObject({ gained: 0, energy: 30 });
  });
});
