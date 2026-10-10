import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  blockedByWater,
  characterAppearanceSchema,
  defaultAppearance,
  getPlace,
  districtAt,
  HOME_UNITS,
  insideBuilding,
  lookSchema,
  looksSchema,
  PLACES,
  propertyPlace,
  propertyTitle,
  readAppearance,
  positionUpdateSchema,
  registerFootprints,
  registeredFootprintCount,
  resolveBuildingCollision,
  routeLength,
  sampleRoute,
  ROUTES,
  STOPS,
  walkable,
} from "./index";

const tileDir = path.resolve(__dirname, "../../../apps/web/public/assets/world/tiles");
beforeAll(() => {
  for (const file of readdirSync(tileDir)) {
    registerFootprints(JSON.parse(readFileSync(path.join(tileDir, file), "utf8")).buildings);
  }
});

describe("character appearance contract", () => {
  it("accepts the shared default", () => {
    expect(characterAppearanceSchema.parse(defaultAppearance)).toEqual(defaultAppearance);
  });

  it("rejects client-invented catalogue values", () => {
    expect(() =>
      characterAppearanceSchema.parse({ ...defaultAppearance, outfit: "admin-only" }),
    ).toThrow();
  });

  it("reads stored looks safely, filling gaps and rejecting bad values", () => {
    expect(readAppearance({ hairstyle: "afro" })).toEqual({ ...defaultAppearance, hairstyle: "afro" });
    expect(readAppearance({ ...defaultAppearance, skinTone: "green" })).toEqual(defaultAppearance);
    expect(readAppearance(null)).toEqual(defaultAppearance);
    expect(readAppearance("afro")).toEqual(defaultAppearance);
  });

  it("caps a looks message at the room size it can describe", () => {
    const look = { sessionId: "abc", appearance: defaultAppearance };
    expect(looksSchema.safeParse(Array.from({ length: 200 }, () => look)).success).toBe(true);
    expect(looksSchema.safeParse(Array.from({ length: 201 }, () => look)).success).toBe(false);
    expect(lookSchema.safeParse({ sessionId: "", appearance: defaultAppearance }).success).toBe(false);
  });
});

describe("position contract", () => {
  it("strips client-invented fields such as balances", () => {
    const result = positionUpdateSchema.parse({
      sequence: 4,
      x: 10,
      z: 20,
      yaw: 0,
      motion: "jog",
      balance: 999_999,
    });
    expect(result).not.toHaveProperty("balance");
  });

  it("rejects unknown motion states and non-finite positions", () => {
    expect(() =>
      positionUpdateSchema.parse({ sequence: 1, x: 0, z: 0, yaw: 0, motion: "teleport" }),
    ).toThrow();
    expect(() =>
      positionUpdateSchema.parse({ sequence: 1, x: Number.NaN, z: 0, yaw: 0, motion: "idle" }),
    ).toThrow();
  });
});

describe("mapped Lekki world", () => {
  it("builds closed danfo loops with ordered stops", () => {
    expect(ROUTES.map((route) => route.routeNumber)).toEqual(["L1", "I1", "V1"]);
    for (const route of ROUTES) {
      expect(routeLength(route)).toBeGreaterThan(1500);
      const positions = route.stops.map((stop) => stop.s);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      const start = sampleRoute(route, 0);
      const wrapped = sampleRoute(route, routeLength(route));
      expect(Math.hypot(start.x - wrapped.x, start.z - wrapped.z)).toBeLessThan(0.01);
      route.points.forEach((a, index) => {
        const b = route.points[(index + 1) % route.points.length]!;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${route.routeId} point ${index}`).toBeLessThan(400);
      });
      const [first, last] = [route.points[0]!, route.points.at(-1)!];
      expect(Math.hypot(first[0] - last[0], first[1] - last[1]), `${route.routeId} turnaround`).toBeLessThan(40);
    }
  });

  it("serves Ikoyi and Victoria Island with stops residents can stand at", () => {
    expect(new Set(STOPS.map((stop) => stop.id)).size).toBe(STOPS.length);
    const served = new Set(STOPS.map((stop) => districtAt(stop.alight[0], stop.alight[1])?.id));
    expect([...served].sort()).toEqual(["ikoyi", "lekki-phase-1", "victoria-island"]);
    for (const stop of STOPS) {
      expect(walkable(stop.alight[0], stop.alight[1]), stop.id).toBe(true);
      expect(insideBuilding(stop.alight[0], stop.alight[1]), stop.id).toBe(false);
      const pose = sampleRoute(stop.route, stop.s);
      expect(Math.hypot(pose.x - stop.pole[0], pose.z - stop.pole[1]), stop.id).toBeLessThan(3.5);
    }
  });

  it("keeps doors outside footprints and pushes avatars out of walls", () => {
    for (const id of ["starter-home", "swift-parcel-hub", "mama-titi-buka"]) {
      const { door } = getPlace(id);
      expect(insideBuilding(door[0], door[1])).toBe(false);
    }
    const { facade, door } = getPlace("starter-home");
    const inside: [number, number] = [
      facade[0] + (facade[0] - door[0]) * 1.5,
      facade[1] + (facade[1] - door[1]) * 1.5,
    ];
    const [x, z] = resolveBuildingCollision(inside[0], inside[1]);
    expect(insideBuilding(x, z, 0.05)).toBe(false);
  });
});

describe("streamed districts", () => {
  it("registers every tile footprint once", () => {
    const count = registeredFootprintCount();
    expect(count).toBeGreaterThan(4000);
    for (const file of readdirSync(tileDir)) {
      registerFootprints(JSON.parse(readFileSync(path.join(tileDir, file), "utf8")).buildings);
    }
    expect(registeredFootprintCount()).toBe(count);
  });

  it("puts every place door in its district, outside its building and off the water", () => {
    for (const place of PLACES) {
      expect(districtAt(place.door[0], place.door[1])?.id, place.id).toBe(place.district);
      expect(walkable(place.door[0], place.door[1]), place.id).toBe(true);
    }
    expect(new Set(PLACES.map((place) => place.district))).toEqual(new Set(["lekki-phase-1", "ikoyi", "victoria-island"]));
  });

  it("blocks the open lagoon but keeps the Lekki-Ikoyi Link Bridge deck walkable", () => {
    // Midway along the bridge (OSM way 499678924), on the deck and 80 m off it.
    const deck: [number, number] = [-1278.6, 648.4];
    expect(blockedByWater(deck[0], deck[1])).toBe(false);
    expect(blockedByWater(deck[0], deck[1] + 80)).toBe(true);
    expect(blockedByWater(deck[0], deck[1] - 80)).toBe(true);
    expect(districtAt(deck[0], deck[1])?.id).toBe("link-bridge");
  });

  it("makes the bridge one continuous deck that ends at the parapets", () => {
    // A north-south cut across the bridge: both carriageways and both footways, no water gap between them.
    const dry: number[] = [];
    for (let dz = -40; dz <= 40; dz += 0.25) if (!blockedByWater(-1278.6, 648.4 + dz)) dry.push(dz);
    const runs = dry.filter((dz, index) => index === 0 || dz - dry[index - 1]! > 0.26).length;
    expect(runs).toBe(1);
    const width = dry[dry.length - 1]! - dry[0]!;
    expect(width).toBeGreaterThan(18);
    expect(width).toBeLessThan(28);
  });
});

describe("home units", () => {
  it("are unique and each belongs to a mapped rental or sale building", () => {
    expect(new Set(HOME_UNITS.map(({ id }) => id)).size).toBe(HOME_UNITS.length);
    for (const unit of HOME_UNITS) {
      const place = getPlace(unit.placeId);
      expect(["rental", "sale"]).toContain(place.kind);
      expect(propertyPlace(unit.id)).toBe(place);
    }
  });

  it("name units by building and leave unmapped listings without a place", () => {
    expect(propertyTitle("lekki-adebayo-flat-7")).toBe("Adebayo Court · Flat 7");
    expect(propertyTitle("starter-home")).toBe("Kayode Court Hostel");
    expect(propertyPlace("rental-test-123")).toBeNull();
  });
});
