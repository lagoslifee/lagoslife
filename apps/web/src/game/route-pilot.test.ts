import { getVehicleModel, type Vec2 } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { CarController } from "./car-controller";
import { RoutePilot } from "./route-pilot";

const saloon = getVehicleModel("tokunbo-saloon");

/** Distance from a point to the nearest segment of a polyline. */
function offRoad(path: Vec2[], x: number, z: number) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    const [ax, az] = path[index - 1]!;
    const [bx, bz] = path[index]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

function drive(path: Vec2[], yaw = 0) {
  const car = new CarController(saloon);
  car.place(path[0]![0], path[0]![1], yaw);
  const pilot = new RoutePilot(path, 0, 30);
  let worst = 0;
  let result: ReturnType<RoutePilot["step"]> = [0, 0];
  const dt = 1 / 30;
  for (let t = 0; t < 120; t += dt) {
    result = pilot.step(car, t * 1_000);
    if (result === "done" || result === "failed") break;
    car.step(dt, { throttle: result[0], steer: result[1], handbrake: false }, 30, (x, z) => [x, z]);
    worst = Math.max(worst, offRoad(path, car.x, car.z));
  }
  return { result, worst, car };
}

describe("RoutePilot", () => {
  it("turns at a right-angle junction instead of cutting across the corner", () => {
    const path: Vec2[] = [[0, 0], [0, 200], [150, 200]];
    const { result, worst } = drive(path);
    expect(result).toBe("done");
    // A Lagos street is about 7 m wide, so the car stays within its half of the road.
    expect(worst).toBeLessThan(3.5);
  });

  it("follows a zig-zag of short blocks and stops at the end", () => {
    const path: Vec2[] = [[0, 0], [0, 60], [60, 60], [60, 120], [0, 120], [0, 180]];
    const { result, worst, car } = drive(path);
    expect(result).toBe("done");
    expect(worst).toBeLessThan(3.5);
    expect(Math.hypot(car.x - 0, car.z - 180)).toBeLessThan(6);
  });

  it("backs round when parked facing away from the route instead of swinging over the kerb", () => {
    const path: Vec2[] = [[0, 0], [0, 150]];
    const { result, worst } = drive(path, Math.PI);
    expect(result).toBe("done");
    expect(worst).toBeLessThan(4);
  });
});
