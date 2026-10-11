import { z } from "zod";
import { sampleRoute, stopById, type Vec2 } from "./world.js";

/** Fictional public bicycle hire, priced in game naira. */
export const BIKE_RENTAL = {
  unlockFee: 100,
  perMinute: 15,
  /** Held at unlock; the ride cost comes out of it on return and the rest is refunded. */
  deposit: 2_000,
  docks: 6,
  /** Bikes per station at opening, leaving docks free for returns. */
  startingBikes: 4,
  rentRange: 6,
  returnRange: 14,
  modelId: "yaba-city-bike",
  colour: "#e0b02a",
} as const;

/** Usage charged on return: whole minutes, never more than the deposit. */
export function rentalUsage(startedAt: number, endedAt: number) {
  const minutes = Math.max(1, Math.ceil((endedAt - startedAt) / 60_000));
  return { minutes, usage: Math.min(BIKE_RENTAL.deposit, minutes * BIKE_RENTAL.perMinute) };
}

export type BikeStation = { id: string; name: string; point: Vec2; yaw: number };

/** Stations stand a few metres along the pavement from these danfo stops, so they share a mapped kerb. */
const SITES: Array<[id: string, name: string, stopId: string]> = [
  ["adebayo", "Admiralty Way · Adebayo Doherty", "adebayo-eb"],
  ["kayode", "Admiralty Way · Kayode Animashaun", "kayode-wb"],
  ["bridge", "Ikoyi Bridge Roundabout", "bridge-roundabout-eb"],
  ["lateef-jakande", "Bourdillon Road · Lateef Jakande", "lateef-jakande-eb"],
  ["falomo", "Bourdillon Road · Falomo", "falomo-wb"],
  ["akin-adesola", "Adeola Odeku · Akin Adesola", "akin-adesola-eb"],
  ["idowu-martins", "Adeola Odeku · Idowu Martins", "idowu-martins-wb"],
];

export const BIKE_STATIONS: BikeStation[] = SITES.map(([id, name, stopId]) => {
  const stop = stopById.get(stopId);
  if (!stop) throw new Error(`Unknown stop ${stopId}`);
  const here = sampleRoute(stop.route, stop.s);
  const ahead = sampleRoute(stop.route, stop.s + 9);
  return { id, name, point: [stop.alight[0] + (ahead.x - here.x), stop.alight[1] + (ahead.z - here.z)], yaw: here.yaw };
});
export const bikeStationById = new Map(BIKE_STATIONS.map((station) => [station.id, station]));

export function nearestBikeStation(x: number, z: number) {
  let best = BIKE_STATIONS[0]!;
  let distance = Infinity;
  for (const station of BIKE_STATIONS) {
    const d = Math.hypot(station.point[0] - x, station.point[1] - z);
    if (d < distance) {
      best = station;
      distance = d;
    }
  }
  return { station: best, distance };
}

export const rentBikeSchema = z.object({ stationId: z.string().min(1).max(40), idempotencyKey: z.uuid() });

export type BikeRental = { id: string; stationId: string; startedAt: number; deposit: number; vehicleId: string | null };
export type BikeStationStock = Record<string, number>;
