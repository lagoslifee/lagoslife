// Lays out fictional building plots inside mapped construction / brownfield / greenfield land near the Lekki start.
// Deterministic: same world data in, same plots out. Writes packages/shared/src/generated/lagos-plots.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const world = JSON.parse(readFileSync(path.join(root, "apps/web/public/assets/world/lagos.world.json"), "utf8"));
const generated = JSON.parse(readFileSync(path.join(root, "packages/shared/src/generated/lagos-world.json"), "utf8"));
const tileDir = path.join(root, "apps/web/public/assets/world/tiles");

const LAND_KINDS = new Set(["construction", "brownfield", "greenfield"]);
const PLOT_WIDTH = 18;
const PLOT_DEPTH = 22;
const SETBACK = 2.5;
const MAX_PLOTS = 12;
const SEARCH_RADIUS = 450;

const start = generated.places.find((place) => place.id === "starter-home").door;
const lekki = generated.districts.find((district) => district.id === "lekki-phase-1").rect;

const areas = [];
const buildings = [];
for (const file of readdirSync(tileDir).sort()) {
  if (!file.endsWith(".json")) continue;
  const tile = JSON.parse(readFileSync(path.join(tileDir, file), "utf8"));
  for (const area of tile.areas ?? []) if (LAND_KINDS.has(area.kind)) areas.push(area);
  for (const building of tile.buildings ?? []) buildings.push(building);
}

const inside = (x, z, points) => {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};
const centroid = (points) => [
  points.reduce((sum, point) => sum + point[0], 0) / points.length,
  points.reduce((sum, point) => sum + point[1], 0) / points.length,
];
const round = (value) => Math.round(value * 100) / 100;

function nearestRoad(x, z) {
  let best = null;
  for (const road of world.roads) {
    if (!["primary", "secondary", "tertiary", "residential", "unclassified", "living_street"].includes(road.kind)) continue;
    for (let index = 1; index < road.points.length; index += 1) {
      const a = road.points[index - 1];
      const b = road.points[index];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (length * length)));
      const px = a[0] + dx * t;
      const pz = a[1] + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance) best = { road, distance, a, b, along: [dx / length, dz / length] };
    }
  }
  return best;
}

function rectangle(center, along, inward) {
  const halfW = PLOT_WIDTH / 2;
  const halfD = PLOT_DEPTH / 2;
  return [
    [center[0] - along[0] * halfW - inward[0] * halfD, center[1] - along[1] * halfW - inward[1] * halfD],
    [center[0] + along[0] * halfW - inward[0] * halfD, center[1] + along[1] * halfW - inward[1] * halfD],
    [center[0] + along[0] * halfW + inward[0] * halfD, center[1] + along[1] * halfW + inward[1] * halfD],
    [center[0] - along[0] * halfW + inward[0] * halfD, center[1] - along[1] * halfW + inward[1] * halfD],
  ];
}

const nearbyBuildings = buildings.filter((building) => {
  const [cx, cz] = centroid(building.points);
  return Math.hypot(cx - start[0], cz - start[1]) < SEARCH_RADIUS + 100;
});

function clearOfBuildings(corners) {
  for (const building of nearbyBuildings) {
    if (building.points.some(([x, z]) => inside(x, z, corners))) return false;
    if (corners.some(([x, z]) => inside(x, z, building.points))) return false;
    const [cx, cz] = centroid(corners);
    if (inside(cx, cz, building.points)) return false;
  }
  return true;
}

const candidates = areas
  .map((area) => ({ area, center: centroid(area.points) }))
  .filter(({ center: [x, z] }) => x >= lekki.minX && x <= lekki.maxX && z >= lekki.minZ && z <= lekki.maxZ)
  .filter(({ center }) => Math.hypot(center[0] - start[0], center[1] - start[1]) < SEARCH_RADIUS)
  .sort((a, b) => Math.hypot(a.center[0] - start[0], a.center[1] - start[1]) - Math.hypot(b.center[0] - start[0], b.center[1] - start[1]));

const plots = [];
for (const { area, center } of candidates) {
  const hit = nearestRoad(center[0], center[1]);
  if (!hit) continue;
  const { road, along } = hit;
  // Inward points from the road into the land.
  const toCenter = [center[0] - hit.a[0], center[1] - hit.a[1]];
  const side = toCenter[0] * -along[1] + toCenter[1] * along[0] >= 0 ? 1 : -1;
  const inward = [-along[1] * side, along[0] * side];
  const edge = (road.width ?? 8) / 2 + SETBACK;
  // Sample positions along the road across the area's extent, front edge parallel to the road.
  const projections = area.points.map(([x, z]) => (x - hit.a[0]) * along[0] + (z - hit.a[1]) * along[1]);
  const from = Math.min(...projections);
  const to = Math.max(...projections);
  for (let s = from + PLOT_WIDTH / 2; s <= to - PLOT_WIDTH / 2 && plots.length < MAX_PLOTS; s += 2) {
    const frontX = hit.a[0] + along[0] * s + inward[0] * edge;
    const frontZ = hit.a[1] + along[1] * s + inward[1] * edge;
    // Push back from the road until the whole rectangle sits on the land.
    for (let back = 0; back <= 30; back += 2) {
      const plotCenter = [frontX + inward[0] * (back + PLOT_DEPTH / 2), frontZ + inward[1] * (back + PLOT_DEPTH / 2)];
      const corners = rectangle(plotCenter, along, inward);
      const samples = [...corners, plotCenter];
      if (!samples.every(([x, z]) => inside(x, z, area.points))) continue;
      if (!clearOfBuildings(corners)) continue;
      if (plots.some((plot) => Math.hypot(plot.center[0] - plotCenter[0], plot.center[1] - plotCenter[1]) < Math.max(PLOT_WIDTH, PLOT_DEPTH) + 1)) continue;
      const gate = [plotCenter[0] - inward[0] * (PLOT_DEPTH / 2 + 1), plotCenter[1] - inward[1] * (PLOT_DEPTH / 2 + 1)];
      const kerbOffset = (road.width ?? 8) / 2 - 1.2;
      const t = (gate[0] - hit.a[0]) * along[0] + (gate[1] - hit.a[1]) * along[1];
      const kerb = [hit.a[0] + along[0] * t + inward[0] * kerbOffset, hit.a[1] + along[1] * t + inward[1] * kerbOffset];
      plots.push({ center: plotCenter, along, inward, gate, kerb, street: road.name ?? null, areaId: area.id });
      s += PLOT_WIDTH;
      break;
    }
  }
  if (plots.length >= MAX_PLOTS) break;
}

const sites = new Map();
const output = plots.map((plot, index) => {
  const siteNumber = sites.get(plot.areaId) ?? sites.size + 1;
  sites.set(plot.areaId, siteNumber);
  return {
    id: `lekki-plot-${index + 1}`,
    name: `Plot ${index + 1}`,
    site: plot.street ? `Building site off ${plot.street}` : `Lekki building site ${siteNumber}`,
    street: plot.street,
    areaId: plot.areaId,
    center: plot.center.map(round),
    along: plot.along.map((value) => Math.round(value * 10_000) / 10_000),
    inward: plot.inward.map((value) => Math.round(value * 10_000) / 10_000),
    width: PLOT_WIDTH,
    depth: PLOT_DEPTH,
    gate: plot.gate.map(round),
    kerb: plot.kerb.map(round),
  };
});

writeFileSync(path.join(root, "packages/shared/src/generated/lagos-plots.json"), `${JSON.stringify(output, null, 1)}\n`);
console.log(`Wrote ${output.length} plots on ${sites.size} mapped sites`);
for (const plot of output) console.log(plot.id, plot.site, plot.center, Math.round(Math.hypot(plot.center[0] - start[0], plot.center[1] - start[1])), "m from start");
