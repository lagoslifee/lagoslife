import { describe, expect, it } from "vitest";
import { findFreeSpot, FURNITURE, furnitureRect, homeRoomFor, legacyCellPosition, misplacedRoom, nearestCell, placementProblem, type PlacedPiece } from "./furniture.js";
import { FRONT_WALL, HOME_LAYOUTS, roomAt } from "./home-layouts.js";
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

  it("delivers each piece to its room, wardrobes and beds backed onto a wall", () => {
    for (const layout of Object.values(HOME_LAYOUTS)) {
      for (const item of FURNITURE) {
        const spot = findFreeSpot(item.id, [], layout);
        expect(spot, `${layout.tier} ${item.id}`).not.toBeNull();
        const room = homeRoomFor(item.id, layout);
        if (room) expect(roomAt(layout, spot!.x, spot!.z, spot!.level), `${layout.tier} ${item.id}`).toBe(room);
        if (item.wall) {
          const rect = furnitureRect(item, spot!.x, spot!.z, spot!.rotation);
          const walls = spot!.level ? layout.upper!.floors.find((floor) => Math.abs(rect.x - floor.x) <= floor.hx && Math.abs(rect.z - floor.z) <= floor.hz)! : { x: 0, z: (layout.back + FRONT_WALL) / 2, hx: layout.halfX, hz: (layout.back - FRONT_WALL) / 2 };
          const gaps = [walls.z + walls.hz - rect.z - rect.hz, rect.z - rect.hz - (walls.z - walls.hz), walls.x + walls.hx - rect.x - rect.hx, rect.x - rect.hx - (walls.x - walls.hx)];
          expect(Math.min(...gaps), `${layout.tier} ${item.id}`).toBeLessThan(0.2);
        }
      }
    }
  });

  it("knows a wardrobe left in the living room belongs in the bedroom", () => {
    const layout = HOME_LAYOUTS.house;
    expect(misplacedRoom({ itemId: "wardrobe", x: 0, z: 0, rotation: 0 }, layout)).toBe("bedroom");
    expect(misplacedRoom({ itemId: "wardrobe", x: 7, z: 6, rotation: 90 }, layout)).toBeNull();
    expect(misplacedRoom({ itemId: "lagoon-sofa", x: 0, z: 0, rotation: 0 }, layout)).toBeNull();
    const spot = findFreeSpot("wardrobe", [], layout, "dining")!;
    expect(roomAt(layout, spot.x, spot.z)).toBe("dining");
  });

  it("furnishes the mansion's upstairs bedroom separately from the lounge under it", () => {
    const layout = HOME_LAYOUTS.mansion;
    const bed = findFreeSpot("eko-king-bed", [], layout)!;
    expect(bed.level).toBe(1);
    expect(roomAt(layout, bed.x, bed.z, 1)).toBe("bedroom");
    const upstairs: PlacedPiece = { id: "bed", itemId: "eko-king-bed", ...bed };
    // The same spot downstairs is free: the lounge under the bedroom is another floor.
    expect(placementProblem({ itemId: "ikoyi-sectional", x: bed.x, z: bed.z, rotation: 0, level: 0 }, [upstairs], layout)).toBeNull();
    expect(placementProblem({ itemId: "velvet-armchair", x: bed.x, z: bed.z, rotation: 0, level: 1 }, [upstairs], layout)).toMatch(/on top of/);
    // Upstairs, pieces stay inside the suites and the landing: not over the stairwell or in a doorway.
    expect(placementProblem({ itemId: "velvet-armchair", x: 0, z: 12, rotation: 0, level: 1 }, [], layout)).toMatch(/upstairs room/);
    expect(placementProblem({ itemId: "velvet-armchair", x: 3.3, z: 17.4, rotation: 0, level: 1 }, [], layout)).toMatch(/door/);
    expect(placementProblem({ itemId: "velvet-armchair", x: 0, z: 0, rotation: 0, level: 1 }, [], HOME_LAYOUTS.house)).toMatch(/no upstairs/);
    // A king bed left downstairs belongs up in the bedroom.
    expect(misplacedRoom({ itemId: "eko-king-bed", x: 9.5, z: 12.5, rotation: 0 }, layout)).toBe("bedroom");
    expect(misplacedRoom({ itemId: "eko-king-bed", x: 9.5, z: 12.5, rotation: 0, level: 1 }, layout)).toBeNull();
    const wardrobe = findFreeSpot("wardrobe", [upstairs], layout)!;
    expect(wardrobe.level).toBe(1);
    expect(placementProblem({ itemId: "wardrobe", ...wardrobe }, [upstairs], layout)).toBeNull();
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
