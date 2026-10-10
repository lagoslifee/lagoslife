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

export * from "./world.js";
export * from "./vehicles.js";
import { worldVehicleSchema } from "./vehicles.js";

export const motionStates = ["idle", "walk", "jog", "sprint", "sit", "wave", "dance", "drive"] as const;
export type MotionState = (typeof motionStates)[number];

/**
 * The client simulates its own avatar for responsiveness and reports the
 * result; the server accepts it only after speed, bounds, and building checks.
 */
export const positionUpdateSchema = z.object({
  sequence: z.number().int().nonnegative(),
  x: z.number().finite().min(-20_000).max(20_000),
  z: z.number().finite().min(-20_000).max(20_000),
  yaw: z.number().finite().min(-Math.PI * 4).max(Math.PI * 4),
  motion: z.enum(motionStates),
});
export type PositionUpdate = z.infer<typeof positionUpdateSchema>;

export const boardRequestSchema = z.object({ busId: z.string().min(1).max(40) });
export const emoteRequestSchema = z.object({ emote: z.enum(["wave", "dance", "sit", "none"]) });
export const enterPropertySchema = z.object({
  propertyId: z.string().min(1).max(100),
  mode: z.enum(["enter", "preview"]),
});

export const networkPlayerSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(20),
  x: z.number().finite(),
  z: z.number().finite(),
  yaw: z.number().finite(),
  motion: z.enum(motionStates),
  location: z.string(),
  busId: z.string().nullable(),
  seat: z.number().int().nullable(),
  carrying: z.boolean(),
  connected: z.boolean(),
  vehicleId: z.string().nullable(),
});

export const busStateSchema = z.object({
  id: z.string(),
  x: z.number().finite(),
  z: z.number().finite(),
  yaw: z.number().finite(),
  speed: z.number().finite(),
  s: z.number().finite(),
  state: z.enum(["driving", "dwelling", "recovering"]),
  doorOpen: z.boolean(),
  stopId: z.string().nullable(),
  nextStopId: z.string(),
  stopRequested: z.boolean(),
  occupied: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  seats: z.array(z.string().nullable()),
});

export const worldSnapshotSchema = z.object({
  tick: z.number().int().nonnegative(),
  serverTime: z.number(),
  players: z.array(networkPlayerSchema),
  buses: z.array(busStateSchema),
  vehicles: z.array(worldVehicleSchema),
  online: z.number().int().nonnegative(),
});

export type NetworkPlayer = z.infer<typeof networkPlayerSchema>;
export type BusState = z.infer<typeof busStateSchema>;
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const selfStateSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
  location: z.string(),
  propertyId: z.string().nullable(),
  previewOnly: z.boolean(),
  busId: z.string().nullable(),
  seat: z.number().int().nullable(),
  vehicleId: z.string().nullable(),
  reason: z.string(),
});
export type SelfState = z.infer<typeof selfStateSchema>;

export const noticeSchema = z.object({
  tone: z.enum(["info", "success", "error"]),
  text: z.string(),
  announcement: z.string().optional(),
});
export type Notice = z.infer<typeof noticeSchema>;

export const purchaseRequestSchema = z.object({
  itemId: z.string().min(1).max(80),
  idempotencyKey: z.uuid(),
});

export const completeJobRequestSchema = z.object({
  jobId: z.uuid(),
});

export const acquirePropertySchema = z.object({
  propertyId: z.string().min(1).max(100),
  tenure: z.enum(["owned", "rented"]),
  idempotencyKey: z.uuid(),
});

export const tenancyActionSchema = z.object({
  idempotencyKey: z.uuid(),
});

export const eatRequestSchema = z.object({
  itemId: z.string().min(1).max(80),
});

export const settingsSchema = z.object({
  mouseSensitivity: z.number().min(0.2).max(3),
  invertY: z.boolean(),
  masterVolume: z.number().min(0).max(1),
  ambienceVolume: z.number().min(0).max(1),
  dialogueVolume: z.number().min(0).max(1),
  subtitles: z.boolean(),
  cameraShake: z.boolean(),
  textScale: z.number().min(0.85).max(1.4),
  graphics: z.enum(["low", "medium", "high"]),
  needsEnabled: z.boolean(),
});
export type PlayerSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: PlayerSettings = {
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  ambienceVolume: 0.6,
  dialogueVolume: 0.9,
  subtitles: true,
  cameraShake: false,
  textScale: 1,
  graphics: "medium",
  needsEnabled: true,
};

export const placeFurnitureSchema = z.object({
  itemId: z.string().min(1).max(80),
  gridX: z.number().int().min(0).max(7),
  gridZ: z.number().int().min(0).max(5),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  idempotencyKey: z.uuid(),
});

export const homeActionSchema = z.object({
  action: z.enum(["sleep", "cook", "clean"]),
});

export const inviteGuestSchema = z.object({
  username: z.string().min(3).max(20),
});
