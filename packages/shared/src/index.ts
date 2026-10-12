import { z } from "zod";

export const bodies = ["male", "female"] as const;
export const skinTones = ["deep", "rich", "warm", "golden", "light"] as const;
export const hairstyles = ["low-fade", "twists", "braids", "afro", "locs", "parted", "buns", "long"] as const;
export const outfits = [
  "island-casual",
  "office-smart",
  "ankara-day",
  "athleisure",
  "ankara-dress",
  "office-skirt",
  "senator-kaftan",
  "taxi-uniform",
  "kandura",
  "abaya",
  "resort-linen",
  "beach-day",
  "police-uniform",
  "security-uniform",
  "agbada-royal",
  "senator-black",
  "aso-oke-wine",
  "denim-street",
  "suit-navy",
  "polo-weekend",
  "gown-emerald",
  "boubou-gold",
  "ankara-jumpsuit",
  "denim-skirt",
  "corporate-red",
  "lace-wine",
] as const;
export type OutfitId = (typeof outfits)[number];
/** Anyone can pick these in the character studio. */
export const starterOutfits = ["island-casual", "office-smart", "ankara-day", "athleisure", "ankara-dress", "office-skirt", "senator-kaftan"] as const satisfies readonly OutfitId[];
/** Sold in shops; wearable once owned (inventory item `outfit:<id>`). */
export const shopOutfits = ["kandura", "abaya", "resort-linen", "beach-day"] as const satisfies readonly OutfitId[];
export const isStarterOutfit = (outfit: string) => (starterOutfits as readonly string[]).includes(outfit);

/**
 * Lagos Living Boutique, sold from the phone (catalogue items `outfit:<id>` with no vendor, so no shop visit).
 * `body` is who the cut is made for; the app lists the collection for the body chosen in the character studio.
 * Keep in step with migration 0025_boutique.sql.
 */
export const BOUTIQUE = [
  { outfit: "agbada-royal", body: "male", name: "Royal blue agbada", price: 65_000, description: "Flowing three-piece agbada with gold embroidery, for owambe Saturdays." },
  { outfit: "senator-black", body: "male", name: "Black senator", price: 38_000, description: "Sharp black senator top and trousers with a long sleeve." },
  { outfit: "aso-oke-wine", body: "male", name: "Wine aso-oke kaftan", price: 52_000, description: "Hand-woven wine aso-oke kaftan with matching trousers." },
  { outfit: "denim-street", body: "male", name: "White tee and denim", price: 18_000, description: "Clean white tee, straight blue jeans and white sneakers." },
  { outfit: "suit-navy", body: "male", name: "Navy two-piece suit", price: 75_000, description: "Tailored navy suit for Victoria Island boardrooms." },
  { outfit: "polo-weekend", body: "male", name: "Weekend polo and chinos", price: 22_000, description: "Navy polo, stone chinos and loafers for a Lekki brunch." },
  { outfit: "gown-emerald", body: "female", name: "Emerald evening gown", price: 70_000, description: "Floor-length emerald gown for the club and the gala." },
  { outfit: "boubou-gold", body: "female", name: "Gold boubou", price: 48_000, description: "Wide, airy boubou in gold with a deep print border." },
  { outfit: "ankara-jumpsuit", body: "female", name: "Ankara jumpsuit", price: 34_000, description: "Bold ankara jumpsuit, long-legged and sleeveless." },
  { outfit: "denim-skirt", body: "female", name: "Tee and denim skirt", price: 16_000, description: "White tee with a knee-length denim skirt." },
  { outfit: "corporate-red", body: "female", name: "Red corporate dress", price: 42_000, description: "Structured red sheath dress with long sleeves." },
  { outfit: "lace-wine", body: "female", name: "Wine lace iro and buba", price: 58_000, description: "Wine lace buba with a wrapped iro skirt." },
] as const satisfies ReadonlyArray<{ outfit: OutfitId; body: (typeof bodies)[number]; name: string; price: number; description: string }>;
export const accessories = ["none", "glasses", "cap", "headwrap", "beard"] as const;

/** Profiles saved before the body choice existed keep the male body they were shown with. */
export const characterAppearanceSchema = z.object({
  body: z.enum(bodies).default("male"),
  skinTone: z.enum(skinTones),
  hairstyle: z.enum(hairstyles),
  outfit: z.enum(outfits),
  accessory: z.enum(accessories),
});

export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;

export const defaultAppearance: CharacterAppearance = {
  body: "male",
  skinTone: "rich",
  hairstyle: "low-fade",
  outfit: "island-casual",
  accessory: "none",
};

export const saveCharacterSchema = z.object({
  appearance: characterAppearanceSchema,
});

/** Appearance travels in its own messages, once per join or change, so 20 Hz snapshots stay small. */
export const lookSchema = z.object({ sessionId: z.string().min(1).max(64), appearance: characterAppearanceSchema });
export type Look = z.infer<typeof lookSchema>;
export const looksSchema = z.array(lookSchema).max(200);

/** Saved appearances written before an option existed fall back to defaults instead of failing. */
export function readAppearance(value: unknown): CharacterAppearance {
  const parsed = characterAppearanceSchema.safeParse({ ...defaultAppearance, ...(typeof value === "object" && value ? value : {}) });
  return parsed.success ? parsed.data : defaultAppearance;
}

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("lagos-living-server"),
});

export type ApiError = {
  error: string;
};

export * from "./world.js";
export * from "./vehicles.js";
export * from "./community.js";
export * from "./safety.js";
export * from "./homes.js";
export * from "./building.js";
export * from "./furniture.js";
export * from "./rides.js";
export * from "./rentals.js";
export * from "./towing.js";
export * from "./roads.js";
export * from "./nightlife.js";
export * from "./club-music.js";
export * from "./police.js";
export * from "./travel.js";
export * from "./fast-travel.js";
export * from "./finance.js";
export * from "./gigs.js";
export * from "./home-services.js";
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
  /** The rest are omitted on the wire when they hold these common values, which roughly halves snapshot size. */
  location: z.string().default("street"),
  busId: z.string().nullable().default(null),
  seat: z.number().int().nullable().default(null),
  carrying: z.boolean().default(false),
  connected: z.boolean().default(true),
  vehicleId: z.string().nullable().default(null),
  /** 0 is the driver's seat; higher numbers are passenger seats. */
  vehicleSeat: z.number().int().nullable().default(null),
  /** Hired guards travelling with this player. */
  guards: z.number().int().min(0).max(4).default(0),
});

export const busStateSchema = z.object({
  id: z.string(),
  routeId: z.string(),
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
/** What the server sends: players may leave out fields that hold their default. */
export type WorldSnapshotWire = z.input<typeof worldSnapshotSchema>;
export type NetworkPlayerWire = z.input<typeof networkPlayerSchema>;

export const selfStateSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
  location: z.string(),
  propertyId: z.string().nullable(),
  previewOnly: z.boolean(),
  busId: z.string().nullable(),
  seat: z.number().int().nullable(),
  vehicleId: z.string().nullable(),
  vehicleSeat: z.number().int().nullable().default(null),
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
  /** Silences every game sound without losing the chosen volume levels. */
  muted: z.boolean().default(false),
  ambienceVolume: z.number().min(0).max(1),
  dialogueVolume: z.number().min(0).max(1),
  subtitles: z.boolean(),
  cameraShake: z.boolean(),
  textScale: z.number().min(0.85).max(1.4),
  graphics: z.enum(["low", "medium", "high"]),
  autoGraphics: z.boolean().default(true),
  needsEnabled: z.boolean(),
  /** Drift the camera back behind a moving vehicle after the player stops looking around. */
  cameraRecentre: z.boolean().default(true),
  /** Pedestrians who admire and photograph rare cars (simulated photos only). */
  carSpotters: z.boolean().default(true),
  /** Fictional roadside touts (agberos) asking a slow or stopped car for small change. */
  streetEncounters: z.boolean().default(true),
});
export type PlayerSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: PlayerSettings = {
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  muted: false,
  ambienceVolume: 0.6,
  dialogueVolume: 0.9,
  subtitles: true,
  cameraShake: false,
  cameraRecentre: true,
  carSpotters: true,
  streetEncounters: true,
  textScale: 1,
  graphics: "medium",
  autoGraphics: true,
  needsEnabled: true,
};

const furnitureRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
/** Room-local metres from the middle of the room. */
const floorCoordinate = z.number().finite().min(-6).max(6);

/** Free positions (`x`, `z`) are preferred; `gridX`/`gridZ` are the old 8 × 6 cells, still accepted. */
export const placeFurnitureSchema = z
  .object({
    itemId: z.string().min(1).max(80),
    x: floorCoordinate.optional(),
    z: floorCoordinate.optional(),
    gridX: z.number().int().min(0).max(7).optional(),
    gridZ: z.number().int().min(0).max(5).optional(),
    rotation: furnitureRotation,
    idempotencyKey: z.uuid(),
  })
  .refine((body) => (body.x !== undefined && body.z !== undefined) || (body.gridX !== undefined && body.gridZ !== undefined), "Give a floor position.");

export const moveFurnitureSchema = z.object({
  placementId: z.uuid(),
  x: floorCoordinate,
  z: floorCoordinate,
  rotation: furnitureRotation,
});

export const homeActionSchema = z.object({
  action: z.enum(["sleep", "cook", "clean", "tv"]),
});

export const inviteGuestSchema = z.object({
  username: z.string().min(3).max(20),
});
export * from "./street-encounters.js";
