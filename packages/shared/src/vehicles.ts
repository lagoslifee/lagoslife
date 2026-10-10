import { z } from "zod";

export const vehicleCategories = ["compact", "sedan", "suv", "luxury", "van", "bicycle"] as const;
export type VehicleCategory = (typeof vehicleCategories)[number];
export const vehicleCategoryLabels: Record<VehicleCategory, string> = {
  compact: "Compact",
  sedan: "Saloon",
  suv: "SUV",
  luxury: "Luxury",
  van: "Vans & utility",
  bicycle: "Bicycles",
};

export type VehicleModel = {
  id: string;
  name: string;
  category: VehicleCategory;
  body: "hatch" | "saloon" | "suv" | "pickup" | "van" | "bicycle";
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
  /** Kilograms, with a driver. Heavier vehicles steer and settle more slowly. */
  mass: number;
  wheelRadius: number;
  seats: number;
  colours: string[];
  description: string;
};

/**
 * Original fictional designs drawn procedurally; none depicts a real make or model.
 * Prices are game naira; handling is tuned for city streets.
 */
export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: "eko-hatch",
    name: "Eko Hatch",
    category: "compact",
    body: "hatch",
    price: 120_000,
    topSpeed: 15,
    reverseSpeed: 4,
    acceleration: 3.6,
    braking: 9,
    wheelbase: 2.45,
    maxSteer: 0.6,
    length: 3.8,
    width: 1.7,
    height: 1.48,
    mass: 1_050,
    wheelRadius: 0.3,
    seats: 4,
    colours: ["#c8102e", "#f2f2ee", "#1f3a5f", "#e0b02a"],
    description: "Small, cheap to insure and easy to park on busy Lekki streets.",
  },
  {
    id: "tokunbo-saloon",
    name: "Tokunbo Saloon",
    category: "sedan",
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
    mass: 1_350,
    wheelRadius: 0.32,
    seats: 5,
    colours: ["#d9d9d6", "#101418", "#5b6770", "#7a1c1c"],
    description: "A dependable imported saloon. The classic Lagos family car.",
  },
  {
    id: "island-suv",
    name: "Island SUV",
    category: "suv",
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
    mass: 1_950,
    wheelRadius: 0.37,
    seats: 5,
    colours: ["#101418", "#f2f2ee", "#4b5320", "#2d4a73"],
    description: "Tall, comfortable and quick off the line.",
  },
  {
    id: "admiralty-executive",
    name: "Admiralty Executive",
    category: "luxury",
    body: "saloon",
    price: 950_000,
    topSpeed: 22,
    reverseSpeed: 5,
    acceleration: 4.8,
    braking: 10.5,
    wheelbase: 3.0,
    maxSteer: 0.52,
    length: 5.1,
    width: 1.92,
    height: 1.47,
    mass: 1_900,
    wheelRadius: 0.35,
    seats: 5,
    colours: ["#0c0d10", "#e9e9e4", "#3b3f46", "#23324a"],
    description: "A long, quiet executive saloon with a smooth ride.",
  },
  {
    id: "banana-island-lx",
    name: "Banana Island LX",
    category: "luxury",
    body: "suv",
    price: 1_400_000,
    topSpeed: 21,
    reverseSpeed: 5,
    acceleration: 4.5,
    braking: 10.5,
    wheelbase: 3.05,
    maxSteer: 0.52,
    length: 5.15,
    width: 2.0,
    height: 1.88,
    mass: 2_550,
    wheelRadius: 0.39,
    seats: 7,
    colours: ["#0c0d10", "#f4f4f0", "#5a5048", "#1d3b2f"],
    description: "A full-size luxury SUV with three rows of seats.",
  },
  {
    id: "lagoon-pickup",
    name: "Lagoon Pickup",
    category: "van",
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
    mass: 1_850,
    wheelRadius: 0.37,
    seats: 2,
    colours: ["#f2f2ee", "#2e4d2c", "#3a3f44", "#b5531c"],
    description: "Open cargo bed for deliveries and moving furniture.",
  },
  {
    id: "ojota-minibus",
    name: "Ojota Minibus",
    category: "van",
    body: "van",
    price: 380_000,
    topSpeed: 14.5,
    reverseSpeed: 4,
    acceleration: 2.6,
    braking: 8,
    wheelbase: 3.0,
    maxSteer: 0.5,
    length: 5.0,
    width: 1.95,
    height: 2.2,
    mass: 2_150,
    wheelRadius: 0.34,
    seats: 8,
    colours: ["#f2c200", "#f2f2ee", "#2d4a73", "#8a1c1c"],
    description: "A private eight-seat minibus for families, church groups and parties.",
  },
  {
    id: "yaba-city-bike",
    name: "Yaba City Bike",
    category: "bicycle",
    body: "bicycle",
    price: 35_000,
    topSpeed: 6.5,
    reverseSpeed: 1,
    acceleration: 1.6,
    braking: 5,
    wheelbase: 1.08,
    maxSteer: 0.7,
    length: 1.75,
    width: 0.6,
    height: 1.05,
    mass: 95,
    wheelRadius: 0.34,
    seats: 1,
    colours: ["#1f6f5c", "#c8102e", "#101418", "#e0b02a"],
    description: "A sturdy city bicycle. No fuel, no insurance needed, slow but free to run.",
  },
];

export const vehicleModelById = new Map(VEHICLE_MODELS.map((model) => [model.id, model]));

export function getVehicleModel(id: string) {
  const model = vehicleModelById.get(id);
  if (!model) throw new Error(`Unknown vehicle model ${id}`);
  return model;
}

/**
 * Seat positions relative to the vehicle centre (x to the right, z forward).
 * Seat 0 is the driver, on the left as in Nigeria's right-hand traffic.
 */
export function vehicleSeats(model: VehicleModel): Array<{ x: number; z: number }> {
  if (model.body === "bicycle") return [{ x: 0, z: -0.1 }];
  const across = model.width * 0.22;
  const front = model.length * { hatch: -0.05, saloon: 0.01, suv: 0.06, pickup: 0.06, van: 0.3 }[model.body];
  const seats = [{ x: -across, z: front }, { x: across, z: front }];
  const rest = model.seats - 2;
  const rows = Math.ceil(rest / 3);
  const rowGap = rows ? Math.min(model.body === "van" ? 1.05 : 0.95, (front + model.length / 2 - 0.75) / rows) : 0;
  for (let row = 1; row <= rows; row += 1) {
    const left = model.seats - seats.length;
    const perRow = Math.min(3, left);
    const xs = perRow === 3 ? [-across * 1.3, 0, across * 1.3] : perRow === 2 ? [-across, across] : [-across];
    for (const x of xs) seats.push({ x, z: front - rowGap * row });
  }
  return seats;
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
  /** Locked vehicles admit only their owner; unlocked ones let other players ride as passengers. */
  locked: boolean;
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
  lights: z.boolean().default(false),
  locked: z.boolean().default(true),
  /** Epoch milliseconds when a dealer test drive ends; null for owned vehicles. */
  testDriveEndsAt: z.number().nullable().default(null),
  /** Driven by a non-player driver (Lagos Living Ride). */
  npc: z.boolean().default(false),
  ownerName: z.string(),
  /** Per viewer: true when the receiving player owns this vehicle. */
  mine: z.boolean(),
});
export type WorldVehicle = z.infer<typeof worldVehicleSchema>;

export const purchaseVehicleSchema = z.object({
  modelId: z.string().min(1).max(40),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
  idempotencyKey: z.uuid(),
});
export const vehicleActionSchema = z.object({ idempotencyKey: z.uuid() });
export const garageVehicleSchema = z.object({ propertyId: z.string().min(1).max(100), idempotencyKey: z.uuid() });
export const enterVehicleSchema = z.object({ vehicleId: z.string().min(1).max(60), seat: z.enum(["driver", "passenger"]).optional() });
export const vehicleLockSchema = z.object({ locked: z.boolean() });
export const testDriveSchema = z.object({ modelId: z.string().min(1).max(40), colour: z.string().regex(/^#[0-9a-f]{6}$/i) });

export const TEST_DRIVE = {
  dealerPlaceId: "lekki-motors",
  /** Must be this close to the dealership door to book one. */
  bookRange: 40,
  seconds: 180,
  /** Leaving this radius around the dealership ends the drive and returns the car. */
  radius: 450,
  cooldownMs: 15_000,
} as const;
export const vehicleSignalSchema = z.object({ lights: z.boolean().optional(), horn: z.literal(true).optional() });
export const vehicleImpactSchema = z.object({ speed: z.number().finite().min(0).max(80) });
