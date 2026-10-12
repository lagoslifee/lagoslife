import { z } from "zod";

/** Household staff hired per home for a week at a time, paid in game naira. */
export const HOME_STAFF = {
  gateman: { name: "Gateman", emoji: "🚧", weekly: 20_000, blurb: "Opens and closes your gate as you drive in and out." },
  cleaner: { name: "Cleaner", emoji: "🧹", weekly: 25_000, blurb: "Keeps the house spotless, so you never have to clean." },
  guard: { name: "House security", emoji: "🛡", weekly: 50_000, blurb: "Stands at your door day and night and turns away intruders." },
} as const;
export type HomeStaffRole = keyof typeof HOME_STAFF;
export const HOME_STAFF_ROLES = Object.keys(HOME_STAFF) as HomeStaffRole[];
export const STAFF_TERM_MS = 7 * 24 * 3_600_000;
export const hireStaffSchema = z.object({ role: z.enum(["gateman", "cleaner", "guard"]), idempotencyKey: z.string().uuid() });
export type HomeStaffState = Array<{ role: HomeStaffRole; paidUntil: string }>;

/** A house party keeps the lights and music going this long; invited friends are told it has started. */
export const PARTY_MS = 15 * 60_000;

/** Delivered to wherever you are: pharmacy items treat sickness and tiredness, food fills you up. */
export const DELIVERY_MENU = [
  { id: "paracetamol", shop: "pharmacy", name: "Paracetamol", emoji: "💊", price: 1_500, hunger: 0, energy: 15, blurb: "For headache and body pain" },
  { id: "malaria-kit", shop: "pharmacy", name: "Malaria treatment pack", emoji: "🩺", price: 6_500, hunger: 0, energy: 40, blurb: "Full course; you'll feel strong again" },
  { id: "vitamin-c", shop: "pharmacy", name: "Vitamin C", emoji: "🍊", price: 2_000, hunger: 5, energy: 10, blurb: "Daily boost" },
  { id: "ors", shop: "pharmacy", name: "ORS sachets", emoji: "🧂", price: 800, hunger: 5, energy: 20, blurb: "Rehydrate after a long night" },
  { id: "jollof-chicken", shop: "food", name: "Jollof rice and chicken", emoji: "🍛", price: 4_500, hunger: 60, energy: 5, blurb: "Smoky party jollof" },
  { id: "suya", shop: "food", name: "Suya (beef, large)", emoji: "🍢", price: 3_500, hunger: 35, energy: 5, blurb: "Spicy yaji, onions" },
  { id: "amala-ewedu", shop: "food", name: "Amala, ewedu and gbegiri", emoji: "🥣", price: 3_000, hunger: 55, energy: 5, blurb: "With assorted meat" },
  { id: "shawarma", shop: "food", name: "Chicken shawarma", emoji: "🌯", price: 3_800, hunger: 45, energy: 5, blurb: "Double sausage" },
  { id: "small-chops", shop: "food", name: "Small chops platter", emoji: "🍤", price: 7_000, hunger: 40, energy: 5, blurb: "Puff-puff, samosa, spring rolls" },
  { id: "zobo", shop: "food", name: "Chilled zobo", emoji: "🥤", price: 900, hunger: 10, energy: 10, blurb: "Hibiscus, ginger, pineapple" },
] as const;
export type DeliveryItem = (typeof DELIVERY_MENU)[number];
/** Seconds between ordering and the rider arriving: where you are, or the door of your home. */
export const DELIVERY_SECONDS = 25;
export const HOME_DELIVERY_SECONDS = 40;
export const DELIVERY_FEE = 1_000;
/** You take the parcel from the rider, or off your doorstep, within this many metres of where it was dropped. */
export const PARCEL_REACH = 25;
/** Extra energy for eating a delivered meal sitting down at home (dining chair or sofa). */
export const SEATED_MEAL_ENERGY = 5;
export const orderDeliverySchema = z.object({
  itemId: z.string().min(2).max(40),
  idempotencyKey: z.string().uuid(),
  destination: z.enum(["here", "home"]).default("here"),
});

/**
 * A paid order on its way or waiting: the rider brings it to `drop` (where you stood, or your front door) and you take it
 * from them. Food stays in your hands until you eat it; medicine is taken as you collect it.
 */
export type FoodParcel = {
  id: string;
  itemId: string;
  name: string;
  emoji: string;
  shop: "food" | "pharmacy";
  destination: "here" | "home";
  propertyId: string | null;
  drop: [number, number];
  dropLocation: string;
  status: "on_the_way" | "collected";
  arrivesAt: string;
};
