import { describe, expect, it } from "vitest";
import { findFreeSpot, FURNITURE, legacyCellPosition, nearestCell, placementProblem, type PlacedPiece } from "./furniture.js";
import { HOUSE_DESIGNS, PLOTS } from "./building.js";

describe("home furniture", () => {
  it("finds room for every piece in an empty home", () => {
    for (const item of FURNITURE) expect(findFreeSpot(item.id, []), item.id).not.toBeNull();
  });

  it("keeps old grid placements where they were", () => {
    for (const [gx, gz] of [[0, 0], [3, 2], [7, 5]] as const) expect(nearestCell(...legacyCellPosition(gx, gz))).toEqual([gx, gz]);
  });

  it("refuses overlaps, the doorway and the walls, but lets rugs sit under furniture", () => {
    const sofa: PlacedPiece = { id: "a", itemId: "lagoon-sofa", x: 0, z: 1, rotation: 0 };
    expect(placementProblem({ itemId: "velvet-armchair", x: 0.5, z: 1.2, rotation: 0 }, [sofa])).toMatch(/on top of/);
    expect(placementProblem({ itemId: "aso-rug", x: 0, z: 1, rotation: 0 }, [sofa])).toBeNull();
    expect(placementProblem({ ...sofa, x: 0.4 }, [sofa])).toBeNull();
    expect(placementProblem({ itemId: "velvet-armchair", x: 0, z: -4.2, rotation: 0 }, [])).toMatch(/doorway/);
    expect(placementProblem({ itemId: "wardrobe", x: 0, z: 4.6, rotation: 0 }, [])).toMatch(/inside the walls/);
    expect(placementProblem({ itemId: "wardrobe", x: 0, z: 4.4, rotation: 0 }, [])).toBeNull();
  });

  it("fills a room until there is no floor left, then says so", () => {
    const placed: PlacedPiece[] = [];
    for (let index = 0; index < 40; index += 1) {
      const spot = findFreeSpot("ikoyi-sectional", placed);
      if (!spot) break;
      placed.push({ id: String(index), itemId: "ikoyi-sectional", ...spot });
    }
    expect(placed.length).toBeGreaterThan(4);
    expect(findFreeSpot("ikoyi-sectional", placed)).toBeNull();
    for (const piece of placed) expect(placementProblem(piece, placed)).toBeNull();
  });
});

describe("house designs", () => {
  it("fits every design, its carports and its pool inside a plot", () => {
    const plot = PLOTS[0]!;
    for (const design of HOUSE_DESIGNS) {
      const front = -plot.depth / 2 + 3;
      expect(front + design.depth, design.id).toBeLessThan(plot.depth / 2 - 1);
      if (design.parking > 0) expect(design.width / 2 + 3.6, design.id).toBeLessThan(plot.width / 2);
      if (design.pool) {
        const garden = plot.depth / 2 - (front + design.depth);
        expect(design.pool[1] + 2, design.id).toBeLessThan(garden);
        expect(design.pool[0], design.id).toBeLessThan(plot.width - 2);
      }
    }
  });
});
