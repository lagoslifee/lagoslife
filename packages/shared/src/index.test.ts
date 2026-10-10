import { describe, expect, it } from "vitest";
import {
  characterAppearanceSchema,
  defaultAppearance,
  getPlace,
  insideBuilding,
  positionUpdateSchema,
  resolveBuildingCollision,
  routeLength,
  sampleRoute,
  TRANSIT,
} from "./index";

describe("character appearance contract", () => {
  it("accepts the shared default", () => {
    expect(characterAppearanceSchema.parse(defaultAppearance)).toEqual(defaultAppearance);
  });

  it("rejects client-invented catalogue values", () => {
    expect(() =>
      characterAppearanceSchema.parse({ ...defaultAppearance, outfit: "admin-only" }),
    ).toThrow();
  });
});

describe("position contract", () => {
  it("strips client-invented fields such as balances", () => {
    const result = positionUpdateSchema.parse({
      sequence: 4,
      x: 10,
      z: 20,
      yaw: 0,
      motion: "jog",
      balance: 999_999,
    });
    expect(result).not.toHaveProperty("balance");
  });

  it("rejects unknown motion states and non-finite positions", () => {
    expect(() =>
      positionUpdateSchema.parse({ sequence: 1, x: 0, z: 0, yaw: 0, motion: "teleport" }),
    ).toThrow();
    expect(() =>
      positionUpdateSchema.parse({ sequence: 1, x: Number.NaN, z: 0, yaw: 0, motion: "idle" }),
    ).toThrow();
  });
});

describe("mapped Lekki world", () => {
  it("builds a closed danfo loop with ordered stops", () => {
    expect(routeLength()).toBeGreaterThan(1500);
    const positions = TRANSIT.stops.map((stop) => stop.s);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const start = sampleRoute(0);
    const wrapped = sampleRoute(routeLength());
    expect(Math.hypot(start.x - wrapped.x, start.z - wrapped.z)).toBeLessThan(0.01);
  });

  it("keeps doors outside footprints and pushes avatars out of walls", () => {
    for (const id of ["starter-home", "swift-parcel-hub", "mama-titi-buka"]) {
      const { door } = getPlace(id);
      expect(insideBuilding(door[0], door[1])).toBe(false);
    }
    const { facade, door } = getPlace("starter-home");
    const inside: [number, number] = [
      facade[0] + (facade[0] - door[0]) * 1.5,
      facade[1] + (facade[1] - door[1]) * 1.5,
    ];
    const [x, z] = resolveBuildingCollision(inside[0], inside[1]);
    expect(insideBuilding(x, z, 0.05)).toBe(false);
  });
});
