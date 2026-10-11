import { z } from "zod";

/** Lagos Living Ride: fictional NPC ride-hailing, paid in game naira. */
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
  driverSpeed: 9,
  modelId: "tokunbo-saloon",
  boardRange: 7,
  /** Drop-off counts as arrived within this distance of the destination's road point. */
  arriveRange: 40,
} as const;

export function rideFare(roadMetres: number) {
  return Math.round((RIDE.baseFare + (roadMetres / 1000) * RIDE.perKm) / 50) * 50;
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
