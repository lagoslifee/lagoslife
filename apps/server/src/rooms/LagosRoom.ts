import {
  boardRequestSchema,
  effectiveTopSpeed,
  emoteRequestSchema,
  enterPropertySchema,
  enterVehicleSchema,
  getVehicleModel,
  impactDamage,
  VEHICLE_RULES,
  vehicleImpactSchema,
  type WorldVehicle,
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
  markProgress,
  savePlayerPlace,
} from "../economy-service.js";
import { pool } from "../database.js";
import { verifyMultiplayerToken, type MultiplayerIdentity } from "../multiplayer-token.js";
import { clearProgressReset, removePlayerPosition, setPlayerPosition, wasProgressReset } from "../player-presence.js";
import { isPropertyAvailable, requirePropertyAccess } from "../property-service.js";
import { vehicleEvents } from "../vehicle-events.js";
import {
  claimVehicle,
  damageVehicle,
  loadStreetVehicle,
  loadStreetVehicles,
  parkAbandonedVehicles,
  saveDrivingVehicle,
  type RoomVehicle,
} from "../vehicle-service.js";

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
export const REBOARD_COOLDOWN_MS = 6_000;
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
  alighted: { busId: string; at: number } | null;
  vehicleId: string | null;
  /** Metres driven since the odometer was last written. */
  driveMetres: number;
  lastVehicleSaveAt: number;
  lastImpactAt: number;
  entering: boolean;
};

const VEHICLE_SAVE_MS = 10_000;
const IMPACT_COOLDOWN_MS = 800;

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
  private vehicles = new Map<string, RoomVehicle>();
  private onVehicleChanged = (vehicleId: string) => void this.refreshVehicle(vehicleId);
  private onVehicleOwnerReset = (userId: string) => this.dropOwnerVehicles(userId);

  onAuth(_client: LagosClient, options: { token?: unknown }, _context: AuthContext) {
    return verifyMultiplayerToken(options.token);
  }

  async onCreate() {
    vehicleEvents.on("changed", this.onVehicleChanged);
    vehicleEvents.on("ownerReset", this.onVehicleOwnerReset);
    try {
      await parkAbandonedVehicles();
      for (const vehicle of await loadStreetVehicles()) this.vehicles.set(vehicle.id, vehicle);
    } catch (error) {
      console.error("Could not load street vehicles", error);
    }
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
    this.onMessage("enterVehicle", (client, payload) => void this.handleEnterVehicle(client, payload));
    this.onMessage("exitVehicle", (client) => void this.handleExitVehicle(client));
    this.onMessage("vehicleImpact", (client, payload) => void this.handleVehicleImpact(client, payload));
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

    this.setFixedTimestep(({ dtMs }) => this.tickWorld(dtMs), 20);
  }

  async onJoin(client: LagosClient) {
    clearProgressReset(client.auth.userId);
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
      alighted: null,
      vehicleId: null,
      driveMetres: 0,
      lastVehicleSaveAt: now,
      lastImpactAt: 0,
      entering: false,
    };
    for (const [sessionId, existing] of this.players) {
      if (existing.userId === player.userId) {
        this.releaseSeat(existing, "interrupted");
        await this.parkPlayerVehicle(existing).catch(() => undefined);
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
      await this.parkPlayerVehicle(player).catch(() => undefined);
      await this.persist(player).catch(() => undefined);
      if (this.players.get(client.sessionId) === player) this.players.delete(client.sessionId);
      removePlayerPosition(player.userId);
    }
  }

  async onDispose() {
    vehicleEvents.off("changed", this.onVehicleChanged);
    vehicleEvents.off("ownerReset", this.onVehicleOwnerReset);
    await Promise.all(
      [...this.players.values()].map(async (player) => {
        await this.parkPlayerVehicle(player).catch(() => undefined);
        await this.persist(player).catch(() => undefined);
      }),
    );
  }

  private persist(player: Player) {
    if (wasProgressReset(player.userId)) return Promise.resolve();
    const onStreet = player.location === "street" && !player.busId;
    const [x, z] = onStreet ? [player.x, player.z] : player.returnPoint;
    player.lastSavedAt = Date.now();
    return savePlayerPlace(player.userId, x, z, onStreet ? "street" : player.location).then(() => {
      this.clientFor(player)?.send("saved", { at: Date.now() });
    });
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
      vehicleId: player.vehicleId,
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
    if (player.entering) return;
    const now = Date.now();
    const elapsed = Math.min(1.5, Math.max(0.03, (now - player.lastAcceptedAt) / 1_000));
    const vehicle = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    const topSpeed = vehicle
      ? effectiveTopSpeed(getVehicleModel(vehicle.modelId), vehicle.condition)
      : MOVEMENT.sprintSpeed;
    const allowed = topSpeed * 1.35 * elapsed + 0.75;
    const distance = Math.hypot(parsed.data.x - player.x, parsed.data.z - player.z);
    const inInterior = player.location !== "street";
    const valid = inInterior
      ? Math.abs(parsed.data.x - INTERIOR_ORIGIN[0]) <= INTERIOR_HALF[0] &&
        Math.abs(parsed.data.z - INTERIOR_ORIGIN[1]) <= INTERIOR_HALF[1]
      : withinWorld(parsed.data.x, parsed.data.z) && !insideBuilding(parsed.data.x, parsed.data.z);
    if (distance > allowed || !valid) {
      client.send("correction", { x: player.x, z: player.z, yaw: player.yaw, sequence: parsed.data.sequence });
      player.lastAcceptedAt = now;
      return;
    }
    player.x = parsed.data.x;
    player.z = parsed.data.z;
    player.yaw = parsed.data.yaw;
    player.motion = vehicle ? "drive" : parsed.data.motion === "drive" ? "idle" : parsed.data.motion;
    player.lastAcceptedAt = now;
    if (vehicle) {
      vehicle.x = player.x;
      vehicle.z = player.z;
      vehicle.yaw = player.yaw;
      player.driveMetres += distance;
      if (now - player.lastVehicleSaveAt > VEHICLE_SAVE_MS) {
        const metres = player.driveMetres;
        player.driveMetres = 0;
        player.lastVehicleSaveAt = now;
        void saveDrivingVehicle(vehicle.id, vehicle, metres, false).catch(() => {
          player.driveMetres += metres;
        });
      }
    }
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
    if (player.vehicleId) return this.notify(client, { tone: "info", text: "Park and step out of your car to board a danfo." });
    const bus = this.buses.find(({ id }) => id === parsed.data.busId);
    if (!bus) return this.notify(client, { tone: "error", text: "That danfo is no longer in service." });
    if (bus.state !== "dwelling" || !bus.currentStopId) {
      return this.notify(client, { tone: "error", text: "Wait for the danfo to stop before boarding." });
    }
    if (player.alighted?.busId === bus.id && Date.now() - player.alighted.at < REBOARD_COOLDOWN_MS) {
      return this.notify(client, { tone: "info", text: "You just stepped off this danfo. Wait for it to pull away or catch the next one." });
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
    player.alighted = { busId: bus.id, at: Date.now() };
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
    if (player.vehicleId) return this.notify(client, { tone: "info", text: "Park and step out of your car first." });
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
    if (!previewOnly && propertyId !== "starter-home") void markProgress(pool, player.userId, "visited_home").catch(() => undefined);
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
    if (player.vehicleId) {
      void this.handleExitVehicle(client, true);
      return this.notify(client, { tone: "info", text: "Parked where you were. If the car is wedged, book a tow from Phone → Vehicles." });
    }
    const safe = nearestSafePoint(player.x, player.z);
    [player.x, player.z] = safe.point;
    player.lastAcceptedAt = now;
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "info", text: `Moved to a safe spot: ${safe.label}.` });
    this.sendSelf(client, player, "recovered");
  }

  private async refreshVehicle(vehicleId: string) {
    const fresh = await loadStreetVehicle(vehicleId).catch(() => undefined);
    if (fresh === undefined) return;
    const cached = this.vehicles.get(vehicleId);
    if (cached?.driverSessionId) {
      if (fresh) cached.condition = fresh.condition;
      return;
    }
    if (fresh) this.vehicles.set(vehicleId, fresh);
    else this.vehicles.delete(vehicleId);
  }

  private dropOwnerVehicles(userId: string) {
    for (const [id, vehicle] of this.vehicles) {
      if (vehicle.ownerUserId === userId) this.vehicles.delete(id);
    }
    for (const player of this.players.values()) {
      if (player.userId !== userId || !player.vehicleId) continue;
      player.vehicleId = null;
      player.driveMetres = 0;
      player.motion = "idle";
      const client = this.clientFor(player);
      if (client) this.sendSelf(client, player, "vehicleRemoved");
    }
  }

  /** Driver door first, then the passenger side, then behind and ahead. */
  private exitPoint(vehicle: RoomVehicle): [number, number] {
    const model = getVehicleModel(vehicle.modelId);
    const rightX = Math.cos(vehicle.yaw);
    const rightZ = -Math.sin(vehicle.yaw);
    const forwardX = Math.sin(vehicle.yaw);
    const forwardZ = Math.cos(vehicle.yaw);
    const side = model.width / 2 + 0.7;
    const end = model.length / 2 + 0.8;
    const candidates: Array<[number, number]> = [
      [vehicle.x - rightX * side, vehicle.z - rightZ * side],
      [vehicle.x + rightX * side, vehicle.z + rightZ * side],
      [vehicle.x - forwardX * end, vehicle.z - forwardZ * end],
      [vehicle.x + forwardX * end, vehicle.z + forwardZ * end],
    ];
    return (
      candidates.find(([x, z]) => withinWorld(x, z) && !insideBuilding(x, z, 0.1)) ??
      nearestSafePoint(vehicle.x, vehicle.z).point
    );
  }

  private async parkPlayerVehicle(player: Player) {
    const vehicleId = player.vehicleId;
    if (!vehicleId) return null;
    const vehicle = this.vehicles.get(vehicleId);
    const metres = player.driveMetres;
    player.vehicleId = null;
    player.driveMetres = 0;
    player.motion = "idle";
    if (!vehicle) return null;
    vehicle.driverSessionId = null;
    await saveDrivingVehicle(vehicleId, vehicle, metres, true);
    return vehicle;
  }

  private async handleEnterVehicle(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = enterVehicleSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.busId || player.vehicleId || player.entering) return;
    const vehicle = this.vehicles.get(parsed.data.vehicleId);
    if (!vehicle) return this.notify(client, { tone: "error", text: "That vehicle is no longer here." });
    if (vehicle.ownerUserId !== player.userId) {
      return this.notify(client, { tone: "error", text: `This car belongs to ${vehicle.ownerName}. It is locked.` });
    }
    if (vehicle.driverSessionId) return this.notify(client, { tone: "error", text: "Someone is already driving it." });
    if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > VEHICLE_RULES.enterRange + 1) {
      return this.notify(client, { tone: "error", text: "Walk up to the car door." });
    }
    if (vehicle.condition <= 0) {
      return this.notify(client, { tone: "error", text: "It will not start. Book a tow to the mechanic from Phone → Vehicles." });
    }
    player.entering = true;
    try {
      const claim = await claimVehicle(player.userId, vehicle.id, client.sessionId);
      if (!claim) return this.notify(client, { tone: "error", text: "The car could not be started right now." });
      if (player.vehicleId || player.location !== "street" || player.busId) {
        await saveDrivingVehicle(vehicle.id, vehicle, 0, true);
        return;
      }
      vehicle.driverSessionId = client.sessionId;
      vehicle.condition = claim.condition;
      player.vehicleId = vehicle.id;
      player.x = vehicle.x;
      player.z = vehicle.z;
      player.yaw = vehicle.yaw;
      player.motion = "drive";
      player.driveMetres = 0;
      player.lastVehicleSaveAt = Date.now();
      player.lastAcceptedAt = Date.now();
      setPlayerPosition(player.userId, player.x, player.z, "street");
      const model = getVehicleModel(vehicle.modelId);
      this.notify(client, {
        tone: claim.condition < VEHICLE_RULES.limpCondition ? "error" : "success",
        text:
          claim.condition < VEHICLE_RULES.limpCondition
            ? `${model.name} is in limp mode (${claim.condition}% condition). Visit Ade Auto Works.`
            : `${model.name} · ${vehicle.plate}. Drive safely.`,
      });
      this.sendSelf(client, player, "drive");
      client.send("vehicleStatus", { vehicleId: vehicle.id, condition: vehicle.condition });
    } finally {
      player.entering = false;
    }
  }

  private async handleExitVehicle(client: Client, quiet = false) {
    const player = this.players.get(client.sessionId);
    if (!player?.vehicleId) return;
    const vehicle = await this.parkPlayerVehicle(player).catch(() => null);
    if (vehicle) [player.x, player.z] = this.exitPoint(vehicle);
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    if (!quiet && vehicle) this.notify(client, { tone: "info", text: `Parked ${vehicle.plate}.` });
    this.sendSelf(client, player, "parked");
  }

  private async handleVehicleImpact(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = vehicleImpactSchema.safeParse(payload);
    if (!player?.vehicleId || !parsed.success) return;
    const vehicle = this.vehicles.get(player.vehicleId);
    if (!vehicle) return;
    const now = Date.now();
    if (now - player.lastImpactAt < IMPACT_COOLDOWN_MS) return;
    player.lastImpactAt = now;
    const model = getVehicleModel(vehicle.modelId);
    const speed = Math.min(parsed.data.speed, model.topSpeed * 1.3);
    const damage = impactDamage(speed);
    if (damage <= 0) return;
    const result = await damageVehicle(player.userId, vehicle.id, damage, speed).catch(() => null);
    if (!result) return;
    vehicle.condition = result.condition;
    client.send("vehicleStatus", { vehicleId: vehicle.id, condition: vehicle.condition, damage });
    if (result.condition <= 0) {
      this.notify(client, {
        tone: "error",
        text: result.insured
          ? "The engine has died. Your cover includes a free tow: Phone → Vehicles."
          : "The engine has died. Book a tow to Ade Auto Works from Phone → Vehicles.",
      });
    } else if (result.condition < VEHICLE_RULES.limpCondition && result.condition + damage >= VEHICLE_RULES.limpCondition) {
      this.notify(client, { tone: "error", text: "Warning light: limp mode. Top speed is reduced until it is repaired." });
    }
  }

  private worldVehicles(viewer: Player): WorldVehicle[] {
    if (viewer.location !== "street" && !viewer.busId) return [];
    const list: WorldVehicle[] = [];
    for (const vehicle of this.vehicles.values()) {
      if (Math.hypot(vehicle.x - viewer.x, vehicle.z - viewer.z) > INTEREST_RADIUS) continue;
      list.push({
        id: vehicle.id,
        modelId: vehicle.modelId,
        colour: vehicle.colour,
        plate: vehicle.plate,
        x: vehicle.x,
        z: vehicle.z,
        yaw: vehicle.yaw,
        driverSessionId: vehicle.driverSessionId,
        ownerName: vehicle.ownerName,
      });
    }
    return list;
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

    this.broadcastSnapshots();
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
          vehicleId: other.vehicleId,
        }));
      const snapshot: WorldSnapshot = {
        tick: this.state.tick,
        serverTime: Date.now(),
        players,
        buses,
        vehicles: this.worldVehicles(viewer),
        online,
      };
      client.send("snapshot", snapshot);
    }
  }
}
