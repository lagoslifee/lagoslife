import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { pool } = await import("./database.js");
const { playerEvents } = await import("./player-events.js");
const { blockPlayer, unblockPlayer } = await import("./safety-service.js");
const { conversation, friendsStatus, purgeExpiredMessages, removeFriend, requestFriend, respondFriend, sendDirectMessage } = await import("./social-service.js");

const make = () => ({ id: `soc-${randomUUID()}`, username: `soc${randomUUID().replaceAll("-", "").slice(0, 12)}` });
const ada = make();
const bayo = make();
const chi = make();
const notices: Array<[string, string]> = [];
const listen = (userId: string, _tone: string, text: string) => notices.push([userId, text]);

beforeAll(async () => {
  for (const user of [ada, bayo, chi]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, 'Social Test', $2, FALSE, NOW(), NOW(), $3, $3)`,
      [user.id, `${user.username}@example.test`, user.username],
    );
  }
  playerEvents.on("notice", listen);
});

afterAll(async () => {
  playerEvents.off("notice", listen);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[ada.id, bayo.id, chi.id]]);
});

describe("friends", () => {
  it("sends a request, tells the other resident, and becomes a friendship once accepted", async () => {
    const sent = await requestFriend(ada.id, bayo.username.toUpperCase());
    expect(sent.result).toMatch(/request sent/);
    expect(sent.outgoing.map((r) => r.userId)).toEqual([bayo.id]);
    expect(notices.some(([to, text]) => to === bayo.id && /friend request/.test(text))).toBe(true);
    await expect(requestFriend(ada.id, bayo.username)).rejects.toThrow(/already asked/);

    const theirs = await friendsStatus(bayo.id);
    expect(theirs.incoming.map((r) => r.userName)).toEqual([ada.username]);
    const accepted = await respondFriend(bayo.id, ada.id, true);
    expect(accepted.friends).toMatchObject([{ userId: ada.id, online: false, unread: 0 }]);
    expect((await friendsStatus(ada.id)).friends.map((f) => f.userId)).toEqual([bayo.id]);
    await expect(requestFriend(ada.id, bayo.username)).rejects.toThrow(/already friends/);
  });

  it("accepts straight away when both residents asked each other, and refuses yourself or unknown names", async () => {
    await requestFriend(chi.id, ada.username);
    const mutual = await requestFriend(ada.id, chi.username);
    expect(mutual.result).toMatch(/now friends/);
    expect(mutual.friends.map((f) => f.userId).sort()).toEqual([bayo.id, chi.id].sort());
    await expect(requestFriend(ada.id, ada.username)).rejects.toThrow(/That's you/);
    await expect(requestFriend(ada.id, "no-such-resident-here")).rejects.toThrow(/No resident/);
  });

  it("declining or withdrawing removes the request", async () => {
    await removeFriend(chi.id, bayo.id);
    await requestFriend(chi.id, bayo.username);
    expect((await respondFriend(bayo.id, chi.id, false)).incoming).toEqual([]);
    await expect(respondFriend(bayo.id, chi.id, true)).rejects.toThrow(/no longer there/);
    await requestFriend(chi.id, bayo.username);
    expect((await removeFriend(chi.id, bayo.id)).outgoing).toEqual([]);
    expect((await friendsStatus(bayo.id)).incoming).toEqual([]);
  });
});

describe("private messages", () => {
  it("only friends can message; messages are filtered, counted unread and marked read when opened", async () => {
    await expect(sendDirectMessage(bayo.id, chi.id, "hi")).rejects.toThrow(/only message friends/);
    const sent = await sendDirectMessage(bayo.id, ada.id, "Meet me at Lekki Phase 1?");
    expect(sent).toMatchObject({ from: bayo.id, to: ada.id, mine: true, text: "Meet me at Lekki Phase 1?" });
    expect(notices.some(([to, text]) => to === ada.id && text.includes("Meet me"))).toBe(true);
    expect((await friendsStatus(ada.id)).friends.find((f) => f.userId === bayo.id)?.unread).toBe(1);

    const thread = await conversation(ada.id, bayo.id);
    expect(thread.friend.userName).toBe(bayo.username);
    expect(thread.messages).toMatchObject([{ from: bayo.id, mine: false, text: "Meet me at Lekki Phase 1?" }]);
    expect((await friendsStatus(ada.id)).friends.find((f) => f.userId === bayo.id)?.unread).toBe(0);
    await expect(conversation(chi.id, bayo.id)).rejects.toThrow(/only message friends/);
  });

  it("blocking stops messages and new requests", async () => {
    await blockPlayer(ada.id, bayo.username);
    await expect(sendDirectMessage(bayo.id, ada.id, "hello?")).rejects.toThrow(/blocked/);
    await removeFriend(ada.id, bayo.id);
    await expect(requestFriend(bayo.id, ada.username)).rejects.toThrow(/blocked/);
    await unblockPlayer(ada.id, bayo.username);
  });

  it("purges messages past retention", async () => {
    await pool.query(`UPDATE direct_message SET created_at = NOW() - INTERVAL '120 days' WHERE sender_id = $1`, [bayo.id]);
    expect(await purgeExpiredMessages()).toBeGreaterThanOrEqual(1);
    expect((await pool.query(`SELECT 1 FROM direct_message WHERE sender_id = $1`, [bayo.id])).rowCount).toBe(0);
  });
});
