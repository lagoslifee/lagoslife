import { CHAT } from "@lagos-living/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import {
  activeMute,
  activeSuspension,
  applyModerationAction,
  blockPlayer,
  getSafetyStatus,
  hiddenPlayers,
  listAudit,
  listReports,
  purgeExpiredChat,
  recordChat,
  reportPlayer,
  residentRecord,
  resolveReport,
  safetyEvents,
  setStaffRole,
  unblockPlayer,
} from "./safety-service.js";

const make = (label: string) => ({
  id: `safety-${label}-${randomUUID()}`,
  username: `${label.slice(0, 4)}${randomUUID().replaceAll("-", "").slice(0, 10)}`,
});
const player = make("player");
const victim = make("victim");
const mod = make("mod");
const admin = make("admin");
const otherMod = make("othermod");
const elder = make("elder");
const witness = make("witness");
const everyone = [player, victim, mod, admin, otherMod, elder, witness];
const actor = (user: { id: string; username: string }) => ({ userId: user.id, name: user.username });

beforeAll(async () => {
  for (const user of everyone) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Safety Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  await setStaffRole({ userId: "console", name: "test console" }, admin.username, "admin", "test setup");
  await setStaffRole(actor(admin), mod.username, "moderator", "test setup");
  await setStaffRole(actor(admin), otherMod.username, "moderator", "test setup");
});

afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [everyone.map(({ id }) => id)]);
});

describe("blocking", () => {
  it("hides chat in both directions and can be undone", async () => {
    await blockPlayer(victim.id, player.username);
    expect((await hiddenPlayers(victim.id)).has(player.id)).toBe(true);
    expect((await hiddenPlayers(player.id)).has(victim.id)).toBe(true);
    expect((await getSafetyStatus(victim.id)).blocked.map(({ userName }) => userName)).toEqual([player.username]);
    await blockPlayer(victim.id, player.username);
    expect((await getSafetyStatus(victim.id)).blocked).toHaveLength(1);
    await unblockPlayer(victim.id, player.username);
    expect((await hiddenPlayers(player.id)).size).toBe(0);
  });

  it("refuses to block yourself or a name nobody has", async () => {
    await expect(blockPlayer(victim.id, victim.username)).rejects.toThrow("yourself");
    await expect(blockPlayer(victim.id, "nobody-by-this-name")).rejects.toThrow("No resident");
  });
});

describe("reports", () => {
  it("keeps one open report per reporter and target, with the chat line as evidence", async () => {
    const messageId = randomUUID();
    await recordChat({ id: messageId, userId: player.id, userName: player.username, location: "street", x: 0, z: 0, body: "nasty original", shown: "•••", filtered: true, recipients: 1 });
    const first = await reportPlayer(victim.id, { userName: player.username, reason: "harassment", details: "kept insulting me", chatMessageId: messageId });
    expect(first.reportId).toBeTruthy();
    const again = await reportPlayer(victim.id, { userName: player.username, reason: "spam", details: "" });
    expect(again).toMatchObject({ reportId: null, alreadyOpen: true });
    const queue = await listReports("open");
    const mine = queue.find((report) => report.id === first.reportId);
    expect(mine).toMatchObject({ reportedName: player.username, messageOriginal: "nasty original", messageShown: "•••" });
  });

  it("refuses evidence that the reported player did not write", async () => {
    const messageId = randomUUID();
    await recordChat({ id: messageId, userId: victim.id, userName: victim.username, location: "street", x: 0, z: 0, body: "hi", shown: "hi", filtered: false, recipients: 0 });
    await expect(reportPlayer(mod.id, { userName: player.username, reason: "spam", details: "", chatMessageId: messageId })).rejects.toThrow("not sent by");
  });
});

describe("chat retention", () => {
  it("purges chat past the retention window but keeps lines an open report points at", async () => {
    const [reported, stale, recent] = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of [reported, stale, recent]) {
      await recordChat({ id, userId: elder.id, userName: elder.username, location: "street", x: 0, z: 0, body: "line", shown: "line", filtered: false, recipients: 1 });
    }
    await pool.query(`UPDATE chat_message SET created_at = NOW() - make_interval(days => $2) WHERE id = ANY($1)`, [[reported, stale], CHAT.retentionDays + 1]);
    const { reportId } = await reportPlayer(witness.id, { userName: elder.username, reason: "harassment", details: "", chatMessageId: reported });
    const remaining = async () =>
      (await pool.query<{ id: string }>(`SELECT id FROM chat_message WHERE id = ANY($1)`, [[reported, stale, recent]])).rows.map(({ id }) => id).sort();

    await purgeExpiredChat();
    expect(await remaining()).toEqual([reported, recent].sort());
    await resolveReport(actor(mod), reportId!, "dismissed", "Retention test");
    await purgeExpiredChat();
    expect(await remaining()).toEqual([recent]);
  });
});

describe("moderation", () => {
  it("only lets staff act, never on themselves or on admins, and moderators not on other moderators", async () => {
    await expect(applyModerationAction(actor(player), { targetUserId: victim.id, action: "warn", reason: "no" })).rejects.toThrow("Not found");
    await expect(applyModerationAction(actor(mod), { targetUserId: mod.id, action: "warn", reason: "self" })).rejects.toThrow("your own");
    await expect(applyModerationAction(actor(mod), { targetUserId: admin.id, action: "mute", reason: "x", durationHours: 1 })).rejects.toThrow("staff");
    await expect(applyModerationAction(actor(mod), { targetUserId: otherMod.id, action: "warn", reason: "x" })).rejects.toThrow("staff");
    await expect(applyModerationAction(actor(admin), { targetUserId: otherMod.id, action: "warn", reason: "admin may warn a moderator" })).resolves.toBeTruthy();
  });

  it("warns, mutes and suspends with live events, resolves the report, and records every step in the audit log", async () => {
    const events: string[] = [];
    const listener = (userId: string, kind: string) => userId === player.id && events.push(kind);
    safetyEvents.on("sanctioned", listener);
    const [report] = (await listReports("open")).filter((entry) => entry.reportedId === player.id);

    await applyModerationAction(actor(mod), { targetUserId: player.id, action: "warn", reason: "Please keep chat friendly" });
    expect((await getSafetyStatus(player.id)).warnings.map(({ reason }) => reason)).toEqual(["Please keep chat friendly"]);

    await applyModerationAction(actor(mod), { targetUserId: player.id, action: "mute", reason: "Harassing another resident", durationHours: 2, reportId: report!.id });
    const mute = await activeMute(player.id);
    expect(mute?.endsAt!.getTime()).toBeGreaterThan(Date.now() + 1.9 * 3_600_000);
    expect((await listReports("actioned")).some(({ id }) => id === report!.id)).toBe(true);
    await expect(
      applyModerationAction(actor(mod), { targetUserId: player.id, action: "warn", reason: "again", reportId: report!.id }),
    ).rejects.toThrow("not open");

    await applyModerationAction(actor(mod), { targetUserId: player.id, action: "suspend", reason: "Repeated harassment", durationHours: 24 });
    expect(await activeSuspension(player.id)).toMatchObject({ reason: "Repeated harassment" });
    await applyModerationAction(actor(mod), { targetUserId: player.id, action: "lift_suspension", reason: "Appeal accepted" });
    expect(await activeSuspension(player.id)).toBeNull();
    await expect(applyModerationAction(actor(mod), { targetUserId: player.id, action: "lift_suspension", reason: "twice" })).rejects.toThrow("no active");

    safetyEvents.off("sanctioned", listener);
    expect(events).toEqual(["warn", "mute", "suspend", "lift_suspension"]);
    const trail = (await listAudit(500)).filter((entry) => entry.targetName === player.username).map(({ action }) => action);
    expect(trail).toEqual(["lift_suspension", "suspend", "mute", "warn"]);
    const record = await residentRecord(player.id);
    expect(record.chat.some(({ body }) => body === "nasty original")).toBe(true);
    expect(record.sanctions.filter(({ active }) => active).map(({ kind }) => kind)).toEqual(["mute"]);
  });

  it("dismisses reports with a note", async () => {
    const { reportId } = await reportPlayer(player.id, { userName: victim.username, reason: "other", details: "they ignored me" });
    await expect(resolveReport(actor(mod), reportId!, "dismissed", "Not a rules issue")).resolves.toMatchObject({ resolution: "dismissed" });
    await expect(resolveReport(actor(mod), reportId!, "dismissed", "twice")).rejects.toThrow("not open");
  });

  it("keeps the audit log append-only", async () => {
    await expect(pool.query(`UPDATE moderation_audit SET reason = 'edited' WHERE actor_id = $1`, [mod.id])).rejects.toThrow("append-only");
    await expect(pool.query(`DELETE FROM moderation_audit WHERE actor_id = $1`, [mod.id])).rejects.toThrow("append-only");
  });

  it("lets only admins change roles, and not their own", async () => {
    await expect(setStaffRole(actor(mod), player.username, "moderator", "promote")).rejects.toThrow("Not found");
    await expect(setStaffRole(actor(admin), admin.username, null, "step down")).rejects.toThrow("own role");
    await setStaffRole(actor(admin), otherMod.username, null, "rotation");
    expect((await getSafetyStatus(otherMod.id)).role).toBeNull();
  });
});
