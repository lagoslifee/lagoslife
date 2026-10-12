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
  "agbada-royal": {
    label: "Royal blue agbada",
    top: { colour: "#1d3f8f", print: { colour: "#d4a537", accent: "#1d3f8f" } },
    longSleeves: true,
    trousers: { colour: "#1d3f8f" },
    skirt: { colour: "#1d3f8f", print: { colour: "#d4a537", accent: "#1d3f8f" } },
    shoes: "#2a1a10",
  },
  "senator-black": { label: "Black senator", top: { colour: "#141518" }, longSleeves: true, trousers: { colour: "#141518" }, skirt: null, shoes: "#3b2418" },
  "aso-oke-wine": {
    label: "Wine aso-oke kaftan",
    top: { colour: "#6b1e2e", print: { colour: "#c9a14a", accent: "#4a1420" } },
    longSleeves: true,
    trousers: { colour: "#6b1e2e" },
    skirt: { colour: "#6b1e2e", print: { colour: "#c9a14a", accent: "#4a1420" } },
    shoes: "#2a1a10",
  },
  "denim-street": { label: "White tee, blue jeans", top: { colour: "#f5f5f2" }, longSleeves: false, trousers: { colour: "#355f8f" }, skirt: null, shoes: "#f4f4f2" },
  "suit-navy": { label: "Navy suit", top: { colour: "#1b2a44" }, longSleeves: true, trousers: { colour: "#1b2a44" }, skirt: null, shoes: "#140d09" },
  "polo-weekend": { label: "Navy polo, stone chinos", top: { colour: "#22355c" }, longSleeves: false, trousers: { colour: "#c8b48e" }, skirt: null, shoes: "#6b4a2f" },
  "gown-emerald": { label: "Emerald gown", top: { colour: "#0f6b4f" }, longSleeves: false, trousers: null, skirt: { colour: "#0f6b4f" }, shoes: "#c9a36a" },
  "boubou-gold": {
    label: "Gold boubou",
    top: { colour: "#d6a531", print: { colour: "#7a2f12", accent: "#f4e3b0" } },
    longSleeves: true,
    trousers: null,
    skirt: { colour: "#d6a531", print: { colour: "#7a2f12", accent: "#f4e3b0" } },
    shoes: "#7a4a22",
  },
  "ankara-jumpsuit": {
    label: "Ankara jumpsuit",
    top: { colour: "#e0592a", print: { colour: "#13506b", accent: "#f7c948" } },
    longSleeves: false,
    trousers: { colour: "#e0592a", print: { colour: "#13506b", accent: "#f7c948" } },
    skirt: null,
    shoes: "#1c1c1e",
  },
  "denim-skirt": { label: "White tee, denim skirt", top: { colour: "#f5f5f2" }, longSleeves: false, trousers: null, skirt: { colour: "#3d6896" }, shoes: "#f4f4f2" },
  "corporate-red": { label: "Red corporate dress", top: { colour: "#b3202e" }, longSleeves: true, trousers: null, skirt: { colour: "#b3202e" }, shoes: "#1c1c1e" },
  "lace-wine": {
    label: "Wine lace iro and buba",
    top: { colour: "#7a1f3d", print: { colour: "#e8c7d2", accent: "#7a1f3d" } },
    longSleeves: true,
    trousers: null,
    skirt: { colour: "#5e1730" },
    shoes: "#c9a36a",
  },
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
