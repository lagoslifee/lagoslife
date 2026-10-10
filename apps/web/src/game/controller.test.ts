import { MOVEMENT } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { LocomotionController, type MoveMode } from "./controller";

/** Steps the controller the same way the engine does (120 Hz substeps inside each rendered frame). */
function timeToCover(distance: number, mode: MoveMode, fps: number) {
  const controller = new LocomotionController((x, z) => [x, z]);
  const frame = 1 / fps;
  let time = 0;
  while (controller.z < distance && time < 60) {
    const steps = Math.max(1, Math.ceil(frame / (1 / 120)));
    for (let step = 0; step < steps; step += 1) controller.step(frame / steps, [0, 1], 0, mode);
    time += frame;
  }
  return time;
}

describe("LocomotionController", () => {
  it.each([30, 60, 144])("covers 30 m at the target speeds independent of frame rate (%i fps)", (fps) => {
    const jog = timeToCover(30, "jog", fps);
    const sprint = timeToCover(30, "sprint", fps);
    const walk = timeToCover(30, "walk", fps);
    console.info(`30 m @ ${fps} fps → walk ${walk.toFixed(2)} s, jog ${jog.toFixed(2)} s, sprint ${sprint.toFixed(2)} s`);
    expect(jog).toBeGreaterThan(8.5);
    expect(jog).toBeLessThan(8.8);
    expect(sprint).toBeGreaterThan(4.95);
    expect(sprint).toBeLessThan(5.25);
    expect(walk).toBeGreaterThan(19.9);
    expect(walk).toBeLessThan(20.3);
  });

  it("reaches jog speed within a fifth of a second and stops within a fifth of a second", () => {
    const controller = new LocomotionController((x, z) => [x, z]);
    for (let index = 0; index < 24; index += 1) controller.step(1 / 120, [0, 1], 0, "jog");
    expect(controller.speed()).toBeCloseTo(MOVEMENT.jogSpeed, 2);
    for (let index = 0; index < 24; index += 1) controller.step(1 / 120, [0, 0], 0, "jog");
    expect(controller.speed()).toBeLessThan(0.01);
  });

  it("slides along walls instead of sticking", () => {
    const controller = new LocomotionController((x, z) => [Math.min(x, 1), z]);
    for (let index = 0; index < 240; index += 1) controller.step(1 / 120, [1, 1], 0, "jog");
    expect(controller.x).toBeCloseTo(1, 5);
    expect(controller.z).toBeGreaterThan(3);
  });
});
