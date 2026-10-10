import { sampleRoute, TRANSIT } from "@lagos-living/shared";
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

const { BUS_CAPACITY, LagosRoom, REBOARD_COOLDOWN_MS } = await import("./LagosRoom.js");

type FakeClient = { sessionId: string; send: ReturnType<typeof vi.fn>; auth: { userId: string; name: string } };
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
  vehicles: Map<string, Record<string, unknown>>;
  onLeave(client: FakeClient): Promise<void>;
  allowReconnection: () => Promise<unknown>;
  busDoor(bus: unknown): { x: number; z: number };
};

const stop = TRANSIT.stops[1]!;

function setup() {
  const room = new LagosRoom() as unknown as RoomInternals;
  const bus: { id: string; state: string; currentStopId: string | null; seats: Array<string | null>; [key: string]: unknown } = {
    id: "danfo-1",
    s: stop.s,
    speed: 0,
    state: "dwelling",
    dwellUntil: Date.now() + 9_000,
    dwellStartedAt: Date.now(),
    stopIndex: 1,
    currentStopId: stop.id,
    stopRequested: false,
    seats: Array.from({ length: BUS_CAPACITY }, () => null as string | null),
    lastMovedAt: Date.now(),
  };
  room.buses = [bus];
  const door = room.busDoor(bus);
  const clients: FakeClient[] = [];
  Object.defineProperty(room, "clients", { value: clients });
  const join = (name: string) => {
    const client: FakeClient = { sessionId: `s-${name}`, send: vi.fn(), auth: { userId: `u-${name}`, name } };
    clients.push(client);
    room.players.set(client.sessionId, {
      sessionId: client.sessionId,
      userId: client.auth.userId,
      name,
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
    expect(sampleRoute(bus.s as number)).toBeTruthy();
  });
});

describe("LagosRoom driving", () => {
  const start = stop.s + 60;
  const parked = sampleRoute(start);

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
    const pose = sampleRoute(start + metres);
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

  it("keeps other residents out of a car they do not own", async () => {
    const { room, join, player, notices } = withCar();
    const tunde = join("tunde");
    Object.assign(player(tunde), { x: parked.x - 1.5, z: parked.z });
    await room.handleEnterVehicle(tunde, { vehicleId: "car-1" });
    expect(vehicles.claimVehicle).not.toHaveBeenCalled();
    expect(player(tunde).vehicleId).toBeNull();
    expect(notices(tunde).at(-1)).toMatch(/belongs to ada/);
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
    drive(room, ada, 1, 18, 1);
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
