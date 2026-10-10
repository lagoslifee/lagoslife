import type { Presence } from "@colyseus/core";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

type Callback = (message: unknown) => void;

/** Stands in for Redis pub/sub: every subscriber sees every message, including its own. */
function sharedBus() {
  const subscribers = new Map<string, Callback[]>();
  const presence = {
    subscribe: async (topic: string, callback: Callback) => {
      subscribers.set(topic, [...(subscribers.get(topic) ?? []), callback]);
      return presence;
    },
    publish: async (topic: string, data: unknown) => {
      for (const callback of subscribers.get(topic) ?? []) callback(JSON.parse(JSON.stringify(data)));
    },
  };
  return presence as unknown as Presence;
}

/** Each call loads fresh module instances, as a separate server process would have. */
async function serverProcess(bus: Presence) {
  vi.resetModules();
  const cluster = await import("./cluster.js");
  const presence = await import("./player-presence.js");
  await cluster.joinCluster(bus);
  return { cluster, presence };
}

describe("multi-process relay", () => {
  it("delivers bridged events to other processes exactly once", async () => {
    const bus = sharedBus();
    const a = await serverProcess(bus);
    const b = await serverProcess(bus);
    const onA = new EventEmitter();
    const onB = new EventEmitter();
    a.cluster.bridgeEmitter("vehicle", onA);
    b.cluster.bridgeEmitter("vehicle", onB);
    const seenA = vi.fn();
    const seenB = vi.fn();
    onA.on("changed", seenA);
    onB.on("changed", seenB);

    onA.emit("changed", "vehicle-1");

    expect(seenA).toHaveBeenCalledTimes(1);
    expect(seenB).toHaveBeenCalledTimes(1);
    expect(seenB).toHaveBeenCalledWith("vehicle-1");
  });

  it("shares positions and progress resets, and ignores a late removal from a process the player left", async () => {
    const bus = sharedBus();
    const a = await serverProcess(bus);
    const b = await serverProcess(bus);

    a.presence.setPlayerPosition("player-1", 10, 20, "street");
    expect(b.presence.isNear("player-1", [10, 21], 2)).toBe(true);

    b.presence.markProgressReset("player-1");
    expect(a.presence.wasProgressReset("player-1")).toBe(true);
    a.presence.clearProgressReset("player-1");
    expect(b.presence.wasProgressReset("player-1")).toBe(false);

    b.presence.setPlayerPosition("player-1", 50, 60, "street");
    a.presence.removePlayerPosition("player-1");
    expect(b.presence.getPlayerPosition("player-1")).toMatchObject({ x: 50, z: 60 });
    expect(a.presence.getPlayerPosition("player-1")).toMatchObject({ x: 50, z: 60 });

    b.presence.removePlayerPosition("player-1");
    expect(a.presence.getPlayerPosition("player-1")).toBeNull();
  });
});
