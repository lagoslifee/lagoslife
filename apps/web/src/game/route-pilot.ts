import type { Vec2 } from "@lagos-living/shared";
import type { CarController } from "./car-controller";
import { offsetPolyline } from "./geometry";

/** Comfortable braking for a passenger car, m/s². */
const BRAKING = 4;

/**
 * Pure-pursuit driver along a road route, with three-point-turn recovery when wedged. It keeps to the right-hand lane,
 * speeds up to `cruise` on straights and brakes in time for the corners ahead.
 */
export class RoutePilot {
  readonly path: Vec2[];
  private index = 0;
  private stuckSince: number | null = null;
  private recovery: { until: number; swerveUntil: number; side: number } | null = null;
  private recoveries = 0;
  private reversing = false;
  private cornerSpeeds: number[];
  private along: number[];
  readonly deadline: number;
  private cruise: number;

  constructor(path: Vec2[], now: number, cruise = 9, lane = 0) {
    const kept = path.filter((point, index) => index === 0 || Math.hypot(point[0] - path[index - 1]![0], point[1] - path[index - 1]![1]) > 0.5);
    this.path = lane && kept.length > 1 ? [...offsetPolyline(kept.slice(0, -1), lane), kept[kept.length - 1]!] : kept;
    this.along = [0];
    for (let index = 1; index < this.path.length; index += 1) this.along.push(this.along[index - 1]! + Math.hypot(this.path[index]![0] - this.path[index - 1]![0], this.path[index]![1] - this.path[index - 1]![1]));
    this.cornerSpeeds = this.path.map((point, index) => {
      if (index === 0 || index === this.path.length - 1) return cruise;
      const a = this.path[index - 1]!;
      const b = this.path[index + 1]!;
      let turn = Math.atan2(b[0] - point[0], b[1] - point[1]) - Math.atan2(point[0] - a[0], point[1] - a[1]);
      turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
      // A 90° junction turn is taken at about 18 km/h, a gentle bend near cruising speed.
      return turn < 0.12 ? cruise : Math.max(3.5, Math.min(cruise, 3.1 / turn));
    });
    const metres = this.along[this.along.length - 1] ?? 0;
    this.deadline = now + 45_000 + (metres / Math.max(2, cruise * 0.35)) * 1_000;
    this.cruise = cruise;
  }

  /** Returns throttle and steer, "done" at the end of the route or "failed" past the deadline or after repeated wedging. */
  step(car: CarController, now: number): [number, number] | "done" | "failed" {
    if (now > this.deadline || this.recoveries > 8) return "failed";
    if (this.path.length < 2) return "done";
    const here = this.progress(car);
    const total = this.along[this.along.length - 1]!;
    if (total - here < 3) return "done";
    const speed = Math.abs(car.speed);
    // Chase a point a short way along the road, never the next corner node, so the car turns at junctions instead of
    // cutting across the inside of them.
    const target = this.pointAt(here + Math.max(4, Math.min(11, 3 + speed * 0.4)));
    let delta = Math.atan2(target[0] - car.x, target[1] - car.z) - car.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const recovery = this.recovery;
    if (recovery && now < recovery.until) return [-0.7, recovery.side];
    if (recovery && now < recovery.swerveUntil) return [car.speed < 3 ? 0.7 : 0, -recovery.side];
    this.recovery = null;
    // Facing away from the route: back round on opposite lock instead of a wide forward U-turn over the kerb.
    if (Math.abs(delta) > (this.reversing ? 1.1 : 2) && car.speed < 2.5) {
      this.reversing = true;
      this.stuckSince = null;
      return [car.speed > -2.5 ? -0.6 : 0, delta > 0 ? -1 : 1];
    }
    this.reversing = false;
    if (speed > 0.6) this.stuckSince = null;
    else if (this.stuckSince === null) this.stuckSince = now;
    else if (now - this.stuckSince > 1200) {
      const side = (this.recoveries % 2 === 0 ? 1 : -1) * (delta >= 0 ? -1 : 1);
      this.recoveries += 1;
      this.stuckSince = null;
      this.recovery = { until: now + 1800, swerveUntil: now + 3000, side };
    }
    const limit = Math.abs(delta) > 0.7 ? 4 : this.speedLimit(here);
    const throttle = car.speed < limit - 0.6 ? 1 : car.speed > limit + 1.2 ? -Math.min(1, (car.speed - limit) / 4) : 0.15;
    const gain = speed > 14 ? 1.3 : speed > 8 ? 1.8 : 2.2;
    return [throttle, Math.max(-1, Math.min(1, delta * gain))];
  }

  /** Metres along the route of the car's nearest point, searching forward from the last segment so it never goes back. */
  private progress(car: CarController) {
    let best = { index: this.index, s: this.along[this.index]!, distance: Infinity };
    for (let index = this.index; index < Math.min(this.path.length - 1, this.index + 10); index += 1) {
      const a = this.path[index]!;
      const b = this.path[index + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((car.x - a[0]) * dx + (car.z - a[1]) * dz) / (length * length)));
      const distance = Math.hypot(a[0] + dx * t - car.x, a[1] + dz * t - car.z);
      if (distance < best.distance - 0.01) best = { index, s: this.along[index]! + length * t, distance };
    }
    this.index = best.index;
    return best.s;
  }

  private pointAt(s: number): Vec2 {
    const total = this.along[this.along.length - 1]!;
    const clamped = Math.min(total, s);
    let index = this.index;
    while (index < this.path.length - 2 && this.along[index + 1]! < clamped) index += 1;
    const a = this.path[index]!;
    const b = this.path[index + 1]!;
    const length = this.along[index + 1]! - this.along[index]! || 1;
    const t = Math.max(0, Math.min(1, (clamped - this.along[index]!) / length));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** Fastest speed that still lets the car slow for every corner, and the final stop, within braking distance. */
  private speedLimit(here: number) {
    const total = this.along[this.along.length - 1]!;
    let limit = Math.min(this.cruise, Math.sqrt(2 * 3 * Math.max(0, total - here)) + 1);
    const horizon = (this.cruise * this.cruise) / (2 * BRAKING) + 12;
    for (let index = this.index + 1; index < this.path.length - 1; index += 1) {
      const ahead = this.along[index]! - here;
      if (ahead > horizon) break;
      limit = Math.min(limit, Math.sqrt(this.cornerSpeeds[index]! ** 2 + 2 * BRAKING * Math.max(0, ahead)));
    }
    return limit;
  }

  /** Remaining route metres from the car's position, for ETAs. */
  remaining(car: CarController) {
    if (this.path.length < 2) return 0;
    return Math.max(0, this.along[this.along.length - 1]! - this.progress(car));
  }
}
