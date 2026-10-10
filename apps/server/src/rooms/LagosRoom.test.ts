import { sampleRoute, TRANSIT } from "@lagos-living/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const economy = vi.hoisted(() => ({
  chargeFare: vi.fn(),
  endJourney: vi.fn(async () => undefined),
  loadPlayerPlace: vi.fn(async () => null),
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
vi.mock("../property-service.js", () => ({ isPropertyAvailable: vi.fn(), requirePropertyAccess: vi.fn() }));

const { BUS_CAPACITY, LagosRoom, REBOARD_COOLDOWN_MS } = await import("./LagosRoom.js");

type FakeClient = { sessionId: string; send: ReturnType<typeof vi.fn>; auth: { userId: string; name: string } };
type RoomInternals = {
  players: Map<string, Record<string, unknown>>;
  buses: Array<{ seats: Array<string | null>; [key: string]: unknown }>;
  clients: FakeClient[];
  handleBoard(client: FakeClient, payload: unknown): Promise<void>;
  handleAlight(client: FakeClient): void;
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
