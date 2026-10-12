import { describe, expect, it } from "vitest";
import { R, computerShot, moving, rack, settle, step, strike, type PoolState, type ShotResult } from "./pool";

const run = (state: PoolState) => {
  const result: ShotResult = { firstHit: null, potted: [] };
  for (let frame = 0; frame < 5000 && (frame === 0 || moving(state)); frame += 1) step(state, result);
  return result;
};
const only = (balls: Array<[number, number, number]>): PoolState => ({
  ...rack(),
  balls: [0, ...Array.from({ length: 15 }, (_, i) => i + 1)].map((id) => {
    const spot = balls.find(([bid]) => bid === id);
    return { id, x: spot?.[1] ?? 0, y: spot?.[2] ?? 0, vx: 0, vy: 0, potted: !spot };
  }),
});

describe("pool", () => {
  it("breaks the rack and every ball comes to rest", () => {
    const state = rack();
    strike(state, 0, 1);
    const result = run(state);
    expect(result.firstHit).not.toBeNull();
    expect(moving(state)).toBe(false);
    for (const ball of state.balls.filter((b) => !b.potted)) {
      expect(ball.x).toBeGreaterThanOrEqual(R - 0.01);
      expect(ball.y).toBeGreaterThanOrEqual(R - 0.01);
    }
  });

  it("assigns groups on the first legal pot and lets the shooter continue", () => {
    const state = only([[0, 150, 50], [3, 190, 50], [9, 100, 20]]);
    const next = settle(state, { firstHit: 3, potted: [3] }, ["You", "CPU"]);
    expect(next.groups).toEqual(["solids", "stripes"]);
    expect(next.turn).toBe(0);
  });

  it("a scratch is a foul: the other side plays from the head spot", () => {
    const state = only([[0, 150, 50], [3, 190, 50]]);
    state.balls[0]!.potted = true;
    const next = settle(state, { firstHit: 3, potted: [0] }, ["You", "CPU"]);
    expect(next.turn).toBe(1);
    expect(next.balls[0]!.potted).toBe(false);
  });

  it("potting the black before clearing your group loses", () => {
    const state = { ...only([[0, 150, 50], [3, 120, 50], [8, 190, 50]]), groups: ["solids", "stripes"] as PoolState["groups"] };
    expect(settle(state, { firstHit: 8, potted: [8] }, ["You", "CPU"]).winner).toBe(1);
  });

  it("the computer pots a straight-in ball", () => {
    const state = only([[0, 100, 60], [5, 160, 60], [8, 30, 20]]);
    state.turn = 1;
    state.groups = ["stripes", "solids"];
    const shot = computerShot(state, () => 0.5);
    strike(state, shot.angle, shot.power);
    const result = run(state);
    expect(result.firstHit).toBe(5);
    expect(result.potted).toContain(5);
  });
});
