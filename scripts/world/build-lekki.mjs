#!/usr/bin/env node
// Builds the compact 1:1 metric Lekki Phase 1 world file from the retained
// OpenStreetMap extract (ODbL). Road names stay attached to their own OSM way;
// unnamed ways are kept with name = null and are never labelled.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(root, "data/osm/lekki-phase1-extract.osm.json");
const target = path.join(root, "apps/web/public/assets/world/lekki-phase1.world.json");

const LAT0 = 6.444;
const LON0 = 3.469;
const BOUNDS = { minX: -640, maxX: 450, minZ: -230, maxZ: 540 };
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110_574;

const raw = JSON.parse(await readFile(source, "utf8"));
const nodes = new Map();
for (const element of raw.elements) {
  if (element.type === "node") {
    nodes.set(element.id, [
      Math.round((element.lon - LON0) * KX * 100) / 100,
      Math.round((element.lat - LAT0) * KZ * 100) / 100,
    ]);
  }
}

const inBounds = ([x, z], margin = 0) =>
  x >= BOUNDS.minX - margin &&
  x <= BOUNDS.maxX + margin &&
  z >= BOUNDS.minZ - margin &&
  z <= BOUNDS.maxZ + margin;

const roadWidths = {
  primary: 8.5,
  primary_link: 6,
  secondary: 8,
  tertiary: 7.5,
  unclassified: 6.5,
  residential: 6,
  service: 4,
  footway: 2,
};

const roads = [];
const buildings = [];
const areas = [];

function clipPolyline(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (inBounds(point, 60)) current.push(point);
    else if (current.length) {
      current.push(point);
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 1) segments.push(current);
  return segments.filter((segment) => segment.length > 1);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

for (const element of raw.elements) {
  if (element.type !== "way" || !element.tags) continue;
  const tags = element.tags;
  const points = element.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  if (tags.highway && roadWidths[tags.highway]) {
    for (const segment of clipPolyline(points)) {
      roads.push({
        id: element.id,
        name: tags.name ?? null,
        kind: tags.highway,
        oneway: tags.oneway === "yes",
        lanes: tags.lanes ? Number(tags.lanes) : null,
        width: roadWidths[tags.highway],
        points: segment,
      });
    }
  } else if (tags.building) {
    const ring = points.slice(0, -1);
    if (ring.length < 3) continue;
    const cx = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
    const cz = ring.reduce((sum, [, z]) => sum + z, 0) / ring.length;
    if (!inBounds([cx, cz])) continue;
    const area = polygonArea(ring);
    if (Math.abs(area) < 12) continue;
    buildings.push({
      id: element.id,
      kind: tags.building,
      levels: tags["building:levels"] ? Number(tags["building:levels"]) : null,
      name: tags.name ?? null,
      points: area < 0 ? ring.reverse() : ring,
    });
  } else if (tags.landuse || tags.leisure || tags.natural || tags.waterway) {
    const kind = tags.landuse ?? tags.leisure ?? tags.natural ?? tags.waterway;
    const inside = points.some((point) => inBounds(point));
    if (!inside) continue;
    areas.push({ id: element.id, kind, name: tags.name ?? null, points });
  }
}

const pois = raw.elements
  .filter((element) => element.type === "node" && element.tags && (element.tags.amenity || element.tags.shop))
  .map((element) => ({
    id: element.id,
    kind: element.tags.amenity ?? element.tags.shop,
    name: element.tags.name ?? null,
    position: nodes.get(element.id),
  }))
  .filter((poi) => inBounds(poi.position));

const world = {
  name: "Lekki Phase 1 starter section",
  attribution: "Map data © OpenStreetMap contributors, ODbL 1.0",
  source: {
    file: "data/osm/lekki-phase1-extract.osm.json",
    timestamp: raw.osm3s?.timestamp_osm_base ?? null,
    projection: { lat0: LAT0, lon0: LON0, unit: "metre", axes: "x east, z north" },
  },
  bounds: BOUNDS,
  roads,
  buildings,
  areas,
  pois,
};
// ---- Danfo loop along Admiralty Way (both carriageways), kerb lane. ----
const wayPoints = new Map();
for (const element of raw.elements) {
  if (element.type === "way") wayPoints.set(element.id, element.nodes.map((id) => nodes.get(id)));
}
function chain(ids) {
  const out = [];
  for (const id of ids) {
    const points = wayPoints.get(id);
    if (!points) throw new Error(`Missing way ${id}`);
    for (const point of points) {
      const last = out.at(-1);
      if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > 0.5) out.push(point);
    }
  }
  return out;
}
function offsetRight(points, distance) {
  return points.map((point, index) => {
    const a = points[Math.max(0, index - 1)];
    const b = points[Math.min(points.length - 1, index + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    return [
      Math.round((point[0] + (dz / length) * distance) * 100) / 100,
      Math.round((point[1] - (dx / length) * distance) * 100) / 100,
    ];
  });
}
// The loop turns at the Victoria Arobieke junction (x≈371) and the Adebayo
// Doherty junction; these turnarounds are a documented gameplay simplification.
const withinLoop = ([x]) => x <= 372 && x >= -545;
const eastbound = offsetRight(chain([294599766, 294599773, 294599770]).filter(withinLoop), 1.9);
const westbound = offsetRight(chain([294599763, 294599771, 294599755]).filter(withinLoop), 1.9);
const loop = [...eastbound, ...westbound];
const cumulative = [0];
for (let index = 1; index <= loop.length; index += 1) {
  const a = loop[index - 1];
  const b = loop[index % loop.length];
  cumulative.push(cumulative[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
}
function nearestOnLoop([x, z]) {
  let best = { distance: Infinity, s: 0, point: loop[0], right: [0, 0] };
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
    const point = [a[0] + dx * t, a[1] + dz * t];
    const distance = Math.hypot(point[0] - x, point[1] - z);
    if (distance < best.distance) {
      const length = Math.sqrt(lengthSquared);
      best = {
        distance,
        s: cumulative[index] + t * length,
        point,
        right: [dz / length, -dx / length],
      };
    }
  }
  return best;
}
const stopSeeds = [
  { id: "kayode-eb", name: "Admiralty Way · Kayode Animashaun (Eastbound)", near: [24, 418] },
  { id: "victoria-arobieke-wb", name: "Admiralty Way · Victoria Arobieke (Westbound)", near: [340, 432] },
  { id: "kayode-wb", name: "Admiralty Way · Kayode Animashaun (Westbound)", near: [40, 431] },
  { id: "adebayo-wb", name: "Admiralty Way · Adebayo Doherty (Westbound)", near: [-492, 364] },
  { id: "adebayo-eb", name: "Admiralty Way · Adebayo Doherty (Eastbound)", near: [-470, 353] },
];
const stops = stopSeeds
  .map((seed) => {
    const nearest = nearestOnLoop(seed.near);
    const pole = [
      nearest.point[0] + nearest.right[0] * 3.1,
      nearest.point[1] + nearest.right[1] * 3.1,
    ];
    return {
      id: seed.id,
      name: seed.name,
      s: Math.round(nearest.s * 10) / 10,
      pole: pole.map((value) => Math.round(value * 100) / 100),
      alight: [
        Math.round((pole[0] + nearest.right[0] * 1.2) * 100) / 100,
        Math.round((pole[1] + nearest.right[1] * 1.2) * 100) / 100,
      ],
      heading: Math.round(Math.atan2(-nearest.right[1], nearest.right[0]) * 1000) / 1000,
    };
  })
  .sort((a, b) => a.s - b.s);

// ---- Named gameplay places on mapped footprints (fictional businesses). ----
const buildingById = new Map(buildings.map((building) => [building.id, building]));
function doorFor(buildingId, streetName) {
  const building = buildingById.get(buildingId);
  if (!building) throw new Error(`Missing building ${buildingId}`);
  const street = roads.filter((road) => road.name === streetName);
  let best = null;
  const ring = building.points;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 2.5) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let roadDistance = Infinity;
    for (const road of street) {
      for (let p = 1; p < road.points.length; p += 1) {
        const r0 = road.points[p - 1];
        const r1 = road.points[p];
        const dx = r1[0] - r0[0];
        const dz = r1[1] - r0[1];
        const t = Math.max(0, Math.min(1, ((mid[0] - r0[0]) * dx + (mid[1] - r0[1]) * dz) / (dx * dx + dz * dz || 1)));
        roadDistance = Math.min(roadDistance, Math.hypot(r0[0] + dx * t - mid[0], r0[1] + dz * t - mid[1]));
      }
    }
    if (!best || roadDistance < best.roadDistance) best = { a, b, mid, length, roadDistance };
  }
  // Counter-clockwise rings: outward normal is to the right of the edge.
  const dx = best.b[0] - best.a[0];
  const dz = best.b[1] - best.a[1];
  const outward = [dz / best.length, -dx / best.length];
  const round = (value) => Math.round(value * 100) / 100;
  return {
    door: [round(best.mid[0] + outward[0] * 1.4), round(best.mid[1] + outward[1] * 1.4)],
    facade: [round(best.mid[0]), round(best.mid[1])],
    facing: round(Math.atan2(outward[0], outward[1])),
    frontage: round(best.length),
  };
}
const placeSeeds = [
  { id: "starter-home", kind: "starter_home", name: "Kayode Court Hostel", building: 1270576402, street: "Kayode Animashaun Street" },
  { id: "lekki-adebayo-flat-2", kind: "rental", name: "Adebayo Court", building: 1268315319, street: "Adebayo Doherty Road" },
  { id: "lekki-chief-okoro-house", kind: "sale", name: "Okoro Terrace", building: 1270055956, street: "Chief Okoro Avenue" },
  { id: "swift-parcel-hub", kind: "job", name: "Swift Parcel Hub", building: 1268315325, street: "Admiralty Way" },
  { id: "mama-titi-buka", kind: "food", name: "Mama Titi's Buka", building: 1268315326, street: "Admiralty Way" },
  { id: "corner-kiosk", kind: "shop", name: "Kayode Corner Mart", building: 775899028, street: "Admiralty Way" },
  { id: "home-and-style", kind: "furniture", name: "Home & Style Furnishings", building: 1270250897, street: "Admiralty Way" },
  { id: "lekki-motors", kind: "dealership", name: "Lekki Motors", building: 1270250907, street: "Admiralty Way" },
  { id: "ade-auto-works", kind: "mechanic", name: "Ade Auto Works", building: 1268314576, street: "Admiralty Way" },
  { id: "drop-chief-okoro", kind: "delivery", name: "Residence on Chief Okoro Avenue", building: 1270055968, street: "Chief Okoro Avenue" },
  { id: "drop-grace-anjos", kind: "delivery", name: "Residence on Grace Anjos Drive", building: 1268315312, street: "Grace Anjos Drive" },
  { id: "drop-adebayo", kind: "delivery", name: "Residence on Adebayo Doherty Road", building: 1270045946, street: "Adebayo Doherty Road" },
];
/** Kerbside parking spot on the place's street, nearest its door, facing along the near lane. */
function kerbFor(door, streetName) {
  let best = null;
  for (const road of roads.filter((candidate) => candidate.name === streetName)) {
    for (let p = 1; p < road.points.length; p += 1) {
      const r0 = road.points[p - 1];
      const r1 = road.points[p];
      const dx = r1[0] - r0[0];
      const dz = r1[1] - r0[1];
      const length = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((door[0] - r0[0]) * dx + (door[1] - r0[1]) * dz) / (length * length)));
      const point = [r0[0] + dx * t, r0[1] + dz * t];
      const distance = Math.hypot(point[0] - door[0], point[1] - door[1]);
      if (!best || distance < best.distance) best = { point, distance, ux: dx / length, uz: dz / length, width: road.width };
    }
  }
  // Pick the side of the carriageway nearest the door; right-hand traffic means travel along +u on the right side.
  const side = (door[0] - best.point[0]) * best.uz - (door[1] - best.point[1]) * best.ux >= 0 ? 1 : -1;
  // A lay-by just past the carriageway edge keeps parked cars out of the danfo's kerb lane.
  const offset = Math.min(best.width / 2 + 1.1, Math.max(best.width / 2 - 1.3, best.distance - 2.5));
  const round = (value) => Math.round(value * 100) / 100;
  const kerb = [round(best.point[0] + best.uz * offset * side), round(best.point[1] - best.ux * offset * side)];
  const yaw = side > 0 ? Math.atan2(best.ux, best.uz) : Math.atan2(-best.ux, -best.uz);
  return { kerb, kerbYaw: round(yaw) };
}
const places = placeSeeds.map((seed) => {
  const door = doorFor(seed.building, seed.street);
  return {
    id: seed.id,
    kind: seed.kind,
    name: seed.name,
    street: seed.street,
    buildingId: seed.building,
    ...door,
    ...kerbFor(door.door, seed.street),
  };
});

const transit = {
  routeId: "admiralty-loop",
  routeName: "Admiralty Way Loop",
  routeNumber: "L1",
  fare: 300,
  length: Math.round(cumulative.at(-1) * 10) / 10,
  points: loop,
  stops,
};
world.transit = transit;
world.places = places;

const sharedTarget = path.join(root, "packages/shared/src/generated/lekki-world.json");
await mkdir(path.dirname(sharedTarget), { recursive: true });
await writeFile(sharedTarget, JSON.stringify({ bounds: BOUNDS, transit, places, buildings: buildings.map(({ id, points }) => ({ id, points })) }));
await writeFile(target, JSON.stringify(world));
console.log(`route ${transit.length} m, stops ${stops.map((stop) => `${stop.id}@${stop.s}`).join(", ")}`);
console.log(places.map((place) => `${place.id} door ${place.door}`).join("\n"));
console.log(
  `roads ${roads.length} (named ${roads.filter((road) => road.name).length}), buildings ${buildings.length}, areas ${areas.length}, pois ${pois.length}`,
);
