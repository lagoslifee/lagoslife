import { describe, expect, it } from "vitest";
import { guide, type RoutePlan } from "./navigation";

const plan = (points: Array<[number, number]>, names: Array<string | null>): RoutePlan => ({ points, names, reachable: true, gap: 0, metres: 0 });

describe("guide", () => {
  // North along A Street for 100 m, then east (right, seen facing +z) along B Road.
  const route = plan([[0, 0], [0, 100], [80, 100]], ["A Street", "B Road", null]);

  it("announces the next turn with its distance and street", () => {
    const next = guide(route, [0, 20])!;
    expect(next.turn).toBe("right");
    expect(next.street).toBe("B Road");
    expect(next.distance).toBeGreaterThan(70);
    expect(next.distance).toBeLessThan(90);
    expect(next.offRoute).toBeLessThan(3);
  });

  it("detects left turns", () => {
    const left = guide(plan([[0, 0], [0, 100], [-80, 100]], ["A Street", "C Close", null]), [0, 10])!;
    expect(left.turn).toBe("left");
  });

  it("switches to arrival after the last turn and measures how far off route the player is", () => {
    expect(guide(route, [50, 100])!.turn).toBe("arrive");
    expect(guide(route, [30, 40])!.offRoute).toBeGreaterThan(25);
  });
});
