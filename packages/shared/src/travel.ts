import { z } from "zod";
import { districtAt, INTERIOR_ORIGIN, type Vec2 } from "./world.js";

/**
 * Lagos ⇄ Dubai holidays. All prices are game naira; nothing here is real-world money or a real airline,
 * consulate or visa. Dubai places are a compact, partly fictional recreation of Dubai Marina and JBR.
 */

export const DUBAI_DISTRICT_IDS = ["dubai-marina", "jbr", "dubai-desert"] as const;
export type TravelRegion = "lagos" | "dubai";

export function regionOf(x: number, z: number): TravelRegion {
  const district = districtAt(x, z);
  return district && (DUBAI_DISTRICT_IDS as readonly string[]).includes(district.id) ? "dubai" : "lagos";
}

/** Distance to a place's door; open-air places with no building (piers, beaches, viewpoints) can also be used from their kerb. */
export function placeDistance(place: { door: Vec2; kerb: Vec2; buildingId: number | null }, x: number, z: number) {
  const door = Math.hypot(place.door[0] - x, place.door[1] - z);
  return place.buildingId !== null ? door : Math.min(door, Math.hypot(place.kerb[0] - x, place.kerb[1] - z));
}

export const TRAVEL_PLACES = {
  lagosAirport: "lagos-air-terminal",
  consulate: "dubai-consular-office",
  dubaiAirport: "dubai-arrivals",
  pier: "marina-dhow-pier",
  desertCamp: "desert-camp",
  rooftop: "skyline-rooftop",
  carRental: "dubai-car-rental",
  boutique: "marina-boutique",
  souvenirs: "marina-souvenirs",
} as const;

export const cabinClasses = ["economy", "business"] as const;
export type CabinClass = (typeof cabinClasses)[number];

export const CABINS: Record<CabinClass, { name: string; fare: number; perks: string[]; seat: string }> = {
  economy: {
    name: "Economy",
    fare: 95_000,
    seat: "Standard seat, 3–3 layout, 79 cm pitch",
    perks: ["Return flights Lagos ⇄ Dubai", "Assigned window, middle or aisle seat", "Soft drink and snack service", "One checked bag"],
  },
  business: {
    name: "Business",
    fare: 280_000,
    seat: "Wide recliner, 2–2 layout, 120 cm legroom",
    perks: ["Return flights Lagos ⇄ Dubai", "Wide seat with extra legroom up front", "Lounge access at both airports", "Hot meal and drinks served at your seat", "Priority boarding and two checked bags"],
  },
};

export const TRAVEL = {
  /** Return tickets can be cancelled for free this soon after buying. */
  freeCancelMinutes: 10,
  /** After the free window and before the outbound flight, this share of the fare is kept. */
  cancelFeeRate: 0.1,
  /** Pending friend invitations lapse after this long. */
  inviteMinutes: 30,
  maxInvites: 5,
  /** Doors close this long after the first passenger boards; anyone boarding meanwhile shares the flight. */
  boardingSeconds: 10,
  /** The flight itself: takeoff, cruise with service, descent and landing. */
  flightSeconds: 60,
  takeoffEnds: 15,
  cruiseEnds: 45,
  /** Counters and gates are used standing within this distance of their spot. */
  counterRange: 2.6,
  /** One hotel night is this many real hours. Stays are paid up front, so nothing is charged while offline. */
  hotelNightHours: 2,
  maxNights: 7,
  visaProcessingSeconds: 8,
} as const;

export const visaPlans = ["single-14", "multi-30"] as const;
export type VisaPlan = (typeof visaPlans)[number];
export const VISA_PLANS: Record<VisaPlan, { name: string; visits: number; days: number; fee: number }> = {
  "single-14": { name: "14-day single-visit tourist visa", visits: 1, days: 14, fee: 20_000 },
  "multi-30": { name: "30-day multiple-visit tourist visa", visits: 3, days: 30, fee: 45_000 },
};
export const CONSULATE_NAME = "Dubai Travel Consular Office — Game Roleplay";
export const CONSULATE_NOTICE = "Fictional office for in-game roleplay only. It is not a government office and issues no real documents.";

export const roomTypes = ["standard", "suite", "luxury"] as const;
export type RoomType = (typeof roomTypes)[number];
export type HotelRoom = { type: RoomType; name: string; capacity: number; perNight: number; amenities: string[] };
export type Hotel = { id: string; name: string; tier: "budget" | "mid" | "luxury"; blurb: string; rooms: HotelRoom[] };

export const HOTELS: Hotel[] = [
  {
    id: "marina-sands-inn",
    name: "Marina Sands Inn",
    tier: "budget",
    blurb: "Simple, clean rooms a short walk from the Marina Walk. Fictional hotel.",
    rooms: [
      { type: "standard", name: "Standard double", capacity: 2, perNight: 6_000, amenities: ["Double bed", "Wardrobe with safe", "Wi-Fi", "Shower room"] },
      { type: "suite", name: "Junior suite", capacity: 3, perNight: 11_000, amenities: ["King bed", "Sofa bed", "Marina view", "Wardrobe with safe", "Room service"] },
    ],
  },
  {
    id: "jbr-palm-suites",
    name: "JBR Palm Suites",
    tier: "mid",
    blurb: "Beachfront towers on The Walk at JBR. Fictional hotel.",
    rooms: [
      { type: "standard", name: "Sea-view room", capacity: 2, perNight: 15_000, amenities: ["King bed", "Sea view", "Wardrobe with safe", "Minibar", "Room service"] },
      { type: "suite", name: "Family suite", capacity: 4, perNight: 26_000, amenities: ["King bed and twin room", "Lounge", "Balcony", "Wardrobe with safe", "Room service"] },
    ],
  },
  {
    id: "marina-crown-hotel",
    name: "Marina Crown Hotel",
    tier: "luxury",
    blurb: "A five-star tower with skyline suites over the marina. Fictional hotel.",
    rooms: [
      { type: "suite", name: "Skyline suite", capacity: 3, perNight: 40_000, amenities: ["Emperor bed", "Floor-to-ceiling skyline view", "Lounge", "Walk-in wardrobe and safe", "24-hour room service"] },
      { type: "luxury", name: "Royal penthouse", capacity: 6, perNight: 90_000, amenities: ["Two bedrooms", "Private dining table", "Panoramic terrace view", "Butler room service", "Walk-in wardrobe and safe"] },
    ],
  },
];
export const hotelById = new Map(HOTELS.map((hotel) => [hotel.id, hotel]));
export function hotelRoom(hotelId: string, type: RoomType) {
  return hotelById.get(hotelId)?.rooms.find((room) => room.type === type) ?? null;
}

export const ROOM_SERVICE = [
  { id: "karak-tea", name: "Karak tea", price: 1_200, hunger: 2, energy: 6 },
  { id: "fresh-juice", name: "Fresh mango juice", price: 2_000, hunger: 4, energy: 4 },
  { id: "chicken-shawarma", name: "Chicken shawarma plate", price: 3_500, hunger: 25, energy: 3 },
  { id: "mezze", name: "Mezze platter", price: 5_500, hunger: 30, energy: 4 },
  { id: "machboos", name: "Lamb machboos", price: 7_500, hunger: 40, energy: 5 },
] as const;
export const ROOFTOP_MENU = [
  { id: "mocktail", name: "Signature mocktail", price: 3_000, hunger: 2, energy: 6 },
  { id: "sunset-platter", name: "Sunset sharing platter", price: 9_000, hunger: 30, energy: 4 },
  { id: "skyline-dinner", name: "Three-course skyline dinner", price: 18_000, hunger: 60, energy: 8 },
] as const;

export const activityIds = ["dhow-cruise", "desert-safari"] as const;
export type ActivityId = (typeof activityIds)[number];
export const ACTIVITIES: Record<ActivityId, { name: string; price: number; seconds: number; placeId: string; blurb: string }> = {
  "dhow-cruise": {
    name: "Marina dhow cruise",
    price: 12_000,
    seconds: 40,
    placeId: TRAVEL_PLACES.pier,
    blurb: "A wooden dhow loops the marina past the towers and out to the beach. Karak tea on board.",
  },
  "desert-safari": {
    name: "Desert safari",
    price: 25_000,
    seconds: 45,
    placeId: TRAVEL_PLACES.desertCamp,
    blurb: "A 4×4 runs you over the dunes to a fictional Bedouin-style camp for photos at sunset.",
  },
};

export const RENTAL_CARS = [
  { modelId: "mercedes-g63", perHour: 18_000 },
  { modelId: "range-rover", perHour: 15_000 },
  { modelId: "porsche-911", perHour: 25_000 },
  { modelId: "lamborghini-urus", perHour: 35_000 },
] as const;
export const CAR_RENTAL = { maxHours: 3, range: 30 } as const;

/** Items sold in Dubai. Outfit items unlock the matching wardrobe outfit everywhere, including back in Lagos. */
export const TRAVEL_SHOP = [
  { id: "outfit:kandura", name: "White kandura", vendor: TRAVEL_PLACES.boutique, price: 18_000, category: "clothing", description: "Crisp ankle-length robe. Wear it from your wardrobe." },
  { id: "outfit:abaya", name: "Black abaya", vendor: TRAVEL_PLACES.boutique, price: 18_000, category: "clothing", description: "Flowing black abaya. Wear it from your wardrobe." },
  { id: "outfit:resort-linen", name: "Resort linen set", vendor: TRAVEL_PLACES.boutique, price: 22_000, category: "clothing", description: "Light linen shirt and trousers for warm evenings." },
  { id: "outfit:beach-day", name: "Beach day outfit", vendor: TRAVEL_PLACES.boutique, price: 12_000, category: "clothing", description: "Bright shirt and shorts for JBR beach." },
  { id: "souvenir:snow-globe", name: "Marina snow globe", vendor: TRAVEL_PLACES.souvenirs, price: 4_500, category: "souvenir", description: "Glass globe with the marina skyline inside." },
  { id: "souvenir:dates", name: "Box of Medjool dates", vendor: TRAVEL_PLACES.souvenirs, price: 6_000, category: "souvenir", description: "A gift box to bring home to Lagos." },
  { id: "souvenir:camel", name: "Camel plush", vendor: TRAVEL_PLACES.souvenirs, price: 3_500, category: "souvenir", description: "Soft toy camel in a tiny scarf." },
  { id: "souvenir:dhow-model", name: "Wooden dhow model", vendor: TRAVEL_PLACES.souvenirs, price: 9_000, category: "souvenir", description: "Hand-finished model of a marina dhow." },
  { id: "souvenir:oud", name: "Oud perfume", vendor: TRAVEL_PLACES.souvenirs, price: 14_000, category: "souvenir", description: "A small bottle of rich oud scent." },
] as const;

/* ---------- Interiors ---------- */

export type TravelInterior = "consulate" | "airport-los" | "airport-dxb" | "cabin" | "hotel" | "rooftop" | "dhow" | "safari";
type Layout = { half: Vec2; spawn: Vec2; spots: Record<string, Vec2> };
/** Offsets from INTERIOR_ORIGIN; +z is north (away from the entrance). */
export const TRAVEL_LAYOUTS: Record<TravelInterior, Layout> = {
  consulate: { half: [7, 5.5], spawn: [0, -4.2], spots: { exit: [0, -5.0], reception: [-4, -2.2], counter: [2.6, 3.4], seats: [-3.2, 1.6] } },
  "airport-los": {
    half: [16, 10],
    spawn: [0, -8.4],
    spots: { exit: [0, -9.4], tickets: [-12.5, -3.5], checkin: [-12.5, 2.5], board: [-4, -6], lounge: [11.5, 5.5], gate: [0, 8.8] },
  },
  "airport-dxb": {
    half: [16, 10],
    spawn: [8, 8.4],
    spots: { exit: [0, -9.4], immigration: [8, 3.2], baggage: [12, -3.5], tickets: [-12.5, -3.5], checkin: [-12.5, 2.5], lounge: [-11.5, 7.2], gate: [-4, 8.8] },
  },
  cabin: { half: [1.9, 12.5], spawn: [0, 0], spots: { galley: [0, 11.2] } },
  hotel: { half: [6.2, 5], spawn: [0, -3.8], spots: { exit: [0, -4.6], bed: [-3.4, 2.2], storage: [5.2, 0.4], service: [2.6, 3.8], view: [0, 4.4] } },
  rooftop: { half: [9, 7], spawn: [0, -5.8], spots: { exit: [0, -6.6], bar: [-6.6, 0], photo: [0, 6.2], dining: [5, 2] } },
  dhow: { half: [2.4, 7.5], spawn: [0, 0], spots: {} },
  safari: { half: [1.6, 3], spawn: [0, 0], spots: {} },
};

/** Bench seats on the dhow deck and in the open safari 4×4, as offsets; avatars face +z, or sideways on the dhow. */
export const EXCURSION_SEATS: Record<"dhow" | "safari", Array<{ at: Vec2; yaw: number }>> = {
  dhow: [-4.5, -3, -1.5, 0, 1.5, 3].flatMap((z) => [
    { at: [-1.55, z] as Vec2, yaw: Math.PI / 2 },
    { at: [1.55, z] as Vec2, yaw: -Math.PI / 2 },
  ]),
  safari: [
    { at: [-0.45, 0.6], yaw: 0 },
    { at: [0.45, 0.6], yaw: 0 },
    { at: [-0.45, -0.5], yaw: 0 },
    { at: [0.45, -0.5], yaw: 0 },
    { at: [-0.45, -1.5], yaw: 0 },
    { at: [0.45, -1.5], yaw: 0 },
  ],
};
export function excursionSeat(kind: "dhow" | "safari", index: number) {
  const seats = EXCURSION_SEATS[kind];
  const seat = seats[index % seats.length]!;
  return { point: [INTERIOR_ORIGIN[0] + seat.at[0], INTERIOR_ORIGIN[1] + seat.at[1]] as Vec2, yaw: seat.yaw };
}

export function travelSpot(kind: TravelInterior, spot: string): Vec2 | null {
  const offset = TRAVEL_LAYOUTS[kind].spots[spot];
  return offset ? [INTERIOR_ORIGIN[0] + offset[0], INTERIOR_ORIGIN[1] + offset[1]] : null;
}
export function travelSpawn(kind: TravelInterior): Vec2 {
  const [x, z] = TRAVEL_LAYOUTS[kind].spawn;
  return [INTERIOR_ORIGIN[0] + x, INTERIOR_ORIGIN[1] + z];
}

/** Which travel interior a server location string is, if any. */
export function travelInteriorOf(location: string): TravelInterior | null {
  if (location === "consulate") return "consulate";
  if (location === "airport:los") return "airport-los";
  if (location === "airport:dxb") return "airport-dxb";
  if (location.startsWith("flight:")) return "cabin";
  if (location.startsWith("hotel:")) return "hotel";
  if (location === "rooftop") return "rooftop";
  if (location.startsWith("excursion:dhow-cruise")) return "dhow";
  if (location.startsWith("excursion:desert-safari")) return "safari";
  return null;
}

/* ---------- Cabin seats ---------- */

const BUSINESS_ROWS = [1, 2, 3];
const ECONOMY_ROWS = Array.from({ length: 15 }, (_, index) => 10 + index);
const BUSINESS_LETTERS = { A: -1.2, C: -0.5, D: 0.5, F: 1.2 } as const;
const ECONOMY_LETTERS = { A: -1.36, B: -0.92, C: -0.48, D: 0.48, E: 0.92, F: 1.36 } as const;

export function cabinSeats(cabin: CabinClass): string[] {
  return cabin === "business"
    ? BUSINESS_ROWS.flatMap((row) => Object.keys(BUSINESS_LETTERS).map((letter) => `${row}${letter}`))
    : ECONOMY_ROWS.flatMap((row) => Object.keys(ECONOMY_LETTERS).map((letter) => `${row}${letter}`));
}

export function seatCabin(seat: string): CabinClass {
  return Number.parseInt(seat, 10) < 10 ? "business" : "economy";
}

/** Seat position in the cabin (world coordinates) and how far the seat is from the aisle. Avatars face +z (forward). */
export function seatPoint(seat: string): Vec2 {
  const row = Number.parseInt(seat, 10);
  const letter = seat.replace(/^\d+/, "");
  const [ox, oz] = INTERIOR_ORIGIN;
  if (row < 10) {
    const x = BUSINESS_LETTERS[letter as keyof typeof BUSINESS_LETTERS] ?? 0;
    return [ox + x, oz + 8.4 - (row - 1) * 1.7];
  }
  const x = ECONOMY_LETTERS[letter as keyof typeof ECONOMY_LETTERS] ?? 0;
  return [ox + x, oz + 2.6 - (row - 10) * 0.82];
}

export function seatLabel(seat: string) {
  const letter = seat.replace(/^\d+/, "");
  const where = letter === "A" || letter === "F" ? "window" : letter === "C" || letter === "D" ? "aisle" : "middle";
  return `Seat ${seat} · ${where}`;
}

/* ---------- Flight clock ---------- */

export type FlightPhase = "boarding" | "takeoff" | "cruise" | "descent" | "landed";
export function flightPhase(departAt: number, now: number): FlightPhase {
  const seconds = (now - departAt) / 1_000;
  if (seconds < 0) return "boarding";
  if (seconds < TRAVEL.takeoffEnds) return "takeoff";
  if (seconds < TRAVEL.cruiseEnds) return "cruise";
  if (seconds < TRAVEL.flightSeconds) return "descent";
  return "landed";
}

export const legs = ["outbound", "return"] as const;
export type Leg = (typeof legs)[number];
const LEG_ROUTES = {
  outbound: { from: "los", to: "dxb", label: "Lagos → Dubai", code: "LL 721" },
  return: { from: "dxb", to: "los", label: "Dubai → Lagos", code: "LL 722" },
} as const;
export const legRoute = (leg: Leg) => LEG_ROUTES[leg];

/* ---------- State sent to the client ---------- */

export type LegStatus = "booked" | "checked_in" | "boarded" | "flown" | "cancelled";
export type TicketState = {
  id: string;
  reference: string;
  cabin: CabinClass;
  fare: number;
  seat: string;
  partyId: string;
  outbound: LegStatus;
  return: LegStatus;
  immigrationDone: boolean;
  createdAt: string;
  cancelledAt: string | null;
  refunded: number;
  companions: string[];
};
export type VisaState = { id: string; plan: VisaPlan; name: string; visitsTotal: number; visitsUsed: number; status: "processing" | "issued" | "expired"; readyAt: string; validUntil: string; reference: string };
export type HotelBookingState = {
  id: string;
  hotelId: string;
  hotelName: string;
  roomType: RoomType;
  roomName: string;
  nights: number;
  price: number;
  status: "booked" | "checked_in" | "checked_out" | "cancelled" | "expired";
  startsAt: string;
  endsAt: string;
  keyCode: string | null;
  guests: string[];
  mine: boolean;
  ownerName: string;
  storage: Array<{ itemId: string; name: string; quantity: number }>;
};
export type InviteState = { id: string; fromName: string; toName: string; cabin: CabinClass; fare: number; status: "pending" | "accepted" | "declined" | "expired" | "cancelled"; createdAt: string; incoming: boolean };
export type TravelStatus = {
  visa: VisaState | null;
  visas: VisaState[];
  ticket: TicketState | null;
  tickets: TicketState[];
  invites: InviteState[];
  bookings: HotelBookingState[];
  photos: Array<{ id: string; spot: string; companions: string[]; takenAt: string }>;
  activities: Array<{ activity: string; at: string }>;
  rental: { modelId: string; until: string } | null;
};

/** Live trip state the room sends while a player is in an airport, on a flight or arriving. */
export type TripState = {
  stage: "none" | "airport" | "boarded" | "arrived";
  ticketId: string | null;
  leg: Leg | null;
  flight: { id: string; code: string; label: string; cabin: CabinClass; seat: string; departAt: number; arriveAt: number; companions: string[] } | null;
  immigrationDone: boolean;
  bagCollected: boolean;
  excursion: { activity: ActivityId; startsAt: number; endsAt: number } | null;
  room: { hotelId: string; roomType: RoomType; bookingId: string | null } | null;
};

export const emptyTrip = (): TripState => ({ stage: "none", ticketId: null, leg: null, flight: null, immigrationDone: false, bagCollected: false, excursion: null, room: null });

/* ---------- Requests ---------- */

const key = z.uuid();
export const visaApplySchema = z.object({ plan: z.enum(visaPlans), idempotencyKey: key });
export const ticketBuySchema = z.object({ cabin: z.enum(cabinClasses), idempotencyKey: key });
export const ticketCancelSchema = z.object({ ticketId: z.string().min(1).max(80) });
export const travelInviteSchema = z.object({ ticketId: z.string().min(1).max(80), userName: z.string().trim().min(1).max(60) });
export const inviteAnswerSchema = z.object({ inviteId: z.string().min(1).max(80), accept: z.boolean(), idempotencyKey: key });
export const hotelBookSchema = z.object({ hotelId: z.string().min(1).max(80), roomType: z.enum(roomTypes), nights: z.number().int().min(1).max(TRAVEL.maxNights), idempotencyKey: key });
export const hotelBookingSchema = z.object({ bookingId: z.string().min(1).max(80) });
export const hotelExtendSchema = z.object({ bookingId: z.string().min(1).max(80), nights: z.number().int().min(1).max(TRAVEL.maxNights), idempotencyKey: key });
export const hotelGuestSchema = z.object({ bookingId: z.string().min(1).max(80), userName: z.string().trim().min(1).max(60), invited: z.boolean() });
export const hotelStoreSchema = z.object({ bookingId: z.string().min(1).max(80), itemId: z.string().min(1).max(80), direction: z.enum(["in", "out"]) });
export const travelOrderSchema = z.object({ menu: z.enum(["room-service", "rooftop"]), itemId: z.string().min(1).max(40), bookingId: z.string().max(80).optional(), idempotencyKey: key });
export const activityBookSchema = z.object({ activity: z.enum(activityIds), idempotencyKey: key });
export const carRentSchema = z.object({ modelId: z.string().min(1).max(60), hours: z.number().int().min(1).max(CAR_RENTAL.maxHours), idempotencyKey: key });
export const photoSchema = z.object({ spot: z.string().min(1).max(60) });

/** Room messages. */
export const travelEnterSchema = z.object({
  target: z.enum(["consulate", "airport", "rooftop", "hotel"]),
  hotelId: z.string().max(80).optional(),
  bookingId: z.string().max(80).optional(),
  previewRoom: z.enum(roomTypes).optional(),
});
export const travelTransferSchema = z.object({ to: z.enum(["marina"]) });
export const travelCounterSchema = z.object({ action: z.enum(["checkin", "board", "immigration", "baggage", "skip", "lounge"]) });
