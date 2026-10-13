import { BUSINESS_TYPES, type BusinessTypeId } from "./business.js";
import { constructionStages, houseDesign, PLOT_SHOP, PLOT_TERMS, SHOP_DESIGN_ID } from "./building.js";
import { vehicleModelById } from "./vehicles.js";

export const rankingBoards = ["worth", "earners", "garage", "property", "fitness"] as const;
export type RankingBoard = (typeof rankingBoards)[number];
export const isRankingBoard = (value: string): value is RankingBoard => (rankingBoards as readonly string[]).includes(value);

export const RANKING_BOARDS: Record<RankingBoard, { title: string; emoji: string; blurb: string; unit: "naira" | "percent" }> = {
  worth: { title: "Richest in Lagos", emoji: "💰", blurb: "Cash, homes, land, cars, businesses and investments, all added up.", unit: "naira" },
  earners: { title: "Top earners this week", emoji: "📈", blurb: "Naira earned from jobs, community work and businesses in the last 7 days.", unit: "naira" },
  garage: { title: "Biggest garage", emoji: "🏎️", blurb: "What every car you own would cost new.", unit: "naira" },
  property: { title: "Property moguls", emoji: "🏘️", blurb: "Homes you own, land and the house you built on it.", unit: "naira" },
  fitness: { title: "Fittest residents", emoji: "💪", blurb: "Fitness from training at the gym. It fades if you stop going.", unit: "percent" },
};

/** Everything a resident holds that the boards count, as stored. */
export type Holdings = {
  balance: number;
  ownedHomesValue: number;
  carModels: string[];
  plot: "leased" | "owned" | null;
  /** The design on the resident's plot and how many of its four stages they have paid for. */
  build: { design: string; stagesPaid: number } | null;
  invested: number;
  businesses: Array<{ type: string; level: number }>;
  fitness: number;
  earnedThisWeek: number;
};

export function garageValue(models: string[]) {
  return models.reduce((sum, id) => sum + (vehicleModelById.get(id)?.price ?? 0), 0);
}

/** What has gone into the house on the plot so far: the stages paid for, or the shopfront. */
export function buildValue(build: Holdings["build"]) {
  if (!build) return 0;
  if (build.design === SHOP_DESIGN_ID) return PLOT_SHOP.cost;
  const design = houseDesign(build.design);
  if (!design) return 0;
  return constructionStages.slice(0, Math.max(0, Math.min(4, build.stagesPaid))).reduce((sum, stage) => sum + design.stages[stage].cost, 0);
}

/** A business is worth what it cost to open plus every upgrade paid for since. */
export function businessValue(type: string, level: number) {
  const base = BUSINESS_TYPES[type as BusinessTypeId]?.cost ?? 0;
  let total = base;
  for (let paid = 1; paid < level; paid += 1) total += Math.round((base * 0.6 * paid) / 1000) * 1000;
  return total;
}

export function propertyValue(holdings: Holdings) {
  return holdings.ownedHomesValue + (holdings.plot === "owned" ? PLOT_TERMS.purchasePrice : 0) + buildValue(holdings.build);
}

export function netWorth(holdings: Holdings) {
  return (
    holdings.balance +
    propertyValue(holdings) +
    garageValue(holdings.carModels) +
    holdings.invested +
    holdings.businesses.reduce((sum, business) => sum + businessValue(business.type, business.level), 0)
  );
}

export function boardScore(board: RankingBoard, holdings: Holdings) {
  if (board === "worth") return netWorth(holdings);
  if (board === "earners") return holdings.earnedThisWeek;
  if (board === "garage") return garageValue(holdings.carModels);
  if (board === "property") return propertyValue(holdings);
  return Math.round(holdings.fitness * 100);
}

export type RankingEntry = { rank: number; username: string; value: number; you: boolean };
export type RankingState = {
  board: RankingBoard;
  entries: RankingEntry[];
  /**
   * Where the asking resident stands and how far behind the one above they are. With nothing on the board they are
   * not ranked; `ahead` is then the last resident on it.
   */
  you: { rank: number | null; value: number; ahead: { username: string; gap: number } | null } | null;
  residents: number;
};

/** Ranks residents with something on a board, highest first; ties share a rank and are listed by name. */
export function rankBoard(board: RankingBoard, residents: Array<{ id: string; username: string; holdings: Holdings }>, viewerId: string, top = 20): RankingState {
  const all = residents.map((resident) => ({ ...resident, value: boardScore(board, resident.holdings) }));
  const scored = all.filter((resident) => resident.value > 0).sort((a, b) => b.value - a.value || a.username.localeCompare(b.username));
  const ranks: number[] = [];
  scored.forEach((resident, index) => ranks.push(index > 0 && scored[index - 1]!.value === resident.value ? ranks[index - 1]! : index + 1));
  const entries = scored.slice(0, top).map((resident, index) => ({ rank: ranks[index]!, username: resident.username, value: resident.value, you: resident.id === viewerId }));
  const viewer = all.find((resident) => resident.id === viewerId);
  let you: RankingState["you"] = null;
  if (viewer) {
    const at = scored.findIndex((resident) => resident.id === viewerId);
    const above = (at >= 0 ? scored.slice(0, at) : [...scored]).reverse().find((resident) => resident.value > viewer.value);
    you = { rank: at >= 0 ? ranks[at]! : null, value: viewer.value, ahead: above ? { username: above.username, gap: above.value - viewer.value } : null };
  }
  return { board, entries, you, residents: scored.length };
}
