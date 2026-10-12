import { randomUUID } from "node:crypto";
import { getPlace } from "@lagos-living/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { pool } = await import("./database.js");
const { cancelGig, completeGig, gigStatus, startGigWork, takeGig } = await import("./gig-service.js");
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
    const gig = status.board[0]!;
    await takeGig(user.id, gig.id);
    await expect(takeGig(user.id, status.board[1]!.id)).rejects.toThrow(/current gig/);
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

  it("lets a gig be cancelled and a new one taken", async () => {
    const status = await gigStatus(user.id);
    await takeGig(user.id, status.board[2]!.id);
    await cancelGig(user.id);
    expect((await gigStatus(user.id)).active).toBeNull();
  });
});
