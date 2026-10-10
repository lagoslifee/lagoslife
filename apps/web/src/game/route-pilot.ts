import type { Vec2 } from "@lagos-living/shared";
import type { CarController } from "./car-controller";

/** Pure-pursuit driver along a road route, with three-point-turn recovery when wedged. */
export class RoutePilot {
  private index = 0;
  private stuckSince: number | null = null;
  private recovery: { until: number; swerveUntil: number; side: number } | null = null;
  private recoveries = 0;
  readonly deadline: number;

  constructor(readonly path: Vec2[], now: number, cruise = 9) {
    let metres = 0;
    for (let index = 1; index < path.length; index += 1) metres += Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1]);
    this.deadline = now + 45_000 + (metres / Math.max(2, cruise * 0.45)) * 1_000;
    this.cruise = cruise;
  }

  private cruise: number;

  /** Returns throttle and steer, "done" at the end of the route or "failed" past the deadline or after repeated wedging. */
  step(car: CarController, now: number): [number, number] | "done" | "failed" {
    if (now > this.deadline || this.recoveries > 8) return "failed";
    if (this.index >= this.path.length) return "done";
    let target = this.path[this.index]!;
    while (Math.hypot(target[0] - car.x, target[1] - car.z) < (this.index === this.path.length - 1 ? 3 : 6)) {
      this.index += 1;
      if (this.index >= this.path.length) return "done";
      target = this.path[this.index]!;
    }
    const last = this.index === this.path.length - 1;
    let delta = Math.atan2(target[0] - car.x, target[1] - car.z) - car.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const recovery = this.recovery;
    if (recovery && now < recovery.until) return [-0.7, recovery.side];
    if (recovery && now < recovery.swerveUntil) return [car.speed < 3 ? 0.7 : 0, -recovery.side];
    this.recovery = null;
    if (Math.abs(car.speed) > 0.6) this.stuckSince = null;
    else if (this.stuckSince === null) this.stuckSince = now;
    else if (now - this.stuckSince > 1200) {
      const side = (this.recoveries % 2 === 0 ? 1 : -1) * (delta >= 0 ? -1 : 1);
      this.recoveries += 1;
      this.stuckSince = null;
      this.recovery = { until: now + 1800, swerveUntil: now + 3000, side };
    }
    const remaining = Math.hypot(target[0] - car.x, target[1] - car.z);
    const cruise = Math.abs(delta) > 0.6 ? 4 : last ? Math.min(this.cruise * 0.8, 1.5 + remaining * 0.5) : this.cruise;
    const throttle = car.speed < cruise ? 0.8 : car.speed > cruise + 1.5 ? -0.6 : 0;
    return [throttle, Math.max(-1, Math.min(1, delta * 2.2))];
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
