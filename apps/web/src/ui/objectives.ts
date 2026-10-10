import { constructionStages, getPlace, houseDesign, PLOTS, ROUTES, stopLabel, type Vec2 } from "@lagos-living/shared";
import { naira, type EconomyState, type PlotState, type PropertyListing } from "../api";
import type { HudState } from "../game/engine";
import { buildProgress } from "../game/build-progress";
import { buildingUnits } from "./Sheets";

/** The first session happens in Lekki, on the Admiralty Way loop. */
const FIRST_ROUTE = ROUTES[0]!;

export type HousingPath = "rent" | "buy" | "build";

export type Objective = {
  step: number;
  total: number;
  title: string;
  detail: string;
  target: { point: Vec2; label: string } | null;
  /** The guide offers to reopen the housing choice. */
  choose?: boolean;
};

const TOTAL = 5;
export const RENTAL_ID = "lekki-adebayo-flat-2";
export const SALE_ID = "lekki-chief-okoro-house";

/** Which way the player is housing themselves: what they hold wins over what they picked. */
export function housingPath(properties: PropertyListing[], plots: PlotState[], chosen: HousingPath | null): HousingPath | null {
  if (plots.some((plot) => plot.status === "mine")) return "build";
  const home = properties.find((listing) => listing.isMine && listing.listingType !== "built");
  if (home) return home.tenureType === "owned" ? "buy" : "rent";
  return chosen;
}

function nearestFreePlot(plots: PlotState[], x: number, z: number) {
  const free = PLOTS.filter((plot) => (plots.find((state) => state.id === plot.id)?.status ?? "available") === "available");
  return free.sort((a, b) => Math.hypot(a.gate[0] - x, a.gate[1] - z) - Math.hypot(b.gate[0] - x, b.gate[1] - z))[0] ?? null;
}

function seconds(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/**
 * The first-session path: settle somewhere (rent, buy or build), move in, earn, eat, ride a danfo, then free play.
 * Earning comes before moving in for builders, who need money while the work goes on.
 */
export function currentObjective(
  economy: EconomyState | null,
  properties: PropertyListing[],
  plots: PlotState[],
  hud: HudState | null,
  visitedHome: boolean,
  chosen: HousingPath | null,
): Objective | null {
  if (!economy || !hud) return null;
  const done = (key: string) => Boolean(economy.progress[key]);
  const hub = getPlace("swift-parcel-hub");
  const earn = (step: number, why: string): Objective => ({
    step,
    total: TOTAL,
    title: "Pick up a delivery job",
    detail: `${why} ${hub.name} on ${hub.street} — press E at the door.`,
    target: { point: hub.door, label: hub.name },
  });

  const meal = (): Objective | null => {
    if (done("first_meal")) return null;
    const buka = getPlace("mama-titi-buka");
    const hasFood = economy.inventory.some((item) => item.category === "food");
    return {
      step: 4,
      total: TOTAL,
      title: hasFood ? "Eat something" : "Buy food at Mama Titi's",
      detail: hasFood ? "Open the phone → Wallet → Eat. Food keeps your hunger bar up." : `${buka.name} on ${buka.street}. Hunger drops over time.`,
      target: hasFood ? null : { point: buka.door, label: buka.name },
    };
  };
  const ride = (): Objective | null => {
    if (done("first_ride")) return null;
    const nearest = [...FIRST_ROUTE.stops].sort((a, b) => Math.hypot(a.alight[0] - hud.x, a.alight[1] - hud.z) - Math.hypot(b.alight[0] - hud.x, b.alight[1] - hud.z))[0]!;
    return {
      step: 5,
      total: TOTAL,
      title: "Ride a danfo",
      detail: `Walk to the yellow stop "${stopLabel(nearest.name)}" and board when it stops — fare ${naira(FIRST_ROUTE.fare)}.`,
      target: { point: nearest.alight, label: "Bus stop" },
    };
  };

  const job = economy.activeJob;
  if (job) {
    return {
      step: 3,
      total: TOTAL,
      title: `Deliver the parcel to ${job.destinationLabel}`,
      detail: `Pays ${naira(job.reward)} on arrival. Follow the blue line and press E at the door.`,
      target: { point: [job.destinationX, job.destinationZ], label: job.destinationLabel ?? "Delivery" },
    };
  }
  if (hud.location === "bus" && hud.bus) {
    return {
      step: 5,
      total: TOTAL,
      title: `Riding danfo ${hud.bus.routeNumber}`,
      detail: hud.bus.atStop ? `Stopped at ${hud.bus.atStop}. Step off here or stay on.` : `Next stop: ${hud.bus.nextStop}. Request a stop when you want to get off.`,
      target: null,
    };
  }

  const path = housingPath(properties, plots, chosen);
  const balance = economy.balance;
  const myPlot = plots.find((plot) => plot.status === "mine") ?? null;
  const home = properties.find((listing) => listing.isMine);

  if (!path) {
    return {
      step: 1,
      total: TOTAL,
      title: "Find a place to live",
      detail: `You're in a temporary room with ${naira(balance)}. Rent a flat, buy a house, or lease land and build your own.`,
      target: null,
      choose: true,
    };
  }

  if (path === "build") {
    if (!myPlot) {
      const plot = nearestFreePlot(plots, hud.x, hud.z);
      if (!plot) return { step: 1, total: TOTAL, title: "Every plot is taken", detail: "All building land is held right now. Rent a flat instead, or check back later.", target: null, choose: true };
      return {
        step: 1,
        total: TOTAL,
        title: `Lease or buy ${plot.name}`,
        detail: `Walk to the red “For lease or sale” sign and press E. Lease ₦15,000/week, or buy for ₦120,000.`,
        target: { point: plot.gate, label: plot.name },
      };
    }
    const plot = PLOTS.find((entry) => entry.id === myPlot.id)!;
    const construction = myPlot.construction;
    if (!construction) {
      return { step: 2, total: TOTAL, title: "Choose a house to build", detail: `At ${plot.name}'s sign, pick a cottage, bungalow or duplex and pay for the foundation.`, target: { point: plot.gate, label: plot.name } };
    }
    if (!construction.completed) {
      const design = houseDesign(construction.designId)!;
      const progress = buildProgress(construction, Date.now());
      const stageName = constructionStages[progress.stage]!;
      if (progress.waitingForPayment) {
        const next = constructionStages[construction.stagesPaid]!;
        const cost = design.stages[next].cost;
        if (balance < cost) return earn(2, `The builders need ${naira(cost)} for the ${next}. You have ${naira(balance)}.`);
        return { step: 2, total: TOTAL, title: `Pay the builders for the ${next}`, detail: `${naira(cost)} at ${plot.name}'s sign. Stage ${construction.stagesPaid + 1} of 4.`, target: { point: plot.gate, label: plot.name } };
      }
      const left = seconds(Date.parse(construction.stageReadyAt) - Date.now());
      if (!done("first_wage")) return earn(2, `Builders are on the ${stageName} (ready in ${left}). Earn money for the next stage meanwhile:`);
      return meal() ?? ride() ?? { step: 2, total: TOTAL, title: `Builders at work: ${stageName}`, detail: `Ready in ${left}. Do more deliveries while you wait — the next stage needs paying.`, target: null };
    }
  } else if (!home) {
    if (path === "rent") {
      const rental = getPlace(RENTAL_ID);
      const { offered: listing, free } = buildingUnits(properties, rental.id);
      const terms = listing ? `${naira(listing.upfrontRent)} upfront (${naira(listing.rent)} rent every ${listing.intervalDays} days + ${naira(listing.deposit)} deposit).` : "";
      return {
        step: 1,
        total: TOTAL,
        title: `Rent a flat at ${rental.name}`,
        detail: listing && !free ? `Every flat is let right now. Try buying or building instead.` : `Walk to the red For Rent sign and press E. ${terms}`,
        target: { point: rental.door, label: rental.name },
        choose: Boolean(listing && !free),
      };
    }
    const sale = getPlace(SALE_ID);
    const { offered: listing, free } = buildingUnits(properties, sale.id);
    const soldOut = Boolean(listing && !free);
    return {
      step: 1,
      total: TOTAL,
      title: `Buy a house at ${sale.name}`,
      detail: soldOut ? "Every house here is sold. Rent or build instead." : `Walk to the For Sale sign and press E. ${listing ? naira(listing.purchasePrice) : ""} — yours outright, no rent.`,
      target: { point: sale.door, label: sale.name },
      choose: soldOut,
    };
  }

  const settled = home ?? null;
  if (settled && !(hud.location === "interior" && hud.propertyId === settled.id) && !visitedHome && !done("visited_home")) {
    return { step: 2, total: TOTAL, title: "Go inside your new home", detail: `${settled.name}. Press E at the door — your key is on your phone.`, target: { point: settled.door, label: settled.name } };
  }
  if (!done("first_wage")) return earn(3, "Earn your first wage.");
  return meal() ?? ride();
}
