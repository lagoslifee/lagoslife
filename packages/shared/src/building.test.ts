import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { designTotal, HOUSE_DESIGNS, houseDoor, houseFootprint, PLOTS, PLOT_TERMS } from "./building.js";
import { districtAt, getPlace, insideBuilding, registerFootprints, walkable, type Vec2 } from "./world.js";

const tileDir = path.resolve(__dirname, "../../../apps/web/public/assets/world/tiles");

beforeAll(() => {
  for (const file of readdirSync(tileDir)) {
    if (file.endsWith(".json")) registerFootprints(JSON.parse(readFileSync(path.join(tileDir, file), "utf8")).buildings);
  }
});

const inRectangle = (point: Vec2, plot: (typeof PLOTS)[number]) => {
  const dx = point[0] - plot.center[0];
  const dz = point[1] - plot.center[1];
  const along = dx * plot.along[0] + dz * plot.along[1];
  const inward = dx * plot.inward[0] + dz * plot.inward[1];
  return Math.abs(along) <= plot.width / 2 + 1e-6 && Math.abs(inward) <= plot.depth / 2 + 1e-6;
};

describe("building plots", () => {
  it("sit in Lekki, close enough to the start to be a first goal", () => {
    expect(PLOTS.length).toBeGreaterThanOrEqual(6);
    const start = getPlace("starter-home").door;
    for (const plot of PLOTS) expect(districtAt(...plot.center)?.id).toBe("lekki-phase-1");
    expect(Math.min(...PLOTS.map((plot) => Math.hypot(plot.center[0] - start[0], plot.center[1] - start[1])))).toBeLessThan(80);
  });

  it("have walkable gates and land clear of mapped buildings", () => {
    for (const plot of PLOTS) {
      expect(walkable(...plot.gate), `${plot.id} gate`).toBe(true);
      for (let a = -0.5; a <= 0.5; a += 0.125) {
        for (let n = -0.5; n <= 0.5; n += 0.125) {
          const x = plot.center[0] + plot.along[0] * a * plot.width + plot.inward[0] * n * plot.depth;
          const z = plot.center[1] + plot.along[1] * a * plot.width + plot.inward[1] * n * plot.depth;
          expect(insideBuilding(x, z, 0), `${plot.id} at ${a},${n}`).toBe(false);
        }
      }
    }
  });

  it("fit every house design with its door on the plot", () => {
    for (const plot of PLOTS) {
      for (const design of HOUSE_DESIGNS) {
        for (const corner of houseFootprint(plot, design)) expect(inRectangle(corner, plot), `${plot.id} ${design.id}`).toBe(true);
        const door = houseDoor(plot);
        expect(inRectangle(door, plot)).toBe(true);
        expect(walkable(...door)).toBe(true);
      }
    }
  });

  it("price designs so the cheapest home can be started on the starting balance", () => {
    const totals = HOUSE_DESIGNS.map(designTotal);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    const cheapest = HOUSE_DESIGNS[0]!;
    expect(PLOT_TERMS.leaseRent + cheapest.stages.foundation.cost).toBeLessThan(250_000);
    expect(PLOT_TERMS.leaseRent + designTotal(cheapest)).toBeLessThan(250_000);
  });
});
