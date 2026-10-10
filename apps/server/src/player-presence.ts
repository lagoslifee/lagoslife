import { onRemote, processTag, publish } from "./cluster.js";

type Presence = { x: number; z: number; location: string; updatedAt: number; origin?: string };

const positions = new Map<string, Presence>();
const lastShared = new Map<string, Presence>();
/** Other processes only use positions for proximity checks with metre-scale radii, so a few updates a second do. */
const SHARE_INTERVAL_MS = 250;

export function setPlayerPosition(userId: string, x: number, z: number, location = "street") {
  const now = Date.now();
  positions.set(userId, { x, z, location, updatedAt: now, origin: processTag });
  const shared = lastShared.get(userId);
  if (shared && shared.location === location && now - shared.updatedAt < SHARE_INTERVAL_MS) return;
  lastShared.set(userId, { x, z, location, updatedAt: now });
  publish("presence", "set", [userId, x, z, location]);
}

export function removePlayerPosition(userId: string) {
  if (positions.get(userId)?.origin === processTag) positions.delete(userId);
  lastShared.delete(userId);
  publish("presence", "remove", [userId]);
}

export function getPlayerPosition(userId: string) {
  const position = positions.get(userId);
  if (!position || Date.now() - position.updatedAt > 15_000) return null;
  return position;
}

export function isNear(userId: string, point: readonly [number, number], radius: number, location = "street") {
  const position = getPlayerPosition(userId);
  return Boolean(
    position &&
      position.location === location &&
      Math.hypot(position.x - point[0], position.z - point[1]) <= radius,
  );
}

const resetUsers = new Set<string>();

/** Live sessions must not write their stale in-memory position back over a progress reset. */
export function markProgressReset(userId: string) {
  resetUsers.add(userId);
  publish("presence", "reset", [userId]);
}

export function wasProgressReset(userId: string) {
  return resetUsers.has(userId);
}

export function clearProgressReset(userId: string) {
  resetUsers.delete(userId);
  publish("presence", "clearReset", [userId]);
}

onRemote("presence", (event, args, origin) => {
  const userId = String(args[0]);
  if (event === "set") {
    const [, x, z, location] = args as [string, number, number, string];
    positions.set(userId, { x, z, location, updatedAt: Date.now(), origin });
  } else if (event === "remove") {
    // A late removal from the process the player just left must not erase where they are now.
    if (positions.get(userId)?.origin === origin) positions.delete(userId);
  }
  else if (event === "reset") resetUsers.add(userId);
  else if (event === "clearReset") resetUsers.delete(userId);
});
