import { getPlace, JUSTICE, OFFENCES } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { getEconomyState } from "./economy-service.js";
import {
  appealCitation,
  citationHistory,
  decideAppeal,
  hasOverdueFines,
  issueCitation,
  listAppeals,
  listCitations,
  payCitation,
} from "./justice-service.js";
import { setPlayerPosition } from "./player-presence.js";
import { DEALERSHIP_ID, purchaseVehicle } from "./vehicle-service.js";

const make = (label: string) => ({
  id: `justice-${label}-${randomUUID()}`,
  username: `${label.slice(0, 4)}${randomUUID().replaceAll("-", "").slice(0, 10)}`,
});
const driver = make("driver");
const second = make("second");
const judge = make("judge");
const users = [driver, second, judge];
const evidence = { x: 10, z: 20, speed: 16.4, district: "Lekki Phase 1" };
const fine = OFFENCES.careless_driving.fine;

async function balance(userId: string) {
  return Number((await pool.query(`SELECT balance FROM wallet WHERE user_id = $1`, [userId])).rows[0].balance);
}

async function clearCooldown(userId: string) {
  await pool.query(`UPDATE citation SET issued_at = issued_at - INTERVAL '1 hour' WHERE user_id = $1`, [userId]);
}

beforeAll(async () => {
  for (const user of users) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Justice Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
    await getEconomyState(user.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map(({ id }) => id)]);
});

describe("citations", () => {
  it("issues one citation however many crashes arrive at once", async () => {
    const results = await Promise.all([0, 1, 2, 3].map(() => issueCitation(driver.id, "careless_driving", evidence)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [citation] = await listCitations(driver.id);
    expect(citation).toMatchObject({ status: "unpaid", fine, evidence, appeal: null });
    expect(new Date(citation!.dueAt).getTime() - new Date(citation!.issuedAt).getTime()).toBe(JUSTICE.dueHours * 3_600_000);
  });

  it("charges the fine once, in game naira, under concurrent and repeated payment", async () => {
    const [citation] = await listCitations(driver.id);
    const before = await balance(driver.id);
    const key = randomUUID();
    const results = await Promise.allSettled([0, 1, 2].map(() => payCitation(driver.id, citation!.id, key)));
    expect(results.every(({ status }) => status === "fulfilled")).toBe(true);
    expect(await balance(driver.id)).toBe(before - fine);
    await payCitation(driver.id, citation!.id, randomUUID());
    expect(await balance(driver.id)).toBe(before - fine);
    const transactions = await pool.query(`SELECT amount FROM game_transaction WHERE user_id = $1 AND kind = 'fine_payment'`, [driver.id]);
    expect(transactions.rows.map(({ amount }) => Number(amount))).toEqual([-fine]);
  });

  it("refuses to let another player pay or appeal it", async () => {
    const [citation] = await listCitations(driver.id);
    await expect(payCitation(second.id, citation!.id, randomUUID())).rejects.toThrow("not yours");
    await expect(appealCitation(second.id, citation!.id, "this is not even my ticket")).rejects.toThrow("not yours");
  });

  it("runs an appeal: nothing is owed while it is reviewed, an overturned fine is void", async () => {
    await clearCooldown(driver.id);
    const citation = (await issueCitation(driver.id, "careless_driving", evidence))!;
    await appealCitation(driver.id, citation.id, "A danfo cut across me at the junction.");
    await expect(appealCitation(driver.id, citation.id, "and another thing entirely")).rejects.toThrow("once");
    await expect(payCitation(driver.id, citation.id, randomUUID())).rejects.toThrow("still being reviewed");
    expect((await listAppeals()).some(({ id, userName }) => id === citation.id && userName === driver.username)).toBe(true);
    await expect(decideAppeal({ userId: driver.id, name: driver.username }, citation.id, "overturned", "self")).rejects.toThrow("Another moderator");
    const decided = await decideAppeal({ userId: judge.id, name: judge.username }, citation.id, "overturned", "Dashcam supports the account.");
    expect(decided).toMatchObject({ status: "overturned", appeal: { outcome: "overturned", note: "Dashcam supports the account." } });
    await expect(decideAppeal({ userId: judge.id, name: judge.username }, citation.id, "upheld", "changed my mind")).rejects.toThrow("already");
    await expect(payCitation(driver.id, citation.id, randomUUID())).rejects.toThrow("overturned");
    const history = (await citationHistory(citation.id)).map(({ event, actorName }) => `${event}:${actorName}`);
    expect(history).toEqual([`issued:${JUSTICE.authority}`, `appealed:${driver.username}`, `overturned:${judge.username}`]);
  });

  it("makes an upheld fine payable again with at least a day to pay", async () => {
    await clearCooldown(driver.id);
    const citation = (await issueCitation(driver.id, "careless_driving", evidence))!;
    await pool.query(`UPDATE citation SET due_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [citation.id]);
    await appealCitation(driver.id, citation.id, "I was not driving fast at all.");
    const upheld = await decideAppeal({ userId: judge.id, name: judge.username }, citation.id, "upheld", "Speed confirmed by server log.");
    expect(upheld.status).toBe("unpaid");
    expect(new Date(upheld.dueAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const before = await balance(driver.id);
    await payCitation(driver.id, citation.id, randomUUID());
    expect(await balance(driver.id)).toBe(before - fine);
  });

  it("closes appeals after the due date and blocks new car purchases while a fine is overdue", async () => {
    const citation = (await issueCitation(second.id, "careless_driving", evidence))!;
    await pool.query(`UPDATE citation SET due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [citation.id]);
    await expect(appealCitation(second.id, citation.id, "too late but trying anyway")).rejects.toThrow("closed");
    expect(await hasOverdueFines(pool, second.id)).toBe(true);
    setPlayerPosition(second.id, ...getPlace(DEALERSHIP_ID).door);
    await expect(purchaseVehicle(second.id, "eko-hatch", "#c8102e", randomUUID())).rejects.toThrow("overdue traffic fines");
    await payCitation(second.id, citation.id, randomUUID());
    expect(await hasOverdueFines(pool, second.id)).toBe(false);
  });

  it("keeps the justice log append-only", async () => {
    await expect(pool.query(`DELETE FROM justice_event WHERE user_id = $1`, [driver.id])).rejects.toThrow("append-only");
  });
});
