import { describe, expect, it } from "vitest";
import { expressFare, RIDE, rideFare } from "./rides.js";

describe("ride fares", () => {
  it("charges express the normal fare plus the express fee", () => {
    for (const metres of [150, 2_400, 18_000]) expect(expressFare(metres)).toBe(rideFare(metres) + RIDE.expressFee);
  });

  it("prices a 5 km cab at base plus distance, rounded to ₦50", () => {
    expect(rideFare(5_000)).toBe(1_200);
  });
});
