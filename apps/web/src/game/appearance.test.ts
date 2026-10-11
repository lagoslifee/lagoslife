import { accessories, characterAppearanceSchema, defaultAppearance, hairstyles, outfits, readAppearance, skinTones, starterOutfits } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { garmentSlots, OUTFITS, SKIN_TONE_COLOURS, skinTint } from "./appearance";
import { appearanceFor } from "./avatar";

describe("appearance", () => {
  it("orders skin tones from deep to light on both bodies", () => {
    for (const body of ["male", "female"] as const) {
      const red = skinTones.map((skinTone) => skinTint({ ...defaultAppearance, body, skinTone }).r);
      expect([...red].sort((a, b) => a - b)).toEqual(red);
      expect(red[0]).toBeLessThan(1);
    }
    expect(Object.keys(SKIN_TONE_COLOURS)).toEqual([...skinTones]);
  });

  it("gives every outfit a label, visible top and shoes, and hides what it does not wear", () => {
    for (const outfit of outfits) {
      const slots = garmentSlots({ ...defaultAppearance, outfit });
      expect(OUTFITS[outfit].label.length).toBeGreaterThan(3);
      expect(slots.top.base[3]).toBeGreaterThan(0);
      expect(slots.shoes.base[3]).toBeGreaterThan(0);
      expect(slots.skirt.base[3] > 0).toBe(OUTFITS[outfit].skirt !== null);
      expect(slots.trousers.base[3] > 0).toBe(OUTFITS[outfit].trousers !== null);
      expect(slots.sleeve.base[3] > 0).toBe(OUTFITS[outfit].longSleeves);
      for (const slot of Object.values(slots)) for (const channel of slot.base.slice(0, 3)) expect(channel).toBeLessThanOrEqual(1);
    }
    expect(garmentSlots({ ...defaultAppearance, outfit: "ankara-dress" }).skirt.base[3]).toBe(2);
  });

  it("keeps profiles saved before the body option on the male body", () => {
    const old = { skinTone: "deep", hairstyle: "locs", outfit: "ankara-day", accessory: "cap" };
    expect(readAppearance(old)).toEqual({ ...old, body: "male" });
    expect(characterAppearanceSchema.parse(old).body).toBe("male");
  });
});

describe("populated residents", () => {
  it("pick a stable, valid and varied look from a seed, with women and men", () => {
    const looks = Array.from({ length: 80 }, (_, seed) => appearanceFor(seed));
    for (const look of looks) expect(characterAppearanceSchema.parse(look)).toEqual(look);
    expect(appearanceFor(7)).toEqual(appearanceFor(7));
    const women = looks.filter((look) => look.body === "female").length;
    expect(women).toBeGreaterThan(25);
    expect(women).toBeLessThan(55);
    expect(new Set(looks.map((look) => look.skinTone)).size).toBe(skinTones.length);
    expect(new Set(looks.map((look) => look.hairstyle)).size).toBe(hairstyles.length);
    expect(new Set(looks.map((look) => look.outfit)).size).toBe(starterOutfits.length);
    expect(new Set(looks.map((look) => look.accessory)).size).toBe(accessories.length);
  });
});
