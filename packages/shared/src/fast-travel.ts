import { z } from "zod";
import type { PlaceKind } from "./world.js";

export const FAST_TRAVEL = {
  /** Standing this close to a place's door or kerb marks it discovered. */
  discoverRadius: 35,
  cooldownMs: 45_000,
  /** Residents this close can be asked to travel with you. */
  togetherRadius: 20,
  /** Invitations and join requests lapse after this long. */
  answerMs: 30_000,
  maxCompanions: 5,
} as const;

/** Public places you can arrive at. Homes, flats for sale and delivery drop-offs are never fast-travel targets. */
export const FAST_TRAVEL_KINDS = [
  "job", "food", "shop", "furniture", "dealership", "mechanic", "library", "worship", "community", "park", "club",
  "police", "security", "airport", "consulate", "hotel", "restaurant", "cafe", "boutique", "souvenir", "lounge",
  "beach", "marina", "photo", "car_rental", "tourism", "gym", "viewing", "estate",
] as const satisfies readonly PlaceKind[];

export const isFastTravelKind = (kind: string) => (FAST_TRAVEL_KINDS as readonly string[]).includes(kind);

export const FAVOURITES = ["home", "garage", "club", "airport"] as const;
export type Favourite = (typeof FAVOURITES)[number];
export const FAVOURITE_LABEL: Record<Favourite, string> = { home: "Home", garage: "Garage", club: "Nearest club", airport: "Airport" };

export const fastTravelSchema = z.object({
  target: z.union([z.object({ placeId: z.string().min(1).max(80) }), z.object({ favourite: z.enum(FAVOURITES) })]),
  /** Residents to invite along; each must accept before they move. */
  with: z.array(z.string().min(1).max(64)).max(FAST_TRAVEL.maxCompanions).default([]),
});

export const travelAnswerSchema = z.object({ requestId: z.string().min(1).max(64), accept: z.boolean() });
export const joinRequestSchema = z.object({ sessionId: z.string().min(1).max(64) });

/** A prompt shown to the player who must agree before anyone moves. */
export type TravelPrompt = {
  requestId: string;
  kind: "together" | "join" | "invite";
  fromName: string;
  /** Where they would go (together) or where they are (join). */
  label: string;
  expiresAt: number;
};

export type Happening = {
  id: string;
  kind: "club" | "flight" | "gathering" | "beach" | "ride";
  title: string;
  detail: string;
  people: number;
  /** Place to fast-travel to for Join; null when it can only be reached another way (e.g. a flight boards at the airport). */
  placeId: string | null;
};

/** What the Go app shows: discovered places, favourites with their resolved place, and residents you could join. */
export type FastTravelState = {
  discovered: string[];
  /** `point` is where Go arrives, also used to draw a driving route. */
  favourites: Array<{ id: Favourite; label: string; placeId: string | null; point: [number, number] | null; note: string | null }>;
  cooldownUntil: number;
  nearby: Array<{ sessionId: string; name: string; distance: number }>;
  /** Everyone else in this group (your neighbours): metres away when you are both out on the street, and whether they have gone quiet. */
  online: Array<{ sessionId: string; name: string; where: string; distance: number | null; away: boolean }>;
  happenings: Happening[];
};
