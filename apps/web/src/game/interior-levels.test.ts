import { describe, expect, it } from "vitest";
import { climb, levelHeight, type Level, type Upstairs } from "./interior";

const upstairs: Upstairs = { stair: { x0: -2, x1: 2, z0: 9.2, z1: 15.6 }, deck: { z0: 15.6, y: 3.6 } };
const room = { minX: -13, maxX: 13, maxZ: 19.2 };

/** Walks a resident in a straight line, as the controller would each frame. */
function walk(from: [number, number], to: [number, number], level: Level, steps = 120) {
  let [x, z] = from;
  let at = level;
  for (let i = 1; i <= steps; i += 1) {
    const target: [number, number] = [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps];
    const step = climb(at, upstairs, room, target[0], target[1], 0.3);
    at = step.level;
    [x, z] = step.point ?? target;
  }
  return { level: at, x, z, height: levelHeight(at, upstairs, z) };
}

describe("mansion stairs and gallery", () => {
  it("walks up the stairs onto the gallery, rising with the steps", () => {
    const halfway = walk([0, 7], [0, 12.4], "ground");
    expect(halfway.level).toBe("stairs");
    expect(halfway.height).toBeGreaterThan(1.5);
    expect(halfway.height).toBeLessThan(2.1);
    const top = walk([0, 12.4], [0, 17.5], "stairs");
    expect(top).toMatchObject({ level: "upper", height: 3.63 });
  });

  it("keeps residents on the gallery behind the balustrade, but lets them back down the stairs", () => {
    const edge = walk([-8, 18], [-8, 12], "upper");
    expect(edge.level).toBe("upper");
    expect(edge.z).toBeCloseTo(15.9, 5);
    const down = walk([0, 17], [0, 7], "upper");
    expect(down).toMatchObject({ level: "ground", height: 0.02 });
  });

  it("does not lift residents walking under the gallery or beside the stairs", () => {
    expect(walk([-8, 12], [-8, 18], "ground")).toMatchObject({ level: "ground", height: 0.02 });
    expect(walk([6, 10], [3, 12], "ground").level).toBe("ground");
  });
});
