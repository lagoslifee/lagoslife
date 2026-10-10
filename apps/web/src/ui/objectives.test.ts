import { getPlace, PLOTS } from "@lagos-living/shared";
import { describe, expect, it, vi } from "vitest";
import type { EconomyState, PlotState, PropertyListing } from "../api";
import type { HudState } from "../game/engine";
import { currentObjective, housingPath } from "./objectives";

vi.mock("../auth-client", () => ({ apiUrl: "", authHeaders: () => ({}) }));

const economy = (overrides: Partial<EconomyState> = {}): EconomyState => ({
  balance: 250_000,
  catalog: [],
  inventory: [],
  transactions: [],
  activeJob: null,
  completedJobs: 0,
  progress: {},
  needs: { hunger: 70, energy: 80 },
  homePropertyId: null,
  ...overrides,
});
const spawn = getPlace("starter-home").door;
const hud = { location: "street", bus: null, x: spawn[0], z: spawn[1], propertyId: null } as unknown as HudState;
const free = (id: string): PlotState => ({ id, status: "available", tenureType: null, nextPaymentAt: null, accessEndsAt: null, overdue: false, construction: null });
const plots = PLOTS.map((plot) => free(plot.id));
const listing = (overrides: Partial<PropertyListing>): PropertyListing =>
  ({ id: "lekki-adebayo-flat-2", name: "Adebayo Court · Flat 1", isMine: false, available: true, tenureType: null, listingType: "rental", door: [0, 0], placeId: "lekki-adebayo-flat-2", upfrontRent: 30_000, rent: 18_000, deposit: 12_000, intervalDays: 7, purchasePrice: 0, ...overrides }) as PropertyListing;

describe("first-session guide", () => {
  it("asks a new player to choose where to live first", () => {
    const objective = currentObjective(economy(), [], plots, hud, false, null)!;
    expect(objective.step).toBe(1);
    expect(objective.title).toBe("Find a place to live");
    expect(objective.choose).toBe(true);
  });

  it("walks a builder to the nearest free plot, then to choosing a design", () => {
    const first = currentObjective(economy(), [], plots, hud, false, "build")!;
    expect(first.title).toMatch(/^Lease or buy Plot \d+$/);
    const nearest = PLOTS.find((plot) => first.title.endsWith(plot.name))!;
    expect(first.target?.point).toEqual(nearest.gate);

    const leased = plots.map((plot) => (plot.id === nearest.id ? { ...plot, status: "mine" as const, tenureType: "leased" as const } : plot));
    expect(currentObjective(economy(), [], leased, hud, false, "build")!.title).toBe("Choose a house to build");
  });

  it("sends a builder to earn while the builders work, and back to pay when a stage is done", () => {
    const now = Date.now();
    const working = (readyIn: number): PlotState[] =>
      plots.map((plot, index) =>
        index === 0
          ? { ...plot, status: "mine", tenureType: "leased", construction: { designId: "duplex", stagesPaid: 1, stageStartedAt: new Date(now - 60_000).toISOString(), stageReadyAt: new Date(now + readyIn).toISOString(), completed: false, homeId: null } }
          : plot,
      );
    expect(currentObjective(economy(), [], working(60_000), hud, false, "build")!.title).toBe("Pick up a delivery job");
    expect(currentObjective(economy({ balance: 200_000 }), [], working(-1_000), hud, false, "build")!.title).toBe("Pay the builders for the blockwork");
    const broke = currentObjective(economy({ balance: 10_000 }), [], working(-1_000), hud, false, "build")!;
    expect(broke.title).toBe("Pick up a delivery job");
    expect(broke.detail).toContain("₦140,000");
  });

  it("follows what the player holds over what they picked", () => {
    const rented = [listing({ isMine: true, tenureType: "rented" })];
    expect(housingPath(rented, plots, "build")).toBe("rent");
    expect(currentObjective(economy(), rented, plots, hud, false, "build")!.title).toBe("Go inside your new home");
    expect(currentObjective(economy({ progress: { first_wage: "x" } }), rented, plots, hud, true, null)!.step).toBe(4);
  });

  it("finishes once the player has a home, a wage, a meal and a ride", () => {
    const rented = [listing({ isMine: true, tenureType: "rented" })];
    const progress = { first_wage: "x", first_meal: "x", first_ride: "x", visited_home: "x" };
    expect(currentObjective(economy({ progress }), rented, plots, hud, true, null)).toBeNull();
  });
});
