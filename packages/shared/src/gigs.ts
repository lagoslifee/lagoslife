import { z } from "zod";
import type { SeededRandom } from "./finance.js";
import type { RepairView } from "./generator-repair.js";

/**
 * Gig board: well-paid one-off jobs around the city. The board changes every `GIG_BOARD_MS` and is the same for every
 * resident; any number of residents can take the same gig. Travel to the place, start the job there, and stay for the
 * work time to get paid. Hands-on gigs (`handsOn`) have no timer: they pay once the work is actually done.
 */
export type GigType = { id: string; title: string; task: string; emoji: string; places: readonly string[]; workSeconds: number; pay: readonly [number, number]; handsOn?: boolean };

export const GIG_TYPES: readonly GigType[] = [
  { id: "dj", title: "Guest DJ set", task: "Play a warm-up set at", emoji: "🎧", places: ["eko-nights", "admiralty-lounge", "awolowo-rooftop"], workSeconds: 45, pay: [150_000, 350_000] },
  { id: "car-deal", title: "Broker a car sale", task: "Close a buyer's deal at", emoji: "🚗", places: ["lekki-motors"], workSeconds: 35, pay: [200_000, 500_000] },
  { id: "realtor", title: "Show a luxury house", task: "Show buyers round", emoji: "🏡", places: ["lekki-chief-okoro-house", "lekki-adebayo-flat-2"], workSeconds: 30, pay: [150_000, 400_000] },
  { id: "shoot", title: "Brand photo shoot", task: "Model for a fashion brand at", emoji: "📸", places: ["muri-okunola-park", "awolowo-rooftop", "island-community-hall"], workSeconds: 30, pay: [100_000, 260_000] },
  { id: "generator", title: "Generator repair", task: "Fix a big generator at", emoji: "🔧", places: ["ade-auto-works", "island-community-hall", "ikoyi-reading-room", "mama-titi-buka"], workSeconds: 0, pay: [60_000, 140_000], handsOn: true },
  { id: "catering", title: "Event catering", task: "Serve jollof and small chops at", emoji: "🍲", places: ["island-community-hall", "mama-titi-buka", "admiralty-lounge"], workSeconds: 35, pay: [70_000, 160_000] },
  { id: "security-shift", title: "Event security shift", task: "Guard the entrance at", emoji: "🛡", places: ["eko-nights", "eko-shield-security", "awolowo-rooftop"], workSeconds: 40, pay: [80_000, 180_000] },
  { id: "chauffeur", title: "VIP airport pickup", task: "Meet a VIP client at", emoji: "✈", places: ["lagos-air-terminal"], workSeconds: 20, pay: [120_000, 280_000] },
  { id: "tutor", title: "Private lesson", task: "Teach a maths lesson at", emoji: "📚", places: ["ikoyi-reading-room"], workSeconds: 30, pay: [50_000, 110_000] },
  { id: "mc", title: "MC a wedding party", task: "Host the owambe at", emoji: "🎤", places: ["island-community-hall", "admiralty-lounge"], workSeconds: 45, pay: [180_000, 420_000] },
];
export const gigType = (id: string) => GIG_TYPES.find((type) => type.id === id);

export const GIG_BOARD_MS = 20 * 60_000;
export const GIGS_PER_BOARD = 6;
/** How close to the place's door the job has to be started and finished. */
export const GIG_RANGE = 9;

export type Gig = { id: string; board: number; typeId: string; title: string; task: string; emoji: string; placeId: string; reward: number; workSeconds: number; handsOn: boolean };

export const gigBoard = (ms: number) => Math.floor(ms / GIG_BOARD_MS);

export function boardGigs(board: number, rand: SeededRandom): Gig[] {
  const types = [...GIG_TYPES].sort((a, b) => rand(`gig:${board}:${a.id}`) - rand(`gig:${board}:${b.id}`)).slice(0, GIGS_PER_BOARD);
  return types.map((type) => {
    const placeId = type.places[Math.floor(rand(`gig:${board}:${type.id}:place`) * type.places.length)]!;
    const [low, high] = type.pay;
    const reward = Math.round((low + (high - low) * rand(`gig:${board}:${type.id}:pay`)) / 1_000) * 1_000;
    return { id: `${board}-${type.id}`, board, typeId: type.id, title: type.title, task: type.task, emoji: type.emoji, placeId, reward, workSeconds: type.workSeconds, handsOn: type.handsOn ?? false };
  });
}

export type ActiveGig = Gig & { runId: string; status: "travelling" | "working"; startedWorkAt: string | null; repair: RepairView | null };
export type GigStatus = { board: Gig[]; nextBoardAt: number; active: ActiveGig | null; completed: number; earned: number };

export const takeGigSchema = z.object({ gigId: z.string().min(3).max(60) });
