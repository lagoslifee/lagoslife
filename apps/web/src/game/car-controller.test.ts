import { getVehicleModel } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { CarController, type CircleResolver } from "./car-controller";

const saloon = getVehicleModel("tokunbo-saloon");
const open: CircleResolver = (x, z) => [x, z];
/** A wall along z = 30 (cars approach from z < 30). */
const wall: CircleResolver = (x, z, radius) => [x, Math.min(z, 30 - radius)];

function run(car: CarController, seconds: number, input: { throttle: number; steer: number; handbrake?: boolean }, resolve = open, fps = 60) {
  const dt = 1 / fps;
  let impact = 0;
  for (let t = 0; t < seconds; t += dt) {
    impact = Math.max(impact, car.step(dt, { handbrake: false, ...input }, saloon.topSpeed, resolve));
  }
  return impact;
}

describe("CarController", () => {
  it("reaches top speed in a few seconds and never exceeds it", () => {
    const car = new CarController(saloon);
    run(car, saloon.topSpeed / saloon.acceleration + 0.2, { throttle: 1, steer: 0 });
    expect(car.speed).toBeCloseTo(saloon.topSpeed, 5);
    run(car, 3, { throttle: 1, steer: 0 });
    expect(car.speed).toBeLessThanOrEqual(saloon.topSpeed);
    expect(car.z).toBeGreaterThan(40);
  });

  it("brakes to a stop without rolling backwards, then reverses slowly", () => {
    const car = new CarController(saloon);
    car.speed = 15;
    run(car, 15 / saloon.braking + 0.3, { throttle: -1, steer: 0 });
    expect(car.speed).toBeLessThanOrEqual(0);
    expect(car.speed).toBeGreaterThan(-1);
    run(car, 4, { throttle: -1, steer: 0 });
    expect(car.speed).toBeCloseTo(-saloon.reverseSpeed, 5);
  });

  it("coasts to a stop when no pedal is pressed", () => {
    const car = new CarController(saloon);
    car.speed = 6;
    run(car, 4, { throttle: 0, steer: 0 });
    expect(car.speed).toBe(0);
  });

  it("turns in a tight circle at parking speed and a wide one at speed", () => {
    const slow = new CarController(saloon);
    slow.speed = 3;
    run(slow, 1, { throttle: 0.2, steer: 1 });
    const fast = new CarController(saloon);
    fast.speed = 15;
    run(fast, 1, { throttle: 1, steer: 1 });
    const slowRate = slow.yaw / 1;
    const fastRadius = fast.speed / (fast.yaw / 1);
    expect(slow.speed / slowRate).toBeLessThan(8);
    expect(fastRadius).toBeGreaterThan(12);
  });

  it("is frame-rate independent within a few percent", () => {
    const a = new CarController(saloon);
    const b = new CarController(saloon);
    run(a, 3, { throttle: 1, steer: 0.3 }, open, 30);
    run(b, 3, { throttle: 1, steer: 0.3 }, open, 144);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1.5);
  });

  it("stops at a wall head-on and reports the impact speed", () => {
    const car = new CarController(saloon);
    car.place(0, 24, 0);
    car.speed = 12;
    const impact = run(car, 1, { throttle: 0, steer: 0 }, wall);
    expect(impact).toBeGreaterThan(10);
    expect(car.z + saloon.length / 2).toBeLessThanOrEqual(30.2);
    expect(car.speed).toBeLessThanOrEqual(0);
  });

  it("scrapes along a wall at a shallow angle instead of stopping dead", () => {
    const car = new CarController(saloon);
    car.place(0, 30 - saloon.width / 2 - 0.4, Math.PI / 2 - 0.25);
    car.speed = 10;
    const impact = run(car, 0.5, { throttle: 1, steer: 0 }, wall);
    expect(car.x).toBeGreaterThan(3);
    expect(impact).toBeLessThan(4);
  });

  it("can always drive out of an overlap it started in", () => {
    const car = new CarController(saloon);
    car.place(0, 29.5, Math.PI);
    run(car, 1.5, { throttle: 1, steer: 0 }, wall);
    expect(car.z).toBeLessThan(27);
  });
});
