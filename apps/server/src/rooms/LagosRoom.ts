import {
  boardRequestSchema,
  emoteRequestSchema,
  enterPropertySchema,
  getPlace,
  INTERIOR_HALF,
  INTERIOR_ORIGIN,
  INTERIOR_SPAWN,
  insideBuilding,
  MOVEMENT,
  nearestSafePoint,
  positionUpdateSchema,
  routeDistanceAhead,
  routeLength,
  sampleRoute,
  TRANSIT,
  withinWorld,
  type BusState,
  type MotionState,
  type Notice,
  type SelfState,
  type WorldSnapshot,
} from "@lagos-living/shared";
import { Client, Room, type AuthContext } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { randomUUID } from "node:crypto";
import {
  chargeFare,
  EconomyError,
  endJourney,
  loadPlayerPlace,
  savePlayerPlace,
} from "../economy-service.js";
import { verifyMultiplayerToken, type MultiplayerIdentity } from "../multiplayer-token.js";
import { removePlayerPosition, setPlayerPosition } from "../player-presence.js";
import { isPropertyAvailable, requirePropertyAccess } from "../property-service.js";

export const LagosState = schema({
  tick: t.uint32().default(0),
});
export type LagosState = SchemaType<typeof LagosState>;

type LagosClient = Client & { auth: MultiplayerIdentity };

export const BUS_CAPACITY = 14;
const BUS_CRUISE = 12.5;
const BUS_ACCEL = 1.8;
const BUS_BRAKE = 2.4;
const BUS_DWELL_MS = 9_000;
const BUS_DWELL_EXTENDED_MS = 16_000;
const BOARD_RANGE = 5.5;
const INTEREST_RADIUS = 180;
const STUCK_RECOVERY_MS = 20_000;

type Player = {
  sessionId: string;
  userId: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  motion: MotionState;
  location: string;
  previewOnly: boolean;
  propertyId: string | null;
  returnPoint: [number, number];
  busId: string | null;
  seat: number | null;
  journeyId: string | null;
  carrying: boolean;
  connected: boolean;
  lastSequence: number;
  lastAcceptedAt: number;
  lastSavedAt: number;
  lastUnstuckAt: number;
  rate: { since: number; count: number };
  actionRate: { since: number; count: number };
  boarding: boolean;
  alightAtNext: boolean;
};

type Bus = {
  id: string;
  s: number;
  speed: number;
  state: BusState["state"];
  dwellUntil: number;
  dwellStartedAt: number;
  stopIndex: number;
  currentStopId: string | null;
  stopRequested: boolean;
  seats: Array<string | null>;
  lastMovedAt: number;
};

function nextStopIndex(s: number) {
  let bestIndex = 0;
  let bestAhead = Infinity;
  TRANSIT.stops.forEach((stop: { s: number }, index: number) => {
    const ahead = routeDistanceAhead(s, stop.s);
    if (ahead > 0.5 && ahead < bestAhead) {
      bestAhead = ahead;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export class LagosRoom extends Room<{ state: LagosState; client: LagosClient }> {
  maxClients = 40;
  state = new LagosState();
  private players = new Map<string, Player>();
  private buses: Bus[] = [];

  onAuth(_client: LagosClient, options: { token?: unknown }, _context: AuthContext) {
    return verifyMultiplayerToken(options.token);
  }

  onCreate() {
    const length = routeLength();
    this.buses = [0, 1, 2].map((index) => {
      const s = (length / 3) * index + 20;
      return {
        id: `danfo-${index + 1}`,
        s,
        speed: 0,
        state: "driving",
        dwellUntil: 0,
        dwellStartedAt: 0,
        stopIndex: nextStopIndex(s),
        currentStopId: null,
        stopRequested: false,
        seats: Array.from({ length: BUS_CAPACITY }, () => null),
        lastMovedAt: Date.now(),
      };
    });

    this.onMessage("position", (client, payload) => this.handlePosition(client, payload));
    this.onMessage("board", (client, payload) => void this.handleBoard(client, payload));
    this.onMessage("alight", (client) => this.handleAlight(client));
    this.onMessage("requestStop", (client) => this.handleRequestStop(client));
    this.onMessage("enterProperty", (client, payload) => void this.handleEnterProperty(client, payload));
    this.onMessage("exitProperty", (client) => this.handleExitProperty(client));
    this.onMessage("unstuck", (client) => this.handleUnstuck(client));
    this.onMessage("emote", (client, payload) => {
      const player = this.players.get(client.sessionId);
      const parsed = emoteRequestSchema.safeParse(payload);
      if (!player || !parsed.success || player.busId) return;
      player.motion = parsed.data.emote === "none" ? "idle" : parsed.data.emote;
    });
    this.onMessage("carrying", (client, payload) => {
      const player = this.players.get(client.sessionId);
      if (player) player.carrying = payload === true;
    });

    this.setFixedTimestep(({ dt }) => this.tickWorld(dt), 50);
  }

  async onJoin(client: LagosClient) {
    const home = getPlace("starter-home");
    const saved = await loadPlayerPlace(client.auth.userId).catch(() => null);
    let spawn: [number, number] = [...home.door];
    if (saved && withinWorld(saved.x, saved.z) && !insideBuilding(saved.x, saved.z)) {
      spawn = [saved.x, saved.z];
    }
    const now = Date.now();
    const player: Player = {
      sessionId: client.sessionId,
      userId: client.auth.userId,
      name: client.auth.name,
      x: spawn[0],
      z: spawn[1],
      yaw: 0,
      motion: "idle",
      location: "street",
      previewOnly: false,
      propertyId: null,
      returnPoint: spawn,
      busId: null,
      seat: null,
      journeyId: null,
      carrying: false,
      connected: true,
      lastSequence: -1,
      lastAcceptedAt: now,
      lastSavedAt: now,
      lastUnstuckAt: 0,
      rate: { since: now, count: 0 },
      actionRate: { since: now, count: 0 },
      boarding: false,
      alightAtNext: false,
    };
    for (const [sessionId, existing] of this.players) {
      if (existing.userId === player.userId) {
        this.releaseSeat(existing, "interrupted");
        this.players.delete(sessionId);
      }
    }
    this.players.set(client.sessionId, player);
    setPlayerPosition(player.userId, player.x, player.z, player.location);
    this.sendSelf(client, player, saved ? "Welcome back — progress restored." : "Welcome to Lekki Phase 1.");
  }

  async onLeave(client: LagosClient) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    try {
      await this.allowReconnection(client, 25);
      player.connected = true;
      player.lastAcceptedAt = Date.now();
      this.sendSelf(client, player, player.busId ? "Reconnected — you are still aboard." : "Reconnected.");
    } catch {
      if (player.busId) {
        const bus = this.buses.find(({ id }) => id === player.busId);
        const stop = bus ? TRANSIT.stops[bus.stopIndex]! : TRANSIT.stops[0]!;
        player.x = stop.alight[0];
        player.z = stop.alight[1];
        this.releaseSeat(player, "interrupted", stop.id);
      }
      await this.persist(player).catch(() => undefined);
      if (this.players.get(client.sessionId) === player) this.players.delete(client.sessionId);
      removePlayerPosition(player.userId);
    }
  }

  async onDispose() {
    await Promise.all([...this.players.values()].map((player) => this.persist(player).catch(() => undefined)));
  }

  private persist(player: Player) {
    const onStreet = player.location === "street" && !player.busId;
    const [x, z] = onStreet ? [player.x, player.z] : player.returnPoint;
    player.lastSavedAt = Date.now();
    return savePlayerPlace(player.userId, x, z, onStreet ? "street" : player.location);
  }

  private limited(rate: { since: number; count: number }, max: number) {
    const now = Date.now();
    if (now - rate.since >= 1_000) {
      rate.since = now;
      rate.count = 0;
    }
    rate.count += 1;
    return rate.count > max;
  }

  private notify(client: Client, notice: Notice) {
    client.send("notice", notice);
  }

  private sendSelf(client: Client, player: Player, reason: string) {
    const self: SelfState = {
      x: player.x,
      z: player.z,
      location: player.location,
      propertyId: player.propertyId,
      previewOnly: player.previewOnly,
      busId: player.busId,
      seat: player.seat,
      reason,
    };
    client.send("self", self);
  }

  private clientFor(player: Player) {
    return this.clients.find(({ sessionId }) => sessionId === player.sessionId);
  }

  private handlePosition(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    if (!player || this.limited(player.rate, 30)) return;
    const parsed = positionUpdateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.sequence <= player.lastSequence) return;
    player.lastSequence = parsed.data.sequence;
    if (player.busId) return;
    const now = Date.now();
    const elapsed = Math.min(1.5, Math.max(0.03, (now - player.lastAcceptedAt) / 1_000));
    const allowed = MOVEMENT.sprintSpeed * 1.35 * elapsed + 0.75;
    const distance = Math.hypot(parsed.data.x - player.x, parsed.data.z - player.z);
    const inInterior = player.location !== "street";
    const valid = inInterior
      ? Math.abs(parsed.data.x - INTERIOR_ORIGIN[0]) <= INTERIOR_HALF[0] &&
        Math.abs(parsed.data.z - INTERIOR_ORIGIN[1]) <= INTERIOR_HALF[1]
      : withinWorld(parsed.data.x, parsed.data.z) && !insideBuilding(parsed.data.x, parsed.data.z);
    if (distance > allowed || !valid) {
      client.send("correction", { x: player.x, z: player.z, sequence: parsed.data.sequence });
      player.lastAcceptedAt = now;
      return;
    }
    player.x = parsed.data.x;
    player.z = parsed.data.z;
    player.yaw = parsed.data.yaw;
    player.motion = parsed.data.motion;
    player.lastAcceptedAt = now;
    setPlayerPosition(player.userId, player.x, player.z, player.location);
    if (!inInterior && now - player.lastSavedAt > 10_000) void this.persist(player).catch(() => undefined);
  }

  private busDoor(bus: Bus) {
    const pose = sampleRoute(bus.s);
    const rightX = Math.cos(pose.yaw);
    const rightZ = -Math.sin(pose.yaw);
    return { x: pose.x + rightX * 1.4, z: pose.z + rightZ * 1.4, pose, rightX, rightZ };
  }

  private async handleBoard(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = boardRequestSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.busId) return this.notify(client, { tone: "info", text: "You are already aboard." });
    if (player.boarding) return;
    if (player.location !== "street") return;
    const bus = this.buses.find(({ id }) => id === parsed.data.busId);
    if (!bus) return this.notify(client, { tone: "error", text: "That danfo is no longer in service." });
    if (bus.state !== "dwelling" || !bus.currentStopId) {
      return this.notify(client, { tone: "error", text: "Wait for the danfo to stop before boarding." });
    }
    const door = this.busDoor(bus);
    if (Math.hypot(player.x - door.x, player.z - door.z) > BOARD_RANGE) {
      return this.notify(client, { tone: "error", text: "Move closer to the sliding door to board." });
    }
    const seat = bus.seats.findIndex((occupant) => occupant === null);
    if (seat < 0) {
      return this.notify(client, { tone: "error", text: "This danfo is full. Another arrives shortly." });
    }
    bus.seats[seat] = player.userId;
    player.boarding = true;
    bus.dwellUntil = Math.max(bus.dwellUntil, Date.now() + 2_500);
    const journeyId = randomUUID();
    try {
      const fare = await chargeFare({
        userId: player.userId,
        journeyId,
        routeId: TRANSIT.routeId,
        busId: bus.id,
        stopId: bus.currentStopId,
        fare: TRANSIT.fare,
      });
      player.busId = bus.id;
      player.seat = seat;
      player.journeyId = journeyId;
      player.motion = "sit";
      player.returnPoint = [...TRANSIT.stops[bus.stopIndex]!.alight];
      setPlayerPosition(player.userId, player.x, player.z, `bus:${bus.id}`);
      this.notify(client, {
        tone: "success",
        text: `Fare paid · ₦${TRANSIT.fare}. Seat ${seat + 1}. Balance ₦${fare.balance.toLocaleString("en-NG")}.`,
        announcement: `Welcome aboard the ${TRANSIT.routeName}. Next stop, ${TRANSIT.stops[bus.stopIndex]!.name}.`,
      });
      this.sendSelf(client, player, "boarded");
    } catch (error) {
      bus.seats[seat] = null;
      this.notify(client, {
        tone: "error",
        text: error instanceof EconomyError ? `${error.message}. The fare is ₦${TRANSIT.fare}.` : "Fare payment failed. You were not charged.",
      });
    } finally {
      player.boarding = false;
    }
  }

  private releaseSeat(player: Player, status: "completed" | "interrupted", stopId: string | null = null) {
    const bus = this.buses.find(({ id }) => id === player.busId);
    if (bus && player.seat !== null && bus.seats[player.seat] === player.userId) bus.seats[player.seat] = null;
    if (player.journeyId) void endJourney(player.userId, player.journeyId, stopId, status).catch(() => undefined);
    player.busId = null;
    player.seat = null;
    player.journeyId = null;
    player.alightAtNext = false;
    player.motion = "idle";
  }

  private alightPlayer(player: Player, bus: Bus) {
    const stop = TRANSIT.stops.find(({ id }) => id === bus.currentStopId)!;
    player.x = stop.alight[0];
    player.z = stop.alight[1];
    player.returnPoint = [...stop.alight];
    this.releaseSeat(player, "completed", stop.id);
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    const client = this.clientFor(player);
    if (client) {
      this.notify(client, { tone: "success", text: `You stepped off at ${stop.name}.` });
      this.sendSelf(client, player, "alighted");
    }
  }

  private handleAlight(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player?.busId) return;
    const bus = this.buses.find(({ id }) => id === player.busId);
    if (!bus) return;
    if (bus.state === "dwelling" && bus.currentStopId) {
      this.alightPlayer(player, bus);
    } else {
      this.handleRequestStop(client);
    }
  }

  private handleRequestStop(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player?.busId) return;
    const bus = this.buses.find(({ id }) => id === player.busId);
    if (!bus) return;
    bus.stopRequested = true;
    player.alightAtNext = true;
    const stop = TRANSIT.stops[bus.stopIndex]!;
    this.notify(client, {
      tone: "info",
      text: `Stop requested: ${stop.name}.`,
      announcement: `Owa o! Next stop, ${stop.name}.`,
    });
  }

  private async handleEnterProperty(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = enterPropertySchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.busId) return;
    const { propertyId, mode } = parsed.data;
    const place = getPlace(propertyId === "starter-home" ? "starter-home" : propertyId);
    if (Math.hypot(player.x - place.door[0], player.z - place.door[1]) > 4.5) {
      return this.notify(client, { tone: "error", text: `Walk up to the door of ${place.name}.` });
    }
    let location: string;
    let previewOnly = false;
    try {
      if (propertyId === "starter-home") {
        location = `starter:${player.userId}`;
      } else if (mode === "preview") {
        if (!(await isPropertyAvailable(propertyId))) {
          await requirePropertyAccess(player.userId, propertyId);
          location = `home:${propertyId}`;
        } else {
          location = `preview:${propertyId}:${player.userId}`;
          previewOnly = true;
        }
      } else {
        await requirePropertyAccess(player.userId, propertyId);
        location = `home:${propertyId}`;
      }
    } catch (error) {
      return this.notify(client, {
        tone: "error",
        text: error instanceof EconomyError ? `${error.message}. Locked.` : "The door is locked.",
      });
    }
    player.returnPoint = [...place.door];
    player.location = location;
    player.previewOnly = previewOnly;
    player.propertyId = propertyId;
    player.x = INTERIOR_SPAWN[0];
    player.z = INTERIOR_SPAWN[1];
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, location);
    void this.persist(player).catch(() => undefined);
    this.sendSelf(client, player, previewOnly ? "preview" : "entered");
  }

  private handleExitProperty(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player || player.location === "street") return;
    player.location = "street";
    player.previewOnly = false;
    player.propertyId = null;
    [player.x, player.z] = player.returnPoint;
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    this.sendSelf(client, player, "exited");
  }

  private handleUnstuck(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    const now = Date.now();
    if (now - player.lastUnstuckAt < 20_000) {
      return this.notify(client, { tone: "error", text: "Recovery is cooling down — try again in a few seconds." });
    }
    player.lastUnstuckAt = now;
    if (player.busId) return this.handleRequestStop(client);
    if (player.location !== "street") return this.handleExitProperty(client);
    const safe = nearestSafePoint(player.x, player.z);
    [player.x, player.z] = safe.point;
    player.lastAcceptedAt = now;
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "info", text: `Moved to a safe spot: ${safe.label}.` });
    this.sendSelf(client, player, "recovered");
  }

  private tickWorld(dt: number) {
    const seconds = dt / 1_000;
    const now = Date.now();
    this.state.tick = (this.state.tick + 1) >>> 0;
    const length = routeLength();
    for (const bus of this.buses) {
      const stop = TRANSIT.stops[bus.stopIndex]!;
      if (bus.state === "dwelling") {
        const someoneWaiting = [...this.players.values()].some(
          (player) =>
            player.location === "street" &&
            !player.busId &&
            Math.hypot(player.x - stop.pole[0], player.z - stop.pole[1]) < 14,
        );
        if (someoneWaiting && now - bus.dwellStartedAt < BUS_DWELL_EXTENDED_MS) {
          bus.dwellUntil = Math.max(bus.dwellUntil, now + 1_500);
        }
        if (now >= bus.dwellUntil) {
          bus.state = "driving";
          bus.currentStopId = null;
          bus.stopIndex = (bus.stopIndex + 1) % TRANSIT.stops.length;
          bus.lastMovedAt = now;
        }
        continue;
      }
      const toStop = routeDistanceAhead(bus.s, stop.s);
      const ahead = this.buses
        .filter((other) => other !== bus)
        .map((other) => routeDistanceAhead(bus.s, other.s))
        .filter((distance) => distance > 0)
        .reduce((min, distance) => Math.min(min, distance), Infinity);
      const pose = sampleRoute(bus.s);
      const blocked = [...this.players.values()].some((player) => {
        if (player.location !== "street" || player.busId) return false;
        const dx = player.x - pose.x;
        const dz = player.z - pose.z;
        const forward = dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw);
        const lateral = Math.abs(dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw));
        return forward > 1.5 && forward < 7 && lateral < 1.4;
      });
      let target = Math.min(BUS_CRUISE, Math.sqrt(Math.max(0, 2 * BUS_BRAKE * (toStop - 0.4))));
      if (ahead < 30) target = Math.min(target, Math.max(0, (ahead - 14) * 0.8));
      const blockedTooLong = now - bus.lastMovedAt > 8_000;
      if (blocked && !blockedTooLong) target = 0;
      bus.speed += Math.max(-BUS_BRAKE * 2 * seconds, Math.min(BUS_ACCEL * seconds, target - bus.speed));
      bus.speed = Math.max(0, bus.speed);
      const step = Math.min(bus.speed * seconds, toStop);
      bus.s = (bus.s + step) % length;
      if (bus.speed > 0.3) bus.lastMovedAt = now;
      bus.state = blockedTooLong ? "recovering" : "driving";
      if (toStop - step < 0.5 && bus.speed < 1.2) {
        bus.s = stop.s;
        bus.speed = 0;
        bus.state = "dwelling";
        bus.currentStopId = stop.id;
        bus.dwellUntil = now + BUS_DWELL_MS;
        bus.dwellStartedAt = now;
        bus.stopRequested = false;
        for (const player of this.players.values()) {
          if (player.busId === bus.id && player.alightAtNext) {
            player.alightAtNext = false;
            this.alightPlayer(player, bus);
          }
        }
        for (const player of this.players.values()) {
          if (player.busId !== bus.id) continue;
          const client = this.clientFor(player);
          if (client) {
            this.notify(client, {
              tone: "info",
              text: `${stop.name}. Press E to step off.`,
              announcement: `${stop.name}! ${stop.name}! Owa o.`,
            });
          }
        }
      }
      if (now - bus.lastMovedAt > STUCK_RECOVERY_MS) {
        bus.s = stop.s - 25;
        bus.speed = 4;
        bus.lastMovedAt = now;
      }
    }

    for (const player of this.players.values()) {
      if (!player.busId) continue;
      const bus = this.buses.find(({ id }) => id === player.busId);
      if (!bus) continue;
      const pose = sampleRoute(bus.s);
      player.x = pose.x;
      player.z = pose.z;
      player.yaw = pose.yaw;
      player.returnPoint = [...TRANSIT.stops[bus.stopIndex]!.alight];
      setPlayerPosition(player.userId, player.x, player.z, `bus:${bus.id}`);
    }

    if (this.state.tick % 2 === 0) this.broadcastSnapshots();
  }

  private busStates(): BusState[] {
    return this.buses.map((bus) => {
      const pose = sampleRoute(bus.s);
      return {
        id: bus.id,
        x: pose.x,
        z: pose.z,
        yaw: pose.yaw,
        speed: bus.speed,
        s: bus.s,
        state: bus.state,
        doorOpen: bus.state === "dwelling",
        stopId: bus.currentStopId,
        nextStopId: TRANSIT.stops[bus.stopIndex]!.id,
        stopRequested: bus.stopRequested,
        occupied: bus.seats.filter(Boolean).length,
        capacity: BUS_CAPACITY,
        seats: bus.seats.map((occupant) =>
          occupant ? ([...this.players.values()].find(({ userId }) => userId === occupant)?.sessionId ?? "npc") : null,
        ),
      };
    });
  }

  private broadcastSnapshots() {
    const buses = this.busStates();
    const all = [...this.players.values()];
    const online = all.filter(({ connected }) => connected).length;
    for (const client of this.clients) {
      const viewer = this.players.get(client.sessionId);
      if (!viewer) continue;
      const viewerLocation = viewer.busId ? "street" : viewer.location;
      const players = all
        .filter((other) => {
          const otherLocation = other.busId ? "street" : other.location;
          if (otherLocation !== viewerLocation) return false;
          return other === viewer || Math.hypot(other.x - viewer.x, other.z - viewer.z) <= INTEREST_RADIUS;
        })
        .map((other) => ({
          sessionId: other.sessionId,
          name: other.name,
          x: other.x,
          z: other.z,
          yaw: other.yaw,
          motion: other.motion,
          location: other.busId ? "street" : other.location,
          busId: other.busId,
          seat: other.seat,
          carrying: other.carrying,
          connected: other.connected,
        }));
      const snapshot: WorldSnapshot = { tick: this.state.tick, serverTime: Date.now(), players, buses, online };
      client.send("snapshot", snapshot);
    }
  }
}
