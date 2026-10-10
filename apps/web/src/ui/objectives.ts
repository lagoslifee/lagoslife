import { getPlace, TRANSIT, type Vec2 } from "@lagos-living/shared";
import { naira, type EconomyState, type PropertyListing } from "../api";
import type { HudState } from "../game/engine";

export type Objective = { step: number; total: number; title: string; detail: string; target: { point: Vec2; label: string } | null };

const TOTAL = 6;

/** The first-session path: ride, work, eat, rent, move in, then free play. */
export function currentObjective(economy: EconomyState | null, properties: PropertyListing[], hud: HudState | null, visitedHome: boolean): Objective | null {
  if (!economy || !hud) return null;
  const done = (key: string) => Boolean(economy.progress[key]);
  const job = economy.activeJob;
  if (job) {
    return {
      step: 3,
      total: TOTAL,
      title: `Deliver the parcel to ${job.destinationLabel}`,
      detail: `Pays ${naira(job.reward)} on arrival. Follow the blue route and press E at the door.`,
      target: { point: [job.destinationX, job.destinationZ], label: job.destinationLabel ?? "Delivery" },
    };
  }
  if (hud.location === "bus" && hud.bus) {
    return {
      step: 1,
      total: TOTAL,
      title: "Ride to Adebayo Doherty Road",
      detail: hud.bus.atStop
        ? `Stopped at ${hud.bus.atStop}. Press E to step off${hud.bus.atStop.includes("Adebayo") ? " here" : ", or stay on"}.`
        : `Next stop: ${hud.bus.nextStop}. Press Q to request your stop.`,
      target: null,
    };
  }
  if (!done("first_ride")) {
    const nearest = [...TRANSIT.stops].sort((a, b) => Math.hypot(a.alight[0] - hud.x, a.alight[1] - hud.z) - Math.hypot(b.alight[0] - hud.x, b.alight[1] - hud.z))[0]!;
    return {
      step: 1,
      total: TOTAL,
      title: "Catch a danfo on Admiralty Way",
      detail: `Walk to the yellow stop "${nearest.name.replace("Admiralty Way · ", "")}". Board when it stops — fare ${naira(TRANSIT.fare)}.`,
      target: { point: nearest.alight, label: "Bus stop" },
    };
  }
  if (!done("first_wage")) {
    const hub = getPlace("swift-parcel-hub");
    return { step: 2, total: TOTAL, title: "Pick up a delivery job", detail: `${hub.name} on ${hub.street}. Press E at the door.`, target: { point: hub.door, label: hub.name } };
  }
  if (!done("first_meal")) {
    const buka = getPlace("mama-titi-buka");
    const hasFood = economy.inventory.some((item) => item.category === "food");
    return {
      step: 4,
      total: TOTAL,
      title: hasFood ? "Eat something" : "Buy food at Mama Titi's",
      detail: hasFood ? "Open the phone (P) → Wallet → Eat." : `${buka.name} on ${buka.street}. Jollof, suya and puff-puff.`,
      target: hasFood ? null : { point: buka.door, label: buka.name },
    };
  }
  const rental = getPlace("lekki-adebayo-flat-2");
  const home = properties.find((listing) => listing.isMine);
  if (!home) {
    const listing = properties.find((candidate) => candidate.id === rental.id);
    return {
      step: 5,
      total: TOTAL,
      title: `Rent ${rental.name}`,
      detail: listing ? `Find the red For Rent sign. ${naira(listing.rent)}/${listing.intervalDays} days + ${naira(listing.deposit)} deposit = ${naira(listing.upfrontRent)} upfront.` : "Find the red For Rent sign.",
      target: { point: rental.door, label: rental.name },
    };
  }
  if (!(hud.location === "interior" && hud.propertyId === home.id) && !visitedHome) {
    return { step: 6, total: TOTAL, title: `Go inside ${home.name}`, detail: "Use your digital key at the door (E). Progress saves automatically.", target: { point: home.door, label: home.name } };
  }
  return {
    step: TOTAL,
    total: TOTAL,
    title: "You're settled in Lekki",
    detail: "Free roam: do more deliveries, furnish your flat, keep up with rent — or save up for Okoro Terrace.",
    target: null,
  };
}
