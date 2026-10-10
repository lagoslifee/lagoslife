import { Client, type Room } from "@colyseus/sdk";
import { MOVEMENT, routeLength, sampleRoute, walkable, type WorldSnapshotWire } from "@lagos-living/shared";
import { pack } from "msgpackr";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pool } from "./database.js";
import { savePlayerPlace } from "./economy-service.js";
import "./world-footprints.js";

/**
 * Local load test: real accounts, real multiplayer tokens, real room joins. Each bot jogs along the danfo loop
 * (offset from the centre line so buses are not blocked), sends position updates at 10 Hz and an occasional chat
 * line, and records what it actually receives. Only measured numbers are printed.
 *
 *   npm run load-test -w @lagos-living/server -- --bots 25 --duration 60
 *
 * Bots are accounts named LoadBotNN (loadbotNN@lagosliving.local). `--cleanup` deletes them afterwards.
 */
const { values } = parseArgs({
  options: {
    bots: { type: "string", default: "10" },
    duration: { type: "string", default: "60" },
    ramp: { type: "string", default: "10" },
    target: { type: "string", default: "http://localhost:2567" },
    origin: { type: "string", default: "http://localhost:5173" },
    "chat-every": { type: "string", default: "20" },
    /** Metres of road the bots start spread over. Small values pack everyone into one interest area (worst case). */
    spread: { type: "string", default: "120" },
    "server-pid": { type: "string" },
    cleanup: { type: "boolean", default: false },
    json: { type: "string" },
  },
});

const BOTS = Number(values.bots);
const DURATION_S = Number(values.duration);
const RAMP_S = Number(values.ramp);
const TARGET = values.target!;
const CHAT_EVERY_S = Number(values["chat-every"]);
const SPREAD_M = Number(values.spread);
const PASSWORD = process.env.LOAD_BOT_PASSWORD ?? "LoadBotLocalOnly!2026";
const SEND_HZ = 10;
const LANE_OFFSET = 3;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(TARGET) && process.env.LOAD_TEST_ALLOW_REMOTE !== "1") {
  console.error("Refusing to load-test a non-local target. Set LOAD_TEST_ALLOW_REMOTE=1 only for an environment you are authorised to test.");
  process.exit(2);
}

type BotStats = {
  name: string;
  joinMs: number | null;
  snapshots: number;
  gaps: number[];
  lag: number[];
  bytes: number[];
  wire: number[];
  visible: number[];
  corrections: number;
  sent: number;
  chatsSent: number;
  chatsHeard: number;
  chatLag: number[];
  error: string | null;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};
const maximum = (values: number[]) => values.reduce((max, value) => (value > max ? value : max), values.length ? -Infinity : 0);
const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

async function authenticate(index: number) {
  const name = `LoadBot${String(index).padStart(2, "0")}`;
  const email = `${name.toLowerCase()}@lagosliving.local`;
  const headers = { "content-type": "application/json", origin: values.origin! };
  let response = await fetch(`${TARGET}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!response.ok) {
    response = await fetch(`${TARGET}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: PASSWORD, name, username: name }),
    });
  }
  if (!response.ok) throw new Error(`${name}: sign-in failed (${response.status}) ${await response.text()}`);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return { name, userId: body.user.id, cookie };
}

function lanePoint(s: number) {
  const pose = sampleRoute(s);
  const rightX = Math.cos(pose.yaw);
  const rightZ = -Math.sin(pose.yaw);
  for (const offset of [LANE_OFFSET, 2, 0]) {
    const x = pose.x + rightX * offset;
    const z = pose.z + rightZ * offset;
    if (walkable(x, z)) return { x, z, yaw: pose.yaw };
  }
  return pose;
}

async function runBot(index: number, startAt: number, endAt: number, stats: BotStats) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, startAt - Date.now())));
  const began = Date.now();
  let room: Room | undefined;
  try {
    const identity = await authenticate(index);
    stats.name = identity.name;
    let s = (Math.min(SPREAD_M, routeLength()) / BOTS) * index;
    const start = lanePoint(s);
    await savePlayerPlace(identity.userId, start.x, start.z, "street");
    const tokenResponse = await fetch(`${TARGET}/api/multiplayer-token`, { method: "POST", headers: { cookie: identity.cookie, origin: values.origin! } });
    if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
    const { token } = (await tokenResponse.json()) as { token: string };
    room = await new Client(TARGET).joinOrCreate("lagos", { token });
    stats.joinMs = Date.now() - began;
    let lastSnapshot = 0;
    let position = { x: start.x, z: start.z };
    room.onMessage("snapshot", (snapshot: WorldSnapshotWire) => {
      const now = Date.now();
      stats.snapshots += 1;
      if (lastSnapshot) stats.gaps.push(now - lastSnapshot);
      lastSnapshot = now;
      stats.lag.push(now - snapshot.serverTime);
      if (stats.snapshots % 20 === 0) {
        stats.bytes.push(JSON.stringify(snapshot).length);
        stats.wire.push(pack(snapshot).length);
      }
      stats.visible.push(snapshot.players.length);
    });
    room.onMessage("self", (self: { x: number; z: number }) => {
      position = { x: self.x, z: self.z };
    });
    room.onMessage("correction", (point: { x: number; z: number }) => {
      stats.corrections += 1;
      position = point;
    });
    room.onMessage("chat", (message: { userName: string; at: number }) => {
      if (message.userName === identity.name) return;
      stats.chatsHeard += 1;
      stats.chatLag.push(Date.now() - message.at);
    });
    for (const type of ["notice", "saved", "vehicleStatus", "suspended"]) room.onMessage(type, () => undefined);

    let sequence = 0;
    let lastSent = Date.now();
    let nextChat = Date.now() + Math.random() * CHAT_EVERY_S * 1_000;
    while (Date.now() < endAt) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 / SEND_HZ));
      const now = Date.now();
      const step = MOVEMENT.jogSpeed * ((now - lastSent) / 1_000);
      lastSent = now;
      const ahead = lanePoint(s + step);
      if (Math.hypot(ahead.x - position.x, ahead.z - position.z) < 6) {
        s += step;
        position = { x: ahead.x, z: ahead.z };
      }
      room.send("position", { sequence: sequence++, x: position.x, z: position.z, yaw: ahead.yaw, motion: "jog" });
      stats.sent += 1;
      if (CHAT_EVERY_S > 0 && now >= nextChat) {
        room.send("chat", { text: `Load test line ${stats.chatsSent + 1} from ${identity.name}` });
        stats.chatsSent += 1;
        nextChat = now + CHAT_EVERY_S * 1_000;
      }
    }
  } catch (error) {
    stats.error = error instanceof Error ? error.message : String(error);
  } finally {
    await room?.leave().catch(() => undefined);
  }
}

function serverPid() {
  if (values["server-pid"]) return Number(values["server-pid"]);
  try {
    const port = new URL(TARGET).port || "80";
    return Number(execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"]).toString().trim().split("\n")[0]);
  } catch {
    return null;
  }
}

function sampleProcess(pid: number) {
  try {
    const [cpu, rss] = execFileSync("ps", ["-p", String(pid), "-o", "%cpu=,rss="]).toString().trim().split(/\s+/).map(Number);
    return { cpu: cpu!, rssMb: rss! / 1024 };
  } catch {
    return null;
  }
}

async function main() {
  const pid = serverPid();
  const started = Date.now();
  const holdStart = started + RAMP_S * 1_000;
  const endAt = holdStart + DURATION_S * 1_000;
  const stats: BotStats[] = Array.from({ length: BOTS }, () => ({
    name: "",
    joinMs: null,
    snapshots: 0,
    gaps: [],
    lag: [],
    bytes: [],
    wire: [],
    visible: [],
    corrections: 0,
    sent: 0,
    chatsSent: 0,
    chatsHeard: 0,
    chatLag: [],
    error: null,
  }));
  const serverSamples: Array<{ cpu: number; rssMb: number }> = [];
  /** CPU time from /proc over each interval; `ps` alone would average over the whole process lifetime. */
  const ticks = () => {
    if (!pid) return null;
    try {
      const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
      return Number(fields[11]) + Number(fields[12]);
    } catch {
      return null;
    }
  };
  let lastTicks = ticks();
  let lastAt = Date.now();
  const sampler = setInterval(() => {
    if (!pid || Date.now() < holdStart) {
      lastTicks = ticks();
      lastAt = Date.now();
      return;
    }
    const now = Date.now();
    const current = ticks();
    const sample = sampleProcess(pid);
    if (current !== null && lastTicks !== null && sample) {
      serverSamples.push({ cpu: ((current - lastTicks) / 100 / ((now - lastAt) / 1_000)) * 100, rssMb: sample.rssMb });
    }
    lastTicks = current;
    lastAt = now;
  }, 1_000);

  console.log(`Load test: ${BOTS} bots over ${SPREAD_M} m of road, ${RAMP_S}s ramp, ${DURATION_S}s hold, target ${TARGET}${pid ? ` (server pid ${pid})` : ""}`);
  await Promise.all(stats.map((entry, index) => runBot(index + 1, started + (RAMP_S * 1_000 * index) / Math.max(1, BOTS), endAt, entry)));
  clearInterval(sampler);

  const ok = stats.filter(({ error, joinMs }) => !error && joinMs !== null);
  const all = <K extends keyof BotStats>(key: K) => ok.flatMap((entry) => entry[key] as unknown as number[]);
  const gaps = all("gaps");
  const lag = all("lag");
  const summary = {
    bots: BOTS,
    joined: ok.length,
    failures: stats.filter(({ error }) => error).map(({ name, error }) => `${name || "?"}: ${error}`),
    holdSeconds: DURATION_S,
    spreadMetres: SPREAD_M,
    joinMs: { p50: percentile(ok.map(({ joinMs }) => joinMs!), 50), max: maximum(ok.map(({ joinMs }) => joinMs!)) },
    snapshotHz: round(gaps.length ? 1_000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) : null),
    snapshotGapMs: { p50: percentile(gaps, 50), p95: percentile(gaps, 95), p99: percentile(gaps, 99), max: gaps.length ? maximum(gaps) : null },
    serverToBotMs: { p50: percentile(lag, 50), p95: percentile(lag, 95), p99: percentile(lag, 99) },
    snapshotJsonBytes: { p50: percentile(all("bytes"), 50), max: maximum(all("bytes")) },
    /** msgpack size of the decoded payload, the encoding Colyseus uses for room messages. */
    snapshotWireBytes: { p50: percentile(all("wire"), 50), max: maximum(all("wire")) },
    downstreamKBps: round(((percentile(all("wire"), 50) ?? 0) * (gaps.length ? 1_000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0)) / 1_024),
    visiblePlayers: { p50: percentile(all("visible"), 50), max: maximum(all("visible")) },
    positionUpdatesSent: ok.reduce((sum, { sent }) => sum + sent, 0),
    corrections: ok.reduce((sum, { corrections }) => sum + corrections, 0),
    chat: {
      sent: ok.reduce((sum, { chatsSent }) => sum + chatsSent, 0),
      deliveries: ok.reduce((sum, { chatsHeard }) => sum + chatsHeard, 0),
      latencyMs: { p50: percentile(all("chatLag"), 50), p95: percentile(all("chatLag"), 95) },
    },
    server: serverSamples.length
      ? {
          cpuPercent: { mean: round(serverSamples.reduce((sum, { cpu }) => sum + cpu, 0) / serverSamples.length), max: round(maximum(serverSamples.map(({ cpu }) => cpu))) },
          rssMb: { max: round(maximum(serverSamples.map(({ rssMb }) => rssMb))) },
        }
      : null,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (values.json) writeFileSync(values.json, JSON.stringify(summary, null, 2));

  if (values.cleanup) {
    const removed = await pool.query(`DELETE FROM "user" WHERE email LIKE 'loadbot%@lagosliving.local'`);
    console.log(`Removed ${removed.rowCount} load-test accounts.`);
  }
  await pool.end();
}

await main();
