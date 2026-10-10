import { z } from "zod";

export const skinTones = ["deep", "rich", "warm", "golden", "light"] as const;
export const hairstyles = ["low-fade", "twists", "braids", "afro", "locs"] as const;
export const outfits = ["island-casual", "office-smart", "ankara-day", "athleisure"] as const;
export const accessories = ["none", "glasses", "cap", "headwrap"] as const;

export const characterAppearanceSchema = z.object({
  skinTone: z.enum(skinTones),
  hairstyle: z.enum(hairstyles),
  outfit: z.enum(outfits),
  accessory: z.enum(accessories),
});

export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;

export const defaultAppearance: CharacterAppearance = {
  skinTone: "rich",
  hairstyle: "low-fade",
  outfit: "island-casual",
  accessory: "none",
};

export const saveCharacterSchema = z.object({
  appearance: characterAppearanceSchema,
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("lagos-living-server"),
});

export type ApiError = {
  error: string;
};
