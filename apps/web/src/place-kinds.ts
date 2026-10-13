import type { Place } from "@lagos-living/shared";

export type PlaceCategory = "food" | "night" | "shopping" | "cars" | "homes" | "travel" | "services" | "leisure";

export const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  food: "Food & drink",
  night: "Nightlife",
  shopping: "Shopping",
  cars: "Cars",
  homes: "Homes",
  travel: "Travel",
  services: "Services",
  leisure: "Leisure",
};

type KindInfo = { label: string; icon: string; colour: string; category: PlaceCategory };

/** How each kind of place is labelled and coloured in the Places app and on its roadside banner. */
export const PLACE_KIND: Record<Place["kind"], KindInfo> = {
  starter_home: { label: "Hostel", icon: "🛏", colour: "#3d5a80", category: "homes" },
  rental: { label: "Flats to rent", icon: "🔑", colour: "#b23a2e", category: "homes" },
  sale: { label: "Houses for sale", icon: "🏡", colour: "#1b4fa0", category: "homes" },
  job: { label: "Courier hub", icon: "📦", colour: "#c4661f", category: "services" },
  food: { label: "Food", icon: "🍲", colour: "#b5472b", category: "food" },
  shop: { label: "Supermarket", icon: "🛒", colour: "#2f7a4f", category: "shopping" },
  furniture: { label: "Furniture", icon: "🛋", colour: "#7a5230", category: "shopping" },
  delivery: { label: "Drop-off", icon: "📮", colour: "#5c5c5c", category: "services" },
  dealership: { label: "Car dealer", icon: "🚗", colour: "#16324f", category: "cars" },
  mechanic: { label: "Mechanic", icon: "🔧", colour: "#4a4f57", category: "cars" },
  library: { label: "Library", icon: "📚", colour: "#5b3f8c", category: "leisure" },
  worship: { label: "Place of worship", icon: "🕊", colour: "#3f6f6a", category: "leisure" },
  community: { label: "Community hall", icon: "🤝", colour: "#2e6b8a", category: "services" },
  park: { label: "Park", icon: "🌳", colour: "#2f7a3a", category: "leisure" },
  club: { label: "Nightclub", icon: "🎶", colour: "#6a1b6e", category: "night" },
  police: { label: "Police", icon: "🚓", colour: "#1d3f8f", category: "services" },
  security: { label: "Security firm", icon: "🛡", colour: "#2b333d", category: "services" },
  airport: { label: "Airport", icon: "✈", colour: "#0f5c8c", category: "travel" },
  consulate: { label: "Consulate", icon: "🛂", colour: "#5a4b2b", category: "travel" },
  hotel: { label: "Hotel", icon: "🏨", colour: "#8a6a1f", category: "travel" },
  restaurant: { label: "Restaurant", icon: "🍽", colour: "#9b2f3a", category: "food" },
  cafe: { label: "Café", icon: "☕", colour: "#6b4a2f", category: "food" },
  boutique: { label: "Boutique", icon: "👔", colour: "#7a2f5a", category: "shopping" },
  souvenir: { label: "Souvenirs", icon: "🎁", colour: "#a0522d", category: "shopping" },
  lounge: { label: "Lounge", icon: "🍸", colour: "#43306b", category: "night" },
  beach: { label: "Beach", icon: "🏖", colour: "#1f7f9c", category: "leisure" },
  marina: { label: "Marina", icon: "⛵", colour: "#1b5f8a", category: "leisure" },
  photo: { label: "Photo spot", icon: "📸", colour: "#335c67", category: "leisure" },
  desert: { label: "Desert camp", icon: "🏜", colour: "#a5662b", category: "leisure" },
  car_rental: { label: "Car hire", icon: "🔑", colour: "#1f4e5f", category: "cars" },
  tourism: { label: "Tours", icon: "🧭", colour: "#2a6f5b", category: "travel" },
  gym: { label: "Gym", icon: "🏋", colour: "#1f6f43", category: "leisure" },
  viewing: { label: "Viewing centre", icon: "⚽", colour: "#0f7a3a", category: "leisure" },
  estate: { label: "Estate agent", icon: "🏢", colour: "#1b4fa0", category: "homes" },
};
