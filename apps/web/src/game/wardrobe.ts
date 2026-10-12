import type { accessories, bodies, hairstyles, outfits, skinTones } from "@lagos-living/shared";

type SkinTone = (typeof skinTones)[number];
type Outfit = (typeof outfits)[number];
export type Body = (typeof bodies)[number];
export type Hairstyle = (typeof hairstyles)[number];
export type Accessory = (typeof accessories)[number];

export const SKIN_TONE_COLOURS: Record<SkinTone, string> = {
  deep: "#4f2d1b",
  rich: "#82502f",
  warm: "#9b6643",
  golden: "#b4845b",
  light: "#cf9f7c",
};

export type Fabric = { colour: string; print?: { colour: string; accent: string } };

/** Garments are generated from the body surface; `skirt` also covers kaftans and dresses. */
export const OUTFITS: Record<
  Outfit,
  { label: string; top: Fabric; longSleeves: boolean; trousers: Fabric | null; skirt: Fabric | null; shoes: string }
> = {
  "island-casual": { label: "Linen shirt, chinos", top: { colour: "#efe8d8" }, longSleeves: false, trousers: { colour: "#b49a74" }, skirt: null, shoes: "#6b4a2f" },
  "office-smart": { label: "Pale blue shirt, charcoal trousers", top: { colour: "#cfdff0" }, longSleeves: true, trousers: { colour: "#2d3139" }, skirt: null, shoes: "#3b2418" },
  "ankara-day": {
    label: "Ankara print shirt",
    top: { colour: "#c3542a", print: { colour: "#1f4e8c", accent: "#f1c232" } },
    longSleeves: false,
    trousers: { colour: "#1d2633" },
    skirt: null,
    shoes: "#f1f1ee",
  },
  athleisure: { label: "Green jersey, joggers", top: { colour: "#167a49" }, longSleeves: false, trousers: { colour: "#2a2a2e" }, skirt: null, shoes: "#f4f4f2" },
  "ankara-dress": {
    label: "Ankara print dress",
    top: { colour: "#6a2a7a", print: { colour: "#f2b705", accent: "#1b8a6b" } },
    longSleeves: false,
    trousers: null,
    skirt: { colour: "#6a2a7a", print: { colour: "#f2b705", accent: "#1b8a6b" } },
    shoes: "#c9a36a",
  },
  "office-skirt": { label: "Blouse, navy skirt", top: { colour: "#f4efe9" }, longSleeves: true, trousers: null, skirt: { colour: "#273449" }, shoes: "#1c1c1e" },
  "senator-kaftan": { label: "Senator kaftan", top: { colour: "#e9e1cf" }, longSleeves: true, trousers: { colour: "#e9e1cf" }, skirt: { colour: "#e9e1cf" }, shoes: "#4b2d1d" },
  "taxi-uniform": { label: "Taxi driver's shirt", top: { colour: "#f2c230", print: { colour: "#1a1a1a", accent: "#f2c230" } }, longSleeves: false, trousers: { colour: "#1b1c20" }, skirt: null, shoes: "#111111" },
  kandura: { label: "White kandura", top: { colour: "#f7f6f1" }, longSleeves: true, trousers: { colour: "#f7f6f1" }, skirt: { colour: "#f7f6f1" }, shoes: "#8a6a48" },
  abaya: { label: "Black abaya", top: { colour: "#16151a" }, longSleeves: true, trousers: null, skirt: { colour: "#16151a" }, shoes: "#2a2224" },
  "resort-linen": { label: "Resort linen, white trousers", top: { colour: "#9fd3cf" }, longSleeves: false, trousers: { colour: "#f4f1ea" }, skirt: null, shoes: "#c9a36a" },
  "beach-day": { label: "Beach shirt, swim shorts", top: { colour: "#ff7a5c", print: { colour: "#ffd166", accent: "#118ab2" } }, longSleeves: false, trousers: { colour: "#118ab2" }, skirt: null, shoes: "#f4f4f2" },
  "police-uniform": { label: "Nigeria Police uniform", top: { colour: "#15171c" }, longSleeves: true, trousers: { colour: "#15171c" }, skirt: null, shoes: "#0b0b0c" },
  "security-uniform": { label: "Security uniform", top: { colour: "#2b333d" }, longSleeves: true, trousers: { colour: "#16191d" }, skirt: null, shoes: "#0b0b0c" },
};

export const BODY_LABELS: Record<Body, string> = { male: "Male", female: "Female" };

export const HAIR_LABELS: Record<Hairstyle, string> = {
  "low-fade": "Low cut",
  twists: "Twists",
  braids: "Braids",
  afro: "Afro",
  locs: "Locs",
  parted: "Side part",
  buns: "Twin buns",
  long: "Long weave",
};

export const ACCESSORY_LABELS: Record<Accessory, string> = { none: "None", glasses: "Glasses", cap: "Cap", headwrap: "Gele headwrap", beard: "Beard" };

export const HAIR_COLOUR = "#16110e";
