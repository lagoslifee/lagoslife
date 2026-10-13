import { z } from "zod";
import type { VehicleCategory, VehicleModel } from "./vehicles.js";
import { sampleRoute, stopById, type Vec2 } from "./world.js";

/**
 * Petrol: every motor vehicle has a tank that empties as it is driven. Filling stations stand along the main roads;
 * an attendant asks how many litres, brings the POS for a card tap, and the pump runs for a few seconds.
 * Stations start out run by their oil marketer; a resident can buy one, set its pump price and keep the margin.
 */
export const FUEL = {
  /** Pump price at a station its marketer still runs. */
  marketerPrice: 1_050,
  /** What a station pays its depot per litre; an owner keeps the pump price above this. */
  depotPrice: 860,
  minPrice: 900,
  maxPrice: 1_500,
  /** Price to buy a station off its marketer. */
  stationPrice: 65_000_000,
  /** How close the car has to stop to the pumps. */
  pumpRange: 9,
  /** How long the pump runs after the card tap. */
  fillMs: 4_000,
  /** With a dry tank the car only creeps along, as if pushed. */
  dryCrawl: 2.5,
} as const;

/** Tank litres and litres burned per game kilometre, by kind of vehicle. Tuned so a tank lasts a long drive across the map. */
const SPECS: Record<VehicleCategory, { tank: number; perKm: number }> = {
  compact: { tank: 40, perKm: 1.2 },
  sedan: { tank: 50, perKm: 1.5 },
  suv: { tank: 75, perKm: 2.1 },
  luxury: { tank: 70, perKm: 2 },
  sports: { tank: 65, perKm: 2.6 },
  van: { tank: 60, perKm: 1.9 },
  motorbike: { tank: 12, perKm: 0.45 },
  bicycle: { tank: 0, perKm: 0 },
};

export function fuelSpec(model: Pick<VehicleModel, "category">) {
  return SPECS[model.category];
}

export function usesFuel(model: Pick<VehicleModel, "category">) {
  return fuelSpec(model).tank > 0;
}

/** Litres left after driving `metres`, from `litres`. */
export function burnFuel(model: Pick<VehicleModel, "category">, litres: number, metres: number) {
  return Math.max(0, litres - (Math.max(0, metres) / 1_000) * fuelSpec(model).perKm);
}

export type FuelBrand = "NNPC" | "Mobil" | "Conoil" | "MRS" | "TotalEnergies";
export type FuelStationSite = { id: string; name: string; brand: FuelBrand; point: Vec2; yaw: number };

const BRAND_COLOURS: Record<FuelBrand, { body: string; trim: string }> = {
  NNPC: { body: "#0a7a3b", trim: "#f2c230" },
  Mobil: { body: "#1b3f94", trim: "#e2262b" },
  Conoil: { body: "#e8e3d5", trim: "#d22d2d" },
  MRS: { body: "#f4f1ea", trim: "#c8102e" },
  TotalEnergies: { body: "#ffffff", trim: "#e3432a" },
};

export function brandColours(brand: FuelBrand) {
  return BRAND_COLOURS[brand];
}

/** Pump islands stand on the pavement a little way past these danfo stops, so cars pull up at a mapped kerb. */
const SITES: Array<[id: string, name: string, brand: FuelBrand, stopId: string]> = [
  ["arobieke", "NNPC Mega Station · Admiralty Way", "NNPC", "victoria-arobieke-wb"],
  ["kayode", "TotalEnergies · Admiralty Way", "TotalEnergies", "kayode-eb"],
  ["alexander", "Mobil · Bourdillon Road", "Mobil", "alexander-wb"],
  ["ahmadu-bello", "Conoil · Ahmadu Bello Way", "Conoil", "ahmadu-bello-eb"],
  ["falomo-east", "MRS · Falomo", "MRS", "falomo-east-eb"],
];

export const FUEL_STATIONS: FuelStationSite[] = SITES.map(([id, name, brand, stopId]) => {
  const stop = stopById.get(stopId);
  if (!stop) throw new Error(`Unknown stop ${stopId}`);
  const here = sampleRoute(stop.route, stop.s);
  const ahead = sampleRoute(stop.route, stop.s + 24);
  return { id, name, brand, point: [stop.alight[0] + (ahead.x - here.x), stop.alight[1] + (ahead.z - here.z)], yaw: here.yaw };
});
export const fuelStationById = new Map(FUEL_STATIONS.map((station) => [station.id, station]));

export function nearestFuelStation(x: number, z: number) {
  let best = FUEL_STATIONS[0]!;
  let distance = Infinity;
  for (const station of FUEL_STATIONS) {
    const d = Math.hypot(station.point[0] - x, station.point[1] - z);
    if (d < distance) [best, distance] = [station, d];
  }
  return { station: best, distance };
}

export type FuelStationState = {
  id: string;
  name: string;
  brand: FuelBrand;
  price: number;
  /** Null while the marketer runs it. */
  owner: string | null;
  mine: boolean;
  /** Litres sold and the owner's margin, since they bought it. */
  litresSold: number;
  earned: number;
};

export const buyFuelSchema = z.object({
  stationId: z.string().min(1).max(40),
  vehicleId: z.string().min(1).max(80),
  litres: z.number().int().min(1).max(120),
  /** The pump price the resident agreed to, so a price change in between cannot surprise them. */
  price: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(120),
});
export const fuelStationPriceSchema = z.object({ price: z.number().int().min(FUEL.minPrice).max(FUEL.maxPrice) });
