import { z } from "zod";

export type VehicleModel = {
  id: string;
  name: string;
  body: "hatch" | "saloon" | "suv" | "pickup";
  price: number;
  /** Metres per second. */
  topSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  braking: number;
  wheelbase: number;
  maxSteer: number;
  length: number;
  width: number;
  height: number;
  colours: string[];
  description: string;
};

/** Fictional models. Prices are game naira; handling is arcade-tuned for city streets. */
export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: "eko-hatch",
    name: "Eko Hatch",
    body: "hatch",
    price: 120_000,
    topSpeed: 15,
    reverseSpeed: 4,
    acceleration: 3.6,
    braking: 9,
    wheelbase: 2.4,
    maxSteer: 0.6,
    length: 3.8,
    width: 1.7,
    height: 1.45,
    colours: ["#c8102e", "#f2f2ee", "#1f3a5f", "#e0b02a"],
    description: "Small, cheap to insure and easy to park on busy Lekki streets.",
  },
  {
    id: "tokunbo-saloon",
    name: "Tokunbo Saloon",
    body: "saloon",
    price: 180_000,
    topSpeed: 17,
    reverseSpeed: 4.5,
    acceleration: 3.4,
    braking: 9,
    wheelbase: 2.7,
    maxSteer: 0.55,
    length: 4.6,
    width: 1.8,
    height: 1.45,
    colours: ["#d9d9d6", "#101418", "#5b6770", "#7a1c1c"],
    description: "A dependable imported saloon. The classic Lagos family car.",
  },
  {
    id: "lagoon-pickup",
    name: "Lagoon Pickup",
    body: "pickup",
    price: 300_000,
    topSpeed: 16.5,
    reverseSpeed: 4.5,
    acceleration: 3.2,
    braking: 8.5,
    wheelbase: 3.0,
    maxSteer: 0.52,
    length: 5.2,
    width: 1.9,
    height: 1.8,
    colours: ["#f2f2ee", "#2e4d2c", "#3a3f44", "#b5531c"],
    description: "Open cargo bed for deliveries and moving furniture.",
  },
  {
    id: "island-suv",
    name: "Island SUV",
    body: "suv",
    price: 420_000,
    topSpeed: 19,
    reverseSpeed: 5,
    acceleration: 4.2,
    braking: 10,
    wheelbase: 2.85,
    maxSteer: 0.55,
    length: 4.8,
    width: 1.95,
    height: 1.8,
    colours: ["#101418", "#f2f2ee", "#4b5320", "#2d4a73"],
    description: "Tall, comfortable and quick off the line.",
  },
];

export const vehicleModelById = new Map(VEHICLE_MODELS.map((model) => [model.id, model]));

export function getVehicleModel(id: string) {
  const model = vehicleModelById.get(id);
  if (!model) throw new Error(`Unknown vehicle model ${id}`);
  return model;
}

export const VEHICLE_RULES = {
  /** Below this condition the engine runs in limp mode. */
  limpCondition: 30,
  limpSpeedFactor: 0.55,
  /** Interaction range for entering a parked vehicle (metres from its centre). */
  enterRange: 3.6,
  /** Vehicle must be parked within this distance of the mechanic's kerb to be serviced. */
  workshopRange: 18,
  /** Vehicle must be parked within this distance of a held home's kerb to be garaged. */
  garageRange: 25,
  routineServiceFee: 2_500,
  serviceIntervalMetres: 25_000,
  insuredExcess: 2_000,
  towFee: 4_000,
  insuranceDays: 7,
  /** Weekly comprehensive premium as a share of the purchase price. */
  insuranceRate: 0.03,
  /** Repair cost per condition point as a share of the purchase price. */
  repairRatePerPoint: 0.0015,
  impactMinSpeed: 3,
  impactDamagePerMps: 2.5,
  impactMaxDamage: 35,
} as const;

export function effectiveTopSpeed(model: VehicleModel, condition: number) {
  if (condition <= 0) return 0;
  return condition < VEHICLE_RULES.limpCondition ? model.topSpeed * VEHICLE_RULES.limpSpeedFactor : model.topSpeed;
}

export function repairCost(model: VehicleModel, condition: number) {
  const points = Math.max(0, 100 - condition);
  return Math.round((points * model.price * VEHICLE_RULES.repairRatePerPoint) / 50) * 50;
}

export function insurancePremium(model: VehicleModel) {
  return Math.round((model.price * VEHICLE_RULES.insuranceRate) / 50) * 50;
}

export function impactDamage(speed: number) {
  if (speed < VEHICLE_RULES.impactMinSpeed) return 0;
  return Math.min(VEHICLE_RULES.impactMaxDamage, Math.round((speed - VEHICLE_RULES.impactMinSpeed + 1) * VEHICLE_RULES.impactDamagePerMps));
}

/** Kerbside parking slots fan out from the kerb point along the lane: 0, +7, -7, +14, ... */
export function kerbSlot(kerb: readonly [number, number], kerbYaw: number, index: number): [number, number] {
  const step = Math.ceil(index / 2) * 7 * (index % 2 === 1 ? 1 : -1);
  return [kerb[0] + Math.sin(kerbYaw) * step, kerb[1] + Math.cos(kerbYaw) * step];
}

export const vehicleStatuses = ["parked", "garaged", "driving"] as const;
export type VehicleStatus = (typeof vehicleStatuses)[number];

export type OwnedVehicle = {
  id: string;
  modelId: string;
  colour: string;
  plate: string;
  condition: number;
  odometerMetres: number;
  metresSinceService: number;
  status: VehicleStatus;
  x: number | null;
  z: number | null;
  yaw: number | null;
  garagePropertyId: string | null;
  insuredUntil: string | null;
};

/** What other players need to draw a vehicle. */
export const worldVehicleSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  colour: z.string(),
  plate: z.string(),
  x: z.number().finite(),
  z: z.number().finite(),
  yaw: z.number().finite(),
  driverSessionId: z.string().nullable(),
  ownerName: z.string(),
});
export type WorldVehicle = z.infer<typeof worldVehicleSchema>;

export const purchaseVehicleSchema = z.object({
  modelId: z.string().min(1).max(40),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
  idempotencyKey: z.uuid(),
});
export const vehicleActionSchema = z.object({ idempotencyKey: z.uuid() });
export const garageVehicleSchema = z.object({ propertyId: z.string().min(1).max(100), idempotencyKey: z.uuid() });
export const enterVehicleSchema = z.object({ vehicleId: z.string().min(1).max(60) });
export const vehicleImpactSchema = z.object({ speed: z.number().finite().min(0).max(80) });
