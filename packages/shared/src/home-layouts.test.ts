import { describe, expect, it } from "vitest";
import { builtHomeId, syncPlotFootprints, PLOTS } from "./building.js";
import { FURNITURE, findFreeSpot, furnitureRect, placementProblem } from "./furniture.js";
import { FRONT_WALL, HOME_LAYOUTS, homeLayout, insideHome } from "./home-layouts.js";

describe("home layouts", () => {
  it("sizes homes by what they are worth", () => {
    expect(homeLayout("lekki-adebayo-flat-3").tier).toBe("flat");
    expect(homeLayout("lekki-chief-okoro-house-2").tier).toBe("house");
    expect(homeLayout("vi-kofo-residences~abc").tier).toBe("apartment");
    expect(homeLayout("ikoyi-milverton-mansion").tier).toBe("mansion");
    expect(homeLayout(null).tier).toBe("flat");
    const areas = (["flat", "house", "apartment", "mansion"] as const).map((tier) => HOME_LAYOUTS[tier].halfX * 2 * (HOME_LAYOUTS[tier].back - FRONT_WALL));
    expect([...areas].sort((a, b) => a - b)).toEqual(areas);
  });

  it("follows the design built on a plot", () => {
    const plot = PLOTS[0]!;
    syncPlotFootprints([{ plotId: plot.id, designId: "estate-mansion", stagesPaid: 4 }]);
    expect(homeLayout(builtHomeId(plot.id)).tier).toBe("mansion");
    syncPlotFootprints([]);
    expect(homeLayout(builtHomeId(plot.id)).tier).toBe("flat");
  });

  it("keeps every piece placed in the original room inside the walls of every plan", () => {
    const flat = HOME_LAYOUTS.flat;
    for (const layout of Object.values(HOME_LAYOUTS)) {
      for (const [x, z] of [[-flat.halfX, FRONT_WALL], [flat.halfX, flat.back]] as const) expect(insideHome(layout, x, z)).toBe(true);
      for (const fixture of layout.fixtures) expect(insideHome(layout, fixture.x, fixture.z), `${layout.tier} ${fixture.label}`).toBe(true);
    }
  });

  it("lets a mansion take furniture far beyond a flat's walls but not on its staircase", () => {
    const mansion = HOME_LAYOUTS.mansion;
    expect(placementProblem({ itemId: "eko-king-bed", x: 8, z: 12, rotation: 0 }, [], mansion)).toBeNull();
    expect(placementProblem({ itemId: "eko-king-bed", x: 8, z: 12, rotation: 0 }, [])).toMatch(/inside the walls/);
    expect(placementProblem({ itemId: "dining-set", x: 0, z: 12, rotation: 0 }, [], mansion)).toMatch(/staircase/);
    for (const layout of Object.values(HOME_LAYOUTS)) {
      for (const item of FURNITURE) {
        const spot = findFreeSpot(item.id, [], layout);
        expect(spot, `${layout.tier} ${item.id}`).not.toBeNull();
        const rect = furnitureRect(item, spot!.x, spot!.z, spot!.rotation);
        expect(insideHome(layout, rect.x, rect.z)).toBe(true);
      }
    }
  });
});
