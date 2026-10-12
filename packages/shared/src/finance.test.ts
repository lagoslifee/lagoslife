import { describe, expect, it } from "vitest";
import { lagosDay } from "./community.js";
import {
  assetPrice,
  dailyReward,
  MARKET_ASSETS,
  matchOdds,
  matchProbabilities,
  matchResult,
  nextStreak,
  roundFixtures,
  spinMultiplier,
  spinReturn,
  spinSlice,
  SPIN_WHEEL,
  footballClub,
} from "./finance.js";

const rand = (key: string) => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 4294967296;
};

describe("daily bonus", () => {
  it("counts consecutive Lagos days and resets after a gap", () => {
    expect(lagosDay(Date.UTC(2026, 0, 1, 23, 30))).toBe("2026-01-02");
    expect(nextStreak(null, 0, "2026-01-02")).toBe(1);
    expect(nextStreak("2026-01-01", 3, "2026-01-02")).toBe(4);
    expect(nextStreak("2025-12-30", 3, "2026-01-02")).toBe(1);
    expect(nextStreak("2026-01-02", 3, "2026-01-02")).toBe(3);
    expect(dailyReward(1)).toBe(5_000);
    expect(dailyReward(8)).toBe(5_000);
  });
});

describe("market", () => {
  it("keeps every price positive and near its base over a month", () => {
    for (const asset of MARKET_ASSETS) {
      for (let hour = 0; hour < 24 * 30; hour += 7) {
        const price = assetPrice(asset, Date.UTC(2026, 5, 1) + hour * 3_600_000, rand);
        expect(price).toBeGreaterThan(asset.base * 0.35);
        expect(price).toBeLessThan(asset.base * 2.8);
      }
    }
  });
});

describe("betting", () => {
  it("gives the wheel a small house edge", () => {
    expect(spinReturn()).toBeGreaterThan(0.9);
    expect(spinReturn()).toBeLessThan(1);
    expect(spinMultiplier(0)).toBe(0);
    expect(spinMultiplier(0.9999)).toBe(10);
    expect(SPIN_WHEEL[spinSlice(10, 3)]).toBe(10);
  });

  it("pairs clubs once per round and prices favourites shorter", () => {
    const fixtures = roundFixtures(1234, rand);
    expect(fixtures).toHaveLength(6);
    const teams = fixtures.flatMap((fixture) => [fixture.home, fixture.away]);
    expect(new Set(teams).size).toBe(teams.length);
    const odds = matchOdds(footballClub("rma")!, footballClub("kan")!);
    expect(odds.home).toBeLessThan(odds.away);
    const p = matchProbabilities(footballClub("ars")!, footballClub("che")!);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6);
  });

  it("produces the same score for the same fixture", () => {
    const [fixture] = roundFixtures(99, rand);
    const a = matchResult(fixture!, rand);
    expect(matchResult(fixture!, rand)).toEqual(a);
    expect(a.goals.filter((goal) => goal.side === "home")).toHaveLength(a.home);
  });
});
