import { placeById } from "./world.js";

/** One rentable flat or purchasable house. Several units share a building's door and For Rent / For Sale board. */
export type HomeUnit = { id: string; placeId: string; unit: string };

const ADEBAYO_COURT = "lekki-adebayo-flat-2";
const OKORO_TERRACE = "lekki-chief-okoro-house";

/** Units behind one door: the first keeps the place id, the rest are "<place>-2", "<place>-3"… */
const units = (placeId: string, count: number, label: string): HomeUnit[] =>
  Array.from({ length: count }, (_, index) => ({ id: index === 0 ? placeId : `${placeId}-${index + 1}`, placeId, unit: `${label} ${index + 1}` }));

/** Must match the rows seeded by apps/server/migrations (0005, 0009 and 0037). */
export const HOME_UNITS: HomeUnit[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ id: `lekki-adebayo-flat-${index + 1}`, placeId: ADEBAYO_COURT, unit: `Flat ${index + 1}` })),
  ...units(OKORO_TERRACE, 6, "House"),
  ...units("vi-femi-pearse-court", 8, "Flat"),
  ...units("vi-kofo-residences", 4, "Apartment"),
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
