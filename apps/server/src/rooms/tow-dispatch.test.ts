import { TOW, type TowState } from "@lagos-living/shared";
import { describe, expect, it, vi } from "vitest";
import type { RoomVehicle } from "../vehicle-service.js";

const service = vi.hoisted(() => ({
  activeTows: vi.fn(async () => []),
  cancelTow: vi.fn(async () => ({ refunded: 4000 })),
  collectTow: vi.fn(async () => true),
  deliverTow: vi.fn(async (..._args: unknown[]) => "car-1"),
  firstHome: vi.fn(async () => null),
  homeDelivery: vi.fn(async () => null),
  mechanicDelivery: vi.fn(async () => ({ kind: "kerb", x: 500, z: 500, yaw: 0 })),
  setTowStage: vi.fn(async () => undefined),
}));
vi.mock("../tow-service.js", () => service);

// A straight north-south road along x = 0.
vi.mock("../world-roads.js", () => ({
  roadNavigator: () => ({
    snap: ([x, z]: [number, number]) => ({ point: [0, z] as [number, number], yaw: 0, distance: Math.abs(x) }),
    plan: (from: [number, number], to: [number, number]) => ({ points: [from, to], names: [null, null], reachable: true, gap: 0, metres: Math.hypot(to[0] - from[0], to[1] - from[1]) }),
  }),
}));
vi.mock("@lagos-living/shared", async (original) => ({ ...(await original<object>()), walkable: () => true }));

const { TowDispatcher } = await import("./tow-dispatch.js");

function setup(owner: { onStreet: boolean; x: number; z: number } | null) {
  const vehicles = new Map<string, RoomVehicle>();
  vehicles.set("car-1", {
    id: "car-1", ownerUserId: "u1", ownerName: "Ada", modelId: "tokunbo-saloon", colour: "#101418", plate: "EKO 123 AB",
    condition: 0, x: 3, z: 100, yaw: 0, driverSessionId: null, lights: false, locked: true,
  });
  const sent: Array<TowState & { at: number }> = [];
  const notices: string[] = [];
  const cleared: string[] = [];
  const dispatcher = new TowDispatcher({
    vehicles,
    owner: () => owner,
    send: (_user, type, payload) => type === "tow" && sent.push({ ...(payload as TowState), at: Date.now() }),
    notify: (_user, notice) => notices.push(notice.text),
    clearOccupants: async (id) => void cleared.push(id),
    personNear: () => false,
  });
  const job = {
    id: "tow-1", vehicleId: "car-1", userId: "u1", stage: "arriving" as const, destination: { kind: "here" as const },
    quote: { towFee: 4000, repair: 3000, fullRepair: 3000, insurer: 0, total: 7000 }, from: [3, 100] as [number, number],
    collectedAt: null, vehicle: { modelId: "tokunbo-saloon", colour: "#101418", plate: "EKO 123 AB", modelName: "Tokunbo Saloon" },
  };
  return { vehicles, sent, notices, cleared, dispatcher, job };
}

async function run(dispatcher: InstanceType<typeof TowDispatcher>, seconds: number, clock: { now: number }) {
  for (let t = 0; t < seconds; t += 0.05) {
    clock.now += 50;
    vi.setSystemTime(clock.now);
    dispatcher.tick(0.05, clock.now);
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe("tow dispatcher", () => {
  it("drives a truck in, loads the same car, repairs it and returns it beside the owner within the timer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clock = { now: 1_000_000 };
    vi.setSystemTime(clock.now);
    const { vehicles, sent, notices, cleared, dispatcher, job } = setup({ onStreet: true, x: 4, z: 300 });
    dispatcher.start(job);
    const truck = vehicles.get("tow-tow-1")!;
    expect(truck.npc).toBe(true);
    expect(truck.z).toBeLessThan(100 - TOW.spawnMetres + 5);
    expect(dispatcher.busy("car-1")).toBe(true);

    await run(dispatcher, 20, clock);
    expect(cleared).toEqual(["car-1"]);
    expect(service.collectTow).toHaveBeenCalledWith("tow-1");
    const collectedAt = clock.now;
    expect(vehicles.has("car-1")).toBe(false);

    await run(dispatcher, TOW.repairReturnSeconds + 6, clock);
    const stages = [...new Set(sent.map((state) => state.stage))];
    expect(stages).toEqual(["arriving", "loading", "collected", "repairing", "returning", "delivered"]);
    const [, spot] = service.deliverTow.mock.calls[0]!;
    expect(spot).toMatchObject({ kind: "kerb" });
    const { x, z } = spot as { x: number; z: number };
    expect(Math.abs(x)).toBeCloseTo(2.6, 1);
    expect(Math.abs(z - 300)).toBeLessThan(30);
    const delivered = sent.find((state) => state.stage === "delivered")!;
    expect(delivered.point).toEqual([x, z]);
    expect(notices.at(-1)).toContain("repaired to 100%");
    const collected = sent.find((state) => state.stage === "collected")!.at;
    expect(collected).toBeLessThanOrEqual(collectedAt);
    expect(delivered.at - collected).toBeGreaterThan((TOW.repairReturnSeconds - 1) * 1_000);
    expect(delivered.at - collected).toBeLessThan((TOW.repairReturnSeconds + 2) * 1_000);
    expect(dispatcher.busy("car-1")).toBe(false);
    expect(vehicles.has("tow-tow-1")).toBe(false);
    vi.useRealTimers();
  });

  it("falls back to the workshop and explains when the owner is offline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clock = { now: 2_000_000 };
    vi.setSystemTime(clock.now);
    service.deliverTow.mockClear();
    const { notices, dispatcher, job } = setup(null);
    dispatcher.start({ ...job, id: "tow-2" });
    await run(dispatcher, 40, clock);
    expect(service.deliverTow).toHaveBeenCalledWith("tow-2", { kind: "kerb", x: 500, z: 500, yaw: 0 }, expect.stringContaining("offline"));
    expect(notices.at(-1)).toContain("Ade Auto Works");
    vi.useRealTimers();
  });

  it("cancels with a refund only before the car is collected", async () => {
    const { vehicles, dispatcher, job } = setup({ onStreet: true, x: 4, z: 300 });
    dispatcher.start({ ...job, id: "tow-3" });
    expect(await dispatcher.cancel("someone-else", "tow-3")).toBeNull();
    expect(await dispatcher.cancel("u1", "tow-3")).toEqual({ refunded: 4000 });
    expect(vehicles.has("tow-tow-3")).toBe(false);
    expect(vehicles.get("car-1")).toMatchObject({ x: 3, z: 100 });
    expect(dispatcher.busy("car-1")).toBe(false);
  });
});
