import { describe, expect, it } from "vitest";
import { VEHICLE_MODELS, vehicleSeats } from "./vehicles";

describe("modelled vehicle layouts", () => {
  const modelled = VEHICLE_MODELS.filter((model) => model.asset);

  it("gives every car in the catalogue a modelled body", () => {
    expect(VEHICLE_MODELS.filter((model) => model.body !== "bicycle" && !model.asset)).toEqual([]);
  });

  it.each(modelled.map((model) => [model.id, model] as const))("%s seats fit inside the body, driver on the left behind the wheel", (_, model) => {
    const asset = model.asset!;
    expect(model.seats).toBe(asset.seats.length);
    expect(vehicleSeats(model)).toHaveLength(model.seats);
    for (const seat of asset.seats) {
      expect(Math.abs(seat.x)).toBeLessThan(model.width / 2 - 0.3);
      expect(Math.abs(seat.z)).toBeLessThan(model.length / 2 - 0.4);
      expect(seat.y).toBeGreaterThanOrEqual(0);
    }
    const driver = asset.seats[0]!;
    expect(driver.x).toBeLessThan(0);
    expect(asset.steering.x).toBe(driver.x);
    expect(asset.steering.z).toBeGreaterThan(driver.z);
    expect(model.wheelbase).toBeLessThan(model.length);
    expect(asset.track * 2).toBeLessThan(model.width);
  });
});
