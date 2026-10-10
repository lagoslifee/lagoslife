import plots from "./generated/lagos-plots.json" with { type: "json" };
import type { Vec2 } from "./world.js";

/**
 * A fictional building plot laid out inside mapped construction land (scripts/world/build-plots.mjs).
 * `along` runs parallel to the street; `inward` points from the street gate into the plot.
 */
export type Plot = {
  id: string;
  name: string;
  site: string;
  street: string | null;
  areaId: number;
  center: Vec2;
  along: Vec2;
  inward: Vec2;
  width: number;
  depth: number;
  gate: Vec2;
  kerb: Vec2;
};

export const PLOTS = plots as Plot[];
const plotIndex = new Map(PLOTS.map((plot) => [plot.id, plot]));

export function plotById(id: string) {
  return plotIndex.get(id) ?? null;
}

/** Ground rent and freehold prices for every plot, in fictional game naira. */
export const PLOT_TERMS = {
  leaseRent: 15_000,
  leaseIntervalDays: 7,
  leaseGraceDays: 3,
  purchasePrice: 120_000,
  /** Metres from the gate within which a player can sign or pay the builders. */
  range: 7,
} as const;

export const constructionStages = ["foundation", "blockwork", "roofing", "finishing"] as const;
export type ConstructionStage = (typeof constructionStages)[number];

export const STAGE_LABELS: Record<ConstructionStage, string> = {
  foundation: "Foundation and floor slab",
  blockwork: "Blockwork walls",
  roofing: "Roof",
  finishing: "Plastering, doors, windows and paint",
};

export type HouseDesign = {
  id: "self-contain" | "bungalow" | "duplex";
  name: string;
  description: string;
  bedrooms: number;
  floors: number;
  /** Footprint on the plot in metres: width along the street, depth into the plot. */
  width: number;
  depth: number;
  storageSlots: number;
  /** Builders' fee and time for each stage, in order. Testing-scale minutes, not real construction time. */
  stages: Record<ConstructionStage, { cost: number; minutes: number }>;
};

export const HOUSE_DESIGNS: HouseDesign[] = [
  {
    id: "self-contain",
    name: "Self-contain cottage",
    description: "One room with a kitchenette and shower. Quick and cheap to put up.",
    bedrooms: 1,
    floors: 1,
    width: 8,
    depth: 7,
    storageSlots: 20,
    stages: {
      foundation: { cost: 20_000, minutes: 1 },
      blockwork: { cost: 25_000, minutes: 2 },
      roofing: { cost: 20_000, minutes: 1 },
      finishing: { cost: 15_000, minutes: 1 },
    },
  },
  {
    id: "bungalow",
    name: "Two-bedroom bungalow",
    description: "A single-storey family home with a sitting room and two bedrooms.",
    bedrooms: 2,
    floors: 1,
    width: 12,
    depth: 10,
    storageSlots: 30,
    stages: {
      foundation: { cost: 40_000, minutes: 2 },
      blockwork: { cost: 60_000, minutes: 3 },
      roofing: { cost: 45_000, minutes: 2 },
      finishing: { cost: 45_000, minutes: 2 },
    },
  },
  {
    id: "duplex",
    name: "Four-bedroom duplex",
    description: "Two storeys, four bedrooms and a balcony. A long-term goal for a hard-working resident.",
    bedrooms: 4,
    floors: 2,
    width: 13,
    depth: 12,
    storageSlots: 45,
    stages: {
      foundation: { cost: 80_000, minutes: 3 },
      blockwork: { cost: 140_000, minutes: 5 },
      roofing: { cost: 110_000, minutes: 3 },
      finishing: { cost: 120_000, minutes: 3 },
    },
  },
];

const designIndex = new Map(HOUSE_DESIGNS.map((design) => [design.id, design]));

export function houseDesign(id: string) {
  return designIndex.get(id as HouseDesign["id"]) ?? null;
}

export function designTotal(design: HouseDesign) {
  return constructionStages.reduce((sum, stage) => sum + design.stages[stage].cost, 0);
}

/** Property id given to the finished house on a plot. */
export function builtHomeId(plotId: string) {
  return `built-${plotId}`;
}

/** World-space corners of a house footprint centred on its plot, slightly back from the gate. */
export function houseFootprint(plot: Plot, design: Pick<HouseDesign, "width" | "depth">): Vec2[] {
  const back = 1.5;
  const cx = plot.center[0] + plot.inward[0] * back;
  const cz = plot.center[1] + plot.inward[1] * back;
  const hw = design.width / 2;
  const hd = design.depth / 2;
  const { along: a, inward: n } = plot;
  return [
    [cx - a[0] * hw - n[0] * hd, cz - a[1] * hw - n[1] * hd],
    [cx + a[0] * hw - n[0] * hd, cz + a[1] * hw - n[1] * hd],
    [cx + a[0] * hw + n[0] * hd, cz + a[1] * hw + n[1] * hd],
    [cx - a[0] * hw + n[0] * hd, cz - a[1] * hw + n[1] * hd],
  ];
}

/** Front door of the finished house: middle of the street-facing wall, a step outside it. */
export function houseDoor(plot: Plot, design: Pick<HouseDesign, "depth">): Vec2 {
  const offset = 1.5 - design.depth / 2 - 0.8;
  return [plot.center[0] + plot.inward[0] * offset, plot.center[1] + plot.inward[1] * offset];
}
