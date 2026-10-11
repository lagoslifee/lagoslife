import { getPlace, OFFENCES, POLICE_CHECKPOINTS, ROBBERY, SECURITY_PLANS } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import { listCitations } from "./justice-service.js";
import { setPlayerPosition } from "./player-presence.js";
import {
  dismissSecurity,
  getSecurityStatus,
  hireSecurity,
  policeRecords,
  policeWitness,
  reportRobbery,
  resolveCheckpoint,
  resolveRobbery,
  startRobbery,
} from "./police-service.js";

const users = [0, 1, 2, 3].map(() => ({
  id: `police-user-${randomUUID()}`,
  username: `cop${randomUUID().replaceAll("-", "").slice(0, 12)}`,
}));
const [robber, victim, guarded, newcomer] = users as [(typeof users)[0], (typeof users)[0], (typeof users)[0], (typeof users)[0]];
const where = { x: 0, z: 0, district: null };

async function balance(userId: string) {
  const result = await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId]);
  return Number(result.rows[0].balance);
}

beforeAll(async () => {
  for (const [index, user] of users.entries()) {
    const age = user === newcomer ? "NOW()" : "NOW() - INTERVAL '2 hours'";
    await pool.query(
      `INSERT INTO "user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Police Test', $2, FALSE, ${age}, NOW(), $3, $3)`,
      [user.id, `${user.username}${index}@example.test`, user.username],
    );
    await getEconomyState(user.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("checkpoints", () => {
  const checkpoint = POLICE_CHECKPOINTS[0]!;

  it("clears a driver whose papers are in order", async () => {
    const result = await resolveCheckpoint(victim.id, checkpoint.id, null, "comply", where);
    expect(result.outcome).toBe("cleared");
    expect(result.citation).toBeNull();
  });

  it("fines a driver in an uninsured car", async () => {
    const vehicleId = randomUUID();
    await pool.query(
      `INSERT INTO player_vehicle (id, owner_user_id, model_id, colour, plate, status, x, z, yaw, purchase_key)
       VALUES ($1, $2, 'corolla', '#ffffff', $3, 'parked', 0, 0, 0, $1)`,
      [vehicleId, robber.id, `T-${vehicleId.slice(0, 8)}`],
    );
    const result = await resolveCheckpoint(robber.id, checkpoint.id, vehicleId, "comply", where);
    expect(result.outcome).toBe("fined");
    expect(result.reason).toContain("insurance");
    expect(result.citation?.offence).toBe("no_papers");
    await pool.query(`UPDATE player_vehicle SET insured_until = NOW() + INTERVAL '1 day' WHERE id = $1`, [vehicleId]);
    expect((await resolveCheckpoint(robber.id, checkpoint.id, vehicleId, "comply", where)).outcome).toBe("cleared");
  });

  it("charges a driver who drives off and is caught, and lets one get away", async () => {
    const caught = await resolveCheckpoint(victim.id, checkpoint.id, null, "flee", where, () => 0.99);
    expect(caught.outcome).toBe("fled_caught");
    expect(caught.citation?.fine).toBe(OFFENCES.evading_checkpoint.fine);
    const escaped = await resolveCheckpoint(victim.id, checkpoint.id, null, "flee", where, () => 0);
    expect(escaped.outcome).toBe("fled_escaped");
    expect(escaped.citation).toBeNull();
  });

  it("knows where officers can see", () => {
    expect(policeWitness(...checkpoint.point)).toBe(true);
    expect(policeWitness(...getPlace("lekki-police-division").door)).toBe(true);
    expect(policeWitness(100_000, 100_000)).toBe(false);
  });
});

describe("robbery", () => {
  it("protects new residents and people with guards", async () => {
    await expect(startRobbery(robber.id, newcomer.id, 0, 0)).rejects.toThrow("only just arrived");
    setPlayerPosition(guarded.id, ...getPlace("eko-shield-security").door);
    await hireSecurity(guarded.id, "pair", randomUUID());
    await expect(startRobbery(robber.id, guarded.id, 0, 0)).rejects.toThrow("security");
  });

  it("takes a capped share only when the victim hands it over", async () => {
    const before = await balance(victim.id);
    const robberBefore = await balance(robber.id);
    const holdUp = await startRobbery(robber.id, victim.id, 0, 0);
    expect(holdUp.amount).toBe(Math.min(ROBBERY.cap, Math.floor(before * ROBBERY.share)));
    expect(await balance(victim.id)).toBe(before);
    const resolved = await resolveRobbery(holdUp.id, "robbed", where);
    expect(resolved?.amount).toBe(holdUp.amount);
    expect(await balance(victim.id)).toBe(before - holdUp.amount);
    expect(await balance(robber.id)).toBe(robberBefore + holdUp.amount);
    expect(await resolveRobbery(holdUp.id, "robbed", where)).toBeNull();
    await expect(startRobbery(robber.id, victim.id, 0, 0)).rejects.toThrow("Lie low");
  });

  it("returns the money when the victim reports it at a station", async () => {
    setPlayerPosition(victim.id, 0, 0);
    await expect(reportRobbery(victim.id, robber.username, "")).rejects.toThrow("police station");
    setPlayerPosition(victim.id, ...getPlace("ikoyi-police-station").door);
    const before = await balance(victim.id);
    const report = await reportRobbery(victim.id, robber.username, "He had a gun on Admiralty Way");
    expect(report.status).toBe("charged");
    expect(report.restitution).toBeGreaterThan(0);
    expect(await balance(victim.id)).toBe(before + report.restitution);
    expect((await listCitations(robber.id)).some((citation) => citation.offence === "armed_robbery")).toBe(true);
    const again = await reportRobbery(victim.id, robber.username, "");
    expect(again.status).toBe("no_record");
    const records = await policeRecords(victim.id);
    expect(records.robberies[0]).toMatchObject({ role: "victim", outcome: "robbed", reported: true });
    expect(records.cases.map((item) => item.status)).toEqual(["no_record", "charged"]);
  });

  it("does not believe a report the city has no record of", async () => {
    setPlayerPosition(guarded.id, ...getPlace("lekki-police-division").door);
    const report = await reportRobbery(guarded.id, robber.username, "");
    expect(report.status).toBe("no_record");
    expect(report.restitution).toBe(0);
  });
});

describe("security", () => {
  it("only hires at the company office and replaces the current hire", async () => {
    setPlayerPosition(guarded.id, 0, 0);
    await expect(hireSecurity(guarded.id, "squad", randomUUID())).rejects.toThrow("Eko Shield");
    setPlayerPosition(guarded.id, ...getPlace("eko-shield-security").door);
    const before = await balance(guarded.id);
    const key = randomUUID();
    const hired = await hireSecurity(guarded.id, "squad", key);
    expect(hired.status.guards).toBe(4);
    const replay = await hireSecurity(guarded.id, "squad", key);
    expect(replay.replayed).toBe(true);
    expect(await balance(guarded.id)).toBe(before - SECURITY_PLANS.squad.price);
    expect((await dismissSecurity(guarded.id)).guards).toBe(0);
    expect((await getSecurityStatus(guarded.id)).plan).toBeNull();
  });
});
