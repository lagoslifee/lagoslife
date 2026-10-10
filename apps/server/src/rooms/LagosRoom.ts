import {
  boardRequestSchema,
  CHAT,
  chatSendSchema,
  defaultAppearance,
  type CharacterAppearance,
  type Look,
  districtAt,
  effectiveTopSpeed,
  filterChat,
  JUSTICE,
  type ChatMessage,
  emoteRequestSchema,
  enterPropertySchema,
  enterVehicleSchema,
  getVehicleModel,
  impactDamage,
  VEHICLE_RULES,
  vehicleImpactSchema,
  vehicleSignalSchema,
  vehicleSeats,
  vehicleModelById,
  kerbSlot,
  testDriveSchema,
  TEST_DRIVE,
  RIDE,
  rideFare,
  rideBookSchema,
  rideCancelSchema,
  type RideState,
  type WorldVehicle,
  getPlace,
  INTERIOR_HALF,
  INTERIOR_ORIGIN,
  INTERIOR_SPAWN,
  walkable,
  insideBuilding,
  MOVEMENT,
  nearestSafePoint,
  positionUpdateSchema,
  propertyPlace,
  builtHomePlace,
  routeDistanceAhead,
  routeLength,
  ROUTES,
  sampleRoute,
  type TransitRoute,
  type BusState,
  type MotionState,
  type Notice,
  type SelfState,
  type NetworkPlayerWire,
  type WorldSnapshotWire,
} from "@lagos-living/shared";
import { Client, Room, type AuthContext } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { randomInt, randomUUID } from "node:crypto";
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
import { issueCitation } from "../justice-service.js";
import { activeMute, activeSuspension, hiddenPlayers, recordChat, safetyEvents } from "../safety-service.js";
import {
  claimVehicle,
  damageVehicle,
  loadStreetVehicle,
  loadStreetVehicles,
  parkAbandonedVehicles,
  saveDrivingVehicle,
  type RoomVehicle,
} from "../vehicle-service.js";
import { loadAppearance, profileEvents } from "../profile-service.js";
import { buildingEvents } from "../building-service.js";
import { chargeRide, refundRide } from "../ride-service.js";
import "../world-footprints.js";

export const LagosState = schema({
  tick: t.uint32().default(0),
});
export type LagosState = SchemaType<typeof LagosState>;

type LagosClient = Client & { auth: MultiplayerIdentity };

export const BUS_CAPACITY = 14;
const RIDE_DRIVERS = ["Tunde", "Chioma", "Emeka", "Aisha", "Segun", "Ngozi", "Ibrahim", "Folake", "Kelechi", "Bisi"];
const RIDE_COLOURS = ["#d9d9d6", "#f2f2ee", "#101418", "#5b6770"];
const BUS_CRUISE = 12.5;
const BUS_ACCEL = 1.8;
const BUS_BRAKE = 2.4;
const BUS_DWELL_MS = 9_000;
const BUS_DWELL_EXTENDED_MS = 16_000;
const BOARD_RANGE = 5.5;
export const REBOARD_COOLDOWN_MS = 6_000;
const INTEREST_RADIUS = 180;
/** Danfos are sent within this range; the client hides them beyond 700 m. */
export const BUS_INTEREST_RADIUS = 900;
/** One room holds the whole city; past this Colyseus opens another room, which players in the first cannot see. */
export const ROOM_CAPACITY = 100;
/** Snapshots carry at most this many players (the nearest), so a crowd cannot blow up per-client bandwidth. */
export const MAX_VISIBLE_PLAYERS = 40;
const STUCK_RECOVERY_MS = 20_000;

type Player = {
  sessionId: string;
  userId: string;
  name: string;
  appearance: CharacterAppearance;
  looksRequestedAt: number;
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
  /** 0 when driving; a passenger seat index otherwise. */
  vehicleSeat: number | null;
  lastTestDriveAt: number;
  ride: RideState | null;
  /** Metres driven since the odometer was last written. */
  driveMetres: number;
  lastVehicleSaveAt: number;
  lastImpactAt: number;
  lastHornAt: number;
  lastCitationCheckAt: number;
  /** Unit direction of the last accepted move. */
  heading: [number, number] | null;
  entering: boolean;
  chatTimes: number[];
  mutedUntil: number | null;
  /** Players blocked by, or blocking, this player. Chat never flows between them. */
  hidden: Set<string>;
  /** Metres covered by recently accepted position updates, for the server's own speed estimate. */
  travel: Array<{ at: number; metres: number; seconds: number }>;
  kicked: boolean;
};

const SPEED_WINDOW_MS = 1_500;

const VEHICLE_SAVE_MS = 10_000;
const IMPACT_COOLDOWN_MS = 800;
/** One citation attempt per crash: the justice service's own cooldown is the authority, this saves database calls. */
const CITATION_CHECK_MS = 3_000;
/** Centre distances that mean a car body (about 1.8 × 4.4 m) touched something. */
const CONTACT_RADIUS = { pedestrian: 1.3, vehicle: 2.0, danfo: 2.3 };
/** A car measured at speed that then moves slower than this, with a wall within WALL_REACH ahead, hit the wall. */
const WALL_STOP_SPEED = 3;
const WALL_REACH = 3;

function distanceToSegment([px, pz]: [number, number], [ax, az]: [number, number], [bx, bz]: [number, number]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

type Bus = {
  id: string;
  route: TransitRoute;
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

function nextStopIndex(route: TransitRoute, s: number) {
  let bestIndex = 0;
  let bestAhead = Infinity;
  route.stops.forEach((stop, index) => {
    const ahead = routeDistanceAhead(route, s, stop.s);
    if (ahead > 0.5 && ahead < bestAhead) {
      bestAhead = ahead;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export class LagosRoom extends Room<{ state: LagosState; client: LagosClient }> {
  maxClients = ROOM_CAPACITY;
  state = new LagosState();
  private players = new Map<string, Player>();
  private buses: Bus[] = [];
  /** Latest join attempt per user; an older join that finishes later must not replace a newer session. */
  private joinTickets = new Map<string, number>();
  private joinCounter = 0;
  private vehicles = new Map<string, RoomVehicle>();
  private onVehicleChanged = (vehicleId: string) => void this.refreshVehicle(vehicleId);
  private onVehicleOwnerReset = (userId: string) => this.dropOwnerVehicles(userId);
  private onSanctioned = (userId: string, kind: string, reason: string, endsAt: number | null) => this.applySanction(userId, kind, reason, endsAt);
  private onBlocksChanged = (userIds: string[]) => void this.refreshHidden(userIds);
  private onAppearance = (userId: string, appearance: CharacterAppearance) => this.updateAppearance(userId, appearance);
  private onPlotsChanged = () => this.broadcast("plots", {});

  onAuth(_client: LagosClient, options: { token?: unknown }, _context: AuthContext) {
    return verifyMultiplayerToken(options.token);
  }

  async onCreate() {
    vehicleEvents.on("changed", this.onVehicleChanged);
    vehicleEvents.on("ownerReset", this.onVehicleOwnerReset);
    safetyEvents.on("sanctioned", this.onSanctioned);
    safetyEvents.on("blocksChanged", this.onBlocksChanged);
    profileEvents.on("appearance", this.onAppearance);
    buildingEvents.on("changed", this.onPlotsChanged);
    try {
      await parkAbandonedVehicles();
      for (const vehicle of await loadStreetVehicles()) this.vehicles.set(vehicle.id, vehicle);
    } catch (error) {
      console.error("Could not load street vehicles", error);
    }
    this.buses = ROUTES.flatMap((route) => {
      const length = routeLength(route);
      const count = Math.max(3, Math.round(length / 1_400));
      return Array.from({ length: count }, (_, index) => ({ route, s: (length / count) * index + 20 }));
    }).map(({ route, s }, index) => {
      return {
        id: `danfo-${index + 1}`,
        route,
        s,
        speed: 0,
        state: "driving",
        dwellUntil: 0,
        dwellStartedAt: 0,
        stopIndex: nextStopIndex(route, s),
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
    this.onMessage("rideBook", (client, payload) => void this.handleRideBook(client, payload));
    this.onMessage("rideBoard", (client) => this.handleRideBoard(client));
    this.onMessage("rideArrive", (client) => void this.handleRideArrive(client));
    this.onMessage("rideCancel", (client, payload) => void this.handleRideCancel(client, payload));
    this.onMessage("testDrive", (client, payload) => this.handleTestDrive(client, payload));
    this.onMessage("vehicleSignal", (client, payload) => this.handleVehicleSignal(client, payload));
    this.onMessage("vehicleImpact", (client, payload) => void this.handleVehicleImpact(client, payload));
    this.onMessage("chat", (client, payload) => void this.handleChat(client, payload));
    this.onMessage("requestLooks", (client) => this.sendLooks(client));
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
    const ticket = ++this.joinCounter;
    this.joinTickets.set(client.auth.userId, ticket);
    const [suspension, mute, hidden, appearance] = await Promise.all([
      activeSuspension(client.auth.userId).catch(() => null),
      activeMute(client.auth.userId).catch(() => null),
      hiddenPlayers(client.auth.userId).catch(() => new Set<string>()),
      loadAppearance(client.auth.userId).catch(() => defaultAppearance),
    ]);
    if (suspension) throw new Error("This account is suspended.");
    clearProgressReset(client.auth.userId);
    const home = getPlace("starter-home");
    const saved = await loadPlayerPlace(client.auth.userId).catch(() => null);
    if (this.joinTickets.get(client.auth.userId) !== ticket) throw new Error("This account joined again from another window.");
    let spawn: [number, number] = [...home.door];
    if (saved && walkable(saved.x, saved.z)) {
      spawn = [saved.x, saved.z];
    }
    const now = Date.now();
    const player: Player = {
      sessionId: client.sessionId,
      userId: client.auth.userId,
      name: client.auth.name,
      appearance,
      looksRequestedAt: 0,
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
      vehicleSeat: null,
      lastTestDriveAt: 0,
      ride: null,
      driveMetres: 0,
      lastVehicleSaveAt: now,
      lastImpactAt: 0,
      lastHornAt: 0,
      lastCitationCheckAt: 0,
      heading: null,
      entering: false,
      chatTimes: [],
      mutedUntil: mute ? (mute.endsAt?.getTime() ?? Infinity) : null,
      hidden,
      travel: [],
      kicked: false,
    };
    for (const [sessionId, existing] of this.players) {
      if (existing.userId === player.userId) {
        existing.kicked = true;
        const previous = this.clientFor(existing);
        if (previous) {
          previous.send("replaced", {});
          previous.leave(4004);
        }
        this.releaseSeat(existing, "interrupted");
        await this.parkPlayerVehicle(existing).catch(() => undefined);
        this.players.delete(sessionId);
      }
    }
    this.players.set(client.sessionId, player);
    setPlayerPosition(player.userId, player.x, player.z, player.location);
    this.sendLook(player, client.sessionId);
    this.sendSelf(client, player, saved ? "Welcome back — progress restored." : "Welcome to Lekki Phase 1.");
  }

  /** Everyone's current look, asked for by a client once its message handlers are registered. */
  private sendLooks(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    const now = Date.now();
    if (now - player.looksRequestedAt < 5_000) return;
    player.looksRequestedAt = now;
    const looks: Look[] = [...this.players.values()].map(({ sessionId, appearance }) => ({ sessionId, appearance }));
    client.send("looks", looks);
  }

  private sendLook(player: Player, except?: string) {
    const look: Look = { sessionId: player.sessionId, appearance: player.appearance };
    for (const client of this.clients) if (client.sessionId !== except) client.send("look", look);
  }

  private updateAppearance(userId: string, appearance: CharacterAppearance) {
    for (const player of this.players.values()) {
      if (player.userId !== userId) continue;
      player.appearance = appearance;
      this.sendLook(player);
    }
  }

  async onLeave(client: LagosClient) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    try {
      if (player.kicked) throw new Error("removed by a moderator");
      await this.allowReconnection(client, 25);
      player.connected = true;
      player.lastAcceptedAt = Date.now();
      this.sendSelf(client, player, player.busId ? "Reconnected — you are still aboard." : "Reconnected.");
    } catch {
      if (this.players.get(client.sessionId) !== player) return;
      if (player.busId) {
        const bus = this.buses.find(({ id }) => id === player.busId);
        const stop = bus ? bus.route.stops[bus.stopIndex]! : ROUTES[0]!.stops[0]!;
        player.x = stop.alight[0];
        player.z = stop.alight[1];
        this.releaseSeat(player, "interrupted", stop.id);
      }
      await this.endRide(player, "cancelled", "You disconnected, so the ride ended.", "system").catch(() => undefined);
      await this.parkPlayerVehicle(player).catch(() => undefined);
      await this.persist(player).catch(() => undefined);
      if (this.players.get(client.sessionId) === player) this.players.delete(client.sessionId);
      removePlayerPosition(player.userId);
    }
  }

  async onDispose() {
    vehicleEvents.off("changed", this.onVehicleChanged);
    vehicleEvents.off("ownerReset", this.onVehicleOwnerReset);
    safetyEvents.off("sanctioned", this.onSanctioned);
    safetyEvents.off("blocksChanged", this.onBlocksChanged);
    profileEvents.off("appearance", this.onAppearance);
    buildingEvents.off("changed", this.onPlotsChanged);
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
      vehicleSeat: player.vehicleSeat,
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
    if (player.vehicleSeat && player.ride?.status !== "riding") return;
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
      : walkable(parsed.data.x, parsed.data.z);
    if (distance > allowed || !valid) {
      client.send("correction", { x: player.x, z: player.z, yaw: player.yaw, sequence: parsed.data.sequence });
      player.lastAcceptedAt = now;
      return;
    }
    const from: [number, number] = [player.x, player.z];
    const speedBefore = vehicle ? this.measuredSpeed(player) : 0;
    player.x = parsed.data.x;
    player.z = parsed.data.z;
    player.yaw = parsed.data.yaw;
    player.motion = vehicle ? "drive" : parsed.data.motion === "drive" ? "idle" : parsed.data.motion;
    player.lastAcceptedAt = now;
    player.travel.push({ at: now, metres: distance, seconds: elapsed });
    while (player.travel.length && now - player.travel[0]!.at > SPEED_WINDOW_MS) player.travel.shift();
    if (vehicle) {
      vehicle.x = player.x;
      vehicle.z = player.z;
      vehicle.yaw = player.yaw;
      for (const rider of this.passengersOf(vehicle.id)) {
        [rider.x, rider.z, rider.yaw] = [player.x, player.z, player.yaw];
        rider.lastAcceptedAt = now;
        setPlayerPosition(rider.userId, rider.x, rider.z, "street");
      }
      const struck = vehicle.npc ? null : this.contactAlong(player, vehicle.id, from, [player.x, player.z]);
      if (struck) this.considerCitation(client, player, null, struck);
      else if (speedBefore >= JUSTICE.carelessDrivingSpeed && distance / elapsed < WALL_STOP_SPEED && player.heading && this.wallAhead(player, player.heading)) {
        this.considerCitation(client, player, null, "building", speedBefore);
      }
      if (distance > 0.05) player.heading = [(player.x - from[0]) / distance, (player.z - from[1]) / distance];
      player.driveMetres += distance;
      if (!vehicle.testDrive && !vehicle.npc && now - player.lastVehicleSaveAt > VEHICLE_SAVE_MS) {
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
    const pose = sampleRoute(bus.route, bus.s);
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
    const route = bus.route;
    try {
      const fare = await chargeFare({
        userId: player.userId,
        journeyId,
        routeId: route.routeId,
        busId: bus.id,
        stopId: bus.currentStopId,
        fare: route.fare,
      });
      player.busId = bus.id;
      player.seat = seat;
      player.journeyId = journeyId;
      player.motion = "sit";
      player.returnPoint = [...route.stops[bus.stopIndex]!.alight];
      setPlayerPosition(player.userId, player.x, player.z, `bus:${bus.id}`);
      this.notify(client, {
        tone: "success",
        text: `Fare paid · ₦${route.fare}. Seat ${seat + 1}. Balance ₦${fare.balance.toLocaleString("en-NG")}.`,
        announcement: `Welcome aboard the ${route.routeNumber} ${route.routeName}. Next stop, ${route.stops[bus.stopIndex]!.name}.`,
      });
      this.sendSelf(client, player, "boarded");
    } catch (error) {
      bus.seats[seat] = null;
      this.notify(client, {
        tone: "error",
        text: error instanceof EconomyError ? `${error.message}. The fare is ₦${route.fare}.` : "Fare payment failed. You were not charged.",
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
    const stop = bus.route.stops.find(({ id }) => id === bus.currentStopId)!;
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
    const stop = bus.route.stops[bus.stopIndex]!;
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
    const place = propertyId === "starter-home" ? getPlace("starter-home") : (propertyPlace(propertyId) ?? builtHomePlace(propertyId));
    if (!place) return this.notify(client, { tone: "error", text: "That home is not on the map." });
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
      if (fresh) {
        cached.condition = fresh.condition;
        cached.locked = fresh.locked;
      }
      return;
    }
    if (fresh && cached && Math.hypot(fresh.x - cached.x, fresh.z - cached.z) > 5) this.ejectPassengers(vehicleId);
    if (fresh) this.vehicles.set(vehicleId, { ...fresh, lights: cached?.lights ?? false });
    else {
      this.ejectPassengers(vehicleId);
      this.vehicles.delete(vehicleId);
    }
  }

  private dropOwnerVehicles(userId: string) {
    for (const [id, vehicle] of this.vehicles) {
      if (vehicle.ownerUserId !== userId) continue;
      this.ejectPassengers(id);
      this.vehicles.delete(id);
    }
    for (const player of this.players.values()) {
      if (player.userId !== userId || !player.vehicleId) continue;
      player.vehicleId = null;
      player.vehicleSeat = null;
      player.driveMetres = 0;
      player.motion = "idle";
      const client = this.clientFor(player);
      if (client) this.sendSelf(client, player, "vehicleRemoved");
    }
  }

  /** Driver door first, then the passenger side, then behind and ahead. */
  private exitPoint(vehicle: RoomVehicle, seatIndex = 0): [number, number] {
    const model = getVehicleModel(vehicle.modelId);
    const seatInfo = vehicleSeats(model)[seatIndex] ?? vehicleSeats(model)[0]!;
    const rightX = Math.cos(vehicle.yaw);
    const rightZ = -Math.sin(vehicle.yaw);
    const forwardX = Math.sin(vehicle.yaw);
    const forwardZ = Math.cos(vehicle.yaw);
    const side = model.width / 2 + 0.7;
    const end = model.length / 2 + 0.8;
    const cx = vehicle.x + forwardX * seatInfo.z;
    const cz = vehicle.z + forwardZ * seatInfo.z;
    const near = seatInfo.x > 0 ? 1 : -1;
    const candidates: Array<[number, number]> = [
      [cx + near * rightX * side, cz + near * rightZ * side],
      [cx - near * rightX * side, cz - near * rightZ * side],
      [vehicle.x - forwardX * end, vehicle.z - forwardZ * end],
      [vehicle.x + forwardX * end, vehicle.z + forwardZ * end],
    ];
    return (
      candidates.find(([x, z]) => walkable(x, z, 0.1)) ??
      nearestSafePoint(vehicle.x, vehicle.z).point
    );
  }

  private async parkPlayerVehicle(player: Player) {
    const vehicleId = player.vehicleId;
    if (!vehicleId) return null;
    const vehicle = this.vehicles.get(vehicleId);
    const metres = player.driveMetres;
    const seat = player.vehicleSeat ?? 0;
    player.vehicleId = null;
    player.vehicleSeat = null;
    player.driveMetres = 0;
    player.motion = "idle";
    if (!vehicle) return null;
    if (seat > 0) return vehicle;
    vehicle.driverSessionId = null;
    vehicle.lights = false;
    if (vehicle.testDrive) {
      this.ejectPassengers(vehicleId);
      this.vehicles.delete(vehicleId);
      return vehicle;
    }
    await saveDrivingVehicle(vehicleId, vehicle, metres, true);
    return vehicle;
  }

  private passengersOf(vehicleId: string) {
    return [...this.players.values()].filter((other) => other.vehicleId === vehicleId && (other.vehicleSeat ?? 0) > 0);
  }

  /** Passengers step out beside their seat when a vehicle leaves the street. */
  private ejectPassengers(vehicleId: string) {
    const vehicle = this.vehicles.get(vehicleId);
    for (const rider of this.passengersOf(vehicleId)) {
      if (vehicle) [rider.x, rider.z] = this.exitPoint(vehicle, rider.vehicleSeat ?? 1);
      rider.vehicleId = null;
      rider.vehicleSeat = null;
      rider.motion = "idle";
      rider.lastAcceptedAt = Date.now();
      setPlayerPosition(rider.userId, rider.x, rider.z, "street");
      const client = this.clientFor(rider);
      if (client) {
        this.sendSelf(client, rider, "parked");
        this.notify(client, { tone: "info", text: "The vehicle left the street, so you stepped out." });
      }
    }
  }

  private seatPassenger(client: Client, player: Player, vehicle: RoomVehicle) {
    const model = getVehicleModel(vehicle.modelId);
    const taken = new Set(this.passengersOf(vehicle.id).map((rider) => rider.vehicleSeat));
    let seat = 1;
    while (taken.has(seat)) seat += 1;
    if (seat >= model.seats) return this.notify(client, { tone: "error", text: `All ${model.seats - 1} passenger seats are taken.` });
    player.vehicleId = vehicle.id;
    player.vehicleSeat = seat;
    [player.x, player.z, player.yaw] = [vehicle.x, vehicle.z, vehicle.yaw];
    player.motion = "sit";
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "success", text: `You're riding in ${vehicle.ownerName}'s ${model.name}. Step out any time.` });
    this.sendSelf(client, player, "boarded");
  }

  private sendRide(player: Player) {
    const client = this.clientFor(player);
    if (client) client.send("ride", player.ride);
  }

  private async handleRideBook(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = rideBookSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (player.ride && (player.ride.status === "approaching" || player.ride.status === "waiting" || player.ride.status === "riding")) return fail("You already have a ride booked.");
    if (player.location !== "street" || player.busId || player.vehicleId) return fail("Book a ride from the street, not from inside a vehicle or building.");
    const { pickup, dropoff, destination, label, roadMetres, idempotencyKey } = parsed.data;
    if (Math.hypot(pickup[0] - player.x, pickup[1] - player.z) > RIDE.pickupRange || !walkable(pickup[0], pickup[1], 0.5)) {
      return fail("Move closer to a road so the driver can reach you.");
    }
    if (!walkable(dropoff[0], dropoff[1], 0.5) || Math.hypot(dropoff[0] - destination[0], dropoff[1] - destination[1]) > 400) {
      return fail(`No road reaches ${label}. Pick a place on the map near a street.`);
    }
    const straight = Math.hypot(dropoff[0] - pickup[0], dropoff[1] - pickup[1]);
    if (straight < RIDE.minMetres) return fail(`${label} is a short walk from here.`);
    if (straight > RIDE.maxMetres) return fail(`${label} is outside the Lagos Living Ride service area.`);
    const metres = Math.min(straight * RIDE.maxRoadFactor, Math.max(straight * RIDE.minRoadFactor, roadMetres));
    const fare = rideFare(metres);
    const id = randomUUID();
    const now = Date.now();
    player.ride = {
      id,
      status: "approaching",
      pickup,
      pickupYaw: parsed.data.pickupYaw,
      dropoff,
      label,
      fare,
      driverName: RIDE_DRIVERS[randomInt(RIDE_DRIVERS.length)]!,
      plate: `LLR ${100 + randomInt(900)} ${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))}`,
      colour: RIDE_COLOURS[randomInt(RIDE_COLOURS.length)]!,
      modelId: RIDE.modelId,
      vehicleId: null,
      bookedAt: now,
      arrivesAt: now + (RIDE.pickupSecondsMin + randomInt(RIDE.pickupSecondsMax - RIDE.pickupSecondsMin)) * 1_000,
      waitUntil: null,
      refunded: 0,
      message: null,
    };
    const ride = player.ride;
    try {
      const balance = await chargeRide(player.userId, fare, label, idempotencyKey);
      this.notify(client, { tone: "success", text: `Ride booked: ${ride.driverName} is on the way. Fare ₦${fare.toLocaleString("en-NG")} paid, balance ₦${balance.toLocaleString("en-NG")}.` });
      this.sendRide(player);
    } catch (error) {
      if (player.ride === ride) player.ride = null;
      const message = (error as Error).message;
      fail(/duplicate|unique/i.test(message) ? "That booking was already made." : message.includes("Insufficient") ? `You need ₦${fare.toLocaleString("en-NG")} for this ride.` : "The ride could not be booked.");
    }
  }

  private handleRideBoard(client: Client) {
    const player = this.players.get(client.sessionId);
    const ride = player?.ride;
    if (!player || !ride || ride.status !== "waiting" || !ride.vehicleId) return;
    const vehicle = this.vehicles.get(ride.vehicleId);
    if (!vehicle) return;
    if (player.location !== "street" || player.busId || player.vehicleId) return this.notify(client, { tone: "error", text: "Step out onto the street first." });
    if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > RIDE.boardRange) return this.notify(client, { tone: "error", text: `Walk to ${ride.driverName}'s car (${ride.plate}).` });
    ride.status = "riding";
    ride.waitUntil = null;
    vehicle.driverSessionId = client.sessionId;
    player.vehicleId = vehicle.id;
    player.vehicleSeat = Math.min(3, getVehicleModel(vehicle.modelId).seats - 1);
    [player.x, player.z, player.yaw] = [vehicle.x, vehicle.z, vehicle.yaw];
    player.motion = "sit";
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "success", text: `${ride.driverName}: "Good evening! Heading to ${ride.label}."` });
    this.sendSelf(client, player, "boarded");
    this.sendRide(player);
  }

  private async handleRideArrive(client: Client) {
    const player = this.players.get(client.sessionId);
    const ride = player?.ride;
    if (!player || !ride || ride.status !== "riding") return;
    if (Math.hypot(player.x - ride.dropoff[0], player.z - ride.dropoff[1]) > RIDE.arriveRange) {
      return this.notify(client, { tone: "error", text: "Not there yet." });
    }
    await this.endRide(player, "completed", `Arrived at ${ride.label}. Thanks for riding with Lagos Living Ride!`, "arrived");
  }

  private async handleRideCancel(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const ride = player?.ride;
    const parsed = rideCancelSchema.safeParse(payload ?? {});
    if (!player || !ride || !parsed.success) return;
    if (ride.status === "riding" && parsed.data.reason === "rider") {
      const vehicle = ride.vehicleId ? this.vehicles.get(ride.vehicleId) : undefined;
      if (vehicle && this.measuredSpeed(player) > 2.5) return this.notify(client, { tone: "info", text: `${ride.driverName} is pulling over — try again once the car stops.` });
    }
    if (ride.status === "approaching" || ride.status === "waiting" || ride.status === "riding") {
      await this.endRide(player, "cancelled", parsed.data.reason === "stuck" ? `${ride.driverName} could not get through, so the ride ended here.` : "Ride cancelled.", parsed.data.reason === "stuck" ? "system" : "rider");
    }
  }

  /**
   * Single exit point for every ride outcome. The status changes before any await so a ride
   * is settled once, and refunds use a per-ride transaction key so they cannot repeat.
   */
  private async endRide(player: Player, status: "completed" | "cancelled", message: string, cause: "arrived" | "rider" | "system" | "no-show") {
    const ride = player.ride;
    if (!ride || ride.status === "completed" || ride.status === "cancelled") return;
    const previous = ride.status;
    ride.status = status;
    ride.message = message;
    const now = Date.now();
    let refund = 0;
    let reason = "";
    if (cause === "system") {
      refund = previous === "riding" ? this.unusedFare(player, ride) : ride.fare;
      reason = "service problem";
    } else if (cause === "no-show") {
      refund = ride.fare - Math.min(ride.fare, RIDE.noShowFee);
      reason = `no-show (₦${RIDE.noShowFee} fee kept)`;
    } else if (cause === "rider") {
      if (previous === "approaching") {
        const free = now - ride.bookedAt <= RIDE.freeCancelSeconds * 1_000;
        refund = free ? ride.fare : ride.fare - Math.min(ride.fare, RIDE.lateCancelFee);
        reason = free ? "cancelled within a minute" : `late cancellation (₦${RIDE.lateCancelFee} fee kept)`;
      } else if (previous === "waiting") {
        refund = ride.fare - Math.min(ride.fare, RIDE.noShowFee);
        reason = `driver had arrived (₦${RIDE.noShowFee} fee kept)`;
      } else if (previous === "riding") {
        refund = this.unusedFare(player, ride);
        reason = "ended early, unused distance";
      }
    }
    const vehicle = ride.vehicleId ? this.vehicles.get(ride.vehicleId) : undefined;
    if (vehicle) {
      if (player.vehicleId === vehicle.id) {
        [player.x, player.z] = this.exitPoint(vehicle, player.vehicleSeat ?? 3);
        player.vehicleId = null;
        player.vehicleSeat = null;
        player.motion = "idle";
        player.lastAcceptedAt = now;
        setPlayerPosition(player.userId, player.x, player.z, "street");
        const client = this.clientFor(player);
        if (client) this.sendSelf(client, player, "parked");
      }
      this.vehicles.delete(vehicle.id);
    }
    ride.vehicleId = null;
    if (refund > 0) {
      try {
        await refundRide(player.userId, ride.id, refund, reason);
        ride.refunded = refund;
        ride.message = `${message} ₦${refund.toLocaleString("en-NG")} refunded (${reason}).`;
      } catch (error) {
        console.error("Ride refund failed", error);
        ride.message = `${message} The refund could not be paid right now; please report it from Phone → Safety.`;
      }
    }
    const client = this.clientFor(player);
    if (client) this.notify(client, { tone: status === "completed" ? "success" : "info", text: ride.message ?? message });
    this.sendRide(player);
  }

  /** Share of the fare for distance not yet travelled, measured on the straight line to the drop-off. */
  private unusedFare(player: Player, ride: RideState) {
    const total = Math.max(1, Math.hypot(ride.dropoff[0] - ride.pickup[0], ride.dropoff[1] - ride.pickup[1]));
    const left = Math.hypot(ride.dropoff[0] - player.x, ride.dropoff[1] - player.z);
    const share = Math.max(0, Math.min(1, left / total));
    return Math.round((ride.fare - RIDE.baseFare) * share / 50) * 50;
  }

  private checkRides(now: number) {
    for (const player of this.players.values()) {
      const ride = player.ride;
      if (!ride) continue;
      if (ride.status === "approaching" && now >= ride.arrivesAt) {
        const vehicle: RoomVehicle = {
          id: `ride-${ride.id}`,
          ownerUserId: player.userId,
          ownerName: `Lagos Living Ride · ${ride.driverName}`,
          modelId: ride.modelId,
          colour: ride.colour,
          plate: ride.plate,
          condition: 100,
          x: ride.pickup[0],
          z: ride.pickup[1],
          yaw: ride.pickupYaw,
          driverSessionId: null,
          lights: false,
          locked: true,
          npc: true,
        };
        this.vehicles.set(vehicle.id, vehicle);
        ride.vehicleId = vehicle.id;
        ride.status = "waiting";
        ride.waitUntil = now + RIDE.waitSeconds * 1_000;
        const client = this.clientFor(player);
        if (client) this.notify(client, { tone: "success", text: `${ride.driverName} has arrived: ${ride.plate}. Walk to the car and get in.`, announcement: "Your ride has arrived" });
        this.sendRide(player);
      } else if (ride.status === "waiting" && ride.waitUntil && now >= ride.waitUntil) {
        void this.endRide(player, "cancelled", `${ride.driverName} waited ${RIDE.waitSeconds / 60} minutes and left.`, "no-show");
      }
    }
  }

  private handleTestDrive(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = testDriveSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.busId || player.vehicleId || player.entering) {
      return this.notify(client, { tone: "error", text: "Step out onto the street first." });
    }
    const model = vehicleModelById.get(parsed.data.modelId);
    if (!model || !model.colours.includes(parsed.data.colour)) return this.notify(client, { tone: "error", text: "That model is not in the showroom." });
    const dealer = getPlace(TEST_DRIVE.dealerPlaceId);
    if (Math.hypot(player.x - dealer.door[0], player.z - dealer.door[1]) > TEST_DRIVE.bookRange) {
      return this.notify(client, { tone: "error", text: `Test drives start at ${dealer.name}.` });
    }
    const now = Date.now();
    if (now - player.lastTestDriveAt < TEST_DRIVE.cooldownMs) return this.notify(client, { tone: "error", text: "The dealer is preparing the next car — try again in a few seconds." });
    if ([...this.vehicles.values()].some((vehicle) => vehicle.testDrive && vehicle.ownerUserId === player.userId)) return;
    let spot: [number, number] = dealer.kerb;
    for (let index = 0; index < 12; index += 1) {
      const candidate = kerbSlot(dealer.kerb, dealer.kerbYaw, index);
      if ([...this.vehicles.values()].every((vehicle) => Math.hypot(vehicle.x - candidate[0], vehicle.z - candidate[1]) > 6)) {
        spot = candidate;
        break;
      }
    }
    player.lastTestDriveAt = now;
    const vehicle: RoomVehicle = {
      id: `test-${randomUUID()}`,
      ownerUserId: player.userId,
      ownerName: `${dealer.name} test car`,
      modelId: model.id,
      colour: parsed.data.colour,
      plate: "TEST",
      condition: 100,
      x: spot[0],
      z: spot[1],
      yaw: dealer.kerbYaw,
      driverSessionId: client.sessionId,
      lights: false,
      locked: true,
      testDrive: { endsAt: now + TEST_DRIVE.seconds * 1_000, origin: spot, yaw: dealer.kerbYaw, warned: false },
    };
    this.vehicles.set(vehicle.id, vehicle);
    player.vehicleId = vehicle.id;
    player.vehicleSeat = 0;
    [player.x, player.z, player.yaw] = [vehicle.x, vehicle.z, vehicle.yaw];
    player.motion = "drive";
    player.driveMetres = 0;
    player.lastAcceptedAt = now;
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "success", text: `Test drive: ${model.name} for ${TEST_DRIVE.seconds / 60} minutes within ${TEST_DRIVE.radius} m of ${dealer.name}. Free, no damage charged.` });
    this.sendSelf(client, player, "drive");
    client.send("vehicleStatus", { vehicleId: vehicle.id, condition: 100 });
  }

  /** Time up or out of bounds: the dealer collects the car and the driver is walked back to the showroom. */
  private checkTestDrives(now: number) {
    for (const vehicle of this.vehicles.values()) {
      const drive = vehicle.testDrive;
      if (!drive) continue;
      const driver = [...this.players.values()].find((player) => player.sessionId === vehicle.driverSessionId);
      if (!driver) {
        this.vehicles.delete(vehicle.id);
        continue;
      }
      const client = this.clientFor(driver);
      const distance = Math.hypot(vehicle.x - drive.origin[0], vehicle.z - drive.origin[1]);
      if (!drive.warned && distance > TEST_DRIVE.radius * 0.8 && client) {
        drive.warned = true;
        this.notify(client, { tone: "info", text: "Nearing the test-drive limit — turn back towards Lekki Motors." });
      }
      const timeUp = now >= drive.endsAt;
      if (!timeUp && distance <= TEST_DRIVE.radius) continue;
      this.ejectPassengers(vehicle.id);
      [vehicle.x, vehicle.z, vehicle.yaw] = [drive.origin[0], drive.origin[1], drive.yaw];
      [driver.x, driver.z] = this.exitPoint(vehicle);
      driver.vehicleId = null;
      driver.vehicleSeat = null;
      driver.motion = "idle";
      driver.lastAcceptedAt = now;
      this.vehicles.delete(vehicle.id);
      setPlayerPosition(driver.userId, driver.x, driver.z, "street");
      if (client) {
        this.notify(client, { tone: "info", text: timeUp ? "Test drive over. The car is back at Lekki Motors — buy it from the showroom if you liked it." : "You left the test-drive area, so the dealer took the car back to Lekki Motors." });
        this.sendSelf(client, driver, "recovered");
      }
    }
  }

  private async handleEnterVehicle(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = enterVehicleSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.busId || player.vehicleId || player.entering) return;
    const vehicle = this.vehicles.get(parsed.data.vehicleId);
    if (!vehicle) return this.notify(client, { tone: "error", text: "That vehicle is no longer here." });
    const owner = vehicle.ownerUserId === player.userId;
    if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > VEHICLE_RULES.enterRange + 1) {
      return this.notify(client, { tone: "error", text: "Walk up to the car door." });
    }
    if (vehicle.npc) return this.notify(client, { tone: "error", text: "That is a Lagos Living Ride car. Book your own from Phone → Ride." });
    if (vehicle.testDrive && !owner) return this.notify(client, { tone: "error", text: "That is someone's dealer test car." });
    if (!owner && vehicle.locked) {
      return this.notify(client, { tone: "error", text: `This vehicle belongs to ${vehicle.ownerName}. It is locked.` });
    }
    if (!owner || parsed.data.seat === "passenger") {
      if (getVehicleModel(vehicle.modelId).seats < 2) return this.notify(client, { tone: "error", text: "There is no passenger seat." });
      return this.seatPassenger(client, player, vehicle);
    }
    if (vehicle.driverSessionId) return this.notify(client, { tone: "error", text: "Someone is already driving it." });
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
      player.vehicleSeat = 0;
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
    const seat = player.vehicleSeat ?? 0;
    const testCar = Boolean(this.vehicles.get(player.vehicleId)?.testDrive);
    const vehicle = await this.parkPlayerVehicle(player).catch(() => null);
    if (vehicle) [player.x, player.z] = this.exitPoint(vehicle, seat);
    if (testCar && !quiet) this.notify(client, { tone: "info", text: "Test drive finished. Lekki Motors has collected the car." });
    if (seat > 0 || testCar) {
      player.lastAcceptedAt = Date.now();
      setPlayerPosition(player.userId, player.x, player.z, "street");
      return this.sendSelf(client, player, "parked");
    }
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    if (!quiet && vehicle) this.notify(client, { tone: "info", text: `Parked ${vehicle.plate}.` });
    this.sendSelf(client, player, "parked");
  }

  private handleVehicleSignal(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = vehicleSignalSchema.safeParse(payload);
    if (!player?.vehicleId || !parsed.success) return;
    const vehicle = this.vehicles.get(player.vehicleId);
    if (!vehicle || vehicle.driverSessionId !== client.sessionId) return;
    if (parsed.data.lights !== undefined) vehicle.lights = parsed.data.lights;
    if (parsed.data.horn) {
      const now = Date.now();
      if (now - player.lastHornAt < 400) return;
      player.lastHornAt = now;
      for (const other of this.clients) {
        const listener = this.players.get(other.sessionId);
        if (!listener || other.sessionId === client.sessionId || listener.location !== "street") continue;
        if (Math.hypot(listener.x - vehicle.x, listener.z - vehicle.z) < 80) other.send("horn", { vehicleId: vehicle.id, x: vehicle.x, z: vehicle.z });
      }
    }
  }

  private async handleVehicleImpact(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = vehicleImpactSchema.safeParse(payload);
    if (!player?.vehicleId || !parsed.success) return;
    const vehicle = this.vehicles.get(player.vehicleId);
    if (!vehicle || vehicle.driverSessionId !== client.sessionId || vehicle.testDrive) return;
    const now = Date.now();
    if (now - player.lastImpactAt < IMPACT_COOLDOWN_MS) return;
    player.lastImpactAt = now;
    const model = getVehicleModel(vehicle.modelId);
    const speed = Math.min(parsed.data.speed, model.topSpeed * 1.3);
    const damage = impactDamage(speed);
    this.considerCitation(client, player, speed);
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

  /** Speed measured by the server from accepted updates over the last moment, so a client cannot talk it down. */
  private measuredSpeed(player: Player) {
    const now = Date.now();
    const recent = player.travel.filter(({ at }) => now - at <= SPEED_WINDOW_MS);
    const seconds = recent.reduce((sum, sample) => sum + sample.seconds, 0);
    return seconds > 0 ? recent.reduce((sum, { metres }) => sum + metres, 0) / seconds : 0;
  }

  /**
   * What a driven car swept into between two accepted positions: a pedestrian on the street, another
   * car (parked or driven) or a danfo. The room sees this itself, so withholding impact reports
   * does not avoid it. Buildings and kerbs are left to the client's impact report.
   */
  private contactAlong(driver: Player, vehicleId: string, from: [number, number], to: [number, number]): "pedestrian" | "vehicle" | "danfo" | null {
    const near = (x: number, z: number, radius: number) => distanceToSegment([x, z], from, to) < radius;
    for (const other of this.players.values()) {
      if (other === driver || !other.connected || other.busId || other.vehicleId || other.location !== "street") continue;
      if (near(other.x, other.z, CONTACT_RADIUS.pedestrian)) return "pedestrian";
    }
    for (const car of this.vehicles.values()) {
      if (car.id !== vehicleId && near(car.x, car.z, CONTACT_RADIUS.vehicle)) return "vehicle";
    }
    for (const bus of this.buses) {
      const pose = sampleRoute(bus.route, bus.s);
      if (near(pose.x, pose.z, CONTACT_RADIUS.danfo)) return "danfo";
    }
    return null;
  }

  /** Whether a building wall lies within a car's nose length along its last direction of travel. */
  private wallAhead(player: Player, [dx, dz]: [number, number]) {
    for (let reach = 0.5; reach <= WALL_REACH; reach += 0.5) {
      if (insideBuilding(player.x + dx * reach, player.z + dz * reach, 0)) return true;
    }
    return false;
  }

  /**
   * A hard crash at speed earns one careless-driving citation. The server's measured speed must
   * agree with either the client's reported impact or a contact the server saw itself. A crash
   * into a wall passes the speed measured just before the car stopped.
   */
  private considerCitation(
    client: Client,
    player: Player,
    reportedSpeed: number | null,
    struck: "pedestrian" | "vehicle" | "danfo" | "building" | null = null,
    speedAtContact?: number,
  ) {
    const measured = speedAtContact ?? this.measuredSpeed(player);
    if (measured < JUSTICE.carelessDrivingSpeed) return;
    if (reportedSpeed !== null && reportedSpeed < JUSTICE.carelessDrivingSpeed) return;
    const now = Date.now();
    if (now - player.lastCitationCheckAt < CITATION_CHECK_MS) return;
    player.lastCitationCheckAt = now;
    const evidence = {
      x: player.x,
      z: player.z,
      speed: Math.round(measured * 10) / 10,
      district: districtAt(player.x, player.z)?.name ?? null,
      detectedBy: reportedSpeed === null ? ("server" as const) : ("client" as const),
      struck,
    };
    void issueCitation(player.userId, "careless_driving", evidence)
      .then((citation) => {
        if (!citation) return;
        this.notify(client, {
          tone: "error",
          text: `${JUSTICE.authority}: careless driving at ${Math.round(evidence.speed * 3.6)} km/h. Fine ₦${citation.fine.toLocaleString("en-NG")} — pay or appeal within ${JUSTICE.dueHours} hours in Phone → Justice.`,
        });
      })
      .catch(() => undefined);
  }

  private chatRecipients(sender: Player) {
    const place = sender.busId ? "street" : sender.location;
    return [...this.players.values()].filter((other) => {
      if (!other.connected) return false;
      if (other === sender) return true;
      if ((other.busId ? "street" : other.location) !== place) return false;
      if (sender.hidden.has(other.userId) || other.hidden.has(sender.userId)) return false;
      return Math.hypot(other.x - sender.x, other.z - sender.z) <= CHAT.radius;
    });
  }

  private async handleChat(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = chatSendSchema.safeParse(payload);
    if (!player || !parsed.success) return;
    const now = Date.now();
    if (player.mutedUntil !== null && player.mutedUntil > now) {
      const until = Number.isFinite(player.mutedUntil) ? ` until ${new Date(player.mutedUntil).toUTCString()}` : "";
      return this.notify(client, { tone: "error", text: `A moderator has muted your chat${until}.` });
    }
    player.chatTimes = player.chatTimes.filter((at) => now - at < CHAT.burstWindowMs);
    const last = player.chatTimes[player.chatTimes.length - 1];
    if (player.chatTimes.length >= CHAT.burst || (last !== undefined && now - last < CHAT.minIntervalMs)) {
      return this.notify(client, { tone: "error", text: "Slow down a little — wait a few seconds before chatting again." });
    }
    player.chatTimes.push(now);
    const { text, filtered } = filterChat(parsed.data.text);
    const recipients = this.chatRecipients(player);
    const message: ChatMessage = { id: randomUUID(), sessionId: player.sessionId, userName: player.name, text, at: now, filtered };
    try {
      await recordChat({
        id: message.id,
        userId: player.userId,
        userName: player.name,
        location: player.busId ? `bus:${player.busId}` : player.location,
        x: player.x,
        z: player.z,
        body: parsed.data.text,
        shown: text,
        filtered,
        recipients: recipients.length - 1,
      });
    } catch {
      return this.notify(client, { tone: "error", text: "Chat is unavailable right now. Your message was not sent." });
    }
    for (const recipient of recipients) this.clientFor(recipient)?.send("chat", message);
  }

  private applySanction(userId: string, kind: string, reason: string, endsAt: number | null) {
    for (const player of this.players.values()) {
      if (player.userId !== userId) continue;
      if (kind === "mute") player.mutedUntil = endsAt ?? Infinity;
      if (kind === "lift_mute") player.mutedUntil = null;
      const client = this.clientFor(player);
      if (!client) continue;
      if (kind === "warn") this.notify(client, { tone: "error", text: `Moderator warning: ${reason}` });
      if (kind === "mute") this.notify(client, { tone: "error", text: `A moderator has muted your chat: ${reason}` });
      if (kind === "lift_mute") this.notify(client, { tone: "info", text: "Your chat mute has been lifted." });
      if (kind === "suspend") {
        player.kicked = true;
        client.send("suspended", { reason, until: endsAt ? new Date(endsAt).toISOString() : null });
        client.leave(4003);
      }
    }
  }

  private async refreshHidden(userIds: string[]) {
    for (const player of this.players.values()) {
      if (!userIds.includes(player.userId)) continue;
      player.hidden = await hiddenPlayers(player.userId).catch(() => player.hidden);
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
        lights: vehicle.lights,
        locked: vehicle.locked,
        testDriveEndsAt: vehicle.testDrive?.endsAt ?? null,
        npc: Boolean(vehicle.npc),
        ownerName: vehicle.ownerName,
        mine: !vehicle.npc && vehicle.ownerUserId === viewer.userId,
      });
    }
    return list;
  }

  private tickWorld(dt: number) {
    const seconds = dt / 1_000;
    const now = Date.now();
    this.state.tick = (this.state.tick + 1) >>> 0;
    if (this.state.tick % 25 === 0) {
      this.checkTestDrives(now);
      this.checkRides(now);
    }
    for (const bus of this.buses) {
      const { route } = bus;
      const length = routeLength(route);
      const stop = route.stops[bus.stopIndex]!;
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
          bus.stopIndex = (bus.stopIndex + 1) % route.stops.length;
          bus.lastMovedAt = now;
        }
        continue;
      }
      const toStop = routeDistanceAhead(route, bus.s, stop.s);
      const ahead = this.buses
        .filter((other) => other !== bus && other.route === route)
        .map((other) => routeDistanceAhead(route, bus.s, other.s))
        .filter((distance) => distance > 0)
        .reduce((min, distance) => Math.min(min, distance), Infinity);
      const pose = sampleRoute(route, bus.s);
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
      const pose = sampleRoute(bus.route, bus.s);
      player.x = pose.x;
      player.z = pose.z;
      player.yaw = pose.yaw;
      player.returnPoint = [...bus.route.stops[bus.stopIndex]!.alight];
      setPlayerPosition(player.userId, player.x, player.z, `bus:${bus.id}`);
    }

    this.broadcastSnapshots();
  }

  private busStates(): BusState[] {
    return this.buses.map((bus) => {
      const pose = sampleRoute(bus.route, bus.s);
      return {
        id: bus.id,
        routeId: bus.route.routeId,
        x: pose.x,
        z: pose.z,
        yaw: pose.yaw,
        speed: bus.speed,
        s: bus.s,
        state: bus.state,
        doorOpen: bus.state === "dwelling",
        stopId: bus.currentStopId,
        nextStopId: bus.route.stops[bus.stopIndex]!.id,
        stopRequested: bus.stopRequested,
        occupied: bus.seats.filter(Boolean).length,
        capacity: BUS_CAPACITY,
        seats: bus.seats.map((occupant) =>
          occupant ? ([...this.players.values()].find(({ userId }) => userId === occupant)?.sessionId ?? "npc") : null,
        ),
      };
    });
  }

  private wirePlayer(player: Player): NetworkPlayerWire {
    const wire: NetworkPlayerWire = { sessionId: player.sessionId, name: player.name, x: player.x, z: player.z, yaw: player.yaw, motion: player.motion };
    if (!player.busId && player.location !== "street") wire.location = player.location;
    if (player.busId) wire.busId = player.busId;
    if (player.seat !== null) wire.seat = player.seat;
    if (player.carrying) wire.carrying = true;
    if (!player.connected) wire.connected = false;
    if (player.vehicleId) wire.vehicleId = player.vehicleId;
    if (player.vehicleSeat) wire.vehicleSeat = player.vehicleSeat;
    return wire;
  }

  private broadcastSnapshots() {
    const buses = this.busStates();
    const all = [...this.players.values()];
    const online = all.filter(({ connected }) => connected).length;
    for (const client of this.clients) {
      const viewer = this.players.get(client.sessionId);
      if (!viewer) continue;
      const viewerLocation = viewer.busId ? "street" : viewer.location;
      const nearby: Array<{ player: Player; distance: number }> = [];
      for (const other of all) {
        if ((other.busId ? "street" : other.location) !== viewerLocation) continue;
        const distance = other === viewer ? -1 : Math.hypot(other.x - viewer.x, other.z - viewer.z);
        if (distance <= INTEREST_RADIUS) nearby.push({ player: other, distance });
      }
      if (nearby.length > MAX_VISIBLE_PLAYERS) nearby.sort((a, b) => a.distance - b.distance).length = MAX_VISIBLE_PLAYERS;
      const players = nearby.map(({ player }) => this.wirePlayer(player));
      const snapshot: WorldSnapshotWire = {
        tick: this.state.tick,
        serverTime: Date.now(),
        players,
        buses: buses.filter((bus) => bus.id === viewer.busId || Math.hypot(bus.x - viewer.x, bus.z - viewer.z) <= BUS_INTEREST_RADIUS),
        vehicles: this.worldVehicles(viewer),
        online,
      };
      client.send("snapshot", snapshot);
    }
  }
}
