import { MOVEMENT } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { LocomotionController, MAX_FRAME_DT, SUBSTEP_DT, type MoveMode } from "./controller";

/** Steps the controller the same way the engine does (120 Hz substeps inside each rendered frame). */
function timeToCover(distance: number, mode: MoveMode, fps: number) {
  const controller = new LocomotionController((x, z) => [x, z]);
  const frame = Math.min(MAX_FRAME_DT, 1 / fps);
  const wall = 1 / fps;
  let time = 0;
  while (controller.z < distance && time < 60) {
    const steps = Math.max(1, Math.ceil(frame / SUBSTEP_DT));
    for (let step = 0; step < steps; step += 1) controller.step(frame / steps, [0, 1], 0, mode);
    time += wall;
  }
  return time;
}

describe("LocomotionController", () => {
  it.each([2, 4, 10, 30, 60, 144])("covers 30 m at the target speeds independent of frame rate (%i fps)", (fps) => {
    const jog = timeToCover(30, "jog", fps);
    const sprint = timeToCover(30, "sprint", fps);
    const walk = timeToCover(30, "walk", fps);
    console.info(`30 m @ ${fps} fps → walk ${walk.toFixed(2)} s, jog ${jog.toFixed(2)} s, sprint ${sprint.toFixed(2)} s`);
    // Time is counted in whole frames, so slow frame rates may overshoot by up to one frame.
    const frame = 1 / fps;
    expect(jog).toBeGreaterThan(8.5);
    expect(jog).toBeLessThan(8.8 + frame);
    expect(sprint).toBeGreaterThan(4.95);
    expect(sprint).toBeLessThan(5.25 + frame);
    expect(walk).toBeGreaterThan(19.9);
    expect(walk).toBeLessThan(20.3 + frame);
  });

  it("reaches jog speed within a fifth of a second and stops within a fifth of a second", () => {
    const controller = new LocomotionController((x, z) => [x, z]);
    for (let index = 0; index < 24; index += 1) controller.step(1 / 120, [0, 1], 0, "jog");
    expect(controller.speed()).toBeCloseTo(MOVEMENT.jogSpeed, 2);
    for (let index = 0; index < 24; index += 1) controller.step(1 / 120, [0, 0], 0, "jog");
    expect(controller.speed()).toBeLessThan(0.01);
  });

  it("is not flung when squeezed between obstacles that push it out every substep", () => {
    // A parked car pushes the resident 0.34 m west, a wall pushes them back: the vehicles e2e hit this.
    let flip = false;
    const controller = new LocomotionController((x, z) => {
      flip = !flip;
      return [x + (flip ? -0.34 : 0.34), z];
    });
    let fastest = 0;
    for (let index = 0; index < 600; index += 1) {
      controller.step(1 / 120, [0, 1], 0, "sprint");
      fastest = Math.max(fastest, controller.speed());
    }
    expect(fastest).toBeLessThanOrEqual(MOVEMENT.sprintSpeed + 1e-6);
    expect(controller.z).toBeGreaterThan(20);
  });

  it("slides along walls instead of sticking", () => {
    const controller = new LocomotionController((x, z) => [Math.min(x, 1), z]);
    for (let index = 0; index < 240; index += 1) controller.step(1 / 120, [1, 1], 0, "jog");
    expect(controller.x).toBeCloseTo(1, 5);
    expect(controller.z).toBeGreaterThan(3);
  });
});
