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
      return turn < 0.12 ? cruise : Math.max(4.5, Math.min(cruise, 3.6 / turn));
    });
    const metres = this.along[this.along.length - 1] ?? 0;
    this.deadline = now + 45_000 + (metres / Math.max(2, cruise * 0.35)) * 1_000;
    this.cruise = cruise;
  }

  /** Returns throttle and steer, "done" at the end of the route or "failed" past the deadline or after repeated wedging. */
  step(car: CarController, now: number): [number, number] | "done" | "failed" {
    if (now > this.deadline || this.recoveries > 8) return "failed";
    if (this.index >= this.path.length) return "done";
    const speed = Math.abs(car.speed);
    const reach = Math.max(6, speed * 0.75);
    let target = this.path[this.index]!;
    while (Math.hypot(target[0] - car.x, target[1] - car.z) < (this.index === this.path.length - 1 ? 3 : reach)) {
      this.index += 1;
      if (this.index >= this.path.length) return "done";
      target = this.path[this.index]!;
    }
    let delta = Math.atan2(target[0] - car.x, target[1] - car.z) - car.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const recovery = this.recovery;
    if (recovery && now < recovery.until) return [-0.7, recovery.side];
    if (recovery && now < recovery.swerveUntil) return [car.speed < 3 ? 0.7 : 0, -recovery.side];
    this.recovery = null;
    if (speed > 0.6) this.stuckSince = null;
    else if (this.stuckSince === null) this.stuckSince = now;
    else if (now - this.stuckSince > 1200) {
      const side = (this.recoveries % 2 === 0 ? 1 : -1) * (delta >= 0 ? -1 : 1);
      this.recoveries += 1;
      this.stuckSince = null;
      this.recovery = { until: now + 1800, swerveUntil: now + 3000, side };
    }
    const limit = Math.abs(delta) > 0.7 ? 4 : this.speedLimit(car);
    const throttle = car.speed < limit - 0.6 ? 1 : car.speed > limit + 1.2 ? -Math.min(1, (car.speed - limit) / 4) : 0.15;
    const gain = speed > 14 ? 1.3 : speed > 8 ? 1.8 : 2.2;
    return [throttle, Math.max(-1, Math.min(1, delta * gain))];
  }

  /** Fastest speed that still lets the car slow for every corner, and the final stop, within braking distance. */
  private speedLimit(car: CarController) {
    const here = Math.max(0, this.along[Math.max(0, this.index - 1)]! + Math.hypot(car.x - this.path[Math.max(0, this.index - 1)]![0], car.z - this.path[Math.max(0, this.index - 1)]![1]));
    const total = this.along[this.along.length - 1]!;
    let limit = Math.min(this.cruise, Math.sqrt(2 * 3 * Math.max(0, total - here)) + 1);
    const horizon = (this.cruise * this.cruise) / (2 * BRAKING) + 12;
    for (let index = this.index; index < this.path.length - 1; index += 1) {
      const ahead = this.along[index]! - here;
      if (ahead > horizon) break;
      limit = Math.min(limit, Math.sqrt(this.cornerSpeeds[index]! ** 2 + 2 * BRAKING * Math.max(0, ahead)));
    }
    return limit;
  }

  /** Remaining route metres from the car's position, for ETAs. */
  remaining(car: CarController) {
    let metres = 0;
    let from: Vec2 = [car.x, car.z];
    for (let index = this.index; index < this.path.length; index += 1) {
      metres += Math.hypot(this.path[index]![0] - from[0], this.path[index]![1] - from[1]);
      from = this.path[index]!;
    }
    return metres;
  }
}
