import { z } from "zod";

/**
 * NEPA (the grid) at home: light comes and goes on a schedule every resident on the same feeder shares, and a diesel
 * generator in the compound keeps the house lit through the cuts while there is diesel in its tank.
 */
export const NEPA = {
  /** The grid is decided slot by slot, so a cut lasts at least this long. */
  slotMinutes: 12,
  /** Share of slots NEPA takes light. */
  cutShare: 0.45,
  /** Homes are grouped onto feeders by id, so neighbours on a feeder lose light together. */
  feeders: 7,
  /** The gateman switches the generator off once nobody has been home this long, so an empty house burns no diesel. */
  gatemanOffMinutes: 10,
} as const;

export type GeneratorId = "lister-8kva" | "mikano-20kva" | "perkins-60kva";
export type GeneratorModel = {
  id: GeneratorId;
  name: string;
  blurb: string;
  price: number;
  /** Tank size in litres. */
  tank: number;
  /** Litres burned per real minute while it carries the house through a cut. */
  burnPerMinute: number;
};

export const GENERATORS: GeneratorModel[] = [
  { id: "lister-8kva", name: "Lister 8 kVA", blurb: "The old reliable. Loud, thirsty for oil, never dies.", price: 1_850_000, tank: 40, burnPerMinute: 0.25 },
  { id: "mikano-20kva", name: "Mikano 20 kVA soundproof", blurb: "Canopied, quiet enough to sleep beside.", price: 6_400_000, tank: 90, burnPerMinute: 0.45 },
  { id: "perkins-60kva", name: "Perkins 60 kVA", blurb: "Runs the whole mansion, the AC and the pool pump.", price: 18_500_000, tank: 220, burnPerMinute: 0.9 },
];

export const DIESEL = {
  pricePerLitre: 1_450,
  /** Below this share of the tank, a standing order with the diesel supplier tops it back up. */
  refillBelow: 0.2,
  supplier: "Oando Diesel Supply",
} as const;

export function generatorModel(id: string | null | undefined) {
  return GENERATORS.find((model) => model.id === id) ?? null;
}

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

export function feederOf(propertyId: string) {
  return hash(propertyId) % NEPA.feeders;
}

function slotOf(time: number) {
  return Math.floor(time / (NEPA.slotMinutes * 60_000));
}

function slotHasLight(feeder: number, slot: number) {
  return (hash(`nepa:${feeder}:${slot}`) % 1000) / 1000 >= NEPA.cutShare;
}

/** Whether NEPA has light at this home at `time`, and when that next changes. */
export function nepaAt(propertyId: string, time: number) {
  const feeder = feederOf(propertyId);
  const slot = slotOf(time);
  const on = slotHasLight(feeder, slot);
  let next = slot + 1;
  while (slotHasLight(feeder, next) === on && next - slot < 200) next += 1;
  return { on, changesAt: next * NEPA.slotMinutes * 60_000 };
}

/** Minutes between `from` and `to` that NEPA was off at this home. */
export function cutMinutes(propertyId: string, from: number, to: number) {
  if (to <= from) return 0;
  const feeder = feederOf(propertyId);
  const slotMs = NEPA.slotMinutes * 60_000;
  let total = 0;
  // A long absence is capped: no tank lasts more than a few days.
  const start = Math.max(from, to - 7 * 24 * 3_600_000);
  for (let slot = slotOf(start); slot * slotMs < to; slot += 1) {
    if (slotHasLight(feeder, slot)) continue;
    total += Math.min(to, (slot + 1) * slotMs) - Math.max(start, slot * slotMs);
  }
  return total / 60_000;
}

export type HomePower = {
  nepa: boolean;
  /** ISO time NEPA next brings or takes light. */
  changesAt: string;
  generator: GeneratorId | null;
  litres: number;
  tank: number;
  /** The switch is on: the generator starts by itself whenever NEPA goes. */
  running: boolean;
  /** Standing order: the supplier refills the tank and debits the owner's account. */
  autoDiesel: boolean;
  /** The house has light right now, from NEPA or the generator. */
  lit: boolean;
  source: "nepa" | "generator" | "none";
};

export const buyGeneratorSchema = z.object({ model: z.enum(["lister-8kva", "mikano-20kva", "perkins-60kva"]), idempotencyKey: z.string().min(8).max(120) });
export const buyDieselSchema = z.object({ litres: z.number().int().min(5).max(220), idempotencyKey: z.string().min(8).max(120) });
export const generatorSwitchSchema = z.object({ running: z.boolean().optional(), autoDiesel: z.boolean().optional() });
