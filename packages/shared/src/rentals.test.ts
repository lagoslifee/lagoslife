import { describe, expect, it } from "vitest";
import { BIKE_RENTAL, BIKE_STATIONS, rentalUsage } from "./rentals.js";
import { walkable } from "./index.js";

describe("bike stations", () => {
  it("stand on walkable pavement and are spread out", () => {
    for (const station of BIKE_STATIONS) {
      expect(walkable(station.point[0], station.point[1], 0.6), station.id).toBe(true);
      for (const other of BIKE_STATIONS) {
        if (other !== station) expect(Math.hypot(other.point[0] - station.point[0], other.point[1] - station.point[1])).toBeGreaterThan(150);
      }
    }
  });

  it("charge started minutes and never more than the deposit", () => {
    expect(rentalUsage(0, 10_000)).toEqual({ minutes: 1, usage: BIKE_RENTAL.perMinute });
    expect(rentalUsage(0, 4 * 60_000 + 1)).toEqual({ minutes: 5, usage: 5 * BIKE_RENTAL.perMinute });
    expect(rentalUsage(0, 10 * 3_600_000).usage).toBe(BIKE_RENTAL.deposit);
  });
});
