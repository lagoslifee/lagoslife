import plots from "./generated/lagos-plots.json" with { type: "json" };
import { registerFootprints, unregisterFootprint, type Vec2 } from "./world.js";

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

/** The estate agent buys land and houses for you from anywhere, for a small fee on top of the price. */
/** `viewingSeconds`: the agent drives you to a listing for a free viewing in about this long. */
export const ESTATE_AGENT = { name: "Lekki Homes estate agent", feeRate: 0.02, viewingSeconds: 3 } as const;
export const agentFee = (price: number) => Math.max(1_000, Math.round((price * ESTATE_AGENT.feeRate) / 1000) * 1000);

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
  id: "self-contain" | "bungalow" | "duplex" | "pool-villa" | "estate-mansion" | "helipad-mansion";
  name: string;
  description: string;
  bedrooms: number;
  floors: number;
  /** Footprint on the plot in metres: width along the street, depth into the plot. */
  width: number;
  depth: number;
  storageSlots: number;
  /** Covered car spaces in the compound, parked nose to tail under carports beside the house. */
  parking: number;
  /** Swimming pool in the back garden, width along the street by length into the plot, in metres. */
  pool: [number, number] | null;
  /** A marked landing pad on the roof with the owner's helicopter parked on it. */
  helipad?: boolean;
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
    parking: 1,
    pool: null,
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
    parking: 0,
    pool: null,
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
    parking: 0,
    pool: null,
    stages: {
      foundation: { cost: 80_000, minutes: 3 },
      blockwork: { cost: 140_000, minutes: 5 },
      roofing: { cost: 110_000, minutes: 3 },
      finishing: { cost: 120_000, minutes: 3 },
    },
  },
  {
    id: "pool-villa",
    name: "Modern pool villa",
    description: "Two storeys of glass and white render, a two-car carport and a pool in the back garden.",
    bedrooms: 3,
    floors: 2,
    width: 10,
    depth: 10,
    storageSlots: 55,
    parking: 2,
    pool: [6, 3.2],
    stages: {
      foundation: { cost: 150_000, minutes: 3 },
      blockwork: { cost: 250_000, minutes: 5 },
      roofing: { cost: 180_000, minutes: 3 },
      finishing: { cost: 220_000, minutes: 4 },
    },
  },
  {
    id: "estate-mansion",
    name: "Three-storey estate mansion",
    description: "Five bedrooms over three floors, carports for four cars on both sides and a long lap pool.",
    bedrooms: 5,
    floors: 3,
    width: 10.6,
    depth: 11,
    storageSlots: 80,
    parking: 4,
    pool: [8, 3.4],
    stages: {
      foundation: { cost: 300_000, minutes: 4 },
      blockwork: { cost: 520_000, minutes: 6 },
      roofing: { cost: 380_000, minutes: 4 },
      finishing: { cost: 500_000, minutes: 5 },
    },
  },
  {
    id: "helipad-mansion",
    name: "Helipad sky mansion",
    description: "The biggest house you can build: three glass storeys, a rooftop helipad with your helicopter on it, four covered parking bays and a lap pool.",
    bedrooms: 6,
    floors: 3,
    width: 10.6,
    depth: 12,
    storageSlots: 110,
    parking: 4,
    pool: [8, 3.4],
    helipad: true,
    stages: {
      foundation: { cost: 600_000, minutes: 4 },
      blockwork: { cost: 1_100_000, minutes: 6 },
      roofing: { cost: 900_000, minutes: 5 },
      finishing: { cost: 1_400_000, minutes: 6 },
    },
  },
];

/** A business built on a plot instead of a house: a shopfront facing the street with parking in front. */
export const PLOT_SHOP = { width: 12, depth: 9, cost: 350_000 } as const;
export const SHOP_DESIGN_ID = "shop";

const designIndex = new Map(HOUSE_DESIGNS.map((design) => [design.id, design]));

export function houseDesign(id: string) {
  return designIndex.get(id as HouseDesign["id"]) ?? null;
}

export function designTotal(design: HouseDesign) {
  return constructionStages.reduce((sum, stage) => sum + design.stages[stage].cost, 0);
}

/** Builders charge this much more to hand over a design finished at once instead of stage by stage. */
export const READY_BUILT_MARKUP = 0.2;

/** The whole design finished on the spot, on land the resident already holds. Land is always bought on its own. */
export function readyBuiltPrice(design: HouseDesign) {
  return Math.round((designTotal(design) * (1 + READY_BUILT_MARKUP)) / 1000) * 1000;
}

/** Property id given to the finished house on a plot. */
export function builtHomeId(plotId: string) {
  return `built-${plotId}`;
}

/** Every house's front wall stands this far in from the plot's street edge, so the door is fixed per plot. */
const FRONT_SETBACK = 3;

/** World-space corners of a house footprint on its plot, front wall facing the gate. */
export function houseFootprint(plot: Plot, design: Pick<HouseDesign, "width" | "depth">): Vec2[] {
  const front = -plot.depth / 2 + FRONT_SETBACK;
  const centre = front + design.depth / 2;
  const cx = plot.center[0] + plot.inward[0] * centre;
  const cz = plot.center[1] + plot.inward[1] * centre;
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

/** Where a resident stands to use the front door: a step outside the middle of the front wall. */
export function houseDoor(plot: Plot): Vec2 {
  const offset = -plot.depth / 2 + FRONT_SETBACK - 0.9;
  return [plot.center[0] + plot.inward[0] * offset, plot.center[1] + plot.inward[1] * offset];
}

/** The plot a finished house stands on, from its property id. */
export function plotForHome(propertyId: string) {
  return propertyId.startsWith("built-") ? plotById(propertyId.slice("built-".length)) : null;
}

/** Name and door of a finished house, shaped like a mapped place for door checks. */
export function builtHomePlace(propertyId: string) {
  const plot = plotForHome(propertyId);
  return plot ? { id: propertyId, name: `${plot.name}, ${plot.site}`, door: houseDoor(plot), street: plot.street ?? plot.site } : null;
}

/** What stands on a plot, as far as collision is concerned. */
export type PlotStructure = { plotId: string; designId: string; stagesPaid: number };

/** Walls go up with the blockwork stage; from then on the house blocks movement like any mapped building. */
export const SOLID_FROM_STAGE = 2;

const solidPlots = new Map<string, string>();

/** Footprint ids for plot houses are negative so they never collide with OSM building ids. */
function plotFootprintId(plotId: string) {
  return -1 - PLOTS.findIndex((plot) => plot.id === plotId);
}

/** Registers or removes plot houses in the shared collision grid so client and server agree on what is solid. */
/** Design standing on a plot once its walls are up (as last synced), or null. */
export function plotDesignId(plotId: string) {
  const id = solidPlots.get(plotId);
  return id && houseDesign(id) ? (id as HouseDesign["id"]) : null;
}

const structureSize = (designId: string) => (designId === SHOP_DESIGN_ID ? PLOT_SHOP : houseDesign(designId));

/** Shops (`designId` "shop") are solid at once; houses once their walls are up. */
export function syncPlotFootprints(structures: PlotStructure[]) {
  const wanted = new Map<string, string>();
  for (const structure of structures) {
    if (structure.stagesPaid >= SOLID_FROM_STAGE && plotById(structure.plotId) && structureSize(structure.designId)) {
      wanted.set(structure.plotId, structure.designId);
    }
  }
  for (const [plotId, designId] of solidPlots) {
    if (wanted.get(plotId) === designId) continue;
    unregisterFootprint(plotFootprintId(plotId));
    solidPlots.delete(plotId);
  }
  for (const [plotId, designId] of wanted) {
    if (solidPlots.has(plotId)) continue;
    registerFootprints([{ id: plotFootprintId(plotId), points: houseFootprint(plotById(plotId)!, structureSize(designId)!) }]);
    solidPlots.set(plotId, designId);
  }
}
