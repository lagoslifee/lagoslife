import { describe, expect, it } from "vitest";
import { characterAppearanceSchema, defaultAppearance } from "./index";

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
