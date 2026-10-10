#!/usr/bin/env node
// Builds the 1:1 metric Lagos world (Lekki Phase 1, the Lekki-Ikoyi Link Bridge,
// Ikoyi and Victoria Island) from the retained OpenStreetMap extracts (ODbL).
// Road names stay attached to their own OSM way; unnamed ways keep name = null
// and are never labelled. Buildings and areas are split into streamed tiles.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const osmDir = path.join(root, "data/osm");
const worldDir = path.join(root, "apps/web/public/assets/world");
const tileDir = path.join(worldDir, "tiles");
const sharedTarget = path.join(root, "packages/shared/src/generated/lagos-world.json");

const LAT0 = 6.444;
const LON0 = 3.469;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110_574;
const TILE = 320;
const WATER_CELL = 10;

/** Playable districts in local metres. Order matters: the first match names a point. */
const DISTRICTS = [
  { id: "lekki-phase-1", name: "Lekki Phase 1", lga: "Eti-Osa", rect: { minX: -1000, maxX: 450, minZ: -230, maxZ: 540 } },
  { id: "link-bridge", name: "Lekki-Ikoyi Link Bridge", lga: "Eti-Osa", rect: { minX: -2300, maxX: -1000, minZ: 220, maxZ: 800 } },
  { id: "ikoyi", name: "Ikoyi", lga: "Eti-Osa", rect: { minX: -4950, maxX: -1880, minZ: -440, maxZ: 1530 } },
  { id: "victoria-island", name: "Victoria Island", lga: "Eti-Osa", rect: { minX: -7050, maxX: -4110, minZ: -2410, maxZ: -420 } },
];
const EXTRACTS = [
  "lekki-phase1-extract.osm.json",
  "link-bridge-extract.osm.json",
  "ikoyi-extract.osm.json",
  "victoria-island-extract.osm.json",
];

const BOUNDS = {
  minX: Math.min(...DISTRICTS.map(({ rect }) => rect.minX)),
  maxX: Math.max(...DISTRICTS.map(({ rect }) => rect.maxX)),
  minZ: Math.min(...DISTRICTS.map(({ rect }) => rect.minZ)),
  maxZ: Math.max(...DISTRICTS.map(({ rect }) => rect.maxZ)),
};
const project = (lat, lon) => [Math.round((lon - LON0) * KX * 100) / 100, Math.round((lat - LAT0) * KZ * 100) / 100];
const round2 = (value) => Math.round(value * 100) / 100;

const inRect = ([x, z], rect, margin = 0) =>
  x >= rect.minX - margin && x <= rect.maxX + margin && z >= rect.minZ - margin && z <= rect.maxZ + margin;
const inDistricts = (point, margin = 0) => DISTRICTS.some(({ rect }) => inRect(point, rect, margin));

// ---- Merge extracts: nodes and ways are deduplicated by OSM id. ----
const nodes = new Map();
const ways = new Map();
const nodeTags = new Map();
const timestamps = [];
for (const file of EXTRACTS) {
  const raw = JSON.parse(await readFile(path.join(osmDir, file), "utf8"));
  timestamps.push({ file: `data/osm/${file}`, timestamp: raw.osm3s?.timestamp_osm_base ?? null });
  for (const element of raw.elements) {
    if (element.type === "node") {
      nodes.set(element.id, project(element.lat, element.lon));
      if (element.tags) nodeTags.set(element.id, element.tags);
    }
  }
  for (const element of raw.elements) {
    if (element.type !== "way" || !element.tags) continue;
    const existing = ways.get(element.id);
    if (!existing || element.nodes.length > existing.nodes.length) ways.set(element.id, element);
  }
}

const ROAD_KINDS = {
  trunk: { kind: "primary", width: 10 },
  primary: { kind: "primary", width: 8.5 },
  trunk_link: { kind: "primary_link", width: 6 },
  primary_link: { kind: "primary_link", width: 6 },
  secondary_link: { kind: "primary_link", width: 6 },
  tertiary_link: { kind: "primary_link", width: 5.5 },
  secondary: { kind: "tertiary", width: 8 },
  tertiary: { kind: "tertiary", width: 7.5 },
  unclassified: { kind: "unclassified", width: 6.5 },
  residential: { kind: "residential", width: 6 },
  living_street: { kind: "residential", width: 5 },
  service: { kind: "service", width: 4 },
  footway: { kind: "footway", width: 2 },
  pedestrian: { kind: "footway", width: 3 },
};

function clipPolyline(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (inDistricts(point, 60)) current.push(point);
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
const centroidOf = (ring) => [ring.reduce((sum, [x]) => sum + x, 0) / ring.length, ring.reduce((sum, [, z]) => sum + z, 0) / ring.length];

const roads = [];
const buildings = [];
const areas = [];
for (const element of ways.values()) {
  const tags = element.tags;
  const points = element.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 2) continue;
  const roadKind = tags.highway ? ROAD_KINDS[tags.highway] : null;
  if (roadKind && tags.area !== "yes") {
    for (const segment of clipPolyline(points)) {
      roads.push({
        id: element.id,
        name: tags.name ?? null,
        kind: roadKind.kind,
        oneway: tags.oneway === "yes",
        lanes: tags.lanes ? Number(tags.lanes) : null,
        width: roadKind.width,
        ...(tags.bridge === "yes" ? { bridge: true } : {}),
        points: segment,
      });
    }
  } else if (tags.building) {
    const ring = points.slice(0, -1);
    if (ring.length < 3) continue;
    if (!inDistricts(centroidOf(ring))) continue;
    const area = polygonArea(ring);
    if (Math.abs(area) < 12) continue;
    const levels = tags["building:levels"] ? Number.parseInt(tags["building:levels"], 10) : null;
    buildings.push({
      id: element.id,
      kind: tags.building,
      levels: Number.isFinite(levels) && levels > 0 ? levels : null,
      name: tags.name ?? null,
      points: area < 0 ? ring.reverse() : ring,
    });
  } else if (tags.landuse || tags.leisure || tags.natural || tags.waterway) {
    const kind = tags.landuse ?? tags.leisure ?? tags.natural ?? tags.waterway;
    if (kind === "coastline") continue;
    if (!points.some((point) => inDistricts(point))) continue;
    areas.push({ id: element.id, kind, name: tags.name ?? null, points });
  }
}
roads.sort((a, b) => a.id - b.id);
buildings.sort((a, b) => a.id - b.id);

const pois = [...nodeTags]
  .filter(([, tags]) => tags.amenity || tags.shop)
  .map(([id, tags]) => ({ id, kind: tags.amenity ?? tags.shop, name: tags.name ?? null, position: nodes.get(id) }))
  .filter((poi) => inDistricts(poi.position));

// ---- Water: Lagos Lagoon, Five Cowries Creek and Commodore Channel multipolygons. ----
function assembleRings(memberWays) {
  const key = ([x, z]) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;
  const pending = memberWays.filter((way) => way.length > 1).map((way) => [...way]);
  const rings = [];
  while (pending.length) {
    let ring = pending.pop();
    let grown = true;
    while (key(ring[0]) !== key(ring.at(-1)) && grown) {
      grown = false;
      for (let index = 0; index < pending.length; index += 1) {
        const way = pending[index];
        if (key(way[0]) === key(ring.at(-1))) ring = ring.concat(way.slice(1));
        else if (key(way.at(-1)) === key(ring.at(-1))) ring = ring.concat([...way].reverse().slice(1));
        else if (key(way.at(-1)) === key(ring[0])) ring = way.concat(ring.slice(1));
        else if (key(way[0]) === key(ring[0])) ring = [...way].reverse().concat(ring.slice(1));
        else continue;
        pending.splice(index, 1);
        grown = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}
const waterRaw = JSON.parse(await readFile(path.join(osmDir, "water-extract.osm.json"), "utf8"));
timestamps.push({ file: "data/osm/water-extract.osm.json", timestamp: waterRaw.osm3s?.timestamp_osm_base ?? null });
const waterBodies = waterRaw.elements.map((relation) =>
  assembleRings(
    relation.members
      .filter((member) => member.type === "way" && member.geometry)
      .map((member) => member.geometry.map(({ lat, lon }) => project(lat, lon))),
  ),
);

/** The water mask reaches two tiles past the districts so edge tiles render real shoreline. */
const MASK = { minX: BOUNDS.minX - 2 * TILE, maxX: BOUNDS.maxX + 2 * TILE, minZ: BOUNDS.minZ - 2 * TILE, maxZ: BOUNDS.maxZ + 2 * TILE };
const cols = Math.ceil((MASK.maxX - MASK.minX) / WATER_CELL);
const rows = Math.ceil((MASK.maxZ - MASK.minZ) / WATER_CELL);
/** Vertex samples (cols + 1) x (rows + 1): 1 = water. Even-odd per water body, unioned across bodies. */
const water = new Uint8Array((cols + 1) * (rows + 1));
for (const rings of waterBodies) {
  for (let row = 0; row <= rows; row += 1) {
    const z = MASK.minZ + row * WATER_CELL;
    const crossings = [];
    for (const ring of rings) {
      for (let index = 1; index < ring.length; index += 1) {
        const [x1, z1] = ring[index - 1];
        const [x2, z2] = ring[index];
        if (z1 > z !== z2 > z) crossings.push(x1 + ((z - z1) * (x2 - x1)) / (z2 - z1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[index] - MASK.minX) / WATER_CELL));
      const c1 = Math.min(cols, Math.floor((crossings[index + 1] - MASK.minX) / WATER_CELL));
      for (let col = c0; col <= c1; col += 1) water[row * (cols + 1) + col] = 1;
    }
  }
}
/**
 * Movement mask: water minus corridors around ordinary roads (causeways and shoreline roads stay walkable).
 * Bridges are not cleared here; their decks are exact strips checked at runtime, so the 10 m grid can't leak past a parapet.
 */
const blocked = Uint8Array.from(water);
for (const road of roads) {
  if (road.bridge) continue;
  const reach = road.width / 2 + (road.kind === "footway" ? 1 : 4.5);
  for (let index = 1; index < road.points.length; index += 1) {
    const [ax, az] = road.points[index - 1];
    const [bx, bz] = road.points[index];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - MASK.minX) / WATER_CELL));
    const c1 = Math.min(cols, Math.ceil((Math.max(ax, bx) + reach - MASK.minX) / WATER_CELL));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - MASK.minZ) / WATER_CELL));
    const r1 = Math.min(rows, Math.ceil((Math.max(az, bz) + reach - MASK.minZ) / WATER_CELL));
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz || 1;
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const x = MASK.minX + col * WATER_CELL;
        const z = MASK.minZ + row * WATER_CELL;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= reach + WATER_CELL * 0.75) blocked[row * (cols + 1) + col] = 0;
      }
    }
  }
}
const pack = (bits) => {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => {
    if (bit) bytes[index >> 3] |= 1 << (index & 7);
  });
  return Buffer.from(bytes).toString("base64");
};
const waterGrid = (bits) => ({ originX: MASK.minX, originZ: MASK.minZ, cell: WATER_CELL, cols, rows, bits: pack(bits) });

// ---- Tiles: buildings and areas by centroid. Roads stay global (navigation, maps, names). ----
const tileKey = ([x, z]) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
const tiles = new Map();
const tileFor = (key) => {
  let tile = tiles.get(key);
  if (!tile) {
    tile = { key, buildings: [], areas: [] };
    tiles.set(key, tile);
  }
  return tile;
};
for (const building of buildings) tileFor(tileKey(centroidOf(building.points))).buildings.push(building);
for (const area of areas) tileFor(tileKey(centroidOf(area.points))).areas.push(area);
for (const district of DISTRICTS) {
  const { rect } = district;
  for (let tx = Math.floor(rect.minX / TILE); tx <= Math.floor(rect.maxX / TILE); tx += 1) {
    for (let tz = Math.floor(rect.minZ / TILE); tz <= Math.floor(rect.maxZ / TILE); tz += 1) tileFor(`${tx}_${tz}`);
  }
}

// ---- Danfo loop along Admiralty Way (both carriageways), kerb lane. ----
const wayPoints = new Map();
for (const element of ways.values()) wayPoints.set(element.id, element.nodes.map((id) => nodes.get(id)));
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
/** Main-road OSM graph (one-way and roundabout direction respected) for routes that use only part of a way. */
const driveGraph = new Map();
const DANFO_ROAD_KINDS = new Set(["primary", "primary_link", "tertiary"]);
for (const element of ways.values()) {
  if (!DANFO_ROAD_KINDS.has(ROAD_KINDS[element.tags.highway]?.kind)) continue;
  const oneway = element.tags.oneway === "yes" || element.tags.junction === "roundabout";
  const link = (a, b) => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    if (!driveGraph.has(a)) driveGraph.set(a, []);
    driveGraph.get(a).push(b);
  };
  for (let index = 1; index < element.nodes.length; index += 1) {
    link(element.nodes[index - 1], element.nodes[index]);
    if (!oneway) link(element.nodes[index], element.nodes[index - 1]);
  }
}
function nodeOnWay(wayId, [x, z]) {
  const way = ways.get(wayId);
  if (!way) throw new Error(`Missing way ${wayId}`);
  return way.nodes.reduce((best, id) => {
    const point = nodes.get(id);
    return Math.hypot(point[0] - x, point[1] - z) < Math.hypot(nodes.get(best)[0] - x, nodes.get(best)[1] - z) ? id : best;
  }, way.nodes[0]);
}
/** Shortest legal drive between a point on one way and a point on another, as node positions. */
function drivePath(from, to) {
  const start = nodeOnWay(from.way, from.near);
  const goal = nodeOnWay(to.way, to.near);
  const distance = new Map([[start, 0]]);
  const previous = new Map();
  const open = new Set([start]);
  while (open.size) {
    let current = null;
    for (const id of open) if (current === null || distance.get(id) < distance.get(current) || (distance.get(id) === distance.get(current) && id < current)) current = id;
    open.delete(current);
    if (current === goal) break;
    const here = nodes.get(current);
    for (const next of driveGraph.get(current) ?? []) {
      const there = nodes.get(next);
      const total = distance.get(current) + Math.hypot(there[0] - here[0], there[1] - here[1]);
      if (total < (distance.get(next) ?? Infinity)) {
        distance.set(next, total);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  if (!distance.has(goal)) throw new Error(`No drive from way ${from.way} to way ${to.way}`);
  const path = [goal];
  while (path[0] !== start) path.unshift(previous.get(path[0]));
  const points = [nodes.get(start)];
  for (const id of path.slice(1)) {
    const a = points.at(-1);
    const b = nodes.get(id);
    const pieces = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 50);
    for (let piece = 1; piece <= pieces; piece += 1) points.push([round2(a[0] + ((b[0] - a[0]) * piece) / pieces), round2(a[1] + ((b[1] - a[1]) * piece) / pieces)]);
  }
  return points;
}
function offsetRight(points, distance) {
  return points.map((point, index) => {
    const a = points[Math.max(0, index - 1)];
    const b = points[Math.min(points.length - 1, index + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    return [round2(point[0] + (dz / length) * distance), round2(point[1] - (dx / length) * distance)];
  });
}
/**
 * A danfo loop: the kerb lane of one mapped carriageway out and the opposite
 * carriageway back. Turnarounds at either end are a documented gameplay
 * simplification. A stop's `leg` limits it to its own carriageway. Each leg is
 * either a list of whole OSM way ids or a `drivePath` point list.
 */
function buildRoute({ routeId, routeName, routeNumber, fare, outbound, inbound, within = () => true, stops: stopSeeds }) {
  const leg = (ids) => (typeof ids[0] === "number" ? chain(ids) : ids);
  const out = offsetRight(leg(outbound).filter(within), 1.9);
  const back = offsetRight(leg(inbound).filter(within), 1.9);
  const loop = [...out, ...back];
  const cumulative = [0];
  for (let index = 1; index <= loop.length; index += 1) {
    const a = loop[index - 1];
    const b = loop[index % loop.length];
    cumulative.push(cumulative[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  function nearestOnLoop([x, z], leg) {
    const [from, to] = leg === "out" ? [0, out.length - 1] : leg === "in" ? [out.length, loop.length - 1] : [0, loop.length];
    let best = { distance: Infinity, s: 0, point: loop[0], right: [0, 0] };
    for (let index = from; index < to; index += 1) {
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
        best = { distance, s: cumulative[index] + t * length, point, right: [dz / length, -dx / length] };
      }
    }
    return best;
  }
  const stops = stopSeeds
    .map((seed) => {
      const nearest = nearestOnLoop(seed.near, seed.leg);
      const pole = [nearest.point[0] + nearest.right[0] * 3.1, nearest.point[1] + nearest.right[1] * 3.1];
      return {
        id: seed.id,
        name: seed.name,
        s: Math.round(nearest.s * 10) / 10,
        pole: pole.map(round2),
        alight: [round2(pole[0] + nearest.right[0] * 1.2), round2(pole[1] + nearest.right[1] * 1.2)],
        heading: Math.round(Math.atan2(-nearest.right[1], nearest.right[0]) * 1000) / 1000,
      };
    })
    .sort((a, b) => a.s - b.s);
  return { routeId, routeName, routeNumber, fare, length: Math.round(cumulative.at(-1) * 10) / 10, points: loop, stops };
}

const routes = [
  buildRoute({
    routeId: "admiralty-loop",
    routeName: "Admiralty Way Loop",
    routeNumber: "L1",
    fare: 300,
    outbound: [294599766, 294599773, 294599770],
    inbound: [294599763, 294599771, 294599755],
    // Turns at the Victoria Arobieke junction (x≈371) and the Adebayo Doherty junction.
    within: ([x]) => x <= 372 && x >= -545,
    stops: [
      { id: "kayode-eb", name: "Admiralty Way · Kayode Animashaun (Eastbound)", near: [24, 418] },
      { id: "victoria-arobieke-wb", name: "Admiralty Way · Victoria Arobieke (Westbound)", near: [340, 432] },
      { id: "kayode-wb", name: "Admiralty Way · Kayode Animashaun (Westbound)", near: [40, 431] },
      { id: "adebayo-wb", name: "Admiralty Way · Adebayo Doherty (Westbound)", near: [-492, 364] },
      { id: "adebayo-eb", name: "Admiralty Way · Adebayo Doherty (Eastbound)", near: [-470, 353] },
    ],
  }),
  // Turns at Falomo Roundabout (by Awolowo Road) and at Alexander Avenue by the Link Bridge landing.
  buildRoute({
    routeId: "bourdillon-loop",
    routeName: "Bourdillon Road Loop",
    routeNumber: "I1",
    fare: 300,
    outbound: [1059928727, 1059928726, 106497223],
    inbound: [294599764, 505413821, 1059928729, 1059928728],
    stops: [
      { id: "falomo-eb", name: "Bourdillon Road · Falomo Roundabout (Eastbound)", near: [-4520, 10], leg: "out" },
      { id: "lateef-jakande-eb", name: "Bourdillon Road · Lateef Jakande Avenue (Eastbound)", near: [-3330, 280], leg: "out" },
      { id: "alexander-wb", name: "Bourdillon Road · Alexander Avenue (Westbound)", near: [-2190, 115], leg: "in" },
      { id: "lateef-jakande-wb", name: "Bourdillon Road · Lateef Jakande Avenue (Westbound)", near: [-3380, 300], leg: "in" },
      { id: "falomo-wb", name: "Bourdillon Road · Falomo Roundabout (Westbound)", near: [-4510, 30], leg: "in" },
    ],
  }),
  // Turns at Akin Adesola Street and at Ahmadu Bello Way.
  buildRoute({
    routeId: "adeola-odeku-loop",
    routeName: "Adeola Odeku Loop",
    routeNumber: "V1",
    fare: 300,
    outbound: [5150268],
    inbound: [134684101],
    stops: [
      { id: "akin-adesola-wb", name: "Adeola Odeku Street · Akin Adesola (Westbound)", near: [-5040, -1628], leg: "out" },
      { id: "idowu-martins-wb", name: "Adeola Odeku Street · Idowu Martins (Westbound)", near: [-5520, -1532], leg: "out" },
      { id: "ahmadu-bello-eb", name: "Adeola Odeku Street · Ahmadu Bello Way (Eastbound)", near: [-6600, -1560], leg: "in" },
      { id: "idowu-martins-eb", name: "Adeola Odeku Street · Idowu Martins (Eastbound)", near: [-5500, -1545], leg: "in" },
      { id: "akin-adesola-eb", name: "Adeola Odeku Street · Akin Adesola (Eastbound)", near: [-5060, -1642], leg: "in" },
    ],
  }),
  // Lekki to Ikoyi over the Link Bridge: Admiralty Way, the Ikoyi Bridge and Alexander
  // roundabouts, then Alexander Avenue. Turns west of Adebayo Doherty and at Bourdillon Road.
  buildRoute({
    routeId: "link-bridge-shuttle",
    routeName: "Link Bridge Shuttle",
    routeNumber: "X1",
    fare: 300,
    outbound: drivePath({ way: 294599755, near: [-520, 355] }, { way: 216689323, near: [-2133, 100] }),
    inbound: drivePath({ way: 216689320, near: [-2124, 100] }, { way: 294599766, near: [-520, 340] }),
    stops: [
      { id: "bridge-roundabout-wb", name: "Admiralty Way · Ikoyi Bridge Roundabout (Westbound)", near: [-780, 332], leg: "out" },
      { id: "alexander-bourdillon-sb", name: "Alexander Avenue · Bourdillon Road (Southbound)", near: [-2140, 170], leg: "out" },
      { id: "alexander-bourdillon-nb", name: "Alexander Avenue · Bourdillon Road (Northbound)", near: [-2128, 170], leg: "in" },
      { id: "bridge-roundabout-eb", name: "Admiralty Way · Ikoyi Bridge Roundabout (Eastbound)", near: [-780, 305], leg: "in" },
    ],
  }),
  // Ikoyi to Victoria Island over Falomo Bridge: Bourdillon Road, Falomo Roundabout, the
  // Alfred Rewane carriageway south and the Falomo Bridge carriageway north, Akin Adesola Street.
  // Turns on Bourdillon Road east of the roundabout and at Adeola Odeku Street.
  buildRoute({
    routeId: "falomo-bridge-shuttle",
    routeName: "Falomo Bridge Shuttle",
    routeNumber: "X2",
    fare: 300,
    outbound: drivePath({ way: 1059928728, near: [-4431, -2] }, { way: 215492880, near: [-4980, -1631] }),
    inbound: drivePath({ way: 525026796, near: [-4970, -1631] }, { way: 1059928727, near: [-4434, -10] }),
    stops: [
      { id: "falomo-east-wb", name: "Bourdillon Road · east of Falomo Roundabout (Westbound)", near: [-4470, 12], leg: "out" },
      { id: "akin-adesola-adeola-sb", name: "Akin Adesola Street · Adeola Odeku Street (Southbound)", near: [-4983, -1585], leg: "out" },
      { id: "akin-adesola-adeola-nb", name: "Akin Adesola Street · Adeola Odeku Street (Northbound)", near: [-4968, -1585], leg: "in" },
      { id: "falomo-east-eb", name: "Bourdillon Road · east of Falomo Roundabout (Eastbound)", near: [-4470, -6], leg: "in" },
    ],
  }),
];

// ---- Named gameplay places on mapped footprints (fictional businesses and venues). ----
const buildingById = new Map(buildings.map((building) => [building.id, building]));
function doorFor(buildingId, streetName) {
  const building = buildingById.get(buildingId);
  if (!building) throw new Error(`Missing building ${buildingId}`);
  const street = roads.filter((road) => road.name === streetName);
  if (!street.length) throw new Error(`Missing street ${streetName}`);
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
  return {
    door: [round2(best.mid[0] + outward[0] * 1.4), round2(best.mid[1] + outward[1] * 1.4)],
    facade: [round2(best.mid[0]), round2(best.mid[1])],
    facing: round2(Math.atan2(outward[0], outward[1])),
    frontage: round2(best.length),
  };
}
const placeSeeds = JSON.parse(await readFile(path.join(root, "scripts/world/places.json"), "utf8"));
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
  const kerb = [round2(best.point[0] + best.uz * offset * side), round2(best.point[1] - best.ux * offset * side)];
  const yaw = side > 0 ? Math.atan2(best.ux, best.uz) : Math.atan2(-best.ux, -best.uz);
  return { kerb, kerbYaw: round2(yaw) };
}
/** Entrance on an open area (a park): the boundary point nearest the street, stepped outward. */
function gateFor(areaId, streetName) {
  const area = areas.find((candidate) => candidate.id === areaId);
  if (!area) throw new Error(`Missing area ${areaId}`);
  const street = roads.filter((road) => road.name === streetName);
  if (!street.length) throw new Error(`Missing street ${streetName}`);
  let best = null;
  for (let index = 1; index < area.points.length; index += 1) {
    const a = area.points[index - 1];
    const b = area.points[index];
    for (let t = 0.1; t < 1; t += 0.2) {
      const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (const road of street) {
        for (let p = 1; p < road.points.length; p += 1) {
          const r0 = road.points[p - 1];
          const r1 = road.points[p];
          const dx = r1[0] - r0[0];
          const dz = r1[1] - r0[1];
          const u = Math.max(0, Math.min(1, ((point[0] - r0[0]) * dx + (point[1] - r0[1]) * dz) / (dx * dx + dz * dz || 1)));
          const q = [r0[0] + dx * u, r0[1] + dz * u];
          const distance = Math.hypot(q[0] - point[0], q[1] - point[1]);
          if (!best || distance < best.distance) best = { point, q, distance };
        }
      }
    }
  }
  const length = best.distance || 1;
  const out = [(best.q[0] - best.point[0]) / length, (best.q[1] - best.point[1]) / length];
  return {
    door: [round2(best.point[0] + out[0] * 1.4), round2(best.point[1] + out[1] * 1.4)],
    facade: [round2(best.point[0]), round2(best.point[1])],
    facing: round2(Math.atan2(out[0], out[1])),
    frontage: 6,
  };
}
const districtOf = (point) => DISTRICTS.find(({ rect }) => inRect(point, rect))?.id ?? null;
const places = placeSeeds.map((seed) => {
  const door = seed.area ? gateFor(seed.area, seed.street) : doorFor(seed.building, seed.street);
  return {
    id: seed.id,
    kind: seed.kind,
    name: seed.name,
    street: seed.street,
    district: districtOf(door.door),
    buildingId: seed.building ?? null,
    ...(seed.area ? { areaId: seed.area } : {}),
    ...door,
    ...kerbFor(door.door, seed.street),
  };
});

const districts = DISTRICTS.map(({ id, name, lga, rect }) => ({ id, name, lga, rect }));
const world = {
  name: "Lagos Living: Lekki Phase 1, Ikoyi and Victoria Island",
  attribution: "Map data © OpenStreetMap contributors, ODbL 1.0",
  source: { extracts: timestamps, projection: { lat0: LAT0, lon0: LON0, unit: "metre", axes: "x east, z north" } },
  bounds: BOUNDS,
  districts,
  tileSize: TILE,
  tiles: [...tiles.values()].map(({ key, buildings: list }) => ({ key, buildings: list.length })),
  water: waterGrid(water),
  roads,
  pois,
};

// Rewrite tiles in place and remove only stale ones: deleting the directory while a Vite dev
// server is running makes it serve index.html for every tile, and the world loads empty.
await mkdir(tileDir, { recursive: true });
const keep = new Set([...tiles.values()].map((tile) => `${tile.key}.json`));
for (const file of await readdir(tileDir)) if (!keep.has(file)) await rm(path.join(tileDir, file), { force: true });
for (const tile of tiles.values()) {
  await writeFile(path.join(tileDir, `${tile.key}.json`), JSON.stringify({ key: tile.key, buildings: tile.buildings, areas: tile.areas }));
}
await writeFile(path.join(worldDir, "lagos.world.json"), JSON.stringify(world));
await mkdir(path.dirname(sharedTarget), { recursive: true });
/** Walkable bridge strips: half-width stops just inside the parapet the client draws at `width / 2 + DECK_PAD`. */
const DECK_PAD = 1;
const decks = roads.filter((road) => road.bridge).map((road) => ({ id: road.id, half: Math.round((road.width / 2 + DECK_PAD - 0.35) * 100) / 100, points: road.points }));
await writeFile(sharedTarget, JSON.stringify({ bounds: BOUNDS, districts, tileSize: TILE, blocked: waterGrid(blocked), decks, routes, places }));

const files = await readdir(tileDir);
for (const route of routes) console.log(`route ${route.routeNumber} ${route.length} m, stops ${route.stops.map((stop) => `${stop.id}@${stop.s}`).join(", ")}`);
console.log(places.map((place) => `${place.id} (${place.district}) door ${place.door} kerb ${place.kerb}`).join("\n"));
console.log(
  `roads ${roads.length} (named ${roads.filter((road) => road.name).length}, bridges ${roads.filter((road) => road.bridge).length}), ` +
    `buildings ${buildings.length}, areas ${areas.length}, pois ${pois.length}, tiles ${files.length}, ` +
    `water ${water.reduce((sum, bit) => sum + bit, 0)} / ${water.length} samples, blocked ${blocked.reduce((sum, bit) => sum + bit, 0)}`,
);
