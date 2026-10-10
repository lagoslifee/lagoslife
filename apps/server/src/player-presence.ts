type Presence = { x: number; z: number; location: string; updatedAt: number };

const positions = new Map<string, Presence>();

export function setPlayerPosition(userId: string, x: number, z: number, location = "street") {
  positions.set(userId, { x, z, location, updatedAt: Date.now() });
}

export function removePlayerPosition(userId: string) {
  positions.delete(userId);
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
}

export function wasProgressReset(userId: string) {
  return resetUsers.has(userId);
}

export function clearProgressReset(userId: string) {
  resetUsers.delete(userId);
}
