import { z } from "zod";

/**
 * Helicopters and private jets for the city's elite. Game naira only. A helicopter hops you anywhere public in the
 * city you are in, no Go-now cooldown and no need to have been there before; a jet flies you between Lagos and
 * Dubai on your own schedule (you still need a visa).
 */
export type AircraftKind = "helicopter" | "jet";

export type AircraftModel = {
  id: string;
  name: string;
  kind: AircraftKind;
  price: number;
  seats: number;
  /** Fuel, pilot and landing fees for one helicopter hop or one jet flight. */
  tripCost: number;
  /** Kilometres per hour, for the brochure. */
  cruise: number;
  description: string;
};

export const AIRCRAFT: AircraftModel[] = [
  { id: "robinson-r44", name: "Robinson R44 Raven II", kind: "helicopter", price: 180_000_000, seats: 4, tripCost: 150_000, cruise: 200, description: "Four-seat piston helicopter. Skip the Third Mainland Bridge traffic for good." },
  { id: "bell-407", name: "Bell 407GXi", kind: "helicopter", price: 420_000_000, seats: 7, tripCost: 250_000, cruise: 246, description: "Turbine executive helicopter with leather club seating. Lekki to Ikoyi in four minutes." },
  { id: "leonardo-aw139", name: "Leonardo AW139", kind: "helicopter", price: 950_000_000, seats: 12, tripCost: 400_000, cruise: 306, description: "Twin-engine VIP helicopter, the oil-and-gas chairman's choice." },
  { id: "embraer-phenom-300", name: "Embraer Phenom 300E", kind: "jet", price: 2_500_000_000, seats: 8, tripCost: 3_500_000, cruise: 839, description: "Light jet. Lagos to Dubai with one fuel stop, champagne on ice." },
  { id: "bombardier-challenger-350", name: "Bombardier Challenger 350", kind: "jet", price: 5_500_000_000, seats: 10, tripCost: 6_000_000, cruise: 870, description: "Super-midsize jet with a flat-floor cabin and a full galley." },
  { id: "gulfstream-g650er", name: "Gulfstream G650ER", kind: "jet", price: 9_000_000_000, seats: 16, tripCost: 9_000_000, cruise: 956, description: "Ultra-long-range flagship. Bedroom, shower and a crew of four. Only for the very top." },
];

export const aircraftById = new Map(AIRCRAFT.map((model) => [model.id, model]));

export const AIRCRAFT_RULES = {
  /** Most aircraft one resident can own. */
  maxOwned: 3,
  /** Shortest gap between two helicopter hops, so the city isn't crossed in a blink. */
  hopGapMs: 15_000,
} as const;

export type OwnedAircraft = { id: string; modelId: string; tail: string; boughtAt: string };

export const aircraftPurchaseSchema = z.object({ modelId: z.string().min(1).max(60), idempotencyKey: z.string().uuid() });
export const helicopterHopSchema = z.object({ aircraftId: z.string().min(1).max(64), placeId: z.string().min(1).max(80) });
export const jetFlightSchema = z.object({ aircraftId: z.string().min(1).max(64) });
