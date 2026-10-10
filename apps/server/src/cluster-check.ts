import { Client, type Room } from "@colyseus/sdk";
import { defaultAppearance, getPlace, type CharacterAppearance, type WorldSnapshotWire } from "@lagos-living/shared";
import { parseArgs } from "node:util";
import { pool } from "./database.js";
import { savePlayerPlace } from "./economy-service.js";

/**
 * Local check that two server processes sharing one Redis behave as one game: both players land in the same room,
 * an HTTP mutation on one process reaches the room on the other, and position checks see players hosted elsewhere.
 */
const { values } = parseArgs({
  options: {
    a: { type: "string", default: "http://localhost:2571" },
    b: { type: "string", default: "http://localhost:2572" },
    origin: { type: "string", default: "http://localhost:5173" },
  },
});
const PASSWORD = process.env.LOAD_BOT_PASSWORD ?? "LoadBotLocalOnly!2026";
const origin = values.origin!;

async function authenticate(target: string, name: string) {
  const email = `${name.toLowerCase()}@lagosliving.local`;
  const headers = { "content-type": "application/json", origin };
  const post = (path: string, body: object) =>
    fetch(`${target}/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  let response = await post("sign-in/email", { email, password: PASSWORD });
  if (!response.ok) response = await post("sign-up/email", { email, password: PASSWORD, name, username: name });
  if (!response.ok) throw new Error(`${name}: sign-in failed (${response.status}) ${await response.text()}`);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return { name, userId: body.user.id, cookie };
}

async function join(target: string, cookie: string) {
  const response = await fetch(`${target}/api/multiplayer-token`, { method: "POST", headers: { cookie, origin } });
  if (!response.ok) throw new Error(`token ${response.status}`);
  const { token } = (await response.json()) as { token: string };
  const room = await new Client(target).joinOrCreate("lagos", { token });
  for (const type of ["self", "snapshot", "look", "looks", "chat"]) room.onMessage(type, () => undefined);
  return room;
}

function waitFor<T>(room: Room, type: string, accept: (message: T) => boolean, ms = 5_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no matching "${type}" within ${ms} ms`)), ms);
    room.onMessage(type, (message: T) => {
      if (!accept(message)) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
}

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${check}: ${detail}`);
};

const hub = getPlace("swift-parcel-hub");
const start = { x: hub.kerb[0], z: hub.kerb[1], yaw: 0 };
const rooms: Room[] = [];
try {
  const alpha = await authenticate(values.a!, "ClusterBotA");
  const beta = await authenticate(values.b!, "ClusterBotB");
  await savePlayerPlace(alpha.userId, start.x, start.z, "street");
  await savePlayerPlace(beta.userId, start.x + 3, start.z, "street");

  const roomA = await join(values.a!, alpha.cookie);
  const roomB = await join(values.b!, beta.cookie);
  rooms.push(roomA, roomB);
  record("same room", roomA.roomId === roomB.roomId, `via A ${roomA.roomId}, via B ${roomB.roomId}`);

  const seen = waitFor<WorldSnapshotWire>(roomB, "snapshot", (snapshot) =>
    snapshot.players.some((player) => player.sessionId === roomA.sessionId));
  roomA.send("position", { sequence: 1, x: start.x, z: start.z, yaw: start.yaw, motion: "idle" });
  await seen.then(
    () => record("players see each other", true, "B's snapshot includes A's player"),
    (error: Error) => record("players see each other", false, error.message),
  );

  // The room lives on one of the two processes, so going through both always crosses processes at least once.
  for (const [label, target] of [["A", values.a!], ["B", values.b!]] as const) {
    const look = waitFor<{ sessionId: string; appearance: CharacterAppearance }>(roomB, "look", (message) =>
      message.sessionId === roomA.sessionId);
    const hairstyle = label === "A" ? "afro" : "locs";
    const saved = await fetch(`${target}/api/character`, {
      method: "PUT",
      headers: { cookie: alpha.cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ appearance: { ...defaultAppearance, hairstyle } }),
    });
    await look.then(
      (message) => record(`HTTP on ${label} reaches the room`, saved.ok && message.appearance.hairstyle === hairstyle,
        `PUT /api/character ${saved.status}, look hairstyle ${message.appearance.hairstyle}`),
      (error: Error) => record(`HTTP on ${label} reaches the room`, false, `PUT ${saved.status}: ${error.message}`),
    );

    const delivery = await fetch(`${target}/api/jobs/delivery/start`, { method: "POST", headers: { cookie: alpha.cookie, origin } });
    record(`${label} knows where the player stands`, delivery.ok,
      `starting a delivery at ${hub.name} through ${label}: ${delivery.status} ${delivery.ok ? "" : await delivery.text()}`.trim());
  }
} catch (error) {
  record("run", false, (error as Error).message);
} finally {
  await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
  await pool.end();
}
process.exit(results.every((result) => result.ok) ? 0 : 1);
