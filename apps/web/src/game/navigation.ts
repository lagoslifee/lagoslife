import type { Vec2 } from "@lagos-living/shared";

export type RoutePlan = { points: Vec2[]; names: Array<string | null>; reachable: boolean; gap: number; metres: number };
export type Turn = "left" | "right" | "slight-left" | "slight-right" | "u-turn" | "straight" | "arrive";
export type Guidance = {
  turn: Turn;
  /** Metres to the next manoeuvre (or to the destination when arriving). */
  distance: number;
  /** Street after the manoeuvre, when known. */
  street: string | null;
  remaining: number;
  /** Metres from the route line; large values mean a missed turn. */
  offRoute: number;
};

const SAMPLE = 5;

/** Even 5 m samples along the route, each with the street of the leg it lies on. */
function resample(plan: RoutePlan) {
  const samples: Array<{ point: Vec2; street: string | null; along: number }> = [];
  let along = 0;
  let carry = 0;
  for (let index = 1; index < plan.points.length; index += 1) {
    const [ax, az] = plan.points[index - 1]!;
    const [bx, bz] = plan.points[index]!;
    const length = Math.hypot(bx - ax, bz - az);
    let t = carry;
    while (t <= length) {
      const u = length > 0 ? t / length : 0;
      samples.push({ point: [ax + (bx - ax) * u, az + (bz - az) * u], street: plan.names[index - 1] ?? null, along: along + t });
      t += SAMPLE;
    }
    carry = t - length;
    along += length;
  }
  const last = plan.points[plan.points.length - 1]!;
  samples.push({ point: last, street: null, along });
  return samples;
}

function heading(a: Vec2, b: Vec2) {
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}

/** Next-turn guidance for a walker or driver at `position` following `plan`. */
export function guide(plan: RoutePlan, position: Vec2): Guidance | null {
  if (plan.points.length < 2) return null;
  const samples = resample(plan);
  let nearest = 0;
  let offRoute = Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    const [x, z] = samples[index]!.point;
    const distance = Math.hypot(x - position[0], z - position[1]);
    if (distance < offRoute) {
      offRoute = distance;
      nearest = index;
    }
  }
  const here = samples[nearest]!.along;
  const remaining = Math.max(0, samples[samples.length - 1]!.along - here);
  const span = 3;
  for (let index = nearest + 1; index < samples.length - span; index += 1) {
    if (index - span < 0) continue;
    const before = heading(samples[index - span]!.point, samples[index]!.point);
    const after = heading(samples[index]!.point, samples[index + span]!.point);
    let delta = after - before;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const size = Math.abs(delta);
    if (size < 0.5) continue;
    // The bend is first noticed on its approach; the sharpest sample nearby is the actual corner.
    let apex = index;
    let sharpest = delta;
    for (let probe = index + 1; probe < Math.min(samples.length - span, index + span * 2); probe += 1) {
      let change = heading(samples[probe]!.point, samples[probe + span]!.point) - heading(samples[probe - span]!.point, samples[probe]!.point);
      change = Math.atan2(Math.sin(change), Math.cos(change));
      if (Math.abs(change) > Math.abs(sharpest)) {
        sharpest = change;
        apex = probe;
      }
    }
    const angle = Math.abs(sharpest);
    // Yaw grows clockwise seen from above, so a positive change is a right turn.
    const turn: Turn = angle > 2.5 ? "u-turn" : angle < 0.85 ? (sharpest > 0 ? "slight-right" : "slight-left") : sharpest > 0 ? "right" : "left";
    return { turn, distance: samples[apex]!.along - here, street: samples[apex + 1]?.street ?? samples[apex]!.street, remaining, offRoute };
  }
  return { turn: "arrive", distance: remaining, street: null, remaining, offRoute };
}

export const turnArrow: Record<Turn, string> = {
  left: "↰",
  right: "↱",
  "slight-left": "↖",
  "slight-right": "↗",
  "u-turn": "↶",
  straight: "↑",
  arrive: "◎",
};

export function describeTurn(guidance: Guidance) {
  const where = guidance.street ? ` onto ${guidance.street}` : "";
  switch (guidance.turn) {
    case "arrive":
      return "Arrive at your destination";
    case "u-turn":
      return `Make a U-turn${where}`;
    case "slight-left":
      return `Bear left${where}`;
    case "slight-right":
      return `Bear right${where}`;
    case "straight":
      return `Continue${where}`;
    default:
      return `Turn ${guidance.turn}${where}`;
  }
}
