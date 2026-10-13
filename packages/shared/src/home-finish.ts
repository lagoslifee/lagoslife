import type { HomeTier } from "./home-layouts.js";

type Rgb = [number, number, number];

/** Print on a home's feature wall; drawn by the client. */
export type WallPrint = "ankara" | "fronds" | "deco" | "damask" | "adire" | "plain";

/**
 * A look for the inside of a home: its wall paint (below and above the dado rail), trim, feature-wall print and floor.
 * Every tier opens with its own signature style; any home can switch to another.
 */
export type InteriorStyle = {
  id: string;
  name: string;
  blurb: string;
  lower: Rgb;
  upper: Rgb;
  skirting: Rgb;
  rail: Rgb;
  /** Feature-wall print, its ground and ink colours (and an accent for prints that use one). */
  print: { kind: WallPrint; ground: string; ink: string; accent?: string };
  floor: FloorFinishId;
  /** Ceiling tint, so a room is never a white box. */
  ceiling: Rgb;
};

export type FloorFinishId = "oak" | "walnut" | "terrazzo" | "travertine" | "black-marble" | "cream-marble" | "terracotta" | "flat-tiles";
export type FloorFinish = { id: FloorFinishId; name: string; blurb: string };

export const FLOOR_FINISHES: FloorFinish[] = [
  { id: "oak", name: "Honey oak planks", blurb: "Warm wide planks in a honey stain." },
  { id: "walnut", name: "Dark walnut herringbone", blurb: "Deep brown herringbone, polished." },
  { id: "terrazzo", name: "Lagos terrazzo", blurb: "Speckled terrazzo in sand, rust and green." },
  { id: "travertine", name: "Warm travertine", blurb: "Honey-beige stone slabs with soft veins." },
  { id: "black-marble", name: "Nero marble", blurb: "Black marble with gold veins." },
  { id: "cream-marble", name: "Cream marble", blurb: "Pale cream marble with grey veins." },
  { id: "terracotta", name: "Terracotta tiles", blurb: "Hand-made clay tiles, rust and ochre." },
  { id: "flat-tiles", name: "Ceramic tiles", blurb: "Plain beige ceramic tiles." },
];

export const INTERIOR_STYLES: InteriorStyle[] = [
  {
    id: "eko-classic",
    name: "Eko Classic",
    blurb: "Cocoa panels, warm sand walls, ankara feature wall, terracotta floor.",
    lower: [0.5, 0.23, 0.14], upper: [0.86, 0.69, 0.5], skirting: [0.3, 0.18, 0.11], rail: [0.95, 0.9, 0.8],
    print: { kind: "ankara", ground: "#e9c98f", ink: "#1f6f6b", accent: "#c4532d" },
    floor: "terracotta", ceiling: [0.93, 0.86, 0.76],
  },
  {
    id: "garden-green",
    name: "Garden Green",
    blurb: "Teal panels, sage walls, palm-frond print, honey oak floor.",
    lower: [0.07, 0.26, 0.26], upper: [0.7, 0.76, 0.6], skirting: [0.25, 0.16, 0.1], rail: [0.94, 0.92, 0.86],
    print: { kind: "fronds", ground: "#dfe5d2", ink: "#4f7d55" },
    floor: "oak", ceiling: [0.9, 0.92, 0.84],
  },
  {
    id: "island-deco",
    name: "Island Deco",
    blurb: "Navy and gold art deco, taupe walls, walnut herringbone.",
    lower: [0.09, 0.12, 0.24], upper: [0.72, 0.67, 0.6], skirting: [0.12, 0.12, 0.14], rail: [0.78, 0.62, 0.34],
    print: { kind: "deco", ground: "#25303f", ink: "#c9a45c" },
    floor: "walnut", ceiling: [0.86, 0.82, 0.76],
  },
  {
    id: "ikoyi-royal",
    name: "Ikoyi Royal",
    blurb: "Mahogany panels, champagne walls, gold damask, warm travertine.",
    lower: [0.3, 0.17, 0.09], upper: [0.86, 0.76, 0.6], skirting: [0.22, 0.13, 0.08], rail: [0.82, 0.65, 0.33],
    print: { kind: "damask", ground: "#e6d3ae", ink: "#b8945a" },
    floor: "travertine", ceiling: [0.92, 0.85, 0.72],
  },
  {
    id: "adire-indigo",
    name: "Adire Indigo",
    blurb: "Indigo adire-dyed feature wall, cream walls, terrazzo floor.",
    lower: [0.12, 0.16, 0.36], upper: [0.9, 0.85, 0.75], skirting: [0.1, 0.1, 0.18], rail: [0.85, 0.82, 0.76],
    print: { kind: "adire", ground: "#1e2c63", ink: "#c9d4f2" },
    floor: "terrazzo", ceiling: [0.9, 0.88, 0.84],
  },
  {
    id: "sunset-lekki",
    name: "Sunset Lekki",
    blurb: "Burnt orange and blush, coral print, honey oak.",
    lower: [0.66, 0.3, 0.16], upper: [0.95, 0.78, 0.68], skirting: [0.4, 0.2, 0.12], rail: [0.98, 0.9, 0.82],
    print: { kind: "ankara", ground: "#f3c7a8", ink: "#b8462a", accent: "#2f6b5e" },
    floor: "oak", ceiling: [0.97, 0.88, 0.8],
  },
  {
    id: "midnight-vi",
    name: "Midnight VI",
    blurb: "Charcoal and black marble with gold trim, for a moody penthouse.",
    lower: [0.08, 0.08, 0.09], upper: [0.3, 0.3, 0.32], skirting: [0.05, 0.05, 0.05], rail: [0.82, 0.65, 0.33],
    print: { kind: "deco", ground: "#121417", ink: "#b8945a" },
    floor: "black-marble", ceiling: [0.4, 0.38, 0.36],
  },
  {
    id: "minimal-cream",
    name: "Minimal Cream",
    blurb: "Soft cream and stone, plain walls, cream marble. Clean and bright.",
    lower: [0.78, 0.74, 0.68], upper: [0.93, 0.9, 0.85], skirting: [0.55, 0.5, 0.44], rail: [0.97, 0.95, 0.9],
    print: { kind: "plain", ground: "#e8e1d4", ink: "#d8cfbf" },
    floor: "cream-marble", ceiling: [0.95, 0.93, 0.89],
  },
];

/** The style a home has until its owner picks another. */
export const SIGNATURE_STYLE: Record<HomeTier, InteriorStyle["id"]> = { flat: "eko-classic", house: "garden-green", apartment: "island-deco", mansion: "ikoyi-royal" };

/** Outside paint for houses residents build. */
export type ExteriorPaint = { id: string; name: string; colour: string };
export const EXTERIOR_PAINTS: ExteriorPaint[] = [
  { id: "white", name: "Brilliant white", colour: "#eeece6" },
  { id: "cream", name: "Lekki cream", colour: "#e8dcc0" },
  { id: "sand", name: "Desert sand", colour: "#d4b98e" },
  { id: "terracotta", name: "Terracotta", colour: "#b8623f" },
  { id: "sage", name: "Sage green", colour: "#9fae8c" },
  { id: "sky", name: "Lagoon blue", colour: "#8fb3c9" },
  { id: "grey", name: "Ikoyi grey", colour: "#8c8f93" },
  { id: "charcoal", name: "Charcoal", colour: "#3c3f44" },
  { id: "blush", name: "Blush pink", colour: "#e2b5a6" },
];

/** What the owner has chosen; nulls keep the signature look. */
export type HomeFinish = { style: string | null; floor: FloorFinishId | null; exterior: string | null };
export const DEFAULT_FINISH: HomeFinish = { style: null, floor: null, exterior: null };

/** Decorators' prices: a bigger home costs more to repaint or refloor. */
const TIER_SCALE: Record<HomeTier, number> = { flat: 1, house: 2, apartment: 3, mansion: 6 };
export const FINISH_PRICES = { style: 40_000, floor: 60_000, exterior: 150_000 } as const;
export function finishPrice(part: keyof typeof FINISH_PRICES, tier: HomeTier) {
  return part === "exterior" ? FINISH_PRICES.exterior : FINISH_PRICES[part] * TIER_SCALE[tier];
}

export function interiorStyle(id: string | null | undefined, tier: HomeTier): InteriorStyle {
  return INTERIOR_STYLES.find((style) => style.id === id) ?? INTERIOR_STYLES.find((style) => style.id === SIGNATURE_STYLE[tier])!;
}

/** The floor a home shows: the owner's choice, else its style's floor. */
export function floorFinish(finish: HomeFinish | null | undefined, tier: HomeTier): FloorFinishId {
  return finish?.floor ?? interiorStyle(finish?.style, tier).floor;
}

export function exteriorPaint(id: string | null | undefined): ExteriorPaint | null {
  return EXTERIOR_PAINTS.find((paint) => paint.id === id) ?? null;
}
