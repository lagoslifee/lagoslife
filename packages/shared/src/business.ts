import { z } from "zod";

/**
 * Player businesses and school. Everything is game roleplay paid in fictional game naira: a registered business
 * earns a steady income that piles up until you collect it (up to `BUSINESS.storeHours`), and courses at the
 * fictional Lagos Skills Academy take a few real minutes and give certificates that unlock or boost things.
 */
export const courseIds = ["catering", "beauty", "business-admin", "coding", "logistics", "hospitality"] as const;
export type CourseId = (typeof courseIds)[number];

export const businessTypeIds = ["pos-kiosk", "buka", "salon", "dispatch", "tech-startup"] as const;
export type BusinessTypeId = (typeof businessTypeIds)[number];

export type Course = { name: string; emoji: string; fee: number; minutes: number; perk: string };
export const COURSES: Record<CourseId, Course> = {
  catering: { name: "Catering & food safety", emoji: "🍲", fee: 150_000, minutes: 3, perk: "Needed to open a buka." },
  beauty: { name: "Barbing, braiding & beauty", emoji: "💈", fee: 100_000, minutes: 2, perk: "Needed to open a salon." },
  logistics: { name: "Dispatch riding & logistics", emoji: "🛵", fee: 120_000, minutes: 2, perk: "Needed for a dispatch company · +20% Swift Parcel delivery pay." },
  hospitality: { name: "Hospitality & customer service", emoji: "🤝", fee: 90_000, minutes: 2, perk: "+20% pay on every shift (Phone → Jobs → shifts)." },
  "business-admin": { name: "Business administration", emoji: "📊", fee: 400_000, minutes: 5, perk: "+20% income from every business you own." },
  coding: { name: "Software development bootcamp", emoji: "💻", fee: 900_000, minutes: 8, perk: "Needed to found a tech startup." },
};

export type BusinessType = { name: string; emoji: string; cost: number; perHour: number; needs: CourseId | null; blurb: string };
export const BUSINESS_TYPES: Record<BusinessTypeId, BusinessType> = {
  "pos-kiosk": { name: "POS & airtime kiosk", emoji: "🏧", cost: 250_000, perHour: 12_000, needs: null, blurb: "Cash-out, transfers and recharge cards by the roadside." },
  salon: { name: "Salon & barbershop", emoji: "💈", cost: 800_000, perHour: 36_000, needs: "beauty", blurb: "Fades, braids and Saturday-morning queues." },
  buka: { name: "Buka (local restaurant)", emoji: "🍲", cost: 1_200_000, perHour: 54_000, needs: "catering", blurb: "Amala, ewedu and pepper soup for the lunch rush." },
  dispatch: { name: "Dispatch bike company", emoji: "🛵", cost: 3_000_000, perHour: 130_000, needs: "logistics", blurb: "A small fleet of riders delivering across the island." },
  "tech-startup": { name: "Tech startup", emoji: "💻", cost: 8_000_000, perHour: 330_000, needs: "coding", blurb: "An app, a Yaba office and very big dreams." },
};

export const BUSINESS = {
  maxLevel: 5,
  /** Income stops piling up after this long without collecting: come back and run your business. */
  storeHours: 8,
  adminBoost: 0.2,
  jobBoost: 0.2,
  maxBusinesses: 5,
  /** Extra takings for a business trading from premises built on the owner's own plot. */
  premisesBoost: 0.25,
} as const;

/** Each level adds half the base income; the upgrade to level n+1 costs 60% of the start-up cost × n. */
export const levelMultiplier = (level: number) => 1 + 0.5 * (Math.max(1, Math.min(BUSINESS.maxLevel, level)) - 1);
export const upgradeCost = (type: BusinessTypeId, level: number) => (level >= BUSINESS.maxLevel ? null : Math.round((BUSINESS_TYPES[type].cost * 0.6 * level) / 1000) * 1000);
export const hourlyIncome = (type: BusinessTypeId, level: number, admin: boolean, premises = false) =>
  Math.round(BUSINESS_TYPES[type].perHour * levelMultiplier(level) * (admin ? 1 + BUSINESS.adminBoost : 1) * (premises ? 1 + BUSINESS.premisesBoost : 1));

/** Income waiting to be collected after `elapsedMs`, capped at the store limit. */
export function pendingIncome(type: BusinessTypeId, level: number, admin: boolean, elapsedMs: number, premises = false) {
  const hours = Math.max(0, Math.min(BUSINESS.storeHours, elapsedMs / 3_600_000));
  return Math.floor(hourlyIncome(type, level, admin, premises) * hours);
}

export type BusinessState = { id: string; type: BusinessTypeId; name: string; level: number; perHour: number; pending: number; full: boolean; upgradeCost: number | null; openedAt: string; plotId: string | null };
export type CourseState = { course: CourseId; endsAt: string; done: boolean };
export type BusinessStatus = { businesses: BusinessState[]; courses: CourseState[]; certificates: CourseId[] };

export const startBusinessSchema = z.object({ type: z.enum(businessTypeIds), name: z.string().trim().min(2).max(40), plotId: z.string().max(60).optional(), idempotencyKey: z.string().uuid() });
export const upgradeBusinessSchema = z.object({ idempotencyKey: z.string().uuid() });
export const enrolSchema = z.object({ course: z.enum(courseIds), idempotencyKey: z.string().uuid() });
