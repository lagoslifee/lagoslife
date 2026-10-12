import { z } from "zod";
import { VEHICLE_ASSETS } from "./vehicle-assets.js";
import { REAL_VEHICLE_ASSETS } from "./vehicle-assets-real.js";

export const vehicleCategories = ["compact", "sedan", "suv", "luxury", "sports", "van", "bicycle"] as const;
export type VehicleCategory = (typeof vehicleCategories)[number];
export const vehicleCategoryLabels: Record<VehicleCategory, string> = {
  compact: "Compact",
  sedan: "Saloon",
  suv: "SUV",
  luxury: "Luxury",
  sports: "Sports & supercars",
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
  /** Modelled vehicles: the GLB and the cabin fitted to it, in vehicle space (metres; x right, y up from the ground, z forward). */
  asset?: VehicleAsset;
};

export type VehicleAsset = {
  url: string;
  /** Where the model came from (see docs/ASSET_MANIFEST.md). */
  source: string;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  wheelRadius: number;
  /** Distance from the centre line to each wheel's mid-plane. */
  track: number;
  /** Seat 0 is the driver. `y` is the seated avatar's root height. */
  seats: Array<{ x: number; y: number; z: number }>;
  /** Centre of the steering wheel. */
  steering: { x: number; y: number; z: number };
  /** The paint is textured (white with baked detail) and tinted by the chosen colour, rather than plain colour. */
  paintTexture?: boolean;
};

/**
 * Lekki Motors' own budget range, under fictional names. Cars use modelled bodies from
 * Kenney's CC0 Car Kit with fitted cabins, and take their size, wheels and seats from the built model
 * (`VEHICLE_ASSETS`); the bicycle is drawn procedurally. Prices are game naira; handling suits city streets.
 */
const CATALOGUE: VehicleModel[] = [
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
    wheelbase: 1.98,
    maxSteer: 0.45,
    length: 4.05,
    width: 1.88,
    height: 1.95,
    mass: 1_850,
    wheelRadius: 0.45,
    seats: 5,
    colours: ["#2f8f6a", "#101418", "#f2f2ee", "#4b5320", "#2d4a73"],
    description: "A short, tall three-door off-roader with a rear-mounted spare. Seats five and shrugs off potholes.",
  },
  {
    id: "admiralty-executive",
    name: "Admiralty Sport",
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
    seats: 4,
    colours: ["#0c0d10", "#e9e9e4", "#3b3f46", "#23324a"],
    description: "A low four-seat sports saloon with a rear wing. The quickest car on the forecourt.",
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

const WHITE = "#f2f2ee";
const BLACK = "#101418";
const SILVER = "#b9bcc0";
type RealCar = Omit<VehicleModel, "reverseSpeed" | "braking" | "wheelbase" | "maxSteer" | "length" | "width" | "height" | "wheelRadius" | "asset"> &
  Partial<Pick<VehicleModel, "braking" | "maxSteer">>;

/**
 * Real makes and models, generated with Meshy (see docs/ASSET_MANIFEST.md). Size, wheels and seats come from the
 * built model; a car is only listed once its model has been built.
 */
const REAL_CATALOGUE: RealCar[] = [
  { id: "toyota-corolla", name: "Toyota Corolla", category: "sedan", body: "saloon", price: 240_000, topSpeed: 17, acceleration: 3.5, mass: 1_350, seats: 5, colours: [WHITE, SILVER, BLACK, "#8a1c1c", "#1f3a5f"], description: "Nigeria's favourite saloon. Cheap to run, easy to sell on." },
  { id: "toyota-camry", name: "Toyota Camry", category: "sedan", body: "saloon", price: 340_000, topSpeed: 18, acceleration: 3.7, mass: 1_550, seats: 5, colours: [WHITE, BLACK, SILVER, "#3a3f46", "#7a1c1c"], description: "The Lagos executive's classic \"Muscle\" Camry. Roomy, smooth and reliable." },
  { id: "honda-accord", name: "Honda Accord", category: "sedan", body: "saloon", price: 320_000, topSpeed: 18, acceleration: 3.8, mass: 1_500, seats: 5, colours: [WHITE, BLACK, SILVER, "#1f3a5f", "#5b6770"], description: "A sharp, sporty family saloon with a comfortable ride." },
  { id: "lexus-rx350", name: "Lexus RX 350", category: "suv", body: "suv", price: 750_000, topSpeed: 19.5, acceleration: 4.1, mass: 1_950, seats: 5, colours: [WHITE, BLACK, SILVER, "#5a5048", "#23324a"], description: "Quiet, plush crossover. A status symbol on every Lekki estate road." },
  { id: "toyota-land-cruiser", name: "Toyota Land Cruiser", category: "suv", body: "suv", price: 1_800_000, topSpeed: 19, acceleration: 3.9, mass: 2_600, seats: 7, colours: [WHITE, BLACK, SILVER, "#4b5320", "#5a5048"], description: "Seven-seat go-anywhere SUV. Floods and potholes don't slow it down." },
  { id: "toyota-hilux", name: "Toyota Hilux", category: "van", body: "pickup", price: 520_000, topSpeed: 17, acceleration: 3.3, mass: 2_100, seats: 5, colours: [WHITE, SILVER, BLACK, "#8a1c1c", "#2e4d2c"], description: "Double-cab workhorse with an open bed for deliveries and moving day." },
  { id: "toyota-sienna", name: "Toyota Sienna", category: "van", body: "van", price: 600_000, topSpeed: 17, acceleration: 3.2, mass: 2_100, seats: 8, colours: [WHITE, SILVER, BLACK, "#1f3a5f", "#5b6770"], description: "Eight-seat minivan with sliding doors. The school-run and church-run favourite." },
  { id: "range-rover", name: "Range Rover", category: "luxury", body: "suv", price: 3_400_000, topSpeed: 21, acceleration: 4.6, mass: 2_500, seats: 5, colours: [WHITE, BLACK, SILVER, "#2d4a3a", "#3b3f46"], description: "Full-size British luxury SUV. Banana Island's default setting." },
  { id: "mercedes-g63", name: "Mercedes-AMG G 63", category: "luxury", body: "suv", price: 4_800_000, topSpeed: 22, acceleration: 5.2, mass: 2_550, seats: 5, colours: [BLACK, WHITE, SILVER, "#4b5320", "#7a1c1c"], description: "The boxy \"G-Wagon\". Loud, square and impossible to ignore." },
  { id: "mercedes-s-class", name: "Mercedes-Benz S-Class", category: "luxury", body: "saloon", price: 4_200_000, topSpeed: 22, acceleration: 4.9, mass: 2_100, seats: 5, colours: [BLACK, WHITE, SILVER, "#23324a", "#3b3f46"], description: "The chairman's limousine. Sit in the back and let someone else drive." },
  { id: "mercedes-gle", name: "Mercedes-Benz GLE", category: "suv", body: "suv", price: 2_000_000, topSpeed: 20.5, acceleration: 4.5, mass: 2_250, seats: 5, colours: [WHITE, BLACK, SILVER, "#23324a", "#5a5048"], description: "Mid-size Mercedes SUV with a big presence and a soft ride." },
  { id: "bmw-x5", name: "BMW X5", category: "suv", body: "suv", price: 1_900_000, topSpeed: 20.5, acceleration: 4.6, mass: 2_200, seats: 5, colours: [WHITE, BLACK, SILVER, "#1f3a5f", "#3b3f46"], description: "Sporty, sharp-handling SUV that still fits the whole family." },
  { id: "bmw-m4", name: "BMW M4", category: "sports", body: "saloon", price: 2_800_000, topSpeed: 25, acceleration: 6, mass: 1_700, seats: 4, colours: [WHITE, BLACK, "#1f5fbf", "#e0b02a", "#c8102e"], description: "Two-door performance coupe. Quick off the lights on Ozumba Mbadiwe." },
  { id: "porsche-911", name: "Porsche 911", category: "sports", body: "saloon", price: 4_500_000, topSpeed: 27, acceleration: 6.6, mass: 1_500, seats: 4, colours: [WHITE, BLACK, SILVER, "#c8102e", "#e0b02a"], description: "The everyday sports car. Rear engine, perfect balance, iconic shape." },
  { id: "porsche-cayenne", name: "Porsche Cayenne", category: "suv", body: "suv", price: 2_600_000, topSpeed: 21.5, acceleration: 5, mass: 2_100, seats: 5, colours: [WHITE, BLACK, SILVER, "#23324a", "#7a1c1c"], description: "A sports car you can take the whole family in." },
  { id: "ferrari-f8", name: "Ferrari F8 Tributo", category: "sports", body: "saloon", price: 9_800_000, topSpeed: 30, acceleration: 7.6, mass: 1_450, seats: 2, maxSteer: 0.5, braking: 12, colours: ["#c4161c", "#f2c200", BLACK, WHITE, "#1f5fbf"], description: "Mid-engined Italian supercar. Rosso red is the only correct answer." },
  { id: "lamborghini-huracan", name: "Lamborghini Huracán", category: "sports", body: "saloon", price: 10_500_000, topSpeed: 30, acceleration: 7.8, mass: 1_500, seats: 2, maxSteer: 0.5, braking: 12, colours: ["#9bd318", "#f2a900", "#e05a00", BLACK, WHITE], description: "Wedge-shaped V10 supercar. Every head on Admiralty Way will turn." },
  { id: "lamborghini-urus", name: "Lamborghini Urus", category: "sports", body: "suv", price: 8_200_000, topSpeed: 27, acceleration: 6.8, mass: 2_250, seats: 5, braking: 11.5, colours: ["#f2c200", BLACK, WHITE, "#e05a00", "#3b3f46"], description: "The super-SUV. Supercar speed with room for four friends." },
  { id: "rolls-royce-cullinan", name: "Rolls-Royce Cullinan", category: "luxury", body: "suv", price: 15_000_000, topSpeed: 22, acceleration: 4.8, mass: 2_750, seats: 5, colours: [BLACK, WHITE, SILVER, "#23324a", "#5a1c2a"], description: "The most expensive thing on four wheels in Lagos. Arrive like royalty." },
  { id: "bentley-continental-gt", name: "Bentley Continental GT", category: "luxury", body: "saloon", price: 9_200_000, topSpeed: 26, acceleration: 6, mass: 2_250, seats: 4, colours: [WHITE, BLACK, "#1d3b2f", "#23324a", "#7a1c1c"], description: "Hand-built British grand tourer. Fast, plush and very, very green." },
];

/** Popular Lagos paint options offered on every real model alongside its own colours. */
const POPULAR_PAINTS = ["#8a1c1c", "#1f3a5f", "#2e4d2c", "#5b6770", "#c8102e", "#1f5fbf", "#e0b02a", "#6b2d5c", "#0f6b6b", "#b5651d"];

const realModels: VehicleModel[] = REAL_CATALOGUE.filter((car) => REAL_VEHICLE_ASSETS[car.id]).map((car) => ({
  braking: 10,
  maxSteer: 0.52,
  ...car,
  colours: [...new Set([...car.colours, ...POPULAR_PAINTS])],
  reverseSpeed: 5,
  wheelbase: 0,
  length: 0,
  width: 0,
  height: 0,
  wheelRadius: 0,
}));

const ASSETS: Record<string, VehicleAsset> = { ...VEHICLE_ASSETS, ...REAL_VEHICLE_ASSETS };

/**
 * The catalogue figures are real-world-ish; the map is a compact Lagos, so motor vehicles run faster than life to
 * keep most drives to two or three minutes (Lekki to Ikoyi about 3 in a saloon). Bicycles stay at their natural pace.
 */
export const SPEED_SCALE = { topSpeed: 2.5, acceleration: 2.2, braking: 1.6 } as const;
/** Game-wide speed limit: no car goes faster than 150 km/h. */
export const MAX_VEHICLE_SPEED = 150 / 3.6;

function scaled(model: VehicleModel): VehicleModel {
  if (model.body === "bicycle") return model;
  return {
    ...model,
    topSpeed: Math.min(MAX_VEHICLE_SPEED, model.topSpeed * SPEED_SCALE.topSpeed),
    acceleration: model.acceleration * SPEED_SCALE.acceleration,
    braking: model.braking * SPEED_SCALE.braking,
  };
}

export const VEHICLE_MODELS: VehicleModel[] = [...CATALOGUE, ...realModels].map((base) => {
  const model = scaled(base);
  const asset = ASSETS[model.id];
  if (!asset) return model;
  const { length, width, height, wheelbase, wheelRadius } = asset;
  return { ...model, length, width, height, wheelbase, wheelRadius, seats: asset.seats.length, asset };
});

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
  if (model.asset) return model.asset.seats.map(({ x, z }) => ({ x, z }));
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
  /** Contacts slower than this (about 16 km/h) are scrapes: parking taps and kerb brushes do no damage. */
  impactMinSpeed: 4.5,
  impactDamagePerMps: 2.5,
  impactMaxDamage: 35,
  /** Scales every collision; 1 is the original tuning. The server can override it with VEHICLE_DAMAGE_MULTIPLIER. */
  damageMultiplier: 0.25,
  /** Impacts from this speed (about 58 km/h) are severe: the only kind that can take a car below `minorFloor`. */
  severeImpactSpeed: 16,
  minorFloor: 15,
  /** The engine warning light comes on below this condition. */
  warnCondition: 50,
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

/** Condition lost in one impact (one per impact, never per frame). */
export function impactDamage(speed: number, multiplier: number = VEHICLE_RULES.damageMultiplier) {
  if (speed < VEHICLE_RULES.impactMinSpeed || multiplier <= 0) return 0;
  const base = Math.min(VEHICLE_RULES.impactMaxDamage, (speed - VEHICLE_RULES.impactMinSpeed + 1) * VEHICLE_RULES.impactDamagePerMps);
  return Math.max(1, Math.round(base * multiplier));
}

export function impactSeverity(speed: number): "none" | "minor" | "severe" {
  if (speed < VEHICLE_RULES.impactMinSpeed) return "none";
  return speed >= VEHICLE_RULES.severeImpactSpeed ? "severe" : "minor";
}

/** Condition after an impact: lesser knocks never take a car below `minorFloor`, so it stays drivable. */
export function conditionAfterImpact(condition: number, damage: number, severe: boolean) {
  const floor = severe ? 0 : Math.min(condition, VEHICLE_RULES.minorFloor);
  return Math.max(floor, condition - damage);
}

/** Kerbside parking slots fan out from the kerb point along the lane: 0, +7, -7, +14, ... */
export function kerbSlot(kerb: readonly [number, number], kerbYaw: number, index: number): [number, number] {
  const step = Math.ceil(index / 2) * 7 * (index % 2 === 1 ? 1 : -1);
  return [kerb[0] + Math.sin(kerbYaw) * step, kerb[1] + Math.cos(kerbYaw) * step];
}

export const vehicleStatuses = ["parked", "garaged", "driving", "towing"] as const;
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
  /** Hired bicycle: when the meter started. */
  rentalStartedAt: z.number().nullable().default(null),
  /** Driven by a non-player driver (Lagos Living Ride). */
  npc: z.boolean().default(false),
  /** Recovery truck: the car on its bed (if loaded) and how far the winch has raised it (0–1). */
  tow: z
    .object({ carrying: z.object({ modelId: z.string(), colour: z.string(), plate: z.string() }).nullable(), lift: z.number().min(0).max(1) })
    .nullable()
    .default(null),
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
