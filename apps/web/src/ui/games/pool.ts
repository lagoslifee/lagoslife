/**
 * Simplified eight-ball on a 2:1 table in table units (the cloth is W × H). Ball 0 is the cue ball, 1–7 solids,
 * 8 the black, 9–15 stripes. Fouls (potting the cue ball, or hitting the other group first) give the opponent the
 * cue ball back on the head spot rather than full ball-in-hand.
 */
export const W = 200;
export const H = 100;
export const R = 2.6;
const POCKET_R = 5.2;
const FRICTION = 0.988;
const CUSHION = 0.82;
const STOP = 0.02;
export const POCKETS: Array<[number, number]> = [[0, 0], [W / 2, -1.5], [W, 0], [0, H], [W / 2, H + 1.5], [W, H]];
const HEAD: [number, number] = [W * 0.25, H / 2];

export type Ball = { id: number; x: number; y: number; vx: number; vy: number; potted: boolean };
export type Group = "solids" | "stripes";
export type Side = 0 | 1;
export type PoolState = {
  balls: Ball[];
  turn: Side;
  groups: [Group | null, Group | null];
  winner: Side | null;
  log: string;
};
export type ShotResult = { firstHit: number | null; potted: number[] };

export const groupOf = (id: number): Group | "eight" | "cue" => (id === 0 ? "cue" : id === 8 ? "eight" : id < 8 ? "solids" : "stripes");

export function rack(): PoolState {
  const balls: Ball[] = [{ id: 0, x: HEAD[0], y: HEAD[1], vx: 0, vy: 0, potted: false }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let n = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let k = 0; k <= row; k += 1) {
      const id = order[n++]!;
      balls.push({ id, x: W * 0.72 + row * R * 1.75, y: H / 2 + (k - row / 2) * R * 2.02, vx: 0, vy: 0, potted: false });
    }
  }
  return { balls, turn: 0, groups: [null, null], winner: null, log: "Break! Tap the table to aim, set the power, then shoot." };
}

export const moving = (state: PoolState) => state.balls.some((ball) => !ball.potted && (Math.abs(ball.vx) > STOP || Math.abs(ball.vy) > STOP));

export function strike(state: PoolState, angle: number, power: number) {
  const cue = state.balls[0]!;
  const speed = 1.2 + Math.max(0, Math.min(1, power)) * 6.5;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
}

/** Advances one frame, in enough sub-steps that no ball moves more than a fifth of its radius per sub-step. */
export function step(state: PoolState, result: ShotResult) {
  const live = state.balls.filter((ball) => !ball.potted);
  const fastest = Math.max(...live.map((ball) => Math.hypot(ball.vx, ball.vy)), 0);
  const subs = Math.max(2, Math.ceil(fastest / (R * 0.2)));
  for (let sub = 0; sub < subs; sub += 1) {
    for (const ball of live) {
      if (ball.potted) continue;
      ball.x += ball.vx / subs;
      ball.y += ball.vy / subs;
      if (POCKETS.some(([px, py]) => Math.hypot(ball.x - px, ball.y - py) < POCKET_R)) {
        ball.potted = true;
        ball.vx = ball.vy = 0;
        result.potted.push(ball.id);
        continue;
      }
      if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx) * CUSHION; }
      if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx) * CUSHION; }
      if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy) * CUSHION; }
      if (ball.y > H - R) { ball.y = H - R; ball.vy = -Math.abs(ball.vy) * CUSHION; }
    }
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const a = live[i]!;
        const b = live[j]!;
        if (a.potted || b.potted) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= R * 2 || distance === 0) continue;
        const wx = (b.vx - a.vx) / subs;
        const wy = (b.vy - a.vy) / subs;
        const ww = wx * wx + wy * wy;
        const pw = dx * wx + dy * wy;
        // Rewind the pair to the instant they touched so the contact normal is exact, not the overlapped one.
        let back = 0;
        if (pw < 0 && ww > 0) back = Math.min(1, (pw + Math.sqrt(Math.max(0, pw * pw - ww * (distance * distance - 4 * R * R)))) / ww);
        if (back > 0) {
          a.x -= (a.vx / subs) * back;
          a.y -= (a.vy / subs) * back;
          b.x -= (b.vx / subs) * back;
          b.y -= (b.vy / subs) * back;
          dx = b.x - a.x;
          dy = b.y - a.y;
          distance = Math.hypot(dx, dy) || R * 2;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = Math.max(0, R * 2 - distance);
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing > 0) {
          const impulse = closing * 0.96;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
        if (back > 0) {
          a.x += (a.vx / subs) * back;
          a.y += (a.vy / subs) * back;
          b.x += (b.vx / subs) * back;
          b.y += (b.vy / subs) * back;
        }
        if (closing <= 0) continue;
        if (result.firstHit === null && (a.id === 0 || b.id === 0)) result.firstHit = a.id === 0 ? b.id : a.id;
      }
    }
  }
  for (const ball of live) {
    ball.vx *= FRICTION;
    ball.vy *= FRICTION;
    if (Math.hypot(ball.vx, ball.vy) < STOP) ball.vx = ball.vy = 0;
  }
}

const left = (state: PoolState, group: Group) => state.balls.filter((ball) => !ball.potted && groupOf(ball.id) === group).length;
export const target = (state: PoolState, side: Side): Group | "eight" | "open" => {
  const group = state.groups[side];
  if (!group) return "open";
  return left(state, group) === 0 ? "eight" : group;
};

/** Applies the rules once every ball has stopped. */
export function settle(state: PoolState, result: ShotResult, names: [string, string]): PoolState {
  const side = state.turn;
  const other: Side = side === 0 ? 1 : 0;
  const wanted = target(state, side);
  const scratch = result.potted.includes(0);
  const firstGroup = result.firstHit === null ? null : groupOf(result.firstHit);
  const wrongFirst = result.firstHit === null || (wanted === "open" ? firstGroup === "eight" : firstGroup !== wanted);
  const foul = scratch || wrongFirst;
  const groups: PoolState["groups"] = [...state.groups];
  if (result.potted.includes(8)) {
    const legal = wanted === "eight" && !foul;
    return { ...state, groups, winner: legal ? side : other, log: legal ? `${names[side]} sank the black — ${names[side]} wins!` : `${names[side]} lost the black early — ${names[other]} wins.` };
  }
  const object = result.potted.filter((id) => id !== 0);
  if (!groups[side] && !foul && object.length) {
    const first = groupOf(object[0]!) as Group;
    groups[side] = first;
    groups[other] = first === "solids" ? "stripes" : "solids";
  }
  const mine = groups[side];
  const scored = !foul && mine !== null && object.some((id) => groupOf(id) === mine);
  if (scratch) {
    const cue = state.balls[0]!;
    Object.assign(cue, { x: HEAD[0], y: HEAD[1], vx: 0, vy: 0, potted: false });
    const blocked = state.balls.some((ball) => ball.id !== 0 && !ball.potted && Math.hypot(ball.x - cue.x, ball.y - cue.y) < R * 2.2);
    if (blocked) cue.y += R * 3;
  }
  const why = scratch ? "potted the cue ball" : result.firstHit === null ? "missed every ball" : "hit the wrong ball first";
  const log = foul
    ? `Foul: ${names[side]} ${why}. ${names[other]} to play.`
    : scored
      ? `${names[side]} potted ${object.length > 1 ? `${object.length} balls` : "one"}${groups[side] && !state.groups[side] ? ` and takes ${groups[side]}` : ""} — shoot again.`
      : `${names[other]} to play.`;
  return { ...state, groups, turn: scored ? side : other, log };
}

/** Clear straight line from `from` to `to` for a ball of radius R, ignoring the listed balls. */
function clear(state: PoolState, from: [number, number], to: [number, number], ignore: number[]) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return state.balls.every((ball) => {
    if (ball.potted || ignore.includes(ball.id)) return true;
    const t = Math.max(0, Math.min(1, ((ball.x - from[0]) * dx + (ball.y - from[1]) * dy) / (length * length)));
    return Math.hypot(from[0] + dx * t - ball.x, from[1] + dy * t - ball.y) > R * 2.05;
  });
}

/** The computer's shot: the easiest pot it can see (ghost-ball aiming with a little human error), else a safe tap. */
export function computerShot(state: PoolState, random: () => number = Math.random) {
  const cue = state.balls[0]!;
  const wanted = target(state, state.turn);
  const candidates = state.balls.filter((ball) => !ball.potted && ball.id !== 0 && (wanted === "open" ? ball.id !== 8 : groupOf(ball.id) === wanted));
  let best: { angle: number; power: number; score: number } | null = null;
  for (const ball of candidates) {
    for (const [px, py] of POCKETS) {
      const toPocket = Math.hypot(px - ball.x, py - ball.y);
      const ux = (px - ball.x) / toPocket;
      const uy = (py - ball.y) / toPocket;
      const ghost: [number, number] = [ball.x - ux * R * 2, ball.y - uy * R * 2];
      const toGhost = Math.hypot(ghost[0] - cue.x, ghost[1] - cue.y);
      const ax = (ghost[0] - cue.x) / toGhost;
      const ay = (ghost[1] - cue.y) / toGhost;
      const cut = Math.acos(Math.max(-1, Math.min(1, ax * ux + ay * uy)));
      if (cut > 1.2) continue;
      if (!clear(state, [cue.x, cue.y], ghost, [0, ball.id]) || !clear(state, [ball.x, ball.y], [px, py], [ball.id])) continue;
      const score = cut * 60 + toGhost * 0.15 + toPocket * 0.1;
      if (!best || score < best.score) best = { angle: Math.atan2(ay, ax), power: Math.min(1, 0.25 + (toGhost + toPocket) / 260 + cut * 0.2), score };
    }
  }
  if (best) return { angle: best.angle + (random() - 0.5) * 0.045, power: best.power };
  const nearest = candidates.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
  if (!nearest) return { angle: random() * Math.PI * 2, power: 0.4 };
  return { angle: Math.atan2(nearest.y - cue.y, nearest.x - cue.x) + (random() - 0.5) * 0.05, power: 0.45 };
}
