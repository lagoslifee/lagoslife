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

export const movementInputSchema = z.object({
  sequence: z.number().int().nonnegative(),
  forward: z.number().min(-1).max(1),
  right: z.number().min(-1).max(1),
  run: z.boolean(),
  yaw: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2),
});

export type MovementInput = z.infer<typeof movementInputSchema>;

export const networkPlayerSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(20),
  x: z.number().finite(),
  z: z.number().finite(),
  yaw: z.number().finite(),
  speed: z.number().finite().nonnegative(),
  motion: z.enum(["idle", "walk", "run"]),
  connected: z.boolean(),
});

export const worldSnapshotSchema = z.object({
  tick: z.number().int().nonnegative(),
  players: z.array(networkPlayerSchema),
});

export type NetworkPlayer = z.infer<typeof networkPlayerSchema>;
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const purchaseRequestSchema = z.object({
  itemId: z.string().min(1).max(80),
  idempotencyKey: z.uuid(),
});

export const completeJobRequestSchema = z.object({
  jobId: z.uuid(),
});
