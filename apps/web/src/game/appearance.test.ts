import { accessories, characterAppearanceSchema, defaultAppearance, hairstyles, outfits, skinTones } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { appearanceUniforms, OUTFIT_COLOURS, SKIN_TONE_COLOURS } from "./appearance";
import { appearanceFor } from "./avatar";

describe("appearance recolouring", () => {
  it("leaves the generated ankara outfit untouched", () => {
    const uniforms = appearanceUniforms({ ...defaultAppearance, outfit: "ankara-day" });
    expect(uniforms.top[3]).toBe(0);
    expect(uniforms.bottom[3]).toBe(0);
    expect(uniforms.shoes[3]).toBe(0);
  });

  it("orders skin tones from deep to light", () => {
    const red = skinTones.map((skinTone) => appearanceUniforms({ ...defaultAppearance, skinTone }).skin.r);
    expect([...red].sort((a, b) => a - b)).toEqual(red);
    expect(red[0]).toBeLessThan(1);
    expect(red.at(-1)).toBeGreaterThan(1);
  });

  it("gives every outfit a label and valid garment colours", () => {
    for (const outfit of outfits) {
      const { top, bottom, shoes } = appearanceUniforms({ ...defaultAppearance, outfit });
      expect(OUTFIT_COLOURS[outfit].label.length).toBeGreaterThan(3);
      for (const garment of [top, bottom, shoes]) {
        for (const channel of garment) expect(channel).toBeGreaterThanOrEqual(0);
        for (const channel of garment.slice(0, 3)) expect(channel).toBeLessThanOrEqual(1);
      }
    }
    expect(Object.keys(SKIN_TONE_COLOURS)).toEqual([...skinTones]);
  });
});

describe("populated residents", () => {
  it("pick a stable, valid and varied look from a seed", () => {
    const looks = Array.from({ length: 40 }, (_, seed) => appearanceFor(seed));
    for (const look of looks) expect(characterAppearanceSchema.parse(look)).toEqual(look);
    expect(appearanceFor(7)).toEqual(appearanceFor(7));
    expect(new Set(looks.map((look) => look.skinTone)).size).toBe(skinTones.length);
    expect(new Set(looks.map((look) => look.hairstyle)).size).toBe(hairstyles.length);
    expect(new Set(looks.map((look) => look.outfit)).size).toBe(outfits.length);
    expect(new Set(looks.map((look) => look.accessory)).size).toBe(accessories.length);
  });
});
