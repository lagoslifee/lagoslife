import { describe, expect, it } from "vitest";
import { FOOTBALL, fromPitch, pitchDirection, restingBall, STREET_PITCHES, stepBall, toPitch } from "./street-football.js";
import { walkable } from "./world.js";

const pitch = STREET_PITCHES[0]!;

describe("street football", () => {
  it("maps between the world and pitch space both ways", () => {
    const [x, z] = fromPitch(pitch, 12, -5);
    const back = toPitch(pitch, x, z);
    expect(back.along).toBeCloseTo(12);
    expect(back.across).toBeCloseTo(-5);
    expect(pitchDirection(pitch, pitch.yaw).along).toBeCloseTo(1);
  });

  it("marks every cage out on open ground", () => {
    for (const site of STREET_PITCHES) {
      for (const [along, across] of [[0, 0], [site.length / 2, 0], [-site.length / 2, 0], [0, site.width / 2], [0, -site.width / 2]] as const) {
        const [x, z] = fromPitch(site, along, across);
        expect(walkable(x, z, 0.5)).toBe(true);
      }
    }
  });

  it("scores between the posts and rebounds off the wall beside them", () => {
    const shot = { ...restingBall(), along: pitch.length / 2 - 2, va: 15 };
    let scored = null;
    for (let i = 0; i < 20 && !scored; i++) scored = stepBall(shot, pitch, 0.05);
    expect(scored).toBe("green");

    const wide = { ...restingBall(), along: pitch.length / 2 - 2, across: FOOTBALL.goalWidth, va: 15 };
    let missed = null;
    for (let i = 0; i < 20; i++) missed ??= stepBall(wide, pitch, 0.05);
    expect(missed).toBeNull();
    expect(wide.va).toBeLessThan(0);
  });

  it("rolls to a stop on the grass", () => {
    const pass = { ...restingBall(), va: FOOTBALL.passSpeed };
    for (let i = 0; i < 400; i++) stepBall(pass, pitch, 0.05);
    expect(pass.va).toBe(0);
    expect(Math.abs(pass.along)).toBeLessThan(pitch.length / 2);
  });
});
