import { describe, expect, it } from "vitest";
import { twoWheeled, VEHICLE_MODELS, vehicleOverlap, vehicleSeats } from "./vehicles";

describe("modelled vehicle layouts", () => {
  const modelled = VEHICLE_MODELS.filter((model) => model.asset);

  it("gives every car in the catalogue a modelled body", () => {
    expect(VEHICLE_MODELS.filter((model) => !twoWheeled(model) && !model.asset)).toEqual([]);
  });

  it("sells motorbikes for a rider and one passenger, astride on the centre line", () => {
    const bikes = VEHICLE_MODELS.filter((model) => model.body === "motorbike");
    expect(bikes.length).toBeGreaterThanOrEqual(3);
    for (const bike of bikes) {
      expect(vehicleSeats(bike)).toHaveLength(bike.seats);
      expect(vehicleSeats(bike).every((seat) => seat.x === 0)).toBe(true);
      expect(bike.topSpeed).toBeGreaterThan(VEHICLE_MODELS.find((model) => model.body === "bicycle")!.topSpeed);
    }
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

describe("vehicleOverlap", () => {
  const model = { length: 4.6, width: 1.9 };
  const parked = { model, x: 0, z: 0, yaw: 0 };

  it("is zero for cars parked side by side or nose to tail with a gap", () => {
    expect(vehicleOverlap({ model, x: 2.3, z: 0, yaw: 0 }, parked)).toBe(0);
    expect(vehicleOverlap({ model, x: 0, z: 5.0, yaw: 0 }, parked)).toBe(0);
  });

  it("grows as one car is driven into another, from the side or end on", () => {
    const shallow = vehicleOverlap({ model, x: 1.6, z: 0, yaw: 0 }, parked);
    const deep = vehicleOverlap({ model, x: 0.5, z: 0, yaw: 0 }, parked);
    expect(shallow).toBeGreaterThan(0.3);
    expect(deep).toBeGreaterThan(shallow);
    expect(vehicleOverlap({ model, x: 0, z: 2.8, yaw: Math.PI / 2 }, parked)).toBeGreaterThan(0.3);
  });
});
