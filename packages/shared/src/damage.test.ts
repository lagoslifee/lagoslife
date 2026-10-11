import { describe, expect, it } from "vitest";
import { conditionAfterImpact, impactDamage, impactSeverity, VEHICLE_RULES } from "./vehicles.js";

describe("collision damage", () => {
  it("is a quarter of the original tuning and ignores scrapes", () => {
    expect(VEHICLE_RULES.damageMultiplier).toBe(0.25);
    expect(impactDamage(4)).toBe(0);
    expect(impactSeverity(4)).toBe("none");
    expect(impactDamage(10)).toBe(Math.round((10 - VEHICLE_RULES.impactMinSpeed + 1) * VEHICLE_RULES.impactDamagePerMps * 0.25));
    expect(impactDamage(10, 1)).toBe(16);
    expect(impactDamage(40)).toBe(Math.round(VEHICLE_RULES.impactMaxDamage * 0.25));
  });

  it("keeps a car drivable through several minor knocks; only severe impacts disable it", () => {
    let condition = 100;
    for (let knock = 0; knock < 30; knock += 1) condition = conditionAfterImpact(condition, impactDamage(12), impactSeverity(12) === "severe");
    expect(condition).toBe(VEHICLE_RULES.minorFloor);
    expect(impactSeverity(20)).toBe("severe");
    expect(conditionAfterImpact(5, 9, true)).toBe(0);
  });
});
