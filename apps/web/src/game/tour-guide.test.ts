import { describe, expect, it, vi } from "vitest";
import type { Vec2 } from "@lagos-living/shared";
import { TourGuide, tourStops } from "./tour-guide";

function fakeFactory() {
  const position = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(position, { x, y, z }); } };
  const avatar = { root: { position, rotation: { y: 0 }, setEnabled: vi.fn() }, update: vi.fn(), dispose: vi.fn() };
  return { factory: { create: () => avatar } as never, avatar };
}

describe("TourGuide", () => {
  it("has a short walking route: every stop exists and they are close together", () => {
    const stops = tourStops();
    expect(stops.length).toBe(4);
    let walk = 0;
    for (let index = 1; index < stops.length; index += 1) walk += Math.hypot(stops[index]!.point[0] - stops[index - 1]!.point[0], stops[index]!.point[1] - stops[index - 1]!.point[1]);
    expect(walk).toBeLessThan(900);
  });

  it("leads the player through every stop, narrates each once, waits when they lag, then finishes", () => {
    const { factory, avatar } = fakeFactory();
    const said: string[] = [];
    const stops = tourStops();
    const guide = new TourGuide(factory, stops, stops[0]!.point, () => 0, () => [], (text) => said.push(text));
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const far: Vec2 = [stops[0]!.point[0] + 500, stops[0]!.point[1]];
    const before = { ...avatar.root.position };
    for (let frame = 0; frame < 60; frame += 1) guide.update(0.1, far, true);
    expect(Math.hypot(avatar.root.position.x - before.x, avatar.root.position.z - before.z)).toBeLessThan(1.5);
    for (let frame = 0; frame < 20_000 && !guide.done; frame += 1) {
      clock += 100;
      guide.update(0.1, [avatar.root.position.x, avatar.root.position.z], true);
    }
    expect(guide.done).toBe(true);
    expect(said).toHaveLength(stops.length);
    expect(said.at(-1)).toMatch(/Dubai International Airport/);
  });
});
