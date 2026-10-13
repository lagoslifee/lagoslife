import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES } from "./business.js";
import { designTotal, houseDesign, PLOT_TERMS } from "./building.js";
import { buildValue, businessValue, netWorth, rankBoard, type Holdings } from "./rankings.js";
import { VEHICLE_MODELS } from "./vehicles.js";

const empty: Holdings = { balance: 0, ownedHomesValue: 0, carModels: [], plot: null, build: null, invested: 0, businesses: [], fitness: 0, earnedThisWeek: 0 };

describe("rankings", () => {
  it("adds cash, homes, land, the house, cars, businesses and investments into net worth", () => {
    const car = VEHICLE_MODELS[0]!;
    const villa = houseDesign("pool-villa")!;
    const holdings: Holdings = {
      ...empty,
      balance: 50_000,
      ownedHomesValue: 2_000_000,
      carModels: [car.id, car.id],
      plot: "owned",
      build: { design: "pool-villa", stagesPaid: 4 },
      invested: 30_000,
      businesses: [{ type: "pos-kiosk", level: 1 }],
    };
    expect(netWorth(holdings)).toBe(50_000 + 2_000_000 + car.price * 2 + PLOT_TERMS.purchasePrice + designTotal(villa) + 30_000 + BUSINESS_TYPES["pos-kiosk"].cost);
  });

  it("counts only the building stages paid for and every business upgrade", () => {
    const duplex = houseDesign("duplex")!;
    expect(buildValue({ design: "duplex", stagesPaid: 1 })).toBe(duplex.stages.foundation.cost);
    expect(businessValue("salon", 3)).toBe(800_000 + 480_000 + 960_000);
  });

  it("ranks highest first, shares ties and tells you the gap to the one above", () => {
    const residents = [
      { id: "a", username: "ada", holdings: { ...empty, balance: 900 } },
      { id: "b", username: "bayo", holdings: { ...empty, balance: 500 } },
      { id: "c", username: "chi", holdings: { ...empty, balance: 500 } },
      { id: "d", username: "dele", holdings: { ...empty, balance: 100 } },
      { id: "e", username: "emeka", holdings: empty },
    ];
    const state = rankBoard("worth", residents, "d", 3);
    expect(state.entries.map((entry) => [entry.rank, entry.username])).toEqual([[1, "ada"], [2, "bayo"], [2, "chi"]]);
    expect(state.you).toEqual({ rank: 4, value: 100, ahead: { username: "chi", gap: 400 } });
    expect(state.residents).toBe(4);
    expect(rankBoard("worth", residents, "e").you).toEqual({ rank: null, value: 0, ahead: { username: "dele", gap: 100 } });
    expect(rankBoard("worth", residents, "a").you?.ahead).toBeNull();
  });
});
