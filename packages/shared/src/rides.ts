import { z } from "zod";

/** Naija World Ride: fictional NPC ride-hailing, paid in game naira. */
export const RIDE = {
  baseFare: 400,
  perKm: 160,
  /** Server bounds on the client's road distance, as multiples of the straight line. */
  minRoadFactor: 1,
  maxRoadFactor: 2.6,
  /** Closer than this, the app suggests walking. */
  minMetres: 120,
  maxMetres: 25_000,
  /** Pickups must be on a road within this distance of the rider. */
  pickupRange: 45,
  /** The driver is already nearby: pickups take about ten seconds from booking. */
  pickupSecondsMin: 8,
  pickupSecondsMax: 12,
  /** Cancelling within this many seconds of booking is free. */
  freeCancelSeconds: 60,
  lateCancelFee: 200,
  /** Driver waits this long at the pickup, then cancels with the no-show fee. */
  waitSeconds: 180,
  noShowFee: 300,
  /** Top cruising speed on straights (about 108 km/h); the driver slows for corners and the stop. */
  driverSpeed: 30,
  /** Drivers keep to the right-hand lane, this far right of the road's centreline. */
  laneOffset: 1.8,
  modelId: "tokunbo-saloon",
  /** Lagos taxi yellow, with a roof sign and a chequered stripe. */
  colour: "#f2c230",
  /** Dubai taxis are cream with a red roof. */
  dubaiColour: "#e8dcc0",
  /** Skipping ahead puts the rider at the drop-off after this short transfer. */
  skipSeconds: 3,
  /** Express costs the ride fare plus this, and can be booked from indoors or away from a road. */
  expressFee: 1_500,
  boardRange: 7,
  /** Drop-off counts as arrived within this distance of the destination's road point. */
  arriveRange: 40,
} as const;

export function rideFare(roadMetres: number) {
  return Math.round((RIDE.baseFare + (roadMetres / 1000) * RIDE.perKm) / 50) * 50;
}

export function expressFare(roadMetres: number) {
  return rideFare(roadMetres) + RIDE.expressFee;
}

const point = z.tuple([z.number().finite(), z.number().finite()]);

export const rideBookSchema = z.object({
  pickup: point,
  pickupYaw: z.number().finite(),
  /** Road point nearest the destination, where the driver stops. */
  dropoff: point,
  destination: point,
  label: z.string().min(1).max(80),
  roadMetres: z.number().finite().min(0).max(60_000),
  /** Express: the rider is taken straight to the destination in about 3 s, for the fare plus `RIDE.expressFee`. */
  express: z.boolean().default(false),
  idempotencyKey: z.uuid(),
});
export const rideCancelSchema = z.object({ reason: z.enum(["rider", "stuck"]).default("rider") });

export const rideStatuses = ["approaching", "waiting", "riding", "completed", "cancelled"] as const;
export type RideStatus = (typeof rideStatuses)[number];

export type RideState = {
  id: string;
  status: RideStatus;
  pickup: [number, number];
  pickupYaw: number;
  dropoff: [number, number];
  label: string;
  fare: number;
  driverName: string;
  plate: string;
  colour: string;
  modelId: string;
  vehicleId: string | null;
  bookedAt: number;
  arrivesAt: number;
  waitUntil: number | null;
  refunded: number;
  message: string | null;
};
