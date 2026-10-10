import { describe, expect, it } from "vitest";
import { characterAppearanceSchema, defaultAppearance, movementInputSchema } from "./index";

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

describe("authoritative movement contract", () => {
  it("accepts bounded controls without accepting a client position", () => {
    const result = movementInputSchema.parse({
      sequence: 4,
      forward: 1,
      right: -0.25,
      run: true,
      yaw: Math.PI,
      x: 999_999,
    });
    expect(result).not.toHaveProperty("x");
  });

  it("rejects impossible input magnitudes", () => {
    expect(() =>
      movementInputSchema.parse({
        sequence: 5,
        forward: 8,
        right: 0,
        run: false,
        yaw: 0,
      }),
    ).toThrow();
  });
});
