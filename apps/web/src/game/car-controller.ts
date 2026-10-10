import type { VehicleModel } from "@lagos-living/shared";

export type CarInput = { throttle: number; steer: number; handbrake: boolean };
/** Pushes a circle out of whatever it overlaps and returns the corrected centre. */
export type CircleResolver = (x: number, z: number, radius: number) => [number, number];

const ROLLING_DRAG = 1.8;
const SLIDE_DRAG = 3;

/**
 * Arcade bicycle-model car. The body is three circles along its length so it
 * slides along walls instead of snagging, and it may always move out of an
 * overlap it started in (for example a car parked tight against a bollard).
 */
export class CarController {
  x = 0;
  z = 0;
  yaw = 0;
  /** Signed metres per second along the heading; negative is reverse. */
  speed = 0;
  steer = 0;

  constructor(public model: VehicleModel) {}

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.steer = 0;
  }

  private circles(x: number, z: number, yaw: number) {
    const reach = Math.max(0, this.model.length / 2 - this.model.width / 2);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const radius = (this.model.width / 2) * 0.95;
    return [
      { x: x + fx * reach, z: z + fz * reach, radius },
      { x, z, radius },
      { x: x - fx * reach, z: z - fz * reach, radius },
    ];
  }

  penetration(x: number, z: number, yaw: number, resolve: CircleResolver) {
    let total = 0;
    for (const circle of this.circles(x, z, yaw)) {
      const [rx, rz] = resolve(circle.x, circle.z, circle.radius);
      total += Math.hypot(rx - circle.x, rz - circle.z);
    }
    return total;
  }

  /** Advances the car; returns the speed of any impact this step (0 when none). */
  step(dt: number, input: CarInput, topSpeed: number, resolve: CircleResolver) {
    const model = this.model;
    const throttle = Math.max(-1, Math.min(1, input.throttle));
    let accel: number;
    let slowing = false;
    if (input.handbrake) {
      accel = -Math.sign(this.speed) * model.braking * 1.1;
      slowing = true;
    } else if (throttle > 0) {
      if (this.speed < -0.3) {
        accel = model.braking * throttle;
        slowing = true;
      } else accel = model.acceleration * throttle;
    } else if (throttle < 0) {
      if (this.speed > 0.3) {
        accel = model.braking * throttle;
        slowing = true;
      } else accel = model.acceleration * 0.7 * throttle;
    } else {
      accel = -Math.sign(this.speed) * ROLLING_DRAG;
      slowing = true;
    }
    let next = this.speed + accel * dt;
    if (slowing && Math.sign(next) !== Math.sign(this.speed)) next = 0;
    if (next > topSpeed) next = Math.max(topSpeed, this.speed - model.braking * 0.5 * dt);
    next = Math.max(-model.reverseSpeed, next);
    if (topSpeed <= 0) next = 0;
    this.speed = next;

    const steerLimit = model.maxSteer / (1 + Math.abs(this.speed) / 10);
    const targetSteer = Math.max(-1, Math.min(1, input.steer)) * steerLimit;
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 8);
    const yaw = this.yaw + ((this.speed * Math.tan(this.steer)) / model.wheelbase) * dt;

    const dx = Math.sin(yaw) * this.speed * dt;
    const dz = Math.cos(yaw) * this.speed * dt;
    const current = this.penetration(this.x, this.z, this.yaw, resolve);
    const allowed = (x: number, z: number, heading: number) => {
      const amount = this.penetration(x, z, heading, resolve);
      return amount < 0.01 || amount <= current + 0.001;
    };
    if (allowed(this.x + dx, this.z + dz, yaw)) {
      this.x += dx;
      this.z += dz;
      this.yaw = yaw;
      return 0;
    }
    const speed = Math.abs(this.speed);
    const along = [
      { x: this.x + dx, z: this.z, lost: Math.abs(Math.cos(yaw)) },
      { x: this.x, z: this.z + dz, lost: Math.abs(Math.sin(yaw)) },
    ].sort((a, b) => a.lost - b.lost);
    for (const slide of along) {
      if (slide.lost > 0.7 || !allowed(slide.x, slide.z, yaw)) continue;
      const mx = slide.x - this.x;
      const mz = slide.z - this.z;
      this.x = slide.x;
      this.z = slide.z;
      this.yaw = yaw;
      if (Math.hypot(mx, mz) > 1e-6) {
        let delta = Math.atan2(mx, mz) + (this.speed < 0 ? Math.PI : 0) - yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        this.yaw = yaw + delta * Math.min(1, dt * 5);
      }
      this.speed *= 1 - Math.min(1, dt * (1 + slide.lost * SLIDE_DRAG));
      return speed * slide.lost;
    }
    this.speed = -this.speed * 0.2;
    if (allowed(this.x, this.z, yaw)) this.yaw = yaw;
    return speed;
  }
}
