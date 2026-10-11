import { z } from "zod";

/** Ade Auto Works recovery: tow, repair and return the same car. */
export const TOW = {
  truckModelId: "lagoon-pickup",
  truckColour: "#f2b705",
  truckName: "Ade Recovery",
  /** Road speed of the truck; kept to town speeds. */
  truckSpeed: 9,
  /** The truck starts this far back along the road from the car. */
  spawnMetres: 70,
  loadSeconds: 4,
  /** Collection to delivery, accelerated: drive off, repair, return. */
  repairReturnSeconds: 10,
  departSeconds: 2.5,
  returnApproachMetres: 30,
  unloadSeconds: 1.5,
  /** Truck gives up the approach after this and teleports alongside (stuck recovery). */
  approachTimeoutSeconds: 40,
  /** "My current location" needs a road within this distance of the owner. */
  hereRoadRange: 60,
} as const;

export const towStages = ["requested", "arriving", "loading", "collected", "repairing", "returning", "delivered", "cancelled"] as const;
export type TowStage = (typeof towStages)[number];

export const TOW_STAGE_LABEL: Record<TowStage, string> = {
  requested: "Tow requested",
  arriving: "Truck arriving",
  loading: "Loading your car",
  collected: "Collected",
  repairing: "Repairing",
  returning: "Returning",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const towDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home"), propertyId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("here") }),
]);
export type TowDestination = z.infer<typeof towDestinationSchema>;

export const towRequestSchema = z.object({
  vehicleId: z.string().min(1).max(60),
  destination: towDestinationSchema,
  idempotencyKey: z.uuid(),
});
export const towCancelSchema = z.object({ towId: z.string().min(1).max(60) });

export type TowQuote = { repair: number; fullRepair: number; towFee: number; insurer: number; total: number };

export type TowState = {
  id: string;
  vehicleId: string;
  plate: string;
  modelName: string;
  stage: TowStage;
  destinationLabel: string;
  quote: TowQuote;
  /** Truck position while it is in the world. */
  truck: [number, number] | null;
  /** Epoch ms the current stage is expected to end, when known. */
  stageEndsAt: number | null;
  /** Where the car was or will be left. */
  point: [number, number] | null;
  message: string | null;
};
