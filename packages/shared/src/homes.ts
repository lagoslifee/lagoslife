import { placeById } from "./world.js";

/** One rentable flat or purchasable house. Several units share a building's door and For Rent / For Sale board. */
export type HomeUnit = { id: string; placeId: string; unit: string };

const ADEBAYO_COURT = "lekki-adebayo-flat-2";
const OKORO_TERRACE = "lekki-chief-okoro-house";

/** Must match the rows seeded by apps/server/migrations (0005 and 0009). */
export const HOME_UNITS: HomeUnit[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ id: `lekki-adebayo-flat-${index + 1}`, placeId: ADEBAYO_COURT, unit: `Flat ${index + 1}` })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: index === 0 ? OKORO_TERRACE : `${OKORO_TERRACE}-${index + 1}`,
    placeId: OKORO_TERRACE,
    unit: `House ${index + 1}`,
  })),
];

const unitById = new Map(HOME_UNITS.map((unit) => [unit.id, unit]));

/** A resident's private copy of a listing is "<listing>~<suffix>"; this returns the listing it copies. */
export function listingTemplateId(propertyId: string) {
  const cut = propertyId.indexOf("~");
  return cut < 0 ? propertyId : propertyId.slice(0, cut);
}

export function homeUnit(propertyId: string) {
  return unitById.get(listingTemplateId(propertyId)) ?? null;
}

/** The mapped building a property belongs to, or null for listings without one (such as test listings). */
export function propertyPlace(propertyId: string) {
  const id = listingTemplateId(propertyId);
  return placeById.get(unitById.get(id)?.placeId ?? id) ?? null;
}

/** "Adebayo Court · Flat 3" for a unit, the place name otherwise. */
export function propertyTitle(propertyId: string) {
  const place = propertyPlace(propertyId);
  const unit = homeUnit(propertyId);
  if (!place) return "Home";
  return unit ? `${place.name} · ${unit.unit}` : place.name;
}
