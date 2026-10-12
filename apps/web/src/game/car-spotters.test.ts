import { vehicleModelById } from "@lagos-living/shared";
import { describe, expect, it } from "vitest";
import { carRarity } from "./car-spotters";

const car = (modelId: string, condition: number | null = 100, colour?: string) => ({ modelId, condition, colour: colour ?? vehicleModelById.get(modelId)!.colours[0]! });

describe("car spotter interest", () => {
  it("ignores ordinary cars and bikes, ranks supercars highest, and loses interest in battered cars", () => {
    expect(carRarity(car("yaba-city-bike"))).toBe(0);
    expect(carRarity(car("rolls-royce-cullinan"))).toBe(3);
    expect(carRarity(car("mercedes-g63"))).toBe(2);
    expect(carRarity(car("rolls-royce-cullinan", 30))).toBe(2);
    expect(carRarity(car("rolls-royce-cullinan", 100, "#123456"))).toBe(3.5);
  });
});
