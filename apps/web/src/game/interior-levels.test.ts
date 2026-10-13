import { HOME_LAYOUTS } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { climb, levelHeight, type Level, type Upstairs } from "./interior";

const walks = HOME_LAYOUTS.mansion.upper!.walks.map((area) => ({ x0: area.x - area.hx, x1: area.x + area.hx, z0: area.z - area.hz, z1: area.z + area.hz }));
const upstairs: Upstairs = { stair: { x0: -2, x1: 2, z0: 9.2, z1: 15.6 }, deck: { z0: 15.6, y: 3.6 }, walks };

/** Walks a resident in a straight line, as the controller would each frame. */
function walk(from: [number, number], to: [number, number], level: Level, steps = 120) {
  let [x, z] = from;
  let at = level;
  for (let i = 1; i <= steps; i += 1) {
    const target: [number, number] = [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps];
    const step = climb(at, upstairs, target[0], target[1], 0.3, [x, z]);
    at = step.level;
    [x, z] = step.point ?? target;
  }
  return { level: at, x, z, height: levelHeight(at, upstairs, z) };
}

/** Walks through a list of points, carrying the position and floor from one leg to the next. */
function route(points: Array<[number, number]>, level: Level) {
  let at = { level, x: points[0]![0], z: points[0]![1], height: 0 };
  for (const point of points.slice(1)) at = walk([at.x, at.z], point, at.level);
  return at;
}

describe("mansion stairs and upstairs rooms", () => {
  it("walks up the stairs onto the landing, rising with the steps", () => {
    const halfway = walk([0, 7], [0, 12.4], "ground");
    expect(halfway.level).toBe("stairs");
    expect(halfway.height).toBeGreaterThan(1.5);
    expect(halfway.height).toBeLessThan(2.1);
    const top = walk([0, 12.4], [0, 17.5], "stairs");
    expect(top).toMatchObject({ level: "upper", height: 3.63 });
  });

  it("keeps residents on the landing behind the balustrade, but lets them back down the stairs", () => {
    const edge = walk([-2, 18], [-2, 12], "upper");
    expect(edge.level).toBe("upper");
    expect(edge.z).toBeCloseTo(15.9, 5);
    const down = walk([0, 17], [0, 7], "upper");
    expect(down).toMatchObject({ level: "ground", height: 0.02 });
  });

  it("goes through the doorway into the bedroom suite and stays inside its walls", () => {
    const inside = route([[0, 7], [0, 17.4], [8, 17.4]], "ground");
    expect(inside).toMatchObject({ level: "upper", height: 3.63 });
    expect(inside.x).toBeCloseTo(8, 5);
    // The suite's front wall over the hall stops you walking off the edge.
    const front = walk([inside.x, inside.z], [8, 4], "upper");
    expect(front.z).toBeCloseTo(9.65, 5);
    // The landing wall beside the doorway is solid.
    const blocked = walk([0, 19], [8, 19], "upper");
    expect(blocked.x).toBeLessThan(2.2);
    const study = route([[0, 17.4], [-8, 17.4]], "upper");
    expect(study.x).toBeCloseTo(-8, 5);
  });

  it("does not lift residents walking under the suites or beside the stairs", () => {
    expect(walk([-8, 12], [-8, 18], "ground")).toMatchObject({ level: "ground", height: 0.02 });
    expect(walk([6, 10], [3, 12], "ground").level).toBe("ground");
  });
});
