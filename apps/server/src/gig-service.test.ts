import { randomUUID } from "node:crypto";
import { applyRepair, getPlace, newRepair, REPAIR_ACTIONS } from "@lagos-living/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { pool } = await import("./database.js");
const { cancelGig, completeGig, gigStatus, repairGig, startGigWork, takeGig } = await import("./gig-service.js");
const { setPlayerPosition } = await import("./player-presence.js");

const user = { id: `gig-${randomUUID()}`, username: `gig${randomUUID().replaceAll("-", "").slice(0, 12)}` };

beforeAll(async () => {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, 'Gig Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
    [user.id, `${user.username}@example.test`, user.username],
  );
});
afterAll(async () => {
  vi.useRealTimers();
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);
});

describe("gigs", () => {
  it("pays only after working the full time at the gig's door, once", async () => {
    const status = await gigStatus(user.id);
    expect(status.board.length).toBeGreaterThan(3);
    const gig = status.board.find((entry) => !entry.handsOn)!;
    await takeGig(user.id, gig.id);
    await expect(takeGig(user.id, status.board.find((entry) => entry.id !== gig.id)!.id)).rejects.toThrow(/current gig/);
    setPlayerPosition(user.id, 0, 0);
    await expect(startGigWork(user.id)).rejects.toThrow(/Go to/);
    const door = getPlace(gig.placeId).door;
    setPlayerPosition(user.id, door[0] + 2, door[1]);
    await startGigWork(user.id);
    await expect(completeGig(user.id)).rejects.toThrow(/Keep working/);
    await pool.query(`UPDATE gig_run SET started_work_at = NOW() - make_interval(secs => work_seconds + 1) WHERE user_id = $1`, [user.id]);
    const paid = await completeGig(user.id);
    expect(paid.reward).toBe(gig.reward);
    await expect(completeGig(user.id)).rejects.toThrow(/Start the job/);
    expect((await gigStatus(user.id)).completed).toBe(1);
  });

  it("pays a generator repair only after the real fault is found, fixed and the engine started", async () => {
    const place = getPlace("ade-auto-works");
    await pool.query(
      `INSERT INTO gig_run (id, user_id, gig_id, type_id, title, task, emoji, place_id, reward, work_seconds) VALUES ($1, $2, '1-generator', 'generator', 'Generator repair', 'Fix', 'x', $3, 90000, 25)`,
      [randomUUID(), user.id, place.id],
    );
    setPlayerPosition(user.id, place.door[0] + 1, place.door[1]);
    await expect(repairGig(user.id, "inspect-fuel")).rejects.toThrow(/Start the repair/);
    const started = await startGigWork(user.id);
    expect(started.handsOn).toBe(true);
    expect(started.repair).toEqual({ inspected: [], fixed: false, running: false, log: [] });
    await expect(completeGig(user.id)).rejects.toThrow(/isn't running/);
    const { rows } = await pool.query<{ repair: { fault: string } }>(`SELECT repair FROM gig_run WHERE user_id = $1 AND status = 'working'`, [user.id]);
    const fault = rows[0]!.repair.fault;
    const skip = () => pool.query(`UPDATE gig_run SET repair_action_at = NOW() - INTERVAL '10 seconds' WHERE user_id = $1`, [user.id]);

    const fix = { fuel: "refuel", plug: "replace-plug", filter: "clean-filter", oil: "top-oil" } as const;
    await expect(repairGig(user.id, fix[fault as keyof typeof fix])).rejects.toThrow(/before you work on it/);
    expect((await repairGig(user.id, "pull-start")).message).toMatch(/won't start/);
    await expect(repairGig(user.id, "inspect-oil")).rejects.toThrow(/Finish what/);
    await skip();
    const found = await repairGig(user.id, `inspect-${fault}` as (typeof REPAIR_ACTIONS)[number]);
    expect(found.message).toMatch(/dry|carbon|dust/);
    expect(JSON.stringify(found.gig)).not.toContain(`"fault"`);
    await skip();
    expect((await repairGig(user.id, fix[fault as keyof typeof fix])).gig.repair?.fixed).toBe(true);
    await skip();
    expect((await repairGig(user.id, "pull-start")).gig.repair?.running).toBe(true);
    setPlayerPosition(user.id, 0, 0);
    await expect(completeGig(user.id)).rejects.toThrow(/You left/);
    setPlayerPosition(user.id, place.door[0] + 1, place.door[1]);
    expect((await completeGig(user.id)).reward).toBe(90000);
  });

  it("wastes a fix on a healthy part", () => {
    const state = applyRepair(newRepair("oil"), "inspect-fuel").state;
    const wasted = applyRepair(state, "refuel");
    expect(wasted.state.fixed).toBe(false);
    expect(wasted.message).toMatch(/already/);
  });

  it("lets a gig be cancelled and a new one taken", async () => {
    const status = await gigStatus(user.id);
    await takeGig(user.id, status.board[2]!.id);
    await cancelGig(user.id);
    expect((await gigStatus(user.id)).active).toBeNull();
  });
});
