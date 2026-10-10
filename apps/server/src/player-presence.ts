type Position = { x: number; z: number; updatedAt: number };

const positions = new Map<string, Position>();

export function setPlayerPosition(userId: string, x: number, z: number) {
  positions.set(userId, { x, z, updatedAt: Date.now() });
}

export function removePlayerPosition(userId: string) {
  positions.delete(userId);
}

export function getPlayerPosition(userId: string) {
  const position = positions.get(userId);
  if (!position || Date.now() - position.updatedAt > 15_000) return null;
  return position;
}
