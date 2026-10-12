import { z } from "zod";
import {
  TOW,
  dialSpeed,
  checkpointAnswerSchema,
  type CheckpointStop,
  type HoldUp,
  holdUpSchema,
  POLICE,
  POLICE_CHECKPOINTS,
  ROBBERY,
  robberyAnswerSchema,
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
  impactSeverity,
  towCancelSchema,
  towRequestSchema,
  VEHICLE_RULES,
  vehicleImpactSchema,
  vehicleSignalSchema,
  vehicleSeats,
  vehicleModelById,
  kerbSlot,
  testDriveSchema,
  TEST_DRIVE,
  RIDE,
  BIKE_RENTAL,
  BIKE_STATIONS,
  bikeStationById,
  nearestBikeStation,
  rentBikeSchema,
  rentalUsage,
  rideFare,
  expressFare,
  rideBookSchema,
  rideCancelSchema,
  type RideState,
  type WorldVehicle,
  getPlace,
  CLUBS,
  clubLocation,
  INTERIOR_HALF,
  INTERIOR_ORIGIN,
  INTERIOR_SPAWN,
  homeLayout,
  insideHome,
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
  travelEnterSchema,
  travelCounterSchema,
  travelTransferSchema,
  activityBookSchema,
  carRentSchema,
  photoSchema,
  TRAVEL,
  TRAVEL_PLACES,
  CONSULATE_NAME,
  CABINS,
  ACTIVITIES,
  CAR_RENTAL,
  rentalPeriodLabel,
  hotelById,
  hotelRoom,
  travelSpot,
  travelSpawn,
  travelInteriorOf,
  TRAVEL_LAYOUTS,
  seatPoint,
  seatLabel,
  cabinSeats,
  legRoute,
  emptyTrip,
  excursionSeat,
  regionOf,
  placeById,
  placeDistance,
  PLACES,
  AGBERO,
  AGBERO_SPOTS,
  agberoAnswerSchema,
  type AgberoEncounter,
  FAST_TRAVEL,
  FAVOURITES,
  FAVOURITE_LABEL,
  fastTravelSchema,
  travelAnswerSchema,
  joinRequestSchema,
  isFastTravelKind,
  type Favourite,
  type FastTravelState,
  type Happening,
  type TravelPrompt,
  type TravelRegion,
  FLIGHT_CAPACITY,
  REACTIONS,
  type Leg,
  type TripState,
  type ActivityId,
  type CabinClass,
  type Place,
} from "@lagos-living/shared";
import {
  advanceLeg,
  retimeFlight,
  SeatTakenError,
  tripRecord,
  clearImmigration,
  hotelAccess,
  payActivity,
  rentCar,
  endCarRental,
  liveCarRental,
  recordPhoto,
  travelEvents,
} from "../travel-service.js";
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
import { homeEvents } from "../home-events.js";
import { playerEvents } from "../player-events.js";
import { splitCabFare } from "../finance-service.js";
import { previewTarget, requirePropertyAccess } from "../property-service.js";
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
import { loadFitness } from "../gym-service.js";
import { buildingEvents } from "../building-service.js";
import { homePropertyOf, loadDiscoveries, recordDiscovery } from "../fast-travel-service.js";
import { encounterEligible, payEncounter, resolveEncounter, startEncounter } from "../street-encounter-service.js";
import { chargeRide, closeRide, refundOrphanedRides, refundRide } from "../ride-service.js";
import { activeRental, parkRental, returnRental, startRental, type ActiveRental } from "../bike-service.js";
import { requestTow } from "../tow-service.js";
import { hasWristband } from "../club-service.js";
import { getSecurityStatus, policeWitness, resolveCheckpoint, resolveRobbery, securityEvents, startRobbery } from "../police-service.js";
import { config } from "../config.js";
import { TowDispatcher } from "./tow-dispatch.js";
import "../world-footprints.js";

export const LagosState = schema({
  tick: t.uint32().default(0),
});
export type LagosState = SchemaType<typeof LagosState>;

type LagosClient = Client & { auth: MultiplayerIdentity };

export const BUS_CAPACITY = 14;
const RIDE_DRIVERS = ["Tunde", "Chioma", "Emeka", "Aisha", "Segun", "Ngozi", "Ibrahim", "Folake", "Kelechi", "Bisi"];
const DUBAI_DRIVERS = ["Rashid", "Imran", "Faisal", "Anil", "Omar", "Yusuf", "Hamdan", "Sultan", "Arjun", "Bilal", "Tariq", "Rajesh"];
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
export const ROOM_CAPACITY = config.ROOM_CAPACITY;
/** Snapshots carry at most this many players (the nearest), so a crowd cannot blow up per-client bandwidth. */
export const MAX_VISIBLE_PLAYERS = 40;
const STUCK_RECOVERY_MS = 20_000;

type Player = {
  sessionId: string;
  userId: string;
  name: string;
  appearance: CharacterAppearance;
  build: number;
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
  guards: number;
  guardsUntil: number;
  /** An officer has flagged this driver down and is waiting for an answer. */
  checkpoint: (CheckpointStop & { point: [number, number] }) | null;
  lastCheckpointAt: number;
  /** A hold-up this player is the victim of, waiting for their answer. */
  heldUp: { robberyId: string; robberSessionId: string; robberName: string; expiresAt: number } | null;
  /** True while this player is holding someone up, so they can't start a second one. */
  robbing: boolean;
  trip: TripState;
  /** Public places this player has stood at; fast travel only goes to these and the favourites. */
  discovered: Set<string>;
  fastTravelAt: number;
  homePropertyId: string | null;
  /** A roadside tout (agbero) waiting for this driver's answer. */
  encounter: (AgberoEncounter & { spotId: string; vehicleId: string | null }) | null;
  lastEncounterAt: number;
  /** Cached result of the account-age and settings check, so a driver idling near a spot is not re-queried. */
  encounterCheck: { at: number; ok: boolean } | null;
};

type TravelRequest = {
  id: string;
  kind: "together" | "join";
  fromSessionId: string;
  toSessionId: string;
  /** Together: where the inviter went. Join: filled in from the host's position when they accept. */
  point: [number, number] | null;
  label: string;
  region: TravelRegion;
  expiresAt: number;
};

type Flight = {
  id: string;
  leg: Leg;
  departAt: number;
  arriveAt: number;
  seats: Map<string, { seat: string; cabin: CabinClass; partyId: string | null; name: string }>;
};

type Excursion = {
  id: string;
  activity: ActivityId;
  startsAt: number;
  endsAt: number;
  riders: number;
};

const PHOTO_PLACES = new Set(["marina-photo-point", "ain-dubai-view", "jbr-beach", "marina-dhow-pier", "desert-camp"]);

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
  private flights = new Map<string, Flight>();
  private travelRequests = new Map<string, TravelRequest>();
  private spotUsedAt = new Map<string, number>();
  private excursions = new Map<string, Excursion>();
  private tows = new TowDispatcher({
    vehicles: this.vehicles,
    owner: (userId) => {
      const player = [...this.players.values()].find((entry) => entry.userId === userId && entry.connected);
      if (!player) return null;
      const indoors = player.location !== "street" && !player.busId && !player.vehicleId;
      return { onStreet: player.location === "street" && !player.busId && !player.vehicleId, x: player.x, z: player.z, door: indoors ? player.returnPoint : null };
    },
    send: (userId, type, payload) => {
      for (const player of this.players.values()) if (player.userId === userId) this.clientFor(player)?.send(type, payload);
    },
    notify: (userId, notice) => {
      for (const player of this.players.values()) {
        const client = player.userId === userId ? this.clientFor(player) : undefined;
        if (client) this.notify(client, notice);
      }
    },
    clearOccupants: async (vehicleId) => {
      const driver = [...this.players.values()].find((player) => player.vehicleId === vehicleId && (player.vehicleSeat ?? 0) === 0);
      const client = driver ? this.clientFor(driver) : undefined;
      if (client) await this.handleExitVehicle(client, true);
      this.ejectPassengers(vehicleId);
    },
    personNear: (x, z, radius) =>
      [...this.players.values()].some((player) => player.location === "street" && !player.busId && Math.hypot(player.x - x, player.z - z) < radius),
  });
  private onVehicleChanged = (vehicleId: string) => void this.refreshVehicle(vehicleId);
  private onVehicleOwnerReset = (userId: string) => this.dropOwnerVehicles(userId);
  private onSanctioned = (userId: string, kind: string, reason: string, endsAt: number | null) => this.applySanction(userId, kind, reason, endsAt);
  private onBlocksChanged = (userIds: string[]) => void this.refreshHidden(userIds);
  private onAppearance = (userId: string, appearance: CharacterAppearance) => this.updateAppearance(userId, appearance);
  private onBuild = (userId: string, build: number) => this.updateBuild(userId, build);
  private onPlotsChanged = () => this.broadcast("plots", {});
  private onSecurityChanged = (userId: string) => void this.refreshGuards(userId);
  private onTravelInvite = (userId: string, from: string) => {
    const player = this.playerByUser(userId);
    const client = player ? this.clientFor(player) : undefined;
    if (client) this.notify(client, { tone: "info", text: `${from} invited you on their Dubai trip. Accept in Phone → Travel; you only pay if you accept.` });
  };

  private onHomeFurniture = (propertyId: string) => {
    const location = `home:${propertyId}`;
    for (const player of this.players.values()) {
      if (player.location === location) this.clientFor(player)?.send("interior", { propertyId });
    }
  };

  private onHomeInvite = (guestId: string, host: string, home: string) => {
    const player = this.playerByUser(guestId);
    const client = player ? this.clientFor(player) : undefined;
    if (client) this.notify(client, { tone: "info", text: `${host} invited you round to ${home}. Phone → My Home → Visit gives you directions; the door will open for you.` });
  };

  private onPlayerNotice = (userId: string, tone: "info" | "success" | "error", text: string) => {
    const player = this.playerByUser(userId);
    const client = player ? this.clientFor(player) : undefined;
    if (client) this.notify(client, { tone, text });
  };

  onAuth(_client: LagosClient, options: { token?: unknown }, _context: AuthContext) {
    return verifyMultiplayerToken(options.token);
  }

  async onCreate() {
    vehicleEvents.on("changed", this.onVehicleChanged);
    vehicleEvents.on("ownerReset", this.onVehicleOwnerReset);
    safetyEvents.on("sanctioned", this.onSanctioned);
    safetyEvents.on("blocksChanged", this.onBlocksChanged);
    profileEvents.on("appearance", this.onAppearance);
    profileEvents.on("build", this.onBuild);
    buildingEvents.on("changed", this.onPlotsChanged);
    securityEvents.on("changed", this.onSecurityChanged);
    travelEvents.on("invite", this.onTravelInvite);
    homeEvents.on("furniture", this.onHomeFurniture);
    homeEvents.on("invited", this.onHomeInvite);
    playerEvents.on("notice", this.onPlayerNotice);
    try {
      await parkAbandonedVehicles();
      for (const vehicle of await loadStreetVehicles()) this.vehicles.set(vehicle.id, vehicle);
    } catch (error) {
      console.error("Could not load street vehicles", error);
    }
    await this.tows.load().catch((error) => console.error("Could not resume tow jobs", error));
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
    this.onMessage("rentBike", (client, payload) => void this.handleRentBike(client, payload));
    this.onMessage("returnBike", (client) => void this.handleReturnBike(client));
    this.onMessage("rideBook", (client, payload) => void this.handleRideBook(client, payload));
    this.onMessage("rideBoard", (client) => this.handleRideBoard(client));
    this.onMessage("rideAsk", (client, payload) => this.handleRideAsk(client, payload));
    this.onMessage("rideAnswer", (client, payload) => void this.handleRideAnswer(client, payload));
    this.onMessage("rideArrive", (client) => void this.handleRideArrive(client));
    this.onMessage("rideCancel", (client, payload) => void this.handleRideCancel(client, payload));
    this.onMessage("rideSkip", (client) => void this.handleRideSkip(client));
    this.onMessage("testDrive", (client, payload) => this.handleTestDrive(client, payload));
    this.onMessage("towRequest", (client, payload) => void this.handleTowRequest(client, payload));
    this.onMessage("towCancel", (client, payload) => void this.handleTowCancel(client, payload));
    this.onMessage("vehicleSignal", (client, payload) => this.handleVehicleSignal(client, payload));
    this.onMessage("vehicleImpact", (client, payload) => void this.handleVehicleImpact(client, payload));
    this.onMessage("chat", (client, payload) => void this.handleChat(client, payload));
    this.onMessage("checkpointAnswer", (client, payload) => this.handleCheckpointAnswer(client, payload));
    this.onMessage("holdUp", (client, payload) => void this.handleHoldUp(client, payload));
    this.onMessage("robberyAnswer", (client, payload) => this.handleRobberyAnswer(client, payload));
    this.onMessage("requestLooks", (client) => this.sendLooks(client));
    this.onMessage("travelEnter", (client, payload) => void this.handleTravelEnter(client, payload));
    this.onMessage("travelCounter", (client, payload) => void this.handleTravelCounter(client, payload));
    this.onMessage("travelTransfer", (client, payload) => this.handleTravelTransfer(client, payload));
    this.onMessage("activityStart", (client, payload) => void this.handleActivityStart(client, payload));
    this.onMessage("carRent", (client, payload) => void this.handleCarRent(client, payload));
    this.onMessage("carReturn", (client) => void this.handleCarReturn(client));
    this.onMessage("photo", (client, payload) => void this.handlePhoto(client, payload));
    this.onMessage("fastTravel", (client, payload) => this.handleFastTravel(client, payload));
    this.onMessage("travelAnswer", (client, payload) => this.handleTravelAnswer(client, payload));
    this.onMessage("joinRequest", (client, payload) => this.handleJoinRequest(client, payload));
    this.onMessage("agberoAnswer", (client, payload) => void this.handleAgberoAnswer(client, payload));
    this.onMessage("goState", (client) => {
      const player = this.players.get(client.sessionId);
      if (player && !this.limited(player.actionRate, 6)) client.send("goState", this.goState(player));
    });
    this.onMessage("requestTrip", (client) => {
      const player = this.players.get(client.sessionId);
      if (player) this.sendTrip(player);
    });
    this.onMessage("emote", (client, payload) => {
      const player = this.players.get(client.sessionId);
      const parsed = emoteRequestSchema.safeParse(payload);
      if (!player || !parsed.success || player.busId) return;
      const seated = player.location.startsWith("flight:") || player.location.startsWith("excursion:");
      if (seated) return;
      player.motion = parsed.data.emote === "none" ? "idle" : parsed.data.emote;
    });
    this.onMessage("react", (client, payload) => {
      const player = this.players.get(client.sessionId);
      const emoji = typeof payload === "object" && payload ? (payload as { emoji?: unknown }).emoji : null;
      if (!player || typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji) || this.limited(player.actionRate, 3)) return;
      for (const other of this.chatRecipients(player)) this.clientFor(other)?.send("react", { sessionId: player.sessionId, emoji });
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
    const [suspension, mute, hidden, appearance, security, discovered, homePropertyId, build] = await Promise.all([
      activeSuspension(client.auth.userId).catch(() => null),
      activeMute(client.auth.userId).catch(() => null),
      hiddenPlayers(client.auth.userId).catch(() => new Set<string>()),
      loadAppearance(client.auth.userId).catch(() => defaultAppearance),
      getSecurityStatus(client.auth.userId).catch(() => ({ guards: 0, until: null })),
      loadDiscoveries(client.auth.userId).catch(() => new Set<string>()),
      homePropertyOf(client.auth.userId).catch(() => null),
      loadFitness(client.auth.userId).catch(() => 0),
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
      build,
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
      guards: security.guards,
      guardsUntil: security.until ? new Date(security.until).getTime() : 0,
      checkpoint: null,
      lastCheckpointAt: 0,
      heldUp: null,
      robbing: false,
      trip: emptyTrip(),
      discovered,
      fastTravelAt: 0,
      homePropertyId,
      encounter: null,
      lastEncounterAt: 0,
      encounterCheck: null,
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
    const resumed = await this.resumeTravel(player).catch(() => undefined);
    if (this.players.get(client.sessionId) !== player) return;
    this.sendLook(player, client.sessionId);
    this.sendTrip(player);
    this.sendSelf(client, player, resumed ?? (saved ? "Welcome back — progress restored." : "Welcome to Lekki Phase 1."));
    const orphaned = await refundOrphanedRides(player.userId, player.ride?.id ?? null).catch(() => 0);
    if (orphaned > 0) this.notify(client, { tone: "info", text: `A ride you paid for was cut off when the server restarted. ₦${orphaned.toLocaleString("en-NG")} has been refunded.` });
    client.send("bikeStock", Object.fromEntries(this.bikeStock));
    client.send("tows", this.tows.states(player.userId));
    const rental = await activeRental(player.userId).catch(() => null);
    if (rental && this.players.get(client.sessionId) === player) this.placeRentalBike(player, rental);
    const hire = await liveCarRental(player.userId).catch(() => null);
    const desk = placeById.get(TRAVEL_PLACES.carRental);
    if (hire && desk && this.players.get(client.sessionId) === player) this.placeHireCar(player, hire.id, hire.modelId, hire.endsAt, desk);
  }

  /** Everyone's current look, asked for by a client once its message handlers are registered. */
  private sendLooks(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    const now = Date.now();
    if (now - player.looksRequestedAt < 5_000) return;
    player.looksRequestedAt = now;
    const looks: Look[] = [...this.players.values()].map(({ sessionId, appearance, build }) => ({ sessionId, appearance, build }));
    client.send("looks", looks);
  }

  private sendLook(player: Player, except?: string) {
    const look: Look = { sessionId: player.sessionId, appearance: player.appearance, build: player.build };
    for (const client of this.clients) if (client.sessionId !== except) client.send("look", look);
  }

  private updateBuild(userId: string, build: number) {
    for (const player of this.players.values()) {
      if (player.userId !== userId) continue;
      player.build = build;
      this.sendLook(player);
    }
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
      this.sendTrip(player);
      this.sendSelf(client, player, player.busId ? "Reconnected — you are still aboard." : player.location.startsWith("flight:") ? "Reconnected — you're still on your flight." : "Reconnected.");
    } catch {
      if (this.players.get(client.sessionId) !== player) return;
      if (player.busId) {
        const bus = this.buses.find(({ id }) => id === player.busId);
        const stop = bus ? bus.route.stops[bus.stopIndex]! : ROUTES[0]!.stops[0]!;
        player.x = stop.alight[0];
        player.z = stop.alight[1];
        this.releaseSeat(player, "interrupted", stop.id);
      }
      if (player.heldUp) await this.finishHoldUp(player, "timeout").catch(() => undefined);
      if (player.encounter) await resolveEncounter(player.userId, player.encounter.id, "ignored").catch(() => undefined);
      if (player.robbing) {
        for (const other of this.players.values()) if (other.heldUp?.robberSessionId === player.sessionId) await this.finishHoldUp(other, "timeout").catch(() => undefined);
      }
      await this.endRide(player, "cancelled", "You disconnected, so the ride ended.", "system").catch(() => undefined);
      await this.parkPlayerVehicle(player).catch(() => undefined);
      for (const vehicle of this.vehicles.values()) {
        if (vehicle.rental && vehicle.ownerUserId === player.userId) await parkRental(vehicle.rental.id, vehicle.x, vehicle.z, vehicle.yaw).catch(() => undefined);
      }
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
    profileEvents.off("build", this.onBuild);
    buildingEvents.off("changed", this.onPlotsChanged);
    securityEvents.off("changed", this.onSecurityChanged);
    travelEvents.off("invite", this.onTravelInvite);
    homeEvents.off("furniture", this.onHomeFurniture);
    homeEvents.off("invited", this.onHomeInvite);
    playerEvents.off("notice", this.onPlayerNotice);
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
    if (player.location.startsWith("flight:") || player.location.startsWith("excursion:")) return;
    const now = Date.now();
    // Mobile links stall for seconds and then deliver a burst; the first packet of the burst covers the whole gap.
    const elapsed = Math.min(4, Math.max(0.03, (now - player.lastAcceptedAt) / 1_000));
    const vehicle = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    const topSpeed = vehicle
      ? effectiveTopSpeed(getVehicleModel(vehicle.modelId), vehicle.condition)
      : MOVEMENT.sprintSpeed;
    // Packets bunch up on mobile networks; judging bunched updates over at least a quarter-second stops false snap-backs.
    const allowed = topSpeed * 1.35 * Math.max(0.25, elapsed) + 0.75;
    const distance = Math.hypot(parsed.data.x - player.x, parsed.data.z - player.z);
    const inInterior = player.location !== "street";
    const travelKind = inInterior ? travelInteriorOf(player.location) : null;
    const half = travelKind ? TRAVEL_LAYOUTS[travelKind].half : INTERIOR_HALF;
    const home = !travelKind && (player.location.startsWith("home:") || player.location.startsWith("preview:"));
    const valid = !inInterior
      ? walkable(parsed.data.x, parsed.data.z)
      : home
        ? insideHome(homeLayout(player.propertyId), parsed.data.x - INTERIOR_ORIGIN[0], parsed.data.z - INTERIOR_ORIGIN[1])
        : Math.abs(parsed.data.x - INTERIOR_ORIGIN[0]) <= half[0] && Math.abs(parsed.data.z - INTERIOR_ORIGIN[1]) <= half[1];
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
      if (!vehicle.npc && !vehicle.tow && !player.vehicleSeat) this.watchCheckpoints(client, player, vehicle, now);
      if (!vehicle.testDrive && !vehicle.npc && !vehicle.rental && !vehicle.hire && now - player.lastVehicleSaveAt > VEHICLE_SAVE_MS) {
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
    const { mode } = parsed.data;
    let { propertyId } = parsed.data;
    const club = CLUBS[propertyId] ? getPlace(propertyId) : null;
    const place = club ?? (propertyId === "starter-home" ? getPlace("starter-home") : (propertyPlace(propertyId) ?? builtHomePlace(propertyId)));
    if (!place) return this.notify(client, { tone: "error", text: "That home is not on the map." });
    if (Math.hypot(player.x - place.door[0], player.z - place.door[1]) > 4.5) {
      return this.notify(client, { tone: "error", text: `Walk up to the door of ${place.name}.` });
    }
    let location: string;
    let previewOnly = false;
    try {
      if (club) {
        if (!(await hasWristband(player.userId, propertyId))) {
          return this.notify(client, { tone: "error", text: `Pay the cover at the door of ${club.name} first.` });
        }
        location = clubLocation(propertyId);
      } else if (propertyId === "starter-home") {
        location = `starter:${player.userId}`;
      } else if (mode === "preview") {
        const target = await previewTarget(player.userId, propertyId);
        if ("home" in target) {
          propertyId = target.home;
          location = `home:${propertyId}`;
        } else {
          propertyId = target.preview;
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
    if (!previewOnly && !club && propertyId !== "starter-home") void markProgress(pool, player.userId, "visited_home").catch(() => undefined);
    this.sendSelf(client, player, previewOnly ? "preview" : "entered");
  }

  private handleExitProperty(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player || player.location === "street") return;
    const blocked = this.travelExitBlock(player);
    if (blocked) return this.notify(client, { tone: "info", text: blocked });
    const wasTravel = travelInteriorOf(player.location) !== null;
    player.location = "street";
    player.previewOnly = false;
    player.propertyId = null;
    [player.x, player.z] = player.returnPoint;
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    if (wasTravel) {
      player.trip = emptyTrip();
      this.sendTrip(player);
    }
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
      if (vehicle.rental) {
        const station = vehicle.rental.stationId;
        this.bikeStock.set(station, Math.min(BIKE_RENTAL.docks, (this.bikeStock.get(station) ?? 0) + 1));
        this.broadcastBikeStock();
      }
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
    if (vehicle.rental || vehicle.hire) return vehicle;
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

  private bikeStock = new Map<string, number>(BIKE_STATIONS.map((station) => [station.id, BIKE_RENTAL.startingBikes]));

  private broadcastBikeStock() {
    this.broadcast("bikeStock", Object.fromEntries(this.bikeStock));
  }

  /** Puts the player in the driver's seat of a vehicle that needs no ownership claim (test cars, hired bikes). */
  private mountVehicle(client: Client, player: Player, vehicle: RoomVehicle, message: string) {
    const now = Date.now();
    vehicle.driverSessionId = client.sessionId;
    player.vehicleId = vehicle.id;
    player.vehicleSeat = 0;
    [player.x, player.z, player.yaw] = [vehicle.x, vehicle.z, vehicle.yaw];
    player.motion = "drive";
    player.driveMetres = 0;
    player.lastAcceptedAt = now;
    setPlayerPosition(player.userId, player.x, player.z, "street");
    this.notify(client, { tone: "success", text: message });
    this.sendSelf(client, player, "drive");
    client.send("vehicleStatus", { vehicleId: vehicle.id, condition: vehicle.condition });
  }

  private rentalVehicle(player: Player, rental: ActiveRental, x: number, z: number, yaw: number): RoomVehicle {
    return {
      id: `hire-${rental.id}`,
      ownerUserId: player.userId,
      ownerName: `Lagos Bike Hire · ${player.name}`,
      modelId: BIKE_RENTAL.modelId,
      colour: BIKE_RENTAL.colour,
      plate: `HIRE ${rental.id.slice(0, 4).toUpperCase()}`,
      condition: 100,
      x,
      z,
      yaw,
      driverSessionId: null,
      lights: false,
      locked: true,
      rental: { id: rental.id, stationId: rental.stationId, startedAt: rental.startedAt },
    };
  }

  /** Restores a hire that outlived the last session, where the bike was last locked. */
  private placeRentalBike(player: Player, rental: ActiveRental) {
    const id = `hire-${rental.id}`;
    if (this.vehicles.has(id)) return;
    this.vehicles.set(id, this.rentalVehicle(player, rental, rental.x, rental.z, rental.yaw));
    const client = this.clientFor(player);
    if (client) this.notify(client, { tone: "info", text: "Your hired bike is still out — find it with Phone → Transport → Bikes. The meter has kept running." });
  }

  private async handleRentBike(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = rentBikeSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const station = bikeStationById.get(parsed.data.stationId);
    if (!station) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (player.location !== "street" || player.busId || player.vehicleId || player.entering) return fail("Step out onto the street first.");
    if (Math.hypot(player.x - station.point[0], player.z - station.point[1]) > BIKE_RENTAL.rentRange + 5) return fail(`Walk up to the ${station.name} bike dock.`);
    if ((this.bikeStock.get(station.id) ?? 0) <= 0) return fail(`No bikes left at ${station.name}. Check Phone → Transport → Bikes for the nearest station with bikes.`);
    player.entering = true;
    this.bikeStock.set(station.id, (this.bikeStock.get(station.id) ?? 1) - 1);
    try {
      const { rental, balance } = await startRental(player.userId, station.id, parsed.data.idempotencyKey);
      if (player.location !== "street" || player.vehicleId || this.players.get(client.sessionId) !== player) {
        await returnRental(player.userId, rental.id, station.id).catch(() => undefined);
        this.bikeStock.set(station.id, (this.bikeStock.get(station.id) ?? 0) + 1);
        return;
      }
      // Wheeled out beside the rack, facing along the pavement.
      const sides: Array<[number, number]> = [1.8, -1.8].map((side) => [station.point[0] + Math.cos(station.yaw) * side, station.point[1] - Math.sin(station.yaw) * side]);
      const [x, z] = sides.find(([sx, sz]) => walkable(sx, sz, 0.4)) ?? station.point;
      const vehicle = this.rentalVehicle(player, rental, x, z, station.yaw);
      this.vehicles.set(vehicle.id, vehicle);
      this.mountVehicle(
        client,
        player,
        vehicle,
        `Bike unlocked: ₦${BIKE_RENTAL.unlockFee} paid and ₦${BIKE_RENTAL.deposit.toLocaleString("en-NG")} deposit held (balance ₦${balance.toLocaleString("en-NG")}). ₦${BIKE_RENTAL.perMinute}/min, return at any station.`,
      );
      this.broadcastBikeStock();
    } catch (error) {
      this.bikeStock.set(station.id, (this.bikeStock.get(station.id) ?? 0) + 1);
      const message = (error as Error).message;
      fail(message.includes("Insufficient") ? `You need ₦${(BIKE_RENTAL.unlockFee + BIKE_RENTAL.deposit).toLocaleString("en-NG")} to hire a bike (₦${BIKE_RENTAL.deposit.toLocaleString("en-NG")} of it comes back on return).` : message);
    } finally {
      player.entering = false;
    }
  }

  /** Return a parked hire bike while standing next to it at a dock. */
  private async handleReturnBike(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player || this.limited(player.actionRate, 4)) return;
    if (player.vehicleId) return this.handleExitVehicle(client);
    const bike = [...this.vehicles.values()].find((vehicle) => vehicle.rental && vehicle.ownerUserId === player.userId);
    if (!bike) return;
    const { station, distance } = nearestBikeStation(bike.x, bike.z);
    if (distance > BIKE_RENTAL.returnRange) return this.notify(client, { tone: "error", text: `Bring the bike to a station first — the nearest is ${station.name}, ${Math.round(distance)} m away.` });
    if ((this.bikeStock.get(station.id) ?? 0) >= BIKE_RENTAL.docks) return this.notify(client, { tone: "error", text: `${station.name} is full. Try another station.` });
    await this.returnBike(client, player, bike);
  }

  private async returnBike(client: Client, player: Player, bike: RoomVehicle) {
    const rental = bike.rental;
    if (!rental) return;
    const { station } = nearestBikeStation(bike.x, bike.z);
    this.vehicles.delete(bike.id);
    this.bikeStock.set(station.id, Math.min(BIKE_RENTAL.docks, (this.bikeStock.get(station.id) ?? 0) + 1));
    this.broadcastBikeStock();
    try {
      const result = await returnRental(player.userId, rental.id, station.id);
      this.notify(client, {
        tone: "success",
        text: `Bike docked at ${station.name}: ${result.minutes} min, ₦${result.usage.toLocaleString("en-NG")}. ₦${result.refund.toLocaleString("en-NG")} of your deposit is back in your wallet.`,
      });
      client.send("bikeReturned", { usage: result.usage, refund: result.refund, minutes: result.minutes });
    } catch (error) {
      console.error("Bike return failed", error);
      const { usage } = rentalUsage(rental.startedAt, Date.now());
      this.notify(client, { tone: "error", text: `The dock took the bike but the deposit could not be settled right now (≈₦${usage} used). Report it from Phone → Safety.` });
    }
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
    const express = parsed.data.express;
    if (player.busId || player.vehicleId) return fail("Get out of the vehicle you're in before booking.");
    if (express) {
      const block = this.fastTravelBlock(player);
      if (block) return fail(block);
    } else if (player.location !== "street") return fail("Book a ride from the street, not from inside a building. Express works from indoors.");
    const { dropoff, destination, label, roadMetres, idempotencyKey } = parsed.data;
    // Express picks you up wherever you stand (indoors, off-road); a normal ride needs a road the driver can reach.
    const pickup: [number, number] = express ? this.standingAt(player) : parsed.data.pickup;
    if (!express && (Math.hypot(pickup[0] - player.x, pickup[1] - player.z) > RIDE.pickupRange || !walkable(pickup[0], pickup[1], 0.5))) {
      return fail("Move closer to a road so the driver can reach you.");
    }
    if (!walkable(dropoff[0], dropoff[1], 0.5) || Math.hypot(dropoff[0] - destination[0], dropoff[1] - destination[1]) > 400) {
      return fail(`No road reaches ${label}. Pick a place on the map near a street.`);
    }
    const region = regionOf(pickup[0], pickup[1]);
    if (region !== regionOf(dropoff[0], dropoff[1])) {
      return fail(region === "dubai" ? `${label} is back in Lagos. Fly home from Dubai International (DXB).` : `${label} is in Dubai. Fly there from the Lagos airport terminal.`);
    }
    const straight = Math.hypot(dropoff[0] - pickup[0], dropoff[1] - pickup[1]);
    if (straight < RIDE.minMetres) return fail(`${label} is a short walk from here.`);
    if (straight > RIDE.maxMetres) return fail(`${label} is outside the Naija World Ride service area.`);
    const metres = Math.min(straight * RIDE.maxRoadFactor, Math.max(straight * RIDE.minRoadFactor, roadMetres));
    const fare = express ? expressFare(metres) : rideFare(metres);
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
      driverName: region === "dubai" ? DUBAI_DRIVERS[randomInt(DUBAI_DRIVERS.length)]! : RIDE_DRIVERS[randomInt(RIDE_DRIVERS.length)]!,
      plate: region === "dubai"
        ? `DUBAI ${String.fromCharCode(65 + randomInt(26))} ${10000 + randomInt(90000)}`
        : `LLR ${100 + randomInt(900)} ${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))}`,
      colour: region === "dubai" ? RIDE.dubaiColour : RIDE.colour,
      modelId: RIDE.modelId,
      vehicleId: null,
      bookedAt: now,
      arrivesAt: now + (RIDE.pickupSecondsMin + randomInt(RIDE.pickupSecondsMax - RIDE.pickupSecondsMin + 1)) * 1_000,
      waitUntil: null,
      refunded: 0,
      message: null,
    };
    const ride = player.ride;
    try {
      const balance = await chargeRide(player.userId, fare, label, idempotencyKey, id);
      if (express) {
        this.notify(client, { tone: "success", text: `Express to ${label}: ₦${fare.toLocaleString("en-NG")} paid, balance ₦${balance.toLocaleString("en-NG")}.` });
        if (walkable(destination[0], destination[1], 0.5)) ride.dropoff = [destination[0], destination[1]];
        if (player.location !== "street") {
          player.location = "street";
          player.previewOnly = false;
          player.propertyId = null;
          [player.x, player.z] = player.returnPoint;
        }
        await this.skipRide(player);
        return;
      }
      this.notify(client, { tone: "success", text: `Ride booked: ${ride.driverName} is on the way. Fare ₦${fare.toLocaleString("en-NG")} paid, balance ₦${balance.toLocaleString("en-NG")}.` });
      this.sendRide(player);
    } catch (error) {
      if (player.ride === ride) player.ride = null;
      const message = (error as Error).message;
      fail(/duplicate|unique/i.test(message) ? "That booking was already made." : message.includes("Insufficient") ? `You need ₦${fare.toLocaleString("en-NG")} for this ride.` : "The ride could not be booked.");
    }
  }

  /** Asks whoever controls a car for a seat: the owner of a locked private car, or the rider who booked a cab. */
  private rideAsks = new Map<string, { vehicleId: string; hostSessionId: string; at: number }>();

  private rideHost(vehicle: RoomVehicle) {
    if (vehicle.npc) {
      for (const candidate of this.players.values()) if (candidate.ride?.vehicleId === vehicle.id && ["waiting", "riding"].includes(candidate.ride.status)) return candidate;
      return undefined;
    }
    return vehicle.ownerUserId ? this.playerByUser(vehicle.ownerUserId) : undefined;
  }

  private handleRideAsk(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const vehicleId = typeof (payload as { vehicleId?: unknown })?.vehicleId === "string" ? (payload as { vehicleId: string }).vehicleId : null;
    if (!player || !vehicleId || this.limited(player.actionRate, 3)) return;
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle || player.location !== "street" || player.vehicleId || player.busId) return;
    if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > VEHICLE_RULES.enterRange + 2) return this.notify(client, { tone: "error", text: "Walk up to the car first." });
    const host = this.rideHost(vehicle);
    const hostClient = host ? this.clientFor(host) : undefined;
    if (!host || !hostClient || host === player) return this.notify(client, { tone: "error", text: "The owner isn't around to let you in." });
    const previous = this.rideAsks.get(client.sessionId);
    if (previous && previous.vehicleId === vehicleId && Date.now() - previous.at < 10_000) return;
    this.rideAsks.set(client.sessionId, { vehicleId, hostSessionId: hostClient.sessionId, at: Date.now() });
    const half = vehicle.npc && host.ride ? Math.floor(host.ride.fare / 2) : 0;
    hostClient.send("rideAsk", { sessionId: client.sessionId, name: player.name, vehicleId, cab: Boolean(vehicle.npc), share: half });
    this.notify(client, { tone: "info", text: vehicle.npc ? `Asked ${host.name} to share their cab. If they agree you pay half: ₦${half.toLocaleString("en-NG")}.` : `Asked ${host.name} for a ride. Wait for them to let you in.` });
  }

  private async handleRideAnswer(client: Client, payload: unknown) {
    const parsed = z.object({ sessionId: z.string().min(1).max(80), allow: z.boolean() }).safeParse(payload);
    const host = this.players.get(client.sessionId);
    if (!parsed.success || !host) return;
    const ask = this.rideAsks.get(parsed.data.sessionId);
    this.rideAsks.delete(parsed.data.sessionId);
    const guest = this.players.get(parsed.data.sessionId);
    const guestClient = guest ? this.clientFor(guest) : undefined;
    if (!ask || ask.hostSessionId !== client.sessionId || !guest || !guestClient || Date.now() - ask.at > 60_000) return;
    if (!parsed.data.allow) return this.notify(guestClient, { tone: "info", text: `${host.name} said no this time.` });
    const vehicle = this.vehicles.get(ask.vehicleId);
    if (!vehicle || guest.location !== "street" || guest.vehicleId || guest.busId) return;
    if (Math.hypot(guest.x - vehicle.x, guest.z - vehicle.z) > VEHICLE_RULES.enterRange + 4) return this.notify(guestClient, { tone: "error", text: "You walked away from the car." });
    if (this.passengersOf(vehicle.id).length >= getVehicleModel(vehicle.modelId).seats - 1) return this.notify(guestClient, { tone: "error", text: "There's no free seat left." });
    if (vehicle.npc) {
      const ride = host.ride;
      if (!ride || ride.vehicleId !== vehicle.id || !["waiting", "riding"].includes(ride.status)) return this.notify(guestClient, { tone: "error", text: "That cab has gone." });
      const half = Math.floor(ride.fare / 2);
      try {
        if (half > 0) await splitCabFare(host.userId, guest.userId, half, ride.id, guest.name, host.name);
      } catch (error) {
        return this.notify(guestClient, { tone: "error", text: (error as Error).message.includes("Insufficient") ? `You need ₦${half.toLocaleString("en-NG")} for your half.` : (error as Error).message });
      }
      this.notify(client, { tone: "success", text: `${guest.name} is sharing your cab and paid you half: ₦${half.toLocaleString("en-NG")}.` });
    } else {
      this.notify(client, { tone: "success", text: `${guest.name} is riding with you.` });
    }
    this.seatPassenger(guestClient, guest, vehicle);
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
    await this.endRide(player, "completed", `Arrived at ${ride.label}. Thanks for riding with Naija World Ride!`, "arrived");
  }

  private async handleRideSkip(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player || this.limited(player.actionRate, 4)) return;
    await this.skipRide(player);
  }

  /**
   * Takes the rider straight to the drop-off: the fare is already paid and nothing is refunded. The ride car
   * goes away with the ride, so no vehicle is left behind or duplicated.
   */
  private async skipRide(player: Player) {
    const ride = player.ride;
    const client = this.clientFor(player);
    if (!ride || !(ride.status === "approaching" || ride.status === "waiting" || ride.status === "riding")) return;
    if (player.checkpoint || player.heldUp) {
      if (client) this.notify(client, { tone: "error", text: "Deal with the situation here first." });
      return;
    }
    const vehicle = ride.vehicleId ? this.vehicles.get(ride.vehicleId) : undefined;
    const aboard = Boolean(vehicle && player.vehicleId === vehicle.id);
    if (!aboard && (player.location !== "street" || player.busId || player.vehicleId)) {
      if (client) this.notify(client, { tone: "error", text: "Step out onto the street first." });
      return;
    }
    const [x, z] = ride.dropoff;
    const now = Date.now();
    if (vehicle && aboard) {
      vehicle.x = x;
      vehicle.z = z;
      for (const rider of this.passengersOf(vehicle.id)) {
        if (rider === player) continue;
        [rider.x, rider.z] = [x, z];
        rider.lastAcceptedAt = now;
        setPlayerPosition(rider.userId, x, z, "street");
        const riderClient = this.clientFor(rider);
        if (riderClient) this.sendSelf(riderClient, rider, "teleported");
      }
    } else if (vehicle) {
      this.vehicles.delete(vehicle.id);
      ride.vehicleId = null;
    }
    [player.x, player.z] = [x, z];
    player.lastAcceptedAt = now;
    await this.endRide(player, "completed", `Arrived at ${ride.label}. Thanks for riding with Naija World Ride!`, "arrived");
    if (!aboard) {
      setPlayerPosition(player.userId, player.x, player.z, "street");
      const latest = this.clientFor(player);
      if (latest) this.sendSelf(latest, player, "teleported");
    }
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
      this.ejectPassengers(vehicle.id);
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
    void closeRide(ride.id).catch((error) => console.error("Could not close ride record", error));
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
          ownerName: `Naija World Ride · ${ride.driverName}`,
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
    if (vehicle.tow) return this.notify(client, { tone: "error", text: "That is an Ade Recovery truck." });
    if (vehicle.npc) return this.notify(client, { tone: "error", text: "That is a Naija World Ride car. Book your own from Phone → Ride." });
    if (this.tows.busy(vehicle.id)) return this.notify(client, { tone: "error", text: "Ade Recovery is collecting this car. Phone → Vehicles shows its progress." });
    if (vehicle.testDrive && !owner) return this.notify(client, { tone: "error", text: "That is someone's dealer test car." });
    if (vehicle.rental) {
      if (!owner) return this.notify(client, { tone: "error", text: "That bike is hired by another resident." });
      if (vehicle.driverSessionId) return;
      return this.mountVehicle(client, player, vehicle, "Back on your hired bike. The meter is still running.");
    }
    if (vehicle.hire && owner && parsed.data.seat !== "passenger") {
      if (vehicle.driverSessionId) return;
      return this.mountVehicle(client, player, vehicle, "Back in your Dubai hire car.");
    }
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
    if (vehicle?.rental && seat === 0) {
      player.lastAcceptedAt = Date.now();
      setPlayerPosition(player.userId, player.x, player.z, "street");
      this.sendSelf(client, player, "parked");
      const { station, distance } = nearestBikeStation(vehicle.x, vehicle.z);
      if (distance <= BIKE_RENTAL.returnRange && (this.bikeStock.get(station.id) ?? 0) < BIKE_RENTAL.docks) return this.returnBike(client, player, vehicle);
      void parkRental(vehicle.rental.id, vehicle.x, vehicle.z, vehicle.yaw).catch(() => undefined);
      if (!quiet) {
        this.notify(client, {
          tone: "info",
          text: distance <= BIKE_RENTAL.returnRange
            ? `${station.name} is full, so the bike is locked here. Try the next station; the meter keeps running.`
            : `Bike locked here. The meter keeps running at ₦${BIKE_RENTAL.perMinute}/min until you return it at any station.`,
        });
      }
      return;
    }
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
    const speed = dialSpeed(Math.min(parsed.data.speed, model.topSpeed * 1.3));
    const damage = impactDamage(speed, config.VEHICLE_DAMAGE_MULTIPLIER);
    const severe = impactSeverity(speed) === "severe";
    this.considerCitation(client, player, speed);
    if (damage <= 0) return;
    const before = vehicle.condition;
    const result = await damageVehicle(player.userId, vehicle.id, damage, speed, severe).catch(() => null);
    if (!result) return;
    vehicle.condition = result.condition;
    client.send("vehicleStatus", { vehicleId: vehicle.id, condition: vehicle.condition, damage: before - result.condition, severe });
    const crossed = (line: number) => result.condition < line && before >= line;
    if (result.condition <= 0) {
      this.notify(client, {
        tone: "error",
        text: result.insured
          ? "Severe crash: the engine has died. Your cover pays for the tow: Phone → Vehicles → Tow & repair."
          : "Severe crash: the engine has died. Phone → Vehicles → Tow & repair sends Ade Recovery.",
      });
    } else if (crossed(VEHICLE_RULES.limpCondition)) {
      this.notify(client, { tone: "error", text: `Warning light: limp mode at ${result.condition}%. Top speed is reduced until it is repaired at Ade Auto Works.` });
    } else if (crossed(VEHICLE_RULES.warnCondition)) {
      this.notify(client, { tone: "info", text: `Check-engine light: ${result.condition}% condition. Still drivable — get it repaired at Ade Auto Works or via Phone → Vehicles.` });
    }
  }

  private async handleTowRequest(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = towRequestSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const { vehicleId, destination, express, idempotencyKey } = parsed.data;
    const car = this.vehicles.get(vehicleId);
    if (car && (car.testDrive || car.rental || car.npc)) return this.notify(client, { tone: "error", text: "Only cars you own can be towed." });
    if (player.vehicleId === vehicleId) await this.handleExitVehicle(client, true);
    try {
      const { job } = await requestTow(player.userId, vehicleId, destination, idempotencyKey, express ? TOW.expressFee : 0);
      if (!this.vehicles.has(vehicleId) && !job.collectedAt) await this.refreshVehicle(vehicleId);
      this.tows.start(job, express);
      this.notify(client, {
        tone: "success",
        text: `${express ? `Ade Recovery express: ${job.vehicle.plate} will be beside you in about ${TOW.expressSeconds} s` : `Ade Recovery is on the way for ${job.vehicle.plate}`}. Paid ${job.quote.total ? `₦${job.quote.total.toLocaleString("en-NG")}` : "nothing"}${job.quote.insurer ? ` (cover paid ₦${job.quote.insurer.toLocaleString("en-NG")})` : ""}.`,
      });
    } catch (error) {
      const message = error instanceof EconomyError ? error.message : "The tow could not be booked. Try again.";
      if (!(error instanceof EconomyError)) console.error("Tow request failed", error);
      this.notify(client, { tone: "error", text: message });
    }
  }

  private async handleTowCancel(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = towCancelSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const result = await this.tows.cancel(player.userId, parsed.data.towId).catch(() => null);
    if (result === "late") return this.notify(client, { tone: "error", text: "The car is already on the truck, so the job can't be cancelled now." });
    if (result) this.notify(client, { tone: "info", text: `Ade Recovery cancelled.${result.refunded ? ` ₦${result.refunded.toLocaleString("en-NG")} refunded.` : ""}` });
  }

  /** Speedometer speed measured by the server from accepted updates over the last moment, so a client cannot talk it down. */
  private measuredSpeed(player: Player) {
    const now = Date.now();
    const recent = player.travel.filter(({ at }) => now - at <= SPEED_WINDOW_MS);
    const seconds = recent.reduce((sum, sample) => sum + sample.seconds, 0);
    return seconds > 0 ? dialSpeed(recent.reduce((sum, { metres }) => sum + metres, 0) / seconds) : 0;
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
        rentalStartedAt: vehicle.rental?.startedAt ?? null,
        npc: Boolean(vehicle.npc),
        tow: vehicle.tow ? { carrying: vehicle.tow.carrying, lift: vehicle.tow.lift } : null,
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
    this.tows.tick(seconds, now);
    if (this.state.tick % 5 === 0 && this.flights.size) this.checkFlights(now);
    if (this.state.tick % 100 === 0) this.checkDiscoveries(now);
    if (this.state.tick % 25 === 0) {
      this.checkTestDrives(now);
      this.checkRides(now);
      this.checkPolice(now);
      this.checkExcursions(now);
      this.checkHires(now);
      this.checkEncounters(now);
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

  private async refreshGuards(userId: string) {
    const status = await getSecurityStatus(userId).catch(() => null);
    if (!status) return;
    for (const player of this.players.values()) {
      if (player.userId !== userId) continue;
      player.guards = status.guards;
      player.guardsUntil = status.until ? new Date(status.until).getTime() : 0;
    }
  }

  private policeWhere(player: Player) {
    return { x: player.x, z: player.z, district: districtAt(player.x, player.z)?.name ?? null };
  }

  /** Flags a driver down near a checkpoint, and treats leaving the checkpoint while flagged as driving off. */
  private watchCheckpoints(client: Client, player: Player, vehicle: RoomVehicle, now: number) {
    if (player.checkpoint) {
      const [cx, cz] = player.checkpoint.point;
      if (Math.hypot(player.x - cx, player.z - cz) > POLICE.fleeDistance) void this.finishCheckpoint(player, "flee");
      return;
    }
    if (now - player.lastCheckpointAt < POLICE.checkpointCooldownMs) return;
    const checkpoint = POLICE_CHECKPOINTS.find(({ point }) => Math.hypot(player.x - point[0], player.z - point[1]) < POLICE.checkpointRadius);
    if (!checkpoint) return;
    player.lastCheckpointAt = now;
    player.checkpoint = { checkpointId: checkpoint.id, name: checkpoint.name, expiresAt: now + POLICE.answerMs, point: checkpoint.point };
    const stop: CheckpointStop = { checkpointId: checkpoint.id, name: checkpoint.name, expiresAt: player.checkpoint.expiresAt };
    client.send("checkpoint", { ...stop, vehicleId: vehicle.id });
  }

  private handleCheckpointAnswer(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = checkpointAnswerSchema.safeParse(payload);
    if (!player || !parsed.success || player.checkpoint?.checkpointId !== parsed.data.checkpointId) return;
    void this.finishCheckpoint(player, parsed.data.answer);
  }

  private async finishCheckpoint(player: Player, answer: "comply" | "flee") {
    const stop = player.checkpoint;
    if (!stop) return;
    player.checkpoint = null;
    const vehicle = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    const papersCar = vehicle && !vehicle.testDrive && !vehicle.rental && vehicle.ownerUserId === player.userId ? vehicle.id : null;
    const result = await resolveCheckpoint(player.userId, stop.checkpointId, papersCar, answer, this.policeWhere(player)).catch(() => null);
    const client = this.clientFor(player);
    if (!client || !result) return;
    const fine = result.citation ? `₦${result.citation.fine.toLocaleString("en-NG")}` : "";
    const text = {
      cleared: "Officer: \"Your papers are in order. Safe journey.\"",
      fined: `Officer: "${result.reason ? result.reason[0]!.toUpperCase() + result.reason.slice(1) : "Your papers aren't in order"}." Fined ${fine} for driving without valid papers. Pay it, or contest it in court, in Phone → Justice.`,
      fled_escaped: "You drove off and lost the police. They didn't get your plate this time.",
      fled_caught: `The police got your plate. You're charged with evading a checkpoint: ${fine}. Pay it, or contest it in court, in Phone → Justice.`,
    }[result.outcome];
    const tone = result.outcome === "cleared" ? "success" : result.outcome === "fled_escaped" ? "info" : "error";
    client.send("checkpointEnd", { checkpointId: stop.checkpointId, outcome: result.outcome, text });
    this.notify(client, { tone, text });
  }

  private onFoot(player: Player) {
    return player.connected && player.location === "street" && !player.busId && !player.vehicleId && !player.entering;
  }

  private async handleHoldUp(client: Client, payload: unknown) {
    const robber = this.players.get(client.sessionId);
    const parsed = holdUpSchema.safeParse(payload);
    if (!robber || !parsed.success || this.limited(robber.actionRate, 2)) return;
    const victim = this.players.get(parsed.data.sessionId);
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (!victim || victim === robber) return fail("There's nobody there to rob.");
    if (!this.onFoot(robber) || !this.onFoot(victim)) return fail("You both need to be on foot in the street.");
    if (Math.hypot(robber.x - victim.x, robber.z - victim.z) > ROBBERY.range) return fail(`Get closer to ${victim.name}.`);
    if (robber.robbing || robber.heldUp || victim.heldUp || victim.robbing) return fail("Not now.");
    robber.robbing = true;
    try {
      const robbery = await startRobbery(robber.userId, victim.userId, robber.x, robber.z);
      if (robbery.repelledBy > 0) {
        robber.robbing = false;
        const chase = { robberyId: robbery.id, victimSessionId: victim.sessionId, robberSessionId: robber.sessionId, until: Date.now() + ROBBERY.chaseMs };
        const watchers = new Set([...this.chatRecipients(victim), robber]);
        for (const watcher of watchers) this.clientFor(watcher)?.send("guardsChase", chase);
        const guards = robbery.repelledBy === 1 ? "guard" : `${robbery.repelledBy} guards`;
        this.notify(client, { tone: "error", text: `You pull a gun on ${victim.name} and their ${guards} come running at you. You back off empty-handed. Lie low for a while.` });
        const victimClient = this.clientFor(victim);
        if (victimClient) this.notify(victimClient, { tone: "success", text: `${robber.name} pulled a gun on you. Your ${guards} chased them off. Nothing was taken.` });
        return;
      }
      if (policeWitness(robber.x, robber.z)) {
        await resolveRobbery(robbery.id, "caught", this.policeWhere(robber));
        robber.robbing = false;
        this.notify(client, {
          tone: "error",
          text: `Officers nearby saw you pull a gun on ${victim.name}. You're charged with armed robbery: ₦50,000. Pay it, or contest it in court, in Phone → Justice.`,
        });
        const victimClient = this.clientFor(victim);
        if (victimClient) this.notify(victimClient, { tone: "info", text: `${robber.name} tried to rob you, but police officers nearby stopped them.` });
        return;
      }
      const expiresAt = Date.now() + ROBBERY.responseMs;
      victim.heldUp = { robberyId: robbery.id, robberSessionId: robber.sessionId, robberName: robber.name, expiresAt };
      robber.motion = "idle";
      const holdUp: HoldUp = { robberyId: robbery.id, robberName: robber.name, amount: robbery.amount, expiresAt };
      this.clientFor(victim)?.send("holdUp", holdUp);
      this.notify(client, { tone: "info", text: `You pull a gun on ${victim.name} and demand ₦${robbery.amount.toLocaleString("en-NG")}…` });
    } catch (error) {
      robber.robbing = false;
      fail(error instanceof Error ? error.message : "That didn't work.");
    }
  }

  private handleRobberyAnswer(client: Client, payload: unknown) {
    const victim = this.players.get(client.sessionId);
    const parsed = robberyAnswerSchema.safeParse(payload);
    if (!victim || !parsed.success || victim.heldUp?.robberyId !== parsed.data.robberyId) return;
    void this.finishHoldUp(victim, parsed.data.answer);
  }

  private async finishHoldUp(victim: Player, answer: "comply" | "run" | "timeout") {
    const holdUp = victim.heldUp;
    if (!holdUp) return;
    victim.heldUp = null;
    const robber = this.players.get(holdUp.robberSessionId);
    if (robber) robber.robbing = false;
    const outcome = answer === "run" && Math.random() < ROBBERY.runEscapeChance ? "escaped" : "robbed";
    const result = await resolveRobbery(holdUp.robberyId, outcome, this.policeWhere(victim)).catch(() => null);
    if (!result) return;
    const money = `₦${result.amount.toLocaleString("en-NG")}`;
    const victimClient = this.clientFor(victim);
    const robberClient = robber ? this.clientFor(robber) : undefined;
    const victimText =
      outcome === "escaped"
        ? `You ran and got away from ${holdUp.robberName}. You can still report them at a police station.`
        : `${holdUp.robberName} took ${money}${answer === "run" ? " — you tried to run but they caught you" : ""}. Report it at a police station within a day to get it back.`;
    victimClient?.send("holdUpEnd", { robberyId: holdUp.robberyId, outcome, text: victimText });
    if (victimClient) this.notify(victimClient, { tone: outcome === "escaped" ? "info" : "error", text: victimText });
    if (robberClient) {
      this.notify(robberClient, {
        tone: outcome === "escaped" ? "info" : "success",
        text: outcome === "escaped" ? `${victim.name} ran off.` : `${victim.name} handed over ${money}. If they report you to the police, you'll have to give it back and pay a fine.`,
      });
    }
  }


  /* ---------- Agberos: optional roadside touts at a few Lagos danfo stops ---------- */

  private ownedCar(player: Player) {
    if (!player.vehicleId || player.vehicleSeat !== 0) return null;
    const vehicle = this.vehicles.get(player.vehicleId);
    if (!vehicle || vehicle.ownerUserId !== player.userId || vehicle.testDrive || vehicle.npc || vehicle.tow || vehicle.rental || vehicle.hire) return null;
    return vehicleModelById.get(vehicle.modelId)?.category === "bicycle" ? null : vehicle;
  }

  private checkEncounters(now: number) {
    for (const player of this.players.values()) {
      const client = this.clientFor(player);
      if (!client || !player.connected) continue;
      const encounter = player.encounter;
      if (encounter) {
        const moved = Math.hypot(player.x - encounter.point[0], player.z - encounter.point[1]);
        if (this.measuredSpeed(player) > AGBERO.driveOffSpeed || moved > 30) void this.settleAgbero(player, "drive");
        else if (encounter.expiresAt < now) void this.settleAgbero(player, "ignore");
        continue;
      }
      if (now - player.lastEncounterAt < AGBERO.playerCooldownMs || player.location !== "street") continue;
      if (player.checkpoint || player.heldUp || player.robbing || player.ride) continue;
      const car = this.ownedCar(player);
      if (!car || this.measuredSpeed(player) > AGBERO.maxSpeed) continue;
      const spot = AGBERO_SPOTS.find((entry) => Math.hypot(entry.point[0] - player.x, entry.point[1] - player.z) < AGBERO.triggerMetres);
      if (!spot || now - (this.spotUsedAt.get(spot.id) ?? -Infinity) < AGBERO.spotCooldownMs) continue;
      if (player.encounterCheck && now - player.encounterCheck.at < 60_000 && !player.encounterCheck.ok) continue;
      player.lastEncounterAt = now;
      this.spotUsedAt.set(spot.id, now);
      void this.beginAgbero(player, spot, car.id);
    }
  }

  private async beginAgbero(player: Player, spot: (typeof AGBERO_SPOTS)[number], vehicleId: string) {
    const ok = await encounterEligible(player.userId).catch(() => false);
    player.encounterCheck = { at: Date.now(), ok };
    if (!ok) {
      player.lastEncounterAt = 0;
      return;
    }
    const ask = Math.round((AGBERO.askMin + randomInt(AGBERO.askMax - AGBERO.askMin + 1)) / 50) * 50;
    const id = randomUUID();
    const started = await startEncounter(id, player.userId, spot.id, vehicleId, ask, player.x, player.z).then(() => true).catch(() => false);
    const client = this.clientFor(player);
    if (!started || !client || player.encounter) return;
    player.encounter = {
      id,
      spotId: spot.id,
      vehicleId,
      spotName: spot.name,
      ask,
      negotiated: false,
      hasGuards: player.guards > 0 && player.guardsUntil > Date.now(),
      expiresAt: Date.now() + AGBERO.answerMs,
      point: [player.x, player.z],
    };
    client.send("agbero", this.agberoView(player));
  }

  private agberoView(player: Player): AgberoEncounter | null {
    const encounter = player.encounter;
    if (!encounter) return null;
    const { spotId: _spot, vehicleId: _vehicle, ...view } = encounter;
    return view;
  }

  private async handleAgberoAnswer(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = agberoAnswerSchema.safeParse(payload);
    if (!player || !parsed.success || player.encounter?.id !== parsed.data.encounterId || this.limited(player.actionRate, 4)) return;
    const choice = parsed.data.choice;
    if (choice === "negotiate") {
      const encounter = player.encounter;
      if (encounter.negotiated) return;
      encounter.negotiated = true;
      const agrees = randomInt(100) < 60;
      encounter.ask = agrees ? Math.max(AGBERO.floor, Math.round(encounter.ask / 2 / 50) * 50) : encounter.ask;
      encounter.expiresAt = Date.now() + AGBERO.answerMs;
      this.notify(client, { tone: "info", text: agrees ? `"Okay oga, bring ₦${encounter.ask} make we dey go."` : `"Ah no, na ₦${encounter.ask} we dey collect for here."` });
      client.send("agbero", this.agberoView(player));
      return;
    }
    if (choice === "guards" && !player.encounter.hasGuards) return this.notify(client, { tone: "error", text: "You don't have guards with you. Hire them at Eko Shield Security." });
    await this.settleAgbero(player, choice === "pay" ? "pay" : choice === "drive" ? "drive" : choice);
  }

  /** Ends the encounter exactly once: the prompt is cleared before any await, and the database row must still be pending. */
  private async settleAgbero(player: Player, how: "pay" | "drive" | "police" | "guards" | "ignore") {
    const encounter = player.encounter;
    if (!encounter) return;
    player.encounter = null;
    const client = this.clientFor(player);
    client?.send("agbero", null);
    const say = (tone: "info" | "success" | "error", text: string) => client && this.notify(client, { tone, text });
    try {
      if (how === "pay") {
        const result = await payEncounter(player.userId, encounter.id, encounter.ask);
        if (result.paid) say("info", `You gave him ₦${encounter.ask}. "Correct guy! Move on." It's on your record at any police station.`);
        return;
      }
      if (how === "drive") {
        const dent = randomInt(1_000) < AGBERO.dentChance * 1_000;
        const done = await resolveEncounter(player.userId, encounter.id, "drove_off", { dent, vehicleId: encounter.vehicleId });
        if (done) {
          say("info", dent
            ? "He slapped the boot as you pulled away — a small cosmetic dent. It doesn't affect driving; any mechanic can panel-beat it and insurance pays most of it."
            : "You drove off. He shouted something about 'next time' and went back to the kerb. Nobody follows you.");
        }
        return;
      }
      if (how === "police") {
        const cctv = policeWitness(encounter.point[0], encounter.point[1]);
        const done = await resolveEncounter(player.userId, encounter.id, "police", { cctv });
        if (done) say("success", cctv
          ? "You called it in. A police camera covers this junction, so the tout was identified and warned off. The report is on your record at any police station."
          : "You called it in and he backed off before anyone arrived. There's no police camera here, but your report is on record at any police station.");
        return;
      }
      if (how === "guards") {
        const done = await resolveEncounter(player.userId, encounter.id, "guards");
        if (done) say("success", "Your guards stepped out and had a quiet word. He waved you on, no money changed hands.");
        return;
      }
      await resolveEncounter(player.userId, encounter.id, "ignored");
      say("info", "He lost interest and went back to the bus stop.");
    } catch (error) {
      if (error instanceof EconomyError) say("error", `${error.message}. He waves you on anyway.`);
      else console.error("Agbero encounter failed", error);
      await resolveEncounter(player.userId, encounter.id, "ignored").catch(() => undefined);
    }
  }

  /* ---------- Go now: fast travel, travelling together, joining a friend, and what's on ---------- */

  /** Street position, or the door of the building the player is in. */
  private standingAt(player: Player): [number, number] {
    return player.location === "street" ? [player.x, player.z] : player.returnPoint;
  }

  private fastTravelBlock(player: Player) {
    if (player.busId) return "Get off the danfo first.";
    if (player.vehicleId) return "Park and step out first. Your car stays parked where you leave it, and you can find it from Phone → Vehicles.";
    if (player.ride && ["approaching", "waiting", "riding"].includes(player.ride.status)) return "You have a ride booked. Cancel it or finish the trip first.";
    if (player.heldUp || player.robbing || player.checkpoint) return "Not right now — deal with what's in front of you first.";
    if (player.location !== "street" && !/^(home|starter|preview|club):/.test(player.location)) {
      return "Go now works from the street, a home or a club. Finish this part of your trip first.";
    }
    return null;
  }

  /** The place's entrance on the public side; open-air spots use their kerb. */
  private arrivalPoint(place: Place): [number, number] {
    if (place.buildingId !== null && walkable(place.door[0], place.door[1])) return [place.door[0], place.door[1]];
    return [place.kerb[0], place.kerb[1]];
  }

  /** A free spot beside `point` so a group does not stand inside each other. */
  private besides(point: [number, number], index: number): [number, number] {
    if (index === 0) return point;
    const angle = index * 2.1;
    const spot: [number, number] = [point[0] + Math.cos(angle) * 1.4, point[1] + Math.sin(angle) * 1.4];
    return walkable(spot[0], spot[1]) ? spot : point;
  }

  private resolveTravelTarget(player: Player, target: { placeId: string } | { favourite: Favourite }): { point: [number, number]; placeId: string; label: string } | string {
    const at = (place: Place, label = place.name) => ({ point: this.arrivalPoint(place), placeId: place.id, label });
    const region = regionOf(...this.standingAt(player));
    if ("favourite" in target) {
      const favourite = target.favourite;
      if (favourite === "home" || favourite === "garage") {
        const homeId = player.homePropertyId;
        if (favourite === "garage" && !homeId) return "You need a home of your own for a garage. Set one from Phone → My Home.";
        const mapped = homeId ? propertyPlace(homeId) : getPlace("starter-home");
        const built = homeId && !mapped ? builtHomePlace(homeId) : null;
        const door = mapped ? this.arrivalPoint(mapped) : built ? ([built.door[0], built.door[1]] as [number, number]) : null;
        const name = mapped?.name ?? built?.name;
        if (!door || !name) return "Your home is not on the map.";
        if (regionOf(door[0], door[1]) !== region) return "Your home is in Lagos. Fly back from Dubai International first.";
        return { point: door, placeId: homeId ?? "starter-home", label: favourite === "garage" ? `your garage at ${name}` : name };
      }
      if (favourite === "airport") {
        const place = placeById.get(region === "dubai" ? TRAVEL_PLACES.dubaiAirport : TRAVEL_PLACES.lagosAirport);
        return place ? at(place) : "The airport is not on the map.";
      }
      const [x, z] = this.standingAt(player);
      const clubs = PLACES.filter((place) => place.kind === "club" && regionOf(place.door[0], place.door[1]) === region);
      const nearest = clubs.sort((a, b) => Math.hypot(a.door[0] - x, a.door[1] - z) - Math.hypot(b.door[0] - x, b.door[1] - z))[0];
      return nearest ? at(nearest) : "There is no club in this city yet.";
    }
    const place = placeById.get(target.placeId);
    if (!place || !isFastTravelKind(place.kind)) return "You can only Go now to public places.";
    if (!player.discovered.has(place.id)) return `Visit ${place.name} once first; after that you can Go now there.`;
    if (regionOf(place.door[0], place.door[1]) !== region) return region === "dubai" ? `${place.name} is in Lagos. Fly home from Dubai International first.` : `${place.name} is in Dubai. Fly there from the Lagos Air Terminal.`;
    return at(place);
  }

  /** Moves a player who agreed to go: out of any interior, to a public point. Never into a building. */
  private moveByTravel(player: Player, point: [number, number], text: string) {
    const client = this.clientFor(player);
    player.location = "street";
    player.previewOnly = false;
    player.propertyId = null;
    [player.x, player.z] = point;
    player.returnPoint = [...point];
    player.motion = "idle";
    player.travel = [];
    player.lastAcceptedAt = Date.now();
    player.fastTravelAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    if (client) {
      this.sendSelf(client, player, "teleported");
      this.notify(client, { tone: "success", text });
    }
  }

  private handleFastTravel(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = fastTravelSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    const block = this.fastTravelBlock(player);
    if (block) return fail(block);
    const now = Date.now();
    const wait = player.fastTravelAt + FAST_TRAVEL.cooldownMs - now;
    if (wait > 0) return fail(`Go now is cooling down — ${Math.ceil(wait / 1_000)} s. Walking, danfos and rides still work.`);
    const target = this.resolveTravelTarget(player, parsed.data.target);
    if (typeof target === "string") return fail(target);
    const [ox, oz] = this.standingAt(player);
    const companions = [...new Set(parsed.data.with)]
      .map((sessionId) => this.players.get(sessionId))
      .filter((other): other is Player => {
        if (!other || other === player || !other.connected || player.hidden.has(other.userId)) return false;
        const [x, z] = this.standingAt(other);
        return Math.hypot(x - ox, z - oz) <= FAST_TRAVEL.togetherRadius;
      });
    const { point } = target;
    this.moveByTravel(player, point, `You're at ${target.label}.${companions.length ? ` Asked ${companions.map((other) => other.name).join(", ")} to come along.` : ""}`);
    companions.forEach((other, index) => {
      const request: TravelRequest = {
        id: randomUUID(),
        kind: "together",
        fromSessionId: player.sessionId,
        toSessionId: other.sessionId,
        point: this.besides(point, index + 1),
        label: target.label,
        region: regionOf(point[0], point[1]),
        expiresAt: now + FAST_TRAVEL.answerMs,
      };
      this.travelRequests.set(request.id, request);
      this.sendPrompt(other, request, player.name);
    });
  }

  private sendPrompt(to: Player, request: TravelRequest, fromName: string) {
    const prompt: TravelPrompt = { requestId: request.id, kind: request.kind, fromName, label: request.label, expiresAt: request.expiresAt };
    this.clientFor(to)?.send("travelPrompt", prompt);
  }

  private handleJoinRequest(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = joinRequestSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    const host = this.players.get(parsed.data.sessionId);
    if (!host || host === player || !host.connected || player.hidden.has(host.userId)) return fail("That resident is not available.");
    const block = this.fastTravelBlock(player);
    if (block) return fail(block);
    const wait = player.fastTravelAt + FAST_TRAVEL.cooldownMs - Date.now();
    if (wait > 0) return fail(`Go now is cooling down — ${Math.ceil(wait / 1_000)} s.`);
    for (const [id, existing] of this.travelRequests) if (existing.kind === "join" && existing.fromSessionId === player.sessionId) this.travelRequests.delete(id);
    const request: TravelRequest = {
      id: randomUUID(),
      kind: "join",
      fromSessionId: player.sessionId,
      toSessionId: host.sessionId,
      point: null,
      label: "wants to join you",
      region: regionOf(...this.standingAt(player)),
      expiresAt: Date.now() + FAST_TRAVEL.answerMs,
    };
    this.travelRequests.set(request.id, request);
    this.sendPrompt(host, request, player.name);
    this.notify(client, { tone: "info", text: `Asked ${host.name} if you can join them. Nobody moves unless they agree.` });
  }

  private handleTravelAnswer(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = travelAnswerSchema.safeParse(payload);
    if (!player || !parsed.success) return;
    const request = this.travelRequests.get(parsed.data.requestId);
    if (!request || request.toSessionId !== client.sessionId) return;
    this.travelRequests.delete(request.id);
    const asker = this.players.get(request.fromSessionId);
    const askerClient = asker ? this.clientFor(asker) : undefined;
    if (request.expiresAt < Date.now()) return this.notify(client, { tone: "info", text: "That request has expired." });
    if (!parsed.data.accept) {
      if (askerClient) this.notify(askerClient, { tone: "info", text: request.kind === "join" ? `${player.name} said not now.` : `${player.name} is staying put.` });
      return;
    }
    if (request.kind === "together") {
      const block = this.fastTravelBlock(player);
      if (block) return this.notify(client, { tone: "error", text: block });
      if (regionOf(...this.standingAt(player)) !== request.region) return this.notify(client, { tone: "error", text: "That's in another city now." });
      this.moveByTravel(player, request.point!, `You came along to ${request.label}${asker ? ` with ${asker.name}` : ""}.`);
      if (askerClient) this.notify(askerClient, { tone: "success", text: `${player.name} joined you.` });
      return;
    }
    // Join: the host (this player) agreed; move the asker next to them, or to the door of the building they're in.
    if (!asker || !askerClient) return;
    const block = this.fastTravelBlock(asker);
    if (block) return this.notify(askerClient, { tone: "error", text: block });
    if (regionOf(...this.standingAt(player)) !== regionOf(...this.standingAt(asker))) {
      return this.notify(askerClient, { tone: "error", text: `${player.name} is in another city. Fly there first.` });
    }
    if (player.location === "street") {
      if (player.vehicleId || player.busId) return this.notify(askerClient, { tone: "error", text: `${player.name} is on the move. Try again when they've stopped.` });
      this.moveByTravel(asker, this.besides([player.x, player.z], 1 + randomInt(4)), `You joined ${player.name}.`);
    } else if (/^(home|starter|preview|club):/.test(player.location)) {
      const place = player.propertyId ? (CLUBS[player.propertyId] ? getPlace(player.propertyId) : propertyPlace(player.propertyId) ?? builtHomePlace(player.propertyId)) : null;
      const name = place?.name ?? "the building";
      this.moveByTravel(asker, this.besides(player.returnPoint, 1), `${player.name} is inside ${name}. You're at the door — go in if you have access (a wristband for clubs, an invite for homes).`);
    } else {
      return this.notify(askerClient, { tone: "error", text: `${player.name} is travelling right now. Try again when they're back on the street.` });
    }
    this.notify(client, { tone: "success", text: `${asker.name} is on their way to you.` });
  }

  /** Marks public places discovered as players pass them, and expires unanswered travel requests. */
  private checkDiscoveries(now: number) {
    for (const [id, request] of this.travelRequests) if (request.expiresAt < now) this.travelRequests.delete(id);
    for (const player of this.players.values()) {
      if (!player.connected || player.location !== "street") continue;
      for (const place of PLACES) {
        if (player.discovered.has(place.id) || !isFastTravelKind(place.kind) || placeDistance(place, player.x, player.z) > FAST_TRAVEL.discoverRadius) continue;
        player.discovered.add(place.id);
        void recordDiscovery(player.userId, place.id).catch(() => undefined);
        const client = this.clientFor(player);
        if (client) this.notify(client, { tone: "info", text: `Discovered ${place.name}. You can now Go now here from Phone → Go.` });
      }
    }
  }

  private whereIs(player: Player) {
    if (player.location.startsWith("flight:")) return "on a flight";
    if (player.location.startsWith("club:")) return `at ${getPlace(player.location.slice(5))?.name ?? "a club"}`;
    if (/^(home|starter|preview):/.test(player.location)) return "at home";
    if (player.location !== "street") return "travelling";
    if (player.busId) return "on a danfo";
    if (player.vehicleId) return "driving";
    return districtAt(player.x, player.z)?.name ?? "around the city";
  }

  /** Live activity in this world instance: busy clubs, boarding flights, and groups of residents at public places. */
  private happenings(now: number): Happening[] {
    const list: Happening[] = [];
    for (const clubId of Object.keys(CLUBS)) {
      const inside = [...this.players.values()].filter((player) => player.location === clubLocation(clubId)).length;
      const place = getPlace(clubId);
      if (inside > 0 && place) list.push({ id: `club:${clubId}`, kind: "club", title: `${place.name} is open`, detail: `${inside} inside · cover at the door`, people: inside, placeId: clubId });
    }
    for (const flight of this.flights.values()) {
      const aboard = [...flight.seats.keys()].filter((key) => !key.startsWith("held:")).length;
      const to = flight.leg === "outbound" ? "Dubai" : "Lagos";
      if (flight.departAt > now) {
        list.push({ id: `flight:${flight.id}`, kind: "flight", title: `Flight to ${to} boarding`, detail: `${aboard} aboard · doors close in ${Math.ceil((flight.departAt - now) / 1_000)} s · needs a ticket`, people: aboard, placeId: flight.leg === "outbound" ? TRAVEL_PLACES.lagosAirport : TRAVEL_PLACES.dubaiAirport });
      } else if (flight.arriveAt > now) {
        list.push({ id: `flight:${flight.id}`, kind: "flight", title: `${aboard} in the air to ${to}`, detail: `Lands in ${Math.ceil((flight.arriveAt - now) / 1_000)} s`, people: aboard, placeId: null });
      }
    }
    const groups = new Map<string, { place: Place; people: number; riders: number }>();
    for (const player of this.players.values()) {
      if (!player.connected || player.location !== "street" || player.busId) continue;
      const vehicle = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
      if (vehicle && !vehicle.rental) continue;
      let best: Place | null = null;
      let bestDistance = 60;
      for (const place of PLACES) {
        if (!isFastTravelKind(place.kind)) continue;
        const distance = placeDistance(place, player.x, player.z);
        if (distance < bestDistance) [best, bestDistance] = [place, distance];
      }
      if (!best) continue;
      const group = groups.get(best.id) ?? { place: best, people: 0, riders: 0 };
      group.people += 1;
      if (vehicle?.rental) group.riders += 1;
      groups.set(best.id, group);
    }
    for (const { place, people, riders } of groups.values()) {
      if (people < 2) continue;
      const kind = riders >= 2 ? "ride" : place.kind === "beach" ? "beach" : "gathering";
      const title = kind === "ride" ? `Bike ride near ${place.name}` : kind === "beach" ? `Beach hangout at ${place.name}` : `Residents hanging out at ${place.name}`;
      list.push({ id: `group:${place.id}`, kind, title, detail: `${people} here now`, people, placeId: place.id });
    }
    return list.sort((a, b) => b.people - a.people).slice(0, 12);
  }

  private goState(player: Player): FastTravelState {
    const [ox, oz] = this.standingAt(player);
    const others = [...this.players.values()].filter((other) => other !== player && other.connected && !player.hidden.has(other.userId));
    return {
      discovered: [...player.discovered],
      favourites: FAVOURITES.map((id) => {
        const target = this.resolveTravelTarget(player, { favourite: id });
        return typeof target === "string"
          ? { id, label: FAVOURITE_LABEL[id], placeId: null, point: null, note: target }
          : { id, label: FAVOURITE_LABEL[id], placeId: target.placeId, point: target.point, note: null };
      }),
      cooldownUntil: player.fastTravelAt + FAST_TRAVEL.cooldownMs,
      nearby: others
        .map((other) => {
          const [x, z] = this.standingAt(other);
          return { sessionId: other.sessionId, name: other.name, distance: Math.round(Math.hypot(x - ox, z - oz)) };
        })
        .filter((entry) => entry.distance <= FAST_TRAVEL.togetherRadius),
      online: others.slice(0, 40).map((other) => ({ sessionId: other.sessionId, name: other.name, where: this.whereIs(other) })),
      happenings: this.happenings(Date.now()),
    };
  }

  /* ---------- Travel: consulate, airports, flights, Dubai ---------- */

  private sendTrip(player: Player) {
    const client = this.clientFor(player);
    if (client) client.send("trip", player.trip);
  }

  private playerByUser(userId: string) {
    for (const player of this.players.values()) if (player.userId === userId) return player;
    return null;
  }

  /** Puts a player into a travel interior (or seat) and tells them, trip state first so the right room is built. */
  private moveInside(client: Client | undefined, player: Player, location: string, spawn: [number, number], returnPoint: [number, number], propertyId: string | null, previewOnly = false) {
    player.returnPoint = [...returnPoint];
    player.location = location;
    player.previewOnly = previewOnly;
    player.propertyId = propertyId;
    [player.x, player.z] = spawn;
    player.yaw = 0;
    player.motion = location.startsWith("flight:") || location.startsWith("excursion:") ? "sit" : "idle";
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, location);
    void this.persist(player).catch(() => undefined);
    this.sendTrip(player);
    if (client) this.sendSelf(client, player, previewOnly ? "preview" : "entered");
  }

  private travelExitBlock(player: Player) {
    if (player.location.startsWith("flight:")) return "You're in the air. Sit back — you'll land in a moment, or press Skip flight.";
    if (player.location.startsWith("excursion:")) return "The trip finishes in a few seconds.";
    if (player.location === "airport:dxb" && player.trip.stage === "arrived" && !player.trip.immigrationDone) {
      return "Pass immigration first: the desks are in the middle of the arrivals hall.";
    }
    return null;
  }

  private async handleTravelEnter(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = travelEnterSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.busId) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (player.vehicleId) return fail("Park and step out first.");
    const near = (placeId: string, range = 6) => {
      const place = placeById.get(placeId);
      return place && placeDistance(place, player.x, player.z) <= range ? place : null;
    };
    const { target } = parsed.data;
    if (target === "consulate") {
      const place = near(TRAVEL_PLACES.consulate);
      if (!place) return fail(`Walk up to the door of the ${CONSULATE_NAME}.`);
      player.trip = emptyTrip();
      return this.moveInside(client, player, "consulate", travelSpawn("consulate"), place.door, place.id);
    }
    if (target === "rooftop") {
      const place = near(TRAVEL_PLACES.rooftop, 8);
      if (!place) return fail("Walk up to the Skyline rooftop lift lobby.");
      player.trip = emptyTrip();
      return this.moveInside(client, player, "rooftop", travelSpawn("rooftop"), place.door, place.id);
    }
    if (target === "airport") {
      const lagos = near(TRAVEL_PLACES.lagosAirport, 8);
      const dubai = lagos ? null : near(TRAVEL_PLACES.dubaiAirport, 8);
      const place = lagos ?? dubai;
      if (!place) return fail("Walk up to the terminal entrance.");
      const record = await tripRecord(player.userId).catch(() => null);
      if (player.location !== "street" || player.vehicleId) return;
      const kind = lagos ? "airport-los" : "airport-dxb";
      const exit = travelSpot(kind, "exit")!;
      player.trip = { ...emptyTrip(), stage: "airport", ticketId: record?.ticketId ?? null, leg: lagos ? "outbound" : "return", immigrationDone: record?.immigrationDone ?? false };
      return this.moveInside(client, player, lagos ? "airport:los" : "airport:dxb", [exit[0], exit[1] + 1.2], place.door, place.id);
    }
    const hotelId = parsed.data.hotelId ?? "";
    const hotel = hotelById.get(hotelId);
    const place = hotel ? near(hotelId, 8) : null;
    if (!hotel || !place) return fail("Walk up to the hotel entrance.");
    if (parsed.data.previewRoom) {
      if (!hotelRoom(hotelId, parsed.data.previewRoom)) return fail("That room type isn't offered here.");
      player.trip = { ...emptyTrip(), room: { hotelId, roomType: parsed.data.previewRoom, bookingId: null } };
      return this.moveInside(client, player, `hotel:preview:${hotelId}:${player.userId}`, travelSpawn("hotel"), place.door, hotelId, true);
    }
    const bookingId = parsed.data.bookingId ?? "";
    const access = bookingId ? await hotelAccess(player.userId, bookingId).catch(() => null) : null;
    if (!access || access.hotelId !== hotelId) return fail("You need a booking here, or an invitation from a guest, to go up to a room.");
    if (!access.checkedIn) return fail(access.owner ? "Check in at reception first to get your digital key." : "Your host hasn't checked in yet.");
    if (player.location !== "street" || player.vehicleId) return;
    player.trip = { ...emptyTrip(), room: { hotelId, roomType: access.roomType, bookingId } };
    if (target === "pool") return this.moveInside(client, player, `pool:${hotelId}`, travelSpawn("pool"), place.door, hotelId);
    this.moveInside(client, player, `hotel:${bookingId}`, travelSpawn("hotel"), place.door, hotelId);
  }

  private async handleTravelCounter(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = travelCounterSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4) || player.entering) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    const kind = travelInteriorOf(player.location);
    const at = (spot: string) => {
      const point = kind ? travelSpot(kind, spot) : null;
      return Boolean(point && Math.hypot(player.x - point[0], player.z - point[1]) <= TRAVEL.counterRange + 0.4);
    };
    const action = parsed.data.action;
    if (action === "skip") {
      const flight = player.location.startsWith("flight:") ? this.flights.get(player.location.slice(7)) : undefined;
      if (flight) await this.landPlayer(player, flight, true);
      return;
    }
    if (kind !== "airport-los" && kind !== "airport-dxb") return;
    const leg: Leg = kind === "airport-los" ? "outbound" : "return";
    if (kind === "airport-dxb" && player.trip.stage === "arrived" && !player.trip.immigrationDone && action !== "immigration") {
      return fail("Pass immigration first: the desks are straight ahead of the arrivals gate.");
    }
    player.entering = true;
    try {
      if (action === "checkin") {
        if (!at("checkin")) return fail("Walk up to the check-in counter.");
        const result = await advanceLeg(player.userId, leg, "checked_in");
        player.trip.ticketId = result.ticketId;
        player.trip.leg = leg;
        this.notify(client, { tone: "success", text: `Checked in for ${legRoute(leg).code} ${legRoute(leg).label} · ${CABINS[result.cabin].name} · ${seatLabel(result.seat)}. Bag tagged. Head to the gate.` });
        this.sendTrip(player);
      } else if (action === "lounge") {
        if (!at("lounge")) return fail("Walk into the lounge.");
        const record = await tripRecord(player.userId);
        if (record?.cabin !== "business") return fail("The lounge is for Business tickets. Economy passengers can relax at the gate.");
        this.notify(client, { tone: "success", text: "Welcome to the Business lounge. Help yourself to coffee, pastries and fresh juice while you wait." });
      } else if (action === "board") {
        if (!at("gate")) return fail("Walk up to the gate desk.");
        await this.boardFlight(client, player, leg);
      } else if (action === "immigration") {
        if (kind !== "airport-dxb" || !at("immigration")) return fail("Walk up to an immigration desk.");
        if (player.trip.stage !== "arrived") return fail("Immigration is for arriving passengers.");
        const result = await clearImmigration(player.userId);
        player.trip.immigrationDone = true;
        const left = result.visitsLeft === null ? "" : ` · ${result.visitsLeft} visa visit${result.visitsLeft === 1 ? "" : "s"} left`;
        this.notify(client, { tone: "success", text: `Welcome to Dubai! Passport stamped (game roleplay)${left}. Collect your bag at the belt, then head out to the pickup area.` });
        this.sendTrip(player);
      } else if (action === "baggage") {
        if (kind !== "airport-dxb" || !at("baggage")) return fail("Walk up to the baggage belt.");
        if (!player.trip.immigrationDone) return fail("Clear immigration before baggage reclaim.");
        player.trip.bagCollected = true;
        this.notify(client, { tone: "success", text: "Got your bag. Taxis, hire cars and hotel shuttles are outside the pickup doors." });
        this.sendTrip(player);
      }
    } catch (error) {
      fail(error instanceof EconomyError ? error.message : "The desk couldn't help right now. Try again.");
    } finally {
      player.entering = false;
    }
  }

  private async boardFlight(client: Client, player: Player, leg: Leg) {
    const record = await tripRecord(player.userId);
    if (!record) throw new EconomyError("You don't have a ticket. Buy one at the ticket desk or in Phone → Travel.", 409);
    if (!player.location.startsWith("airport:")) return;
    const party = record.partyId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = Date.now();
      // Boarding is open until a second before doors close; later passengers join the next departure.
      const open = (entry: Flight) => entry.leg === leg && entry.departAt > now + 1_000 && this.freeSeats(entry, record.cabin).length > 0;
      let flight =
        [...this.flights.values()].find((entry) => open(entry) && [...entry.seats.values()].some((seat) => seat.partyId === party)) ??
        [...this.flights.values()].find(open);
      if (!flight) {
        const departAt = now + TRAVEL.boardingSeconds * 1_000;
        flight = { id: randomUUID(), leg, departAt, arriveAt: departAt + TRAVEL.flightSeconds * 1_000, seats: new Map() };
        this.flights.set(flight.id, flight);
      }
      // Reserved before any await, so two passengers boarding at once can never pick the same seat.
      const seat = this.pickSeat(flight, record.cabin, record.seat, party);
      flight.seats.set(player.userId, { seat, cabin: record.cabin, partyId: party, name: player.name });
      try {
        await advanceLeg(player.userId, leg, "boarded", { id: flight.id, seat, departAt: flight.departAt, arriveAt: flight.arriveAt });
      } catch (error) {
        flight.seats.delete(player.userId);
        if (error instanceof SeatTakenError) {
          flight.seats.set(`held:${seat}`, { seat, cabin: record.cabin, partyId: null, name: "" });
          continue;
        }
        throw error;
      }
      if (!player.location.startsWith("airport:")) return;
      await this.endHire(player);
      this.seatInFlight(client, player, flight, record.ticketId);
      const route = legRoute(leg);
      const full = this.freeSeats(flight, "business").length + this.freeSeats(flight, "economy").length === 0;
      if (full && flight.departAt > Date.now() + 1_500) {
        flight.departAt = Date.now() + 1_500;
        flight.arriveAt = flight.departAt + TRAVEL.flightSeconds * 1_000;
        void retimeFlight(flight.id, flight.departAt, flight.arriveAt).catch(() => undefined);
      }
      const waiting = Math.max(1, Math.round((flight.departAt - Date.now()) / 1000));
      this.notify(client, {
        tone: "success",
        text: `Welcome aboard ${route.code} to ${leg === "outbound" ? "Dubai" : "Lagos"}. ${seatLabel(seat)}, ${CABINS[record.cabin].name}. ${full ? "The flight is full — departing now." : `Doors close in ${waiting} s for anyone else boarding.`}`,
      });
      this.refreshFlightCompanions(flight);
      return;
    }
    throw new EconomyError("Seats are being taken fast — try boarding again.", 409);
  }

  private freeSeats(flight: Flight, cabin: CabinClass) {
    const taken = new Set([...flight.seats.values()].map((entry) => entry.seat));
    return cabinSeats(cabin).filter((seat) => !taken.has(seat));
  }

  /** The ticket's own seat when free; otherwise the free seat closest to someone from the same booking party. */
  private pickSeat(flight: Flight, cabin: CabinClass, preferred: string, party: string) {
    const free = this.freeSeats(flight, cabin);
    const friends = [...flight.seats.values()].filter((entry) => entry.partyId === party && entry.cabin === cabin).map((entry) => seatPoint(entry.seat));
    if (friends.length) {
      const gap = (seat: string) => {
        const [x, z] = seatPoint(seat);
        return Math.min(...friends.map(([fx, fz]) => Math.hypot(fx - x, fz - z)));
      };
      return free.reduce((best, seat) => (gap(seat) < gap(best) ? seat : best), free[0]!);
    }
    return free.includes(preferred) ? preferred : free[0]!;
  }

  private seatInFlight(client: Client | undefined, player: Player, flight: Flight, ticketId: string) {
    const entry = flight.seats.get(player.userId)!;
    const destination = placeById.get(flight.leg === "outbound" ? TRAVEL_PLACES.dubaiAirport : TRAVEL_PLACES.lagosAirport);
    const route = legRoute(flight.leg);
    player.trip = {
      ...emptyTrip(),
      stage: "boarded",
      ticketId,
      leg: flight.leg,
      immigrationDone: player.trip.immigrationDone,
      flight: { id: flight.id, code: route.code, label: route.label, cabin: entry.cabin, seat: entry.seat, departAt: flight.departAt, arriveAt: flight.arriveAt, companions: [], passengers: flight.seats.size, capacity: FLIGHT_CAPACITY },
    };
    this.moveInside(client, player, `flight:${flight.id}`, seatPoint(entry.seat), destination?.door ?? getPlace("starter-home").door, null);
  }

  private refreshFlightCompanions(flight: Flight) {
    for (const [userId, entry] of flight.seats) {
      const player = this.playerByUser(userId);
      if (!player?.trip.flight || player.trip.flight.id !== flight.id) continue;
      player.trip.flight.companions = [...flight.seats.entries()].filter(([other, mate]) => other !== userId && mate.partyId === entry.partyId).map(([, mate]) => mate.name);
      player.trip.flight.passengers = flight.seats.size;
      player.trip.flight.departAt = flight.departAt;
      player.trip.flight.arriveAt = flight.arriveAt;
      this.sendTrip(player);
    }
  }

  /** Lands one passenger: at the flight's arrival time for everyone, or early when they skip. */
  private async landPlayer(player: Player, flight: Flight, skipped = false) {
    if (skipped) {
      flight.seats.delete(player.userId);
      await advanceLeg(player.userId, flight.leg, "flown").catch(() => undefined);
    }
    if (player.location !== `flight:${flight.id}`) return;
    const outbound = flight.leg === "outbound";
    const kind = outbound ? "airport-dxb" : "airport-los";
    const place = placeById.get(outbound ? TRAVEL_PLACES.dubaiAirport : TRAVEL_PLACES.lagosAirport);
    const spawn = outbound ? travelSpawn(kind) : travelSpot(kind, "gate")!;
    const ticketId = player.trip.ticketId;
    player.trip = { ...emptyTrip(), stage: outbound ? "arrived" : "airport", ticketId: outbound ? ticketId : null, leg: flight.leg, immigrationDone: !outbound };
    const client = this.clientFor(player);
    this.moveInside(client, player, outbound ? "airport:dxb" : "airport:los", outbound ? spawn : [spawn[0], spawn[1] - 1.5], place?.door ?? getPlace("starter-home").door, place?.id ?? null);
    if (client) {
      this.notify(client, outbound
        ? { tone: "success", text: "Welcome to Dubai! Follow the signs: immigration, baggage, then the pickup area outside.", announcement: "Ladies and gentlemen, welcome to Dubai." }
        : { tone: "success", text: "Welcome home to Lagos! Your home, cars and belongings are just as you left them.", announcement: "Welcome to Lagos." });
    }
    if (skipped) this.refreshFlightCompanions(flight);
  }

  private checkFlights(now: number) {
    for (const [id, flight] of this.flights) {
      if (now < flight.arriveAt) continue;
      this.flights.delete(id);
      for (const userId of flight.seats.keys()) {
        if (userId.startsWith("held:")) continue;
        const player = this.playerByUser(userId);
        void advanceLeg(userId, flight.leg, "flown")
          .catch(() => undefined)
          .then(() => (player ? this.landPlayer(player, flight) : undefined));
      }
    }
  }

  /** On join: back into the same flight if it is still in the air, or into the arrivals hall if it landed meanwhile. */
  private async resumeTravel(player: Player) {
    const record = await tripRecord(player.userId).catch(() => null);
    if (!record) return;
    const now = Date.now();
    const flown = record.flight && (record.flight.leg === "outbound" ? record.outbound : record.return) === "boarded" ? record.flight : null;
    if (flown && flown.arriveAt > now) {
      let flight = this.flights.get(flown.id);
      if (!flight) {
        flight = { id: flown.id, leg: flown.leg, departAt: flown.departAt, arriveAt: flown.arriveAt, seats: new Map() };
        this.flights.set(flight.id, flight);
      }
      flight.seats.set(player.userId, { seat: flown.seat, cabin: record.cabin, partyId: record.partyId, name: player.name });
      this.seatInFlight(undefined, player, flight, record.ticketId);
      return "Reconnected — you're still on your flight.";
    }
    if (flown) await advanceLeg(player.userId, flown.leg, "flown").catch(() => undefined);
    const landedIn = flown?.leg ?? (record.outbound === "flown" && !record.immigrationDone ? "outbound" : null);
    if (landedIn === "outbound" && !record.immigrationDone) {
      const place = placeById.get(TRAVEL_PLACES.dubaiAirport);
      player.trip = { ...emptyTrip(), stage: "arrived", ticketId: record.ticketId, leg: "outbound" };
      this.moveInside(undefined, player, "airport:dxb", travelSpawn("airport-dxb"), place?.door ?? player.returnPoint, place?.id ?? null);
      return "Your flight landed while you were away. Welcome to Dubai — immigration is ahead.";
    }
    if (landedIn === "return") {
      const place = placeById.get(TRAVEL_PLACES.lagosAirport);
      player.trip = { ...emptyTrip(), stage: "airport", leg: "return", immigrationDone: true };
      this.moveInside(undefined, player, "airport:los", travelSpot("airport-los", "gate")!, place?.door ?? player.returnPoint, place?.id ?? null);
      return "Your flight landed while you were away. Welcome home to Lagos.";
    }
    return;
  }

  private async handleActivityStart(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = activityBookSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4) || player.entering) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (player.location !== "street" || player.busId || player.vehicleId) return fail("Step out onto the street first.");
    const { activity } = parsed.data;
    const details = ACTIVITIES[activity];
    const desks = activity === "desert-safari" ? [TRAVEL_PLACES.tourism, TRAVEL_PLACES.pier, TRAVEL_PLACES.desertCamp] : [TRAVEL_PLACES.tourism, TRAVEL_PLACES.pier];
    const desk = desks.map((id) => placeById.get(id)).find((place) => place && placeDistance(place, player.x, player.z) <= 18);
    if (!desk) return fail(`Book the ${details.name} at the Dubai Marina Tourism Centre on The Walk, or the tours desk by the dhow pier.`);
    player.entering = true;
    try {
      await payActivity(player.userId, activity, parsed.data.idempotencyKey);
    } catch (error) {
      return fail(error instanceof EconomyError && error.message.includes("Insufficient") ? `You need ₦${details.price.toLocaleString("en-NG")} for the ${details.name}.` : error instanceof EconomyError ? error.message : "The tour desk couldn't book that right now.");
    } finally {
      player.entering = false;
    }
    if (player.location !== "street" || player.vehicleId) return;
    const now = Date.now();
    let group = [...this.excursions.values()].find((entry) => entry.activity === activity && entry.startsAt > now);
    if (!group) {
      const startsAt = now + 4_000;
      group = { id: randomUUID().slice(0, 8), activity, startsAt, endsAt: startsAt + details.seconds * 1_000, riders: 0 };
      this.excursions.set(group.id, group);
    }
    const seatIndex = group.riders++;
    const kind = activity === "dhow-cruise" ? "dhow" : "safari";
    const seat = excursionSeat(kind, seatIndex);
    const camp = placeById.get(TRAVEL_PLACES.desertCamp);
    const pier = placeById.get(TRAVEL_PLACES.pier)!;
    const back = desk.id === TRAVEL_PLACES.tourism ? desk.kerb : activity === "desert-safari" && camp && walkable(camp.kerb[0], camp.kerb[1]) ? camp.kerb : pier.kerb;
    player.trip = { ...emptyTrip(), excursion: { activity, startsAt: group.startsAt, endsAt: group.endsAt } };
    this.moveInside(client, player, `excursion:${activity}:${group.id}`, seat.point, back, desk.id);
    player.yaw = seat.yaw;
    this.notify(client, { tone: "success", text: `${details.name} booked · ₦${details.price.toLocaleString("en-NG")}. ${activity === "dhow-cruise" ? "All aboard — we cast off in a few seconds." : "Hop in — the 4×4 is heading for the dunes."}` });
  }

  private checkExcursions(now: number) {
    for (const [id, group] of this.excursions) if (now > group.endsAt + 5_000) this.excursions.delete(id);
    for (const player of this.players.values()) {
      const excursion = player.trip?.excursion;
      if (!excursion || !player.location.startsWith("excursion:") || now < excursion.endsAt) continue;
      const desert = excursion.activity === "desert-safari";
      player.trip = emptyTrip();
      player.location = "street";
      player.propertyId = null;
      player.motion = "idle";
      [player.x, player.z] = player.returnPoint;
      player.lastAcceptedAt = now;
      setPlayerPosition(player.userId, player.x, player.z, "street");
      void this.persist(player).catch(() => undefined);
      const client = this.clientFor(player);
      this.sendTrip(player);
      if (!client) continue;
      this.sendSelf(client, player, "exited");
      this.notify(client, { tone: "success", text: desert ? "Welcome to the desert camp! Take photos by the camels, then ride the 4×4 back to the Marina from the camp." : "Back at the pier. Hope you enjoyed the cruise!" });
    }
  }

  private handleTravelTransfer(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = travelTransferSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4)) return;
    if (player.location !== "street" || player.vehicleId || player.busId) return this.notify(client, { tone: "error", text: "Step out onto the street first." });
    const camp = placeById.get(TRAVEL_PLACES.desertCamp);
    const pier = placeById.get(TRAVEL_PLACES.pier);
    if (!camp || !pier || placeDistance(camp, player.x, player.z) > 40) return this.notify(client, { tone: "error", text: "The 4×4 back to the Marina leaves from the desert camp." });
    [player.x, player.z] = pier.kerb;
    player.lastAcceptedAt = Date.now();
    setPlayerPosition(player.userId, player.x, player.z, "street");
    void this.persist(player).catch(() => undefined);
    this.sendSelf(client, player, "teleported");
    this.notify(client, { tone: "success", text: "Back at the Marina." });
  }

  private async handlePhoto(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = photoSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 2)) return;
    const spot = parsed.data.spot;
    let valid = false;
    if (player.location === "street") {
      const place = placeById.get(spot);
      valid = Boolean(place && PHOTO_PLACES.has(place.id) && placeDistance(place, player.x, player.z) <= 25);
    } else {
      valid = spot === player.location.split(":")[0];
    }
    if (!valid) return this.notify(client, { tone: "error", text: "Find a photo spot first: the Marina photo point, Ain Dubai view, JBR beach, the dhow pier, the desert camp or the rooftop." });
    const companions = [...this.players.values()]
      .filter((other) => other !== player && other.location === player.location && Math.hypot(other.x - player.x, other.z - player.z) <= 10)
      .map((other) => other.name);
    await recordPhoto(player.userId, spot, companions).catch(() => undefined);
    client.send("photo", { spot, companions });
    this.notify(client, { tone: "success", text: companions.length ? `Group photo with ${companions.join(", ")} saved to Phone → Travel.` : "Photo saved to Phone → Travel." });
    for (const other of this.players.values()) {
      if (other !== player && companions.includes(other.name)) {
        const otherClient = this.clientFor(other);
        if (otherClient) this.notify(otherClient, { tone: "info", text: `${player.name} took a group photo with you.` });
      }
    }
  }

  private async handleCarRent(client: Client, payload: unknown) {
    const player = this.players.get(client.sessionId);
    const parsed = carRentSchema.safeParse(payload);
    if (!player || !parsed.success || this.limited(player.actionRate, 4) || player.entering) return;
    const fail = (text: string) => this.notify(client, { tone: "error", text });
    if (player.location !== "street" || player.busId || player.vehicleId) return fail("Step out onto the street first.");
    const desk = placeById.get(TRAVEL_PLACES.carRental);
    if (!desk || placeDistance(desk, player.x, player.z) > CAR_RENTAL.range) return fail("Hire cars are collected at the Dubai car hire desk.");
    const model = vehicleModelById.get(parsed.data.modelId);
    if (!model) return fail("That car isn't on the fleet.");
    player.entering = true;
    let hire: Awaited<ReturnType<typeof rentCar>>;
    try {
      hire = await rentCar(player.userId, model.id, parsed.data.hours, parsed.data.idempotencyKey);
    } catch (error) {
      return fail(error instanceof EconomyError ? (error.message.includes("Insufficient") ? "You don't have enough for that hire." : error.message) : "The desk couldn't hire you a car right now.");
    } finally {
      player.entering = false;
    }
    if (player.location !== "street" || player.vehicleId) return;
    const vehicle = this.placeHireCar(player, hire.id, model.id, hire.endsAt, desk);
    this.mountVehicle(client, player, vehicle, `${model.name} hired for ${rentalPeriodLabel(parsed.data.hours)}. The agent hands you the keys. Return it at any time from Phone → Travel; it is collected automatically when the hire ends.`);
  }

  private placeHireCar(player: Player, hireId: string, modelId: string, endsAt: number, desk: Place) {
    const id = `carhire-${hireId}`;
    const existing = this.vehicles.get(id);
    if (existing) return existing;
    let spot: [number, number] = desk.kerb;
    for (let index = 0; index < 12; index += 1) {
      const candidate = kerbSlot(desk.kerb, desk.kerbYaw, index);
      if ([...this.vehicles.values()].every((vehicle) => Math.hypot(vehicle.x - candidate[0], vehicle.z - candidate[1]) > 6)) {
        spot = candidate;
        break;
      }
    }
    const model = getVehicleModel(modelId);
    const vehicle: RoomVehicle = {
      id,
      ownerUserId: player.userId,
      ownerName: `Dubai car hire · ${player.name}`,
      modelId,
      colour: model.colours[0]!,
      plate: `DXB ${hireId.slice(0, 5).toUpperCase()}`,
      condition: 100,
      x: spot[0],
      z: spot[1],
      yaw: desk.kerbYaw,
      driverSessionId: null,
      lights: false,
      locked: true,
      hire: { id: hireId, endsAt },
    };
    this.vehicles.set(id, vehicle);
    return vehicle;
  }

  private removeHireCar(vehicle: RoomVehicle) {
    for (const player of this.players.values()) {
      if (player.vehicleId !== vehicle.id || (player.vehicleSeat ?? 0) > 0) continue;
      [player.x, player.z] = this.exitPoint(vehicle, 0);
      player.vehicleId = null;
      player.vehicleSeat = null;
      player.motion = "idle";
      player.lastAcceptedAt = Date.now();
      setPlayerPosition(player.userId, player.x, player.z, "street");
      const client = this.clientFor(player);
      if (client) {
        this.sendSelf(client, player, "parked");
        this.notify(client, { tone: "info", text: "Your Dubai hire car has been returned." });
      }
    }
    this.ejectPassengers(vehicle.id);
    this.vehicles.delete(vehicle.id);
  }

  private async endHire(player: Player) {
    const vehicle = [...this.vehicles.values()].find((entry) => entry.hire && entry.ownerUserId === player.userId);
    if (!vehicle) return;
    this.removeHireCar(vehicle);
    await endCarRental(player.userId).catch(() => undefined);
  }

  private async handleCarReturn(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player || this.limited(player.actionRate, 4)) return;
    await this.endHire(player);
  }

  private checkHires(now: number) {
    for (const vehicle of [...this.vehicles.values()]) if (vehicle.hire && vehicle.hire.endsAt <= now) this.removeHireCar(vehicle);
  }

  private checkPolice(now: number) {
    for (const player of this.players.values()) {
      if (player.checkpoint && now > player.checkpoint.expiresAt) void this.finishCheckpoint(player, "comply");
      if (player.heldUp && now > player.heldUp.expiresAt) void this.finishHoldUp(player, "timeout");
      if (player.guards && player.guardsUntil <= now) player.guards = 0;
    }
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
    if (player.guards && player.guardsUntil > Date.now()) wire.guards = player.guards;
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
