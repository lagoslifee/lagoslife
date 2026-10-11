import { blockedByWater, cabinSeats, seatPoint, travelSpot, TRAVEL, getPlace, getRoute, ROUTES, sampleRoute, type RideState, type TransitRoute } from "@lagos-living/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const economy = vi.hoisted(() => ({
  chargeFare: vi.fn(),
  endJourney: vi.fn(async () => undefined),
  loadPlayerPlace: vi.fn(async () => null),
  markProgress: vi.fn(async () => undefined),
  savePlayerPlace: vi.fn(async (_userId: string, _x: number, _z: number, _place: string) => undefined),
}));

vi.mock("../economy-service.js", async () => {
  class EconomyError extends Error {
    constructor(message: string, readonly status = 400) {
      super(message);
    }
  }
  return { ...economy, EconomyError };
});
vi.mock("../database.js", () => ({ pool: {} }));
vi.mock("../property-service.js", () => ({ isPropertyAvailable: vi.fn(), requirePropertyAccess: vi.fn() }));

const vehicles = vi.hoisted(() => ({
  claimVehicle: vi.fn(async (..._args: unknown[]): Promise<{ condition: number } | null> => ({ condition: 100 })),
  damageVehicle: vi.fn(async (..._args: unknown[]) => ({ condition: 80, insured: false })),
  loadStreetVehicle: vi.fn(async () => null),
  loadStreetVehicles: vi.fn(async () => []),
  parkAbandonedVehicles: vi.fn(async () => undefined),
  saveDrivingVehicle: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("../vehicle-service.js", () => vehicles);

const safety = vi.hoisted(() => ({
  activeMute: vi.fn(async () => null),
  activeSuspension: vi.fn(async () => null),
  hiddenPlayers: vi.fn(async () => new Set<string>()),
  recordChat: vi.fn(async (_message: Record<string, unknown>) => undefined),
}));
vi.mock("../safety-service.js", async () => {
  const { EventEmitter } = await import("node:events");
  return { ...safety, safetyEvents: new EventEmitter() };
});
const justice = vi.hoisted(() => ({
  issueCitation: vi.fn(async (..._args: unknown[]): Promise<{ fine: number } | null> => ({ fine: 2_500 })),
}));
vi.mock("../justice-service.js", () => justice);
const rides = vi.hoisted(() => ({ chargeRide: vi.fn(async () => 1_000), refundRide: vi.fn(async () => 1_000) }));
vi.mock("../ride-service.js", () => rides);
const travel = vi.hoisted(() => ({
  tripRecord: vi.fn(async (_userId: string): Promise<Record<string, unknown> | null> => null),
  advanceLeg: vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({})),
  retimeFlight: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("../travel-service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), ...travel }));
vi.mock("../profile-service.js", async () => {
  const { EventEmitter } = await import("node:events");
  return { loadAppearance: vi.fn(async () => ({ skinTone: "rich", hairstyle: "low-fade", outfit: "island-casual", accessory: "none" })), profileEvents: new EventEmitter() };
});
const { safetyEvents } = await import("../safety-service.js");
const { profileEvents } = await import("../profile-service.js");
const property = await import("../property-service.js");

const { BUS_CAPACITY, LagosRoom, MAX_VISIBLE_PLAYERS, REBOARD_COOLDOWN_MS } = await import("./LagosRoom.js");

type FakeClient = { sessionId: string; send: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn>; auth: { userId: string; name: string } };
type RoomInternals = {
  players: Map<string, Record<string, unknown>>;
  buses: Array<{ seats: Array<string | null>; [key: string]: unknown }>;
  clients: FakeClient[];
  handleBoard(client: FakeClient, payload: unknown): Promise<void>;
  handleAlight(client: FakeClient): void;
  handleEnterVehicle(client: FakeClient, payload: unknown): Promise<void>;
  handleExitVehicle(client: FakeClient): Promise<void>;
  handleVehicleImpact(client: FakeClient, payload: unknown): Promise<void>;
  handlePosition(client: FakeClient, payload: unknown): void;
  handleChat(client: FakeClient, payload: unknown): Promise<void>;
  handleEnterProperty(client: FakeClient, payload: unknown): Promise<void>;
  sendLooks(client: FakeClient): void;
  onCreate(): Promise<void>;
  onJoin(client: FakeClient): Promise<void>;
  applySanction(userId: string, kind: string, reason: string, endsAt: number | null): void;
  broadcastSnapshots(): void;
  vehicles: Map<string, Record<string, unknown>>;
  onLeave(client: FakeClient): Promise<void>;
  allowReconnection: () => Promise<unknown>;
  busDoor(bus: unknown): { x: number; z: number };
  tickWorld(dt: number): void;
  handleRequestStop(client: FakeClient): void;
  busStates(): Array<{ id: string; routeId: string; s: number; stopId: string | null; nextStopId: string }>;
};

const lekki = ROUTES[0]!;
const stop = lekki.stops[1]!;

function setup(route: TransitRoute = lekki, stopIndex = 1) {
  const room = new LagosRoom() as unknown as RoomInternals;
  const at = route.stops[stopIndex]!;
  const bus: { id: string; state: string; currentStopId: string | null; seats: Array<string | null>; [key: string]: unknown } = {
    id: "danfo-1",
    route,
    s: at.s,
    speed: 0,
    state: "dwelling",
    dwellUntil: Date.now() + 9_000,
    dwellStartedAt: Date.now(),
    stopIndex,
    currentStopId: at.id,
    stopRequested: false,
    seats: Array.from({ length: BUS_CAPACITY }, () => null as string | null),
    lastMovedAt: Date.now(),
  };
  room.buses = [bus];
  const door = room.busDoor(bus);
  const clients: FakeClient[] = [];
  Object.defineProperty(room, "clients", { value: clients });
  const join = (name: string) => {
    const client: FakeClient = { sessionId: `s-${name}`, send: vi.fn(), leave: vi.fn(), auth: { userId: `u-${name}`, name } };
    clients.push(client);
    room.players.set(client.sessionId, {
      sessionId: client.sessionId,
      userId: client.auth.userId,
      name,
      appearance: { body: "male", skinTone: "rich", hairstyle: "low-fade", outfit: "island-casual", accessory: "none" },
      looksRequestedAt: 0,
      x: door.x,
      z: door.z,
      yaw: 0,
      motion: "idle",
      location: "street",
      previewOnly: false,
      propertyId: null,
      returnPoint: [door.x, door.z],
      busId: null,
      seat: null,
      journeyId: null,
      carrying: false,
      connected: true,
      lastSequence: -1,
      lastAcceptedAt: Date.now(),
      lastSavedAt: Date.now(),
      lastUnstuckAt: 0,
      rate: { since: Date.now(), count: 0 },
      actionRate: { since: Date.now(), count: 0 },
      boarding: false,
      alightAtNext: false,
      alighted: null,
      vehicleId: null,
      driveMetres: 0,
      lastVehicleSaveAt: Date.now(),
      lastImpactAt: 0,
      entering: false,
      chatTimes: [],
      mutedUntil: null,
      hidden: new Set<string>(),
      travel: [],
      kicked: false,
    });
    return client;
  };
  const notices = (client: FakeClient) => client.send.mock.calls.filter(([type]) => type === "notice").map(([, notice]) => (notice as { text: string }).text);
  return { room, bus, join, notices, player: (client: FakeClient) => room.players.get(client.sessionId)! };
}

describe("LagosRoom danfo boarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    economy.chargeFare.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { balance: 1_000 };
    });
  });

  it("gives the last seat to exactly one of two simultaneous requests and charges once", async () => {
    const { room, bus, join, notices, player } = setup();
    bus.seats.fill("npc");
    bus.seats[BUS_CAPACITY - 1] = null;
    const ada = join("ada");
    const tunde = join("tunde");
    await Promise.all([room.handleBoard(ada, { busId: bus.id }), room.handleBoard(tunde, { busId: bus.id })]);
    const seated = [player(ada), player(tunde)].filter((p) => p.busId === bus.id);
    expect(seated).toHaveLength(1);
    expect(economy.chargeFare).toHaveBeenCalledTimes(1);
    expect([...notices(ada), ...notices(tunde)].some((text) => text.includes("full"))).toBe(true);
  });

  it("refuses a full danfo without charging", async () => {
    const { room, bus, join, notices, player } = setup();
    bus.seats.fill("npc");
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    expect(player(ada).busId).toBeNull();
    expect(economy.chargeFare).not.toHaveBeenCalled();
    expect(notices(ada).at(-1)).toMatch(/full/);
  });

  it("charges a repeated (double-pressed) board request only once", async () => {
    const { room, bus, join, player } = setup();
    const ada = join("ada");
    await Promise.all([room.handleBoard(ada, { busId: bus.id }), room.handleBoard(ada, { busId: bus.id }), room.handleBoard(ada, { busId: bus.id })]);
    expect(economy.chargeFare).toHaveBeenCalledTimes(1);
    expect(player(ada).busId).toBe(bus.id);
    expect(bus.seats.filter((seat) => seat === "u-ada")).toHaveLength(1);
  });

  it("refuses boarding while the danfo is moving", async () => {
    const { room, bus, join, notices } = setup();
    bus.state = "driving";
    bus.currentStopId = null;
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    expect(economy.chargeFare).not.toHaveBeenCalled();
    expect(notices(ada).at(-1)).toMatch(/Wait for the danfo to stop/);
  });

  it("releases the seat and does not charge when payment fails mid-boarding", async () => {
    const { room, bus, join, notices, player } = setup();
    economy.chargeFare.mockRejectedValueOnce(new Error("database unavailable"));
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    expect(player(ada).busId).toBeNull();
    expect(bus.seats.every((seat) => seat === null)).toBe(true);
    expect(notices(ada).at(-1)).toMatch(/not charged/);
  });

  it("blocks re-boarding the same danfo right after stepping off", async () => {
    const { room, bus, join, notices, player } = setup();
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    room.handleAlight(ada);
    expect(player(ada).busId).toBeNull();
    await room.handleBoard(ada, { busId: bus.id });
    expect(economy.chargeFare).toHaveBeenCalledTimes(1);
    expect(notices(ada).at(-1)).toMatch(/just stepped off/);
    expect(REBOARD_COOLDOWN_MS).toBeGreaterThan(3_000);
  });

  it("frees the seat and drops the rider at the next stop when they disconnect for good", async () => {
    const { room, bus, join, player } = setup();
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    const seat = player(ada).seat as number;
    expect(bus.seats[seat]).toBe("u-ada");
    room.allowReconnection = () => Promise.reject(new Error("gone"));
    await room.onLeave(ada);
    expect(bus.seats[seat]).toBeNull();
    expect(room.players.has(ada.sessionId)).toBe(false);
    expect(economy.endJourney).toHaveBeenCalledWith("u-ada", expect.any(String), stop.id, "interrupted");
    const [, x, z] = economy.savePlayerPlace.mock.calls.at(-1)!;
    expect(Math.hypot(x - stop.alight[0], z - stop.alight[1])).toBeLessThan(0.01);
  });

  it("keeps the seat when the rider reconnects in time", async () => {
    const { room, bus, join, player } = setup();
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    room.allowReconnection = () => Promise.resolve(ada);
    await room.onLeave(ada);
    expect(player(ada).busId).toBe(bus.id);
    expect(bus.seats.filter((seat) => seat === "u-ada")).toHaveLength(1);
    expect(sampleRoute(lekki, bus.s as number)).toBeTruthy();
  });
});

describe("LagosRoom driving", () => {
  const start = stop.s + 60;
  const parked = sampleRoute(lekki, start);

  function withCar(condition = 100) {
    const context = setup();
    context.room.vehicles.set("car-1", {
      id: "car-1",
      ownerUserId: "u-ada",
      ownerName: "ada",
      modelId: "tokunbo-saloon",
      colour: "#d9d9d6",
      plate: "EKO 123 AB",
      condition,
      x: parked.x,
      z: parked.z,
      yaw: parked.yaw,
      driverSessionId: null,
    });
    const ada = context.join("ada");
    Object.assign(context.player(ada), { x: parked.x + 1.5, z: parked.z });
    return { ...context, ada };
  }

  function drive(room: RoomInternals, client: FakeClient, sequence: number, metres: number, secondsAgo: number) {
    const player = room.players.get(client.sessionId)!;
    player.lastAcceptedAt = Date.now() - secondsAgo * 1_000;
    const pose = sampleRoute(lekki, start + metres);
    room.handlePosition(client, { sequence, x: pose.x, z: pose.z, yaw: pose.yaw, motion: "drive" });
    return pose;
  }

  beforeEach(() => vi.clearAllMocks());

  it("lets the owner take the wheel once, even when E is pressed repeatedly", async () => {
    const { room, ada, player } = withCar();
    await Promise.all([
      room.handleEnterVehicle(ada, { vehicleId: "car-1" }),
      room.handleEnterVehicle(ada, { vehicleId: "car-1" }),
    ]);
    expect(vehicles.claimVehicle).toHaveBeenCalledTimes(1);
    expect(player(ada).vehicleId).toBe("car-1");
    expect(room.vehicles.get("car-1")!.driverSessionId).toBe(ada.sessionId);
  });

  it("keeps other residents out of a locked car they do not own", async () => {
    const { room, join, player, notices } = withCar();
    room.vehicles.get("car-1")!.locked = true;
    const tunde = join("tunde");
    Object.assign(player(tunde), { x: parked.x - 1.5, z: parked.z });
    await room.handleEnterVehicle(tunde, { vehicleId: "car-1" });
    expect(vehicles.claimVehicle).not.toHaveBeenCalled();
    expect(player(tunde).vehicleId).toBeNull();
    expect(notices(tunde).at(-1)).toMatch(/belongs to ada.*locked/);
  });

  it("lets other residents ride as passengers in an unlocked car, never as driver", async () => {
    const { room, join, player } = withCar();
    room.vehicles.get("car-1")!.locked = false;
    const tunde = join("tunde");
    Object.assign(player(tunde), { x: parked.x - 1.5, z: parked.z });
    await room.handleEnterVehicle(tunde, { vehicleId: "car-1" });
    expect(vehicles.claimVehicle).not.toHaveBeenCalled();
    expect(player(tunde).vehicleId).toBe("car-1");
    expect(player(tunde).vehicleSeat).toBeGreaterThan(0);
  });

  it("accepts car speeds while driving but corrects anything faster than the model allows", async () => {
    const { room, ada, player } = withCar();
    await room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    const pose = drive(room, ada, 1, 15, 1);
    expect(player(ada).x).toBeCloseTo(pose.x);
    expect(room.vehicles.get("car-1")!.x).toBeCloseTo(pose.x);
    drive(room, ada, 2, 15 + 60, 1);
    expect(player(ada).x).toBeCloseTo(pose.x);
    expect(ada.send.mock.calls.some(([type]) => type === "correction")).toBe(true);
  });

  it("caps a limp-mode car at the reduced top speed", async () => {
    const { room, ada, player } = withCar(20);
    vehicles.claimVehicle.mockResolvedValueOnce({ condition: 20 });
    await room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    drive(room, ada, 1, 36, 1);
    expect(player(ada).x).toBeCloseTo(parked.x);
  });

  it("parks where the driver stops, records the distance and puts them beside the car", async () => {
    const { room, ada, player } = withCar();
    await room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    const pose = drive(room, ada, 1, 12, 1);
    await room.handleExitVehicle(ada);
    const [id, saved, metres, park] = vehicles.saveDrivingVehicle.mock.calls.at(-1)! as [string, { x: number }, number, boolean];
    expect([id, park]).toEqual(["car-1", true]);
    expect(saved.x).toBeCloseTo(pose.x);
    expect(metres).toBeCloseTo(12, 0);
    expect(player(ada).vehicleId).toBeNull();
    expect(Math.hypot((player(ada).x as number) - pose.x, (player(ada).z as number) - pose.z)).toBeLessThan(4);
    expect(room.vehicles.get("car-1")!.driverSessionId).toBeNull();
  });

  it("applies impact damage once per cooldown", async () => {
    const { room, ada } = withCar();
    await room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    await room.handleVehicleImpact(ada, { speed: 10 });
    await room.handleVehicleImpact(ada, { speed: 10 });
    expect(vehicles.damageVehicle).toHaveBeenCalledTimes(1);
    expect(room.vehicles.get("car-1")!.condition).toBe(80);
  });

  it("parks the car when the driver disconnects for good", async () => {
    const { room, ada } = withCar();
    await room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    room.allowReconnection = () => Promise.reject(new Error("gone"));
    await room.onLeave(ada);
    expect(vehicles.saveDrivingVehicle).toHaveBeenCalledWith("car-1", expect.anything(), expect.any(Number), true);
    expect(room.vehicles.get("car-1")!.driverSessionId).toBeNull();
  });
});

describe("LagosRoom water and bridges", () => {
  const deck: [number, number] = [-1278.6, 648.4];

  function onDeck() {
    const context = setup();
    const ada = context.join("ada");
    Object.assign(context.player(ada), { x: deck[0], z: deck[1] });
    const move = (sequence: number, x: number, z: number) => {
      context.player(ada).lastAcceptedAt = Date.now() - 1_500;
      context.room.handlePosition(ada, { sequence, x, z, yaw: 0, motion: "jog" });
    };
    return { ...context, ada, move };
  }

  beforeEach(() => vi.clearAllMocks());

  it("lets a resident cross the Link Bridge on foot", () => {
    const { ada, player, move } = onDeck();
    move(1, deck[0] - 6, deck[1] + 1.3);
    expect(player(ada).x).toBeCloseTo(deck[0] - 6);
    expect(ada.send.mock.calls.some(([type]) => type === "correction")).toBe(false);
  });

  it("corrects a step over the parapet onto the lagoon", () => {
    const { ada, player, move } = onDeck();
    let edge = 0;
    while (!blockedByWater(deck[0], deck[1] + edge)) edge += 0.25;
    move(1, deck[0], deck[1] + edge + 1);
    expect(player(ada).z).toBeCloseTo(deck[1]);
    expect(ada.send.mock.calls.some(([type]) => type === "correction")).toBe(true);
  });
});

describe("LagosRoom chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  const chats = (client: FakeClient) =>
    client.send.mock.calls.filter(([type]) => type === "chat").map(([, message]) => message as { text: string; userName: string; id: string });

  function crowd() {
    const context = setup();
    const ada = context.join("ada");
    const near = context.join("near");
    const far = context.join("far");
    const inside = context.join("inside");
    const origin = context.player(ada);
    Object.assign(context.player(near), { x: (origin.x as number) + 25, z: origin.z });
    Object.assign(context.player(far), { x: (origin.x as number) + 120, z: origin.z });
    Object.assign(context.player(inside), { location: "home:glover-court-2b" });
    return { ...context, ada, near, far, inside };
  }

  it("reaches the sender and nearby residents in the same place only, and stores the line first", async () => {
    const { room, ada, near, far, inside } = crowd();
    await room.handleChat(ada, { text: "  Ẹ kú àárọ̀ everyone  " });
    expect(chats(ada).map(({ text }) => text)).toEqual(["Ẹ kú àárọ̀ everyone"]);
    expect(chats(near)).toHaveLength(1);
    expect(chats(far)).toHaveLength(0);
    expect(chats(inside)).toHaveLength(0);
    expect(safety.recordChat).toHaveBeenCalledWith(expect.objectContaining({ id: chats(ada)[0]!.id, userId: "u-ada", recipients: 1, filtered: false }));
  });

  it("masks blocked words and contact details but keeps the original for moderators", async () => {
    const { room, ada, near } = crowd();
    await room.handleChat(ada, { text: "shit, call me on 0803 555 1234" });
    const [shown] = chats(near);
    expect(shown!.text).not.toMatch(/shit|0803/);
    expect(safety.recordChat).toHaveBeenCalledWith(expect.objectContaining({ body: "shit, call me on 0803 555 1234", filtered: true }));
  });

  it("rate-limits bursts and rapid repeats", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { room, ada, notices } = crowd();
    await room.handleChat(ada, { text: "one" });
    await room.handleChat(ada, { text: "two, too soon" });
    expect(chats(ada)).toHaveLength(1);
    for (let index = 0; index < 6; index += 1) {
      vi.advanceTimersByTime(1_000);
      await room.handleChat(ada, { text: `line ${index}` });
    }
    expect(chats(ada)).toHaveLength(5);
    expect(notices(ada).filter((text) => text.startsWith("Slow down"))).toHaveLength(3);
    vi.advanceTimersByTime(10_000);
    await room.handleChat(ada, { text: "after a pause" });
    expect(chats(ada)).toHaveLength(6);
  });

  it("never carries chat between residents who blocked each other, in either direction", async () => {
    const { room, ada, near, player } = crowd();
    player(near).hidden = new Set(["u-ada"]);
    await room.handleChat(ada, { text: "can you hear me" });
    await new Promise((resolve) => setTimeout(resolve, 750));
    await room.handleChat(near, { text: "and me?" });
    expect(chats(near).map(({ userName }) => userName)).toEqual(["near"]);
    expect(chats(ada).map(({ userName }) => userName)).toEqual(["ada"]);
  });

  it("rejects empty or oversized messages and does not send chat it could not store", async () => {
    const { room, ada, near, notices } = crowd();
    await room.handleChat(ada, { text: "   " });
    await room.handleChat(ada, { text: "x".repeat(201) });
    expect(safety.recordChat).not.toHaveBeenCalled();
    safety.recordChat.mockRejectedValueOnce(new Error("db down"));
    await room.handleChat(ada, { text: "hello" });
    expect(chats(near)).toHaveLength(0);
    expect(notices(ada).at(-1)).toMatch(/not sent/);
  });

  it("applies mutes live, and a suspension removes the player without holding their slot", async () => {
    const { room, ada, near, notices, player } = crowd();
    room.applySanction("u-ada", "mute", "Spamming", Date.now() + 3_600_000);
    await room.handleChat(ada, { text: "let me talk" });
    expect(chats(near)).toHaveLength(0);
    expect(notices(ada).at(-1)).toMatch(/muted/);
    room.applySanction("u-ada", "lift_mute", "Expired early", null);
    await room.handleChat(ada, { text: "thanks" });
    expect(chats(near)).toHaveLength(1);

    room.applySanction("u-near", "suspend", "Repeated harassment", null);
    expect(near.send).toHaveBeenCalledWith("suspended", { reason: "Repeated harassment", until: null });
    expect(near.leave).toHaveBeenCalledWith(4003);
    const reconnect = vi.fn(async () => undefined);
    room.allowReconnection = reconnect;
    await room.onLeave(near);
    expect(reconnect).not.toHaveBeenCalled();
    expect(room.players.has(near.sessionId)).toBe(false);
    expect(player(ada)).toBeTruthy();
  });
});

describe("LagosRoom careless-driving citations", () => {
  const start = stop.s + 60;
  const parked = sampleRoute(lekki, start);
  beforeEach(() => vi.clearAllMocks());

  async function driving() {
    const context = setup();
    context.room.vehicles.set("car-1", {
      id: "car-1", ownerUserId: "u-ada", ownerName: "ada", modelId: "tokunbo-saloon", colour: "#d9d9d6",
      plate: "EKO 123 AB", condition: 100, x: parked.x, z: parked.z, yaw: parked.yaw, driverSessionId: null,
    });
    const ada = context.join("ada");
    Object.assign(context.player(ada), { x: parked.x + 1.5, z: parked.z });
    await context.room.handleEnterVehicle(ada, { vehicleId: "car-1" });
    const step = (sequence: number, metres: number) => {
      context.player(ada).lastAcceptedAt = Date.now() - 500;
      const pose = sampleRoute(lekki, start + metres);
      context.room.handlePosition(ada, { sequence, x: pose.x, z: pose.z, yaw: pose.yaw, motion: "drive" });
    };
    return { ...context, ada, step };
  }

  it("cites a crash when the server measured the car at speed", async () => {
    const { room, ada, step, notices } = await driving();
    step(1, 9);
    step(2, 18);
    await room.handleVehicleImpact(ada, { speed: 17 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(justice.issueCitation).toHaveBeenCalledTimes(1);
    const [userId, offence, evidence] = justice.issueCitation.mock.calls[0]! as [string, string, { speed: number; district: string }];
    expect([userId, offence]).toEqual(["u-ada", "careless_driving"]);
    expect(evidence.speed).toBeCloseTo(18, 0);
    expect(evidence.district).toBe("Lekki Phase 1");
    expect(notices(ada).at(-1)).toMatch(/careless driving at 6\d km\/h/);
  });

  it("does not cite when the client claims a hard crash the server did not see", async () => {
    const { room, ada, step } = await driving();
    step(1, 2);
    step(2, 4);
    await room.handleVehicleImpact(ada, { speed: 25 });
    expect(justice.issueCitation).not.toHaveBeenCalled();
  });

  it("does not cite a gentle bump after fast driving", async () => {
    const { room, ada, step } = await driving();
    step(1, 9);
    step(2, 18);
    await room.handleVehicleImpact(ada, { speed: 6 });
    expect(justice.issueCitation).not.toHaveBeenCalled();
  });

  const pedestrianAt = (context: Awaited<ReturnType<typeof driving>>, metres: number, sideways = 0) => {
    const pose = sampleRoute(lekki, start + metres);
    const bola = context.join("bola");
    Object.assign(context.player(bola), { x: pose.x + Math.cos(pose.yaw) * sideways, z: pose.z - Math.sin(pose.yaw) * sideways, location: "street" });
    return bola;
  };
  const serverEvidence = () => justice.issueCitation.mock.calls.map(([, , evidence]) => evidence as { detectedBy?: string; struck?: string });

  it("cites a fast driver who hits a pedestrian even when the client never reports the impact", async () => {
    const context = await driving();
    pedestrianAt(context, 16);
    context.step(1, 9);
    context.step(2, 18);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(justice.issueCitation).toHaveBeenCalledTimes(1);
    expect(serverEvidence()[0]).toMatchObject({ detectedBy: "server", struck: "pedestrian" });
    expect(context.notices(context.ada).at(-1)).toMatch(/careless driving/);
  });

  it("sees a parked car the driver swept through between two updates", async () => {
    const context = await driving();
    const through = sampleRoute(lekki, start + 13);
    context.room.vehicles.set("car-2", {
      id: "car-2", ownerUserId: "u-cy", ownerName: "cy", modelId: "eko-hatch", colour: "#2b4c7e",
      plate: "LND 456 CD", condition: 100, x: through.x, z: through.z, yaw: through.yaw, driverSessionId: null,
    });
    context.step(1, 9);
    context.step(2, 18);
    expect(justice.issueCitation).toHaveBeenCalledTimes(1);
    expect(serverEvidence()[0]).toMatchObject({ detectedBy: "server", struck: "vehicle" });
  });

  it("does not cite slow contact or a fast pass beside someone on the pavement", async () => {
    const slow = await driving();
    pedestrianAt(slow, 4);
    slow.step(1, 2);
    slow.step(2, 4);
    expect(justice.issueCitation).not.toHaveBeenCalled();

    const passing = await driving();
    pedestrianAt(passing, 16, 4);
    passing.step(1, 9);
    passing.step(2, 18);
    expect(justice.issueCitation).not.toHaveBeenCalled();
  });

  /** Drives straight at the starter home's front wall, one update per `dt` seconds, at the given speeds. */
  async function towardsWall(speeds: number[], dt: number) {
    const context = await driving();
    const { door, facade } = getPlace("starter-home");
    const length = Math.hypot(facade[0] - door[0], facade[1] - door[1]);
    const unit: [number, number] = [(facade[0] - door[0]) / length, (facade[1] - door[1]) / length];
    const distance = speeds.reduce((total, speed) => total + speed * dt, 0);
    // End with the nose at the wall: the front of a 4.4 m car sits about 2.2 m ahead of its centre.
    let along = length - 2.2 - distance;
    const at = (metres: number) => [door[0] + unit[0] * metres, door[1] + unit[1] * metres] as const;
    const [sx, sz] = at(along);
    vi.useFakeTimers({ toFake: ["Date"] });
    Object.assign(context.player(context.ada), { x: sx, z: sz, heading: null, travel: [], lastAcceptedAt: Date.now() });
    speeds.forEach((speed, index) => {
      vi.setSystemTime(Date.now() + dt * 1_000);
      along += speed * dt;
      const [x, z] = at(along);
      context.room.handlePosition(context.ada, { sequence: 10 + index, x, z, yaw: Math.atan2(unit[0], unit[1]), motion: "drive" });
    });
    vi.useRealTimers();
    return context;
  }

  it("cites a fast driver who runs into a building without reporting the impact", async () => {
    // 72 km/h for 1.5 s, then the wall stops the car dead.
    await towardsWall([...Array(15).fill(20), 0.5], 0.1);
    expect(justice.issueCitation).toHaveBeenCalledTimes(1);
    expect(serverEvidence()[0]).toMatchObject({ detectedBy: "server", struck: "building" });
    expect((justice.issueCitation.mock.calls[0]![2] as { speed: number }).speed).toBeGreaterThan(19);
  });

  it("does not cite an emergency stop in front of a wall at full braking", async () => {
    // From 72 km/h at 11 m/s², harder than any car brakes, to a stop beside the same wall.
    const speeds = Array.from({ length: 19 }, (_, index) => Math.max(0.2, 20 - 11 * 0.1 * (index + 1)));
    const context = await towardsWall([...Array(10).fill(20), ...speeds], 0.1);
    const { facade } = getPlace("starter-home");
    const stopped = context.player(context.ada) as { x: number; z: number };
    expect(Math.hypot(stopped.x - facade[0], stopped.z - facade[1])).toBeLessThan(2.5);
    expect(justice.issueCitation).not.toHaveBeenCalled();
  });

  it("issues one citation when the server and the client both see the same crash", async () => {
    const context = await driving();
    pedestrianAt(context, 16);
    context.step(1, 9);
    context.step(2, 18);
    await context.room.handleVehicleImpact(context.ada, { speed: 18 });
    expect(justice.issueCitation).toHaveBeenCalledTimes(1);
  });
});

describe("LagosRoom snapshots", () => {
  it("sends only the nearest players in a crowd, always including the viewer, and omits default fields", () => {
    const { room, join, player } = setup();
    const viewer = join("viewer");
    const origin = player(viewer);
    const crowd = Array.from({ length: MAX_VISIBLE_PLAYERS + 10 }, (_, index) => {
      const client = join(`p${index}`);
      Object.assign(player(client), { x: (origin.x as number) + 1 + index, z: origin.z });
      return client;
    });
    room.broadcastSnapshots();
    const [, snapshot] = viewer.send.mock.calls.find(([type]) => type === "snapshot")! as [string, { players: Array<Record<string, unknown>> }];
    expect(snapshot.players).toHaveLength(MAX_VISIBLE_PLAYERS);
    expect(snapshot.players[0]!.sessionId).toBe(viewer.sessionId);
    const included = new Set(snapshot.players.map(({ sessionId }) => sessionId));
    expect(included.has(crowd[0]!.sessionId)).toBe(true);
    expect(included.has(crowd.at(-1)!.sessionId)).toBe(false);
    expect(Object.keys(snapshot.players[1]!).sort()).toEqual(["motion", "name", "sessionId", "x", "yaw", "z"]);
  });
});

describe("LagosRoom appearance", () => {
  beforeEach(() => vi.clearAllMocks());
  const looks = (client: FakeClient, type: "look" | "looks") => client.send.mock.calls.filter(([kind]) => kind === type).map(([, value]) => value);

  it("sends everyone's look on request, at most once every 5 seconds", () => {
    const { room, join, player } = setup();
    const ada = join("ada");
    const tunde = join("tunde");
    Object.assign(player(tunde), { appearance: { body: "male", skinTone: "deep", hairstyle: "locs", outfit: "ankara-day", accessory: "cap" } });
    room.sendLooks(ada);
    room.sendLooks(ada);
    const sent = looks(ada, "looks");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      expect.arrayContaining([
        { sessionId: "s-ada", appearance: expect.objectContaining({ skinTone: "rich" }) },
        { sessionId: "s-tunde", appearance: { body: "male", skinTone: "deep", hairstyle: "locs", outfit: "ankara-day", accessory: "cap" } },
      ]),
    );
  });

  it("shows a saved character change to everyone in the room at once", async () => {
    const { room, join, player } = setup();
    const ada = join("ada");
    const tunde = join("tunde");
    await room.onCreate().catch(() => undefined);
    const next = { skinTone: "golden", hairstyle: "afro", outfit: "athleisure", accessory: "glasses" };
    profileEvents.emit("appearance", "u-ada", next);
    expect(player(ada).appearance).toEqual(next);
    expect(looks(tunde, "look")).toEqual([{ sessionId: "s-ada", appearance: next }]);
    expect(looks(ada, "look")).toEqual([{ sessionId: "s-ada", appearance: next }]);
    profileEvents.removeAllListeners();
  });
});

describe("LagosRoom homes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets a tenant enter their own flat through the building's shared door", async () => {
    const { room, join, player } = setup();
    const ada = join("ada");
    const court = getPlace("lekki-adebayo-flat-2");
    Object.assign(player(ada), { x: court.door[0], z: court.door[1] });
    vi.mocked(property.requirePropertyAccess).mockResolvedValue({ owner: true, guest: false });
    await room.handleEnterProperty(ada, { propertyId: "lekki-adebayo-flat-7", mode: "enter" });
    expect(property.requirePropertyAccess).toHaveBeenCalledWith("u-ada", "lekki-adebayo-flat-7");
    expect(player(ada)).toMatchObject({ location: "home:lekki-adebayo-flat-7", propertyId: "lekki-adebayo-flat-7", returnPoint: court.door });
  });

  it("refuses a home that is not on the map without throwing", async () => {
    const { room, join, player, notices } = setup();
    const ada = join("ada");
    await room.handleEnterProperty(ada, { propertyId: "nowhere-flat-9", mode: "enter" });
    expect(player(ada).location).toBe("street");
    expect(notices(ada)).toEqual(["That home is not on the map."]);
  });
});

describe("LagosRoom danfo routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    economy.chargeFare.mockResolvedValue({ balance: 1_000 });
  });

  it("runs danfos on the Lekki, Ikoyi and Victoria Island loops, each on its own route", async () => {
    const room = new LagosRoom() as unknown as RoomInternals;
    Object.defineProperty(room, "clients", { value: [] });
    await room.onCreate().catch(() => undefined);
    const states = room.busStates();
    expect(new Set(states.map(({ id }) => id)).size).toBe(states.length);
    for (const route of ROUTES) {
      const own = states.filter(({ routeId }) => routeId === route.routeId);
      expect(own.length, route.routeId).toBeGreaterThanOrEqual(3);
      for (const bus of own) expect(route.stops.map(({ id }) => id)).toContain(bus.nextStopId);
    }
  });

  it("charges the Victoria Island fare against its own route and stop", async () => {
    const island = getRoute("adeola-odeku-loop");
    const { room, bus, join, notices, player } = setup(island, 0);
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    expect(player(ada).busId).toBe(bus.id);
    expect(economy.chargeFare).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: "adeola-odeku-loop", stopId: island.stops[0]!.id, fare: island.fare }),
    );
    expect(notices(ada).at(-1)).toMatch(/^Fare paid/);
  });

  it("sends each resident only the danfos near them, plus the one they ride", async () => {
    const { room, join, player } = setup();
    await room.onCreate().catch(() => undefined);
    const viewer = join("lekki");
    const rider = join("rider");
    const home = lekki.stops[0]!;
    Object.assign(player(viewer), { x: home.alight[0], z: home.alight[1] });
    const ikoyiBus = room.busStates().find(({ routeId }) => routeId === "bourdillon-loop")!;
    Object.assign(player(rider), { x: home.alight[0], z: home.alight[1], busId: ikoyiBus.id });
    room.broadcastSnapshots();
    const sent = (client: FakeClient) => {
      const [, snapshot] = client.send.mock.calls.filter(([type]) => type === "snapshot").at(-1)! as [string, { buses: Array<{ id: string; routeId: string }> }];
      return snapshot.buses;
    };
    const viewerRoutes = new Set(sent(viewer).map(({ routeId }) => routeId));
    expect(viewerRoutes).toContain("admiralty-loop");
    expect(viewerRoutes).not.toContain("bourdillon-loop");
    expect(viewerRoutes).not.toContain("adeola-odeku-loop");
    expect(sent(rider).map(({ id }) => id)).toContain(ikoyiBus.id);
  });

  it.each(ROUTES.map((route) => [route.routeNumber, route] as const))("%s danfo laps its whole loop, dwelling at every stop in order", (_number, route) => {
    const { room, bus } = setup(route, 0);
    const seen: string[] = [];
    for (let tick = 0; tick < 20_000 && seen.length < route.stops.length + 1; tick += 1) {
      vi.setSystemTime(Date.now() + 50);
      room.tickWorld(50);
      if (bus.state === "dwelling" && bus.currentStopId && seen.at(-1) !== bus.currentStopId) seen.push(bus.currentStopId);
    }
    vi.useRealTimers();
    expect(seen).toEqual([...route.stops, route.stops[0]!].map(({ id }) => id));
  });

  it("drives an Ikoyi danfo to its next Bourdillon Road stop and lets a rider step off there", async () => {
    const ikoyi = getRoute("bourdillon-loop");
    const { room, bus, join, player } = setup(ikoyi, 0);
    const ada = join("ada");
    await room.handleBoard(ada, { busId: bus.id });
    const next = ikoyi.stops[1]!;
    Object.assign(bus, { state: "driving", currentStopId: null, stopIndex: 1, s: next.s - 40, speed: 6, dwellUntil: 0 });
    room.handleRequestStop(ada);
    for (let tick = 0; tick < 400 && bus.state !== "dwelling"; tick += 1) room.tickWorld(50);
    expect(bus.currentStopId).toBe(next.id);
    expect(player(ada).busId).toBeNull();
    const { x, z } = player(ada) as { x: number; z: number };
    expect(Math.hypot(x - next.alight[0], z - next.alight[1])).toBeLessThan(0.01);
  });
});

describe("LagosRoom sessions", () => {
  beforeEach(() => vi.clearAllMocks());
  const fresh = () => {
    const room = new LagosRoom() as unknown as RoomInternals;
    const clients: FakeClient[] = [];
    Object.defineProperty(room, "clients", { value: clients });
    const connect = (sessionId: string) => {
      const client: FakeClient = { sessionId, send: vi.fn(), leave: vi.fn(), auth: { userId: "u-ada", name: "ada" } };
      clients.push(client);
      return client;
    };
    return { room, connect };
  };

  it("keeps the newer session when an older join for the same account finishes last", async () => {
    const { room, connect } = fresh();
    let releaseOld: (value: null) => void = () => undefined;
    economy.loadPlayerPlace.mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)));
    const old = connect("s-old");
    const newer = connect("s-new");
    const oldJoin = room.onJoin(old);
    await room.onJoin(newer);
    releaseOld(null);
    await expect(oldJoin).rejects.toThrow(/another window/);
    expect([...room.players.keys()]).toEqual(["s-new"]);
    room.broadcastSnapshots();
    expect(newer.send.mock.calls.some(([type]) => type === "snapshot")).toBe(true);
  });

  it("closes a connected older session for the same account", async () => {
    const { room, connect } = fresh();
    const old = connect("s-old");
    await room.onJoin(old);
    const newer = connect("s-new");
    await room.onJoin(newer);
    expect(old.send).toHaveBeenCalledWith("replaced", {});
    expect(old.leave).toHaveBeenCalledWith(4004);
    expect([...room.players.keys()]).toEqual(["s-new"]);
  });

  it("does not save a dropped session's stale position after the account rejoined", async () => {
    const { room, connect } = fresh();
    const old = connect("s-old");
    await room.onJoin(old);
    let giveUp: (error: Error) => void = () => undefined;
    room.allowReconnection = () => new Promise((_resolve, reject) => (giveUp = reject));
    const leaving = room.onLeave(old);
    await room.onJoin(connect("s-new"));
    giveUp(new Error("timed out"));
    await leaving;
    expect(economy.savePlayerPlace).not.toHaveBeenCalled();
    expect([...room.players.keys()]).toEqual(["s-new"]);
  });
});

describe("LagosRoom Lagos Living Ride", () => {
  type RideRoom = {
    handleRideBook(client: FakeClient, payload: unknown): Promise<void>;
    handleRideCancel(client: FakeClient, payload: unknown): Promise<void>;
    handleRideBoard(client: FakeClient): void;
    handleEnterVehicle(client: FakeClient, payload: unknown): Promise<void>;
    checkRides(now: number): void;
    vehicles: Map<string, { npc?: boolean }>;
  };
  const here = sampleRoute(lekki, stop.s + 40);
  const there = [150, 250, 350, 450].map((ahead) => sampleRoute(lekki, stop.s + 40 + ahead)).find((pose) => Math.hypot(pose.x - here.x, pose.z - here.z) > 140)!;

  function booked() {
    const context = setup();
    const ada = context.join("ada");
    Object.assign(context.player(ada), { x: here.x, z: here.z });
    const room = context.room as unknown as RideRoom;
    const book = () =>
      room.handleRideBook(ada, {
        pickup: [here.x, here.z],
        pickupYaw: here.yaw,
        dropoff: [there.x, there.z],
        destination: [there.x, there.z],
        label: "Ade Auto Works",
        roadMetres: 660,
        idempotencyKey: crypto.randomUUID(),
      });
    return { ...context, ada, room, book, ride: () => (context.player(ada) as unknown as { ride: RideState }).ride };
  }

  beforeEach(() => {
    rides.chargeRide.mockClear();
    rides.refundRide.mockClear();
  });

  it("charges the fare once and refuses a second booking while one is active", async () => {
    const { book, ride, notices, ada } = booked();
    await book();
    expect(notices(ada)).toEqual([expect.stringContaining("Ride booked")]);
    expect(ride().status).toBe("approaching");
    expect(rides.chargeRide).toHaveBeenCalledWith("u-ada", ride().fare, "Ade Auto Works", expect.any(String));
    await book();
    expect(rides.chargeRide).toHaveBeenCalledTimes(1);
  });

  it("refunds everything when cancelled inside the free minute", async () => {
    const { book, room, ada, ride } = booked();
    await book();
    await room.handleRideCancel(ada, { reason: "rider" });
    expect(ride().status).toBe("cancelled");
    expect(rides.refundRide).toHaveBeenCalledWith("u-ada", ride().id, ride().fare, expect.stringContaining("within a minute"));
  });

  it("keeps the no-show fee once the driver is waiting, and nobody can drive the ride car", async () => {
    const { book, room, ada, ride, join, player } = booked();
    await book();
    room.checkRides(ride().arrivesAt + 1);
    expect(ride().status).toBe("waiting");
    const carId = ride().vehicleId!;
    const car = room.vehicles.get(carId)!;
    expect(car.npc).toBe(true);
    const tunde = join("tunde");
    Object.assign(player(tunde), { x: here.x, z: here.z });
    await room.handleEnterVehicle(tunde, { vehicleId: ride().vehicleId });
    expect(player(tunde).vehicleId).toBeNull();
    await room.handleRideCancel(ada, { reason: "rider" });
    expect(rides.refundRide).toHaveBeenCalledWith("u-ada", ride().id, ride().fare - 300, expect.stringContaining("fee kept"));
    expect(room.vehicles.has(carId)).toBe(false);
  });

  it("boards the rider into a passenger seat when the car has arrived", async () => {
    const { book, room, ada, ride, player } = booked();
    await book();
    room.checkRides(ride().arrivesAt + 1);
    room.handleRideBoard(ada);
    expect(ride().status).toBe("riding");
    expect(player(ada).vehicleId).toBe(ride().vehicleId);
    expect(player(ada).vehicleSeat).toBeGreaterThan(0);
  });
});

describe("LagosRoom shared flights", () => {
  type Internals = RoomInternals & { handleTravelCounter(client: FakeClient, payload: unknown): Promise<void>; flights: Map<string, { departAt: number; seats: Map<string, { seat: string }> }> };
  const parties: Record<string, string> = {};
  beforeEach(() => {
    vi.clearAllMocks();
    travel.tripRecord.mockImplementation(async (userId: string) => ({
      ticketId: `t-${userId}`,
      partyId: parties[userId] ?? userId,
      cabin: userId.endsWith("biz") ? "business" : "economy",
      seat: userId.endsWith("biz") ? "1A" : "10A",
      outbound: "checked_in",
      return: "booked",
      flight: null,
      immigrationDone: false,
    }));
    travel.advanceLeg.mockImplementation(async (userId: unknown, _leg: unknown, _to: unknown, flight: unknown) => ({ ticketId: `t-${String(userId)}`, cabin: "economy", seat: (flight as { seat: string }).seat, status: "boarded", changed: true }));
  });
  const atGate = (room: Internals, client: FakeClient) => {
    const player = room.players.get(client.sessionId)!;
    const gate = travelSpot("airport-los", "gate")!;
    Object.assign(player, { location: "airport:los", x: gate[0], z: gate[1], trip: { stage: "airport", ticketId: null, leg: "outbound", flight: null, immigrationDone: false, bagCollected: false, excursion: null, room: null } });
  };
  const board = (room: Internals, client: FakeClient) => room.handleTravelCounter(client, { action: "board" });

  it("puts everyone boarding in the window on one flight with unique seats and one departure time", async () => {
    const { room, join, player } = setup();
    const internals = room as Internals;
    const [ada, bayo, chi] = [join("ada"), join("bayo"), join("chibiz")];
    for (const client of [ada, bayo, chi]) atGate(internals, client);
    await board(internals, ada);
    const departAt = [...internals.flights.values()][0]!.departAt;
    await board(internals, bayo);
    await board(internals, chi);
    expect(internals.flights.size).toBe(1);
    const flight = [...internals.flights.values()][0]!;
    expect(flight.departAt).toBe(departAt);
    expect(departAt - Date.now()).toBeLessThanOrEqual(TRAVEL.boardingSeconds * 1_000);
    const locations = new Set([ada, bayo, chi].map((client) => player(client).location));
    expect(locations.size).toBe(1);
    const seats = [...flight.seats.values()].map((entry) => entry.seat);
    expect(new Set(seats).size).toBe(3);
    expect(cabinSeats("business")).toContain(flight.seats.get("u-chibiz")!.seat);
    expect(cabinSeats("economy")).toContain(flight.seats.get("u-bayo")!.seat);
    const trip = player(bayo).trip as { flight: { passengers: number; departAt: number } };
    expect(trip.flight.passengers).toBe(3);
    expect(trip.flight.departAt).toBe(departAt);
  });

  it("seats friends from the same booking together and sends late passengers to the next departure", async () => {
    const { room, join, player } = setup();
    const internals = room as Internals;
    parties["u-dami"] = "group";
    parties["u-efe"] = "group";
    const [stranger, dami, efe] = [join("stranger"), join("dami"), join("efe")];
    for (const client of [stranger, dami, efe]) atGate(internals, client);
    await board(internals, stranger);
    await board(internals, dami);
    await board(internals, efe);
    const flight = [...internals.flights.values()][0]!;
    const [dx, dz] = seatPoint(flight.seats.get("u-dami")!.seat);
    const [ex, ez] = seatPoint(flight.seats.get("u-efe")!.seat);
    expect(Math.hypot(dx - ex, dz - ez)).toBeLessThan(1);
    flight.departAt = Date.now() - 100;
    const late = join("late");
    atGate(internals, late);
    await board(internals, late);
    expect(internals.flights.size).toBe(2);
    expect(player(late).location).not.toBe(player(dami).location);
  });

  it("retries another seat when the database reports the seat as taken, and never double-books", async () => {
    const { room, join } = setup();
    const internals = room as Internals;
    const { SeatTakenError } = await import("../travel-service.js");
    const fay = join("fay");
    atGate(internals, fay);
    travel.advanceLeg.mockRejectedValueOnce(new SeatTakenError());
    await board(internals, fay);
    const flight = [...internals.flights.values()][0]!;
    expect(travel.advanceLeg).toHaveBeenCalledTimes(2);
    const seats = [...flight.seats.values()].map((entry) => entry.seat);
    expect(new Set(seats).size).toBe(seats.length);
  });
});
