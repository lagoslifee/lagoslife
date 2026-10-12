import { describe, expect, it } from "vitest";
import { RoadNavigator } from "./roads.js";
import type { Vec2 } from "./world.js";

describe("RoadNavigator.plan", () => {
  // A long street with junctions only at its ends, beside a parallel street whose corner is closer to the start.
  const nav = new RoadNavigator([
    { name: "Long Street", points: [[0, 0], [0, 200]] },
    { name: "Side Road", points: [[15, 100], [15, 300]] },
  ]);

  it("joins and leaves at the nearest point on a road instead of cutting across to the nearest junction", () => {
    const plan = nav.plan([1, 100], [1, 190]);
    expect(plan.reachable).toBe(true);
    const onRoad = plan.points.slice(1, -1).every((point: Vec2) => Math.abs(point[0]) < 0.01);
    expect(onRoad).toBe(true);
    expect(plan.metres).toBeCloseTo(92, 0);
    expect(plan.names[1]).toBe("Long Street");
  });

  it("routes along the graph between different streets", () => {
    const linked = new RoadNavigator([
      { name: "A Street", points: [[0, 0], [0, 100]] },
      { name: "B Road", points: [[0, 100], [80, 100]] },
    ]);
    const plan = linked.plan([0, 40], [50, 100]);
    expect(plan.reachable).toBe(true);
    expect(plan.points).toContainEqual([0, 100]);
    expect(plan.metres).toBeCloseTo(110, 0);
  });

  it("arrives by the door's own street when given its kerb, even if another road is nearer the door", () => {
    // Front Street runs past the door's kerb at x = 0; Back Lane passes just behind the house at x = 12.
    const block = new RoadNavigator([
      { name: "Front Street", points: [[0, 0], [0, 100]] },
      { name: "Top Road", points: [[0, 100], [12, 100]] },
      { name: "Back Lane", points: [[12, 100], [12, 0]] },
    ]);
    const door: Vec2 = [10, 30];
    const kerb: Vec2 = [1, 30];
    expect(block.plan([0, 5], door).names).toContain("Top Road");
    const plan = block.plan([0, 5], door, kerb);
    expect(plan.names).not.toContain("Top Road");
    expect(plan.points.at(-2)).toEqual(kerb);
    expect(plan.points.at(-1)).toEqual(door);
    expect(plan.metres).toBeCloseTo(35, 0);
  });

  it("reports unreachable when the streets are not joined", () => {
    expect(nav.plan([0, 50], [15, 250]).reachable).toBe(false);
  });
});
