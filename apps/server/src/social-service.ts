import { randomUUID } from "node:crypto";
import { districtAt, filterChat, regionAt, SOCIAL, type DirectMessage, type FriendsStatus } from "@lagos-living/shared";
import { pool } from "./database.js";
import { EconomyError } from "./economy-service.js";
import { getPlayerPosition } from "./player-presence.js";
import { playerEvents } from "./player-events.js";
import { withinRate } from "./request-rate.js";
import { activeMute, hiddenPlayers } from "./safety-service.js";

const NAME = `COALESCE("displayUsername", username, name)`;

async function nameOf(userId: string) {
  const { rows } = await pool.query<{ name: string }>(`SELECT ${NAME} AS name FROM "user" WHERE id = $1`, [userId]);
  if (!rows[0]) throw new EconomyError("No such resident.", 404);
  return rows[0].name;
}

async function findByName(userName: string) {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, ${NAME} AS name FROM "user" WHERE LOWER(username) = LOWER($1) OR LOWER("displayUsername") = LOWER($1) LIMIT 1`,
    [userName.replace(/^@/, "")],
  );
  if (!rows[0]) throw new EconomyError("No resident goes by that name. Check the spelling of their username.", 404);
  return rows[0];
}

async function areFriends(a: string, b: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM friendship WHERE status = 'accepted' AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [a, b],
  );
  return Boolean(rowCount);
}

function whereNow(userId: string) {
  const position = getPlayerPosition(userId);
  if (!position) return { online: false, where: null, at: null };
  if (position.location !== "street") return { online: true, where: "Indoors", at: null };
  const district = districtAt(position.x, position.z);
  return { online: true, where: district?.name ?? (regionAt(position.x, position.z) === "dubai" ? "Dubai" : "Lagos"), at: [position.x, position.z] as const };
}

export async function friendsStatus(userId: string): Promise<FriendsStatus> {
  const [friends, incoming, outgoing, unread] = await Promise.all([
    pool.query<{ id: string; name: string; since: Date }>(
      `SELECT u.id, COALESCE(u."displayUsername", u.username, u.name) AS name, COALESCE(f.accepted_at, f.created_at) AS since
       FROM friendship f JOIN "user" u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)`,
      [userId],
    ),
    pool.query<{ id: string; name: string; at: Date }>(
      `SELECT u.id, COALESCE(u."displayUsername", u.username, u.name) AS name, f.created_at AS at
       FROM friendship f JOIN "user" u ON u.id = f.requester_id WHERE f.status = 'pending' AND f.addressee_id = $1 ORDER BY f.created_at DESC`,
      [userId],
    ),
    pool.query<{ id: string; name: string; at: Date }>(
      `SELECT u.id, COALESCE(u."displayUsername", u.username, u.name) AS name, f.created_at AS at
       FROM friendship f JOIN "user" u ON u.id = f.addressee_id WHERE f.status = 'pending' AND f.requester_id = $1 ORDER BY f.created_at DESC`,
      [userId],
    ),
    pool.query<{ sender_id: string; count: string }>(
      `SELECT sender_id, COUNT(*) AS count FROM direct_message WHERE recipient_id = $1 AND read_at IS NULL GROUP BY sender_id`,
      [userId],
    ),
  ]);
  const unreadBy = new Map(unread.rows.map((row) => [row.sender_id, Number(row.count)]));
  const me = whereNow(userId).at;
  const list = friends.rows.map((row) => {
    const now = whereNow(row.id);
    return {
      userId: row.id,
      userName: row.name,
      online: now.online,
      where: now.where,
      distance: me && now.at ? Math.round(Math.hypot(me[0] - now.at[0], me[1] - now.at[1])) : null,
      unread: unreadBy.get(row.id) ?? 0,
      since: new Date(row.since).toISOString(),
    };
  });
  list.sort((a, b) => b.unread - a.unread || Number(b.online) - Number(a.online) || a.userName.localeCompare(b.userName));
  const request = (row: { id: string; name: string; at: Date }) => ({ userId: row.id, userName: row.name, at: new Date(row.at).toISOString() });
  return { friends: list, incoming: incoming.rows.map(request), outgoing: outgoing.rows.map(request) };
}

/** Sends a friend request by username; if they already asked you, you become friends straight away. */
export async function requestFriend(userId: string, userName: string) {
  const target = await findByName(userName);
  if (target.id === userId) throw new EconomyError("That's you!");
  if ((await hiddenPlayers(userId)).has(target.id)) throw new EconomyError("You can't add someone you've blocked (or who has blocked you).", 403);
  const { rows: existing } = await pool.query<{ requester_id: string; status: string }>(
    `SELECT requester_id, status FROM friendship WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [userId, target.id],
  );
  const row = existing[0];
  if (row?.status === "accepted") throw new EconomyError(`You and ${target.name} are already friends.`);
  if (row?.requester_id === userId) throw new EconomyError(`You already asked ${target.name}. They'll see it in Phone → Friends.`);
  const { rows: count } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM friendship WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
    [userId],
  );
  if (Number(count[0]!.n) >= SOCIAL.maxFriends) throw new EconomyError(`You can have up to ${SOCIAL.maxFriends} friends.`);
  const me = await nameOf(userId);
  if (row) {
    await pool.query(`UPDATE friendship SET status = 'accepted', accepted_at = NOW() WHERE requester_id = $1 AND addressee_id = $2`, [target.id, userId]);
    playerEvents.emit("notice", target.id, "success", `👥 ${me} accepted your friend request. Message them in Phone → Friends.`);
    return { ...(await friendsStatus(userId)), result: `You and ${target.name} are now friends.` };
  }
  await pool.query(`INSERT INTO friendship (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`, [userId, target.id]);
  playerEvents.emit("notice", target.id, "info", `👥 ${me} sent you a friend request. Open Phone → Friends to accept.`);
  return { ...(await friendsStatus(userId)), result: `Friend request sent to ${target.name}.` };
}

export async function respondFriend(userId: string, fromId: string, accept: boolean) {
  const done = accept
    ? await pool.query(`UPDATE friendship SET status = 'accepted', accepted_at = NOW() WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [fromId, userId])
    : await pool.query(`DELETE FROM friendship WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [fromId, userId]);
  if (!done.rowCount) throw new EconomyError("That friend request is no longer there.", 404);
  if (accept) playerEvents.emit("notice", fromId, "success", `👥 ${await nameOf(userId)} accepted your friend request. Message them in Phone → Friends.`);
  return friendsStatus(userId);
}

/** Unfriends, or withdraws a request you sent. */
export async function removeFriend(userId: string, otherId: string) {
  await pool.query(`DELETE FROM friendship WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`, [userId, otherId]);
  return friendsStatus(userId);
}

function toMessage(row: { id: string; sender_id: string; recipient_id: string; shown: string; created_at: Date; sender_name: string }, userId: string): DirectMessage {
  return { id: row.id, from: row.sender_id, fromName: row.sender_name, to: row.recipient_id, text: row.shown, at: new Date(row.created_at).toISOString(), mine: row.sender_id === userId };
}

/** The latest messages with a friend, oldest first; opening it marks theirs as read. */
export async function conversation(userId: string, friendId: string) {
  if (!(await areFriends(userId, friendId))) throw new EconomyError("You can only message friends. Send them a friend request first.", 403);
  const { rows } = await pool.query(
    `SELECT m.id, m.sender_id, m.recipient_id, m.shown, m.created_at, COALESCE(u."displayUsername", u.username, u.name) AS sender_name
     FROM direct_message m JOIN "user" u ON u.id = m.sender_id
     WHERE (m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)
     ORDER BY m.created_at DESC LIMIT $3`,
    [userId, friendId, SOCIAL.pageSize],
  );
  await pool.query(`UPDATE direct_message SET read_at = NOW() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`, [userId, friendId]);
  const now = whereNow(friendId);
  return { friend: { userId: friendId, userName: await nameOf(friendId), online: now.online, where: now.where }, messages: rows.reverse().map((row) => toMessage(row, userId)) };
}

export async function sendDirectMessage(userId: string, to: string, text: string) {
  if (!(await areFriends(userId, to))) throw new EconomyError("You can only message friends. Send them a friend request first.", 403);
  if (await activeMute(userId)) throw new EconomyError("A moderator has muted your chat, so you can't send messages right now.", 403);
  if ((await hiddenPlayers(userId)).has(to)) throw new EconomyError("You can't message someone you've blocked (or who has blocked you).", 403);
  if (!(await withinRate(`dm:${userId}`, SOCIAL.messagesPerMinute, 60_000))) throw new EconomyError("Slow down a little: wait a moment before sending more messages.", 429);
  const { text: shown, filtered } = filterChat(text);
  const id = randomUUID();
  const { rows } = await pool.query<{ created_at: Date }>(
    `INSERT INTO direct_message (id, sender_id, recipient_id, body, shown, filtered) VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`,
    [id, userId, to, text, shown, filtered],
  );
  const me = await nameOf(userId);
  playerEvents.emit("notice", to, "info", `💬 ${me}: ${shown.length > 90 ? `${shown.slice(0, 87)}…` : shown}`);
  return toMessage({ id, sender_id: userId, recipient_id: to, shown, created_at: rows[0]!.created_at, sender_name: me }, userId);
}

export async function purgeExpiredMessages() {
  const { rowCount } = await pool.query(`DELETE FROM direct_message WHERE created_at < NOW() - make_interval(days => $1)`, [SOCIAL.retentionDays]);
  return rowCount ?? 0;
}
