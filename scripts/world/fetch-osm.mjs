#!/usr/bin/env node
// Fetches the OpenStreetMap extracts (ODbL) used by build-world.mjs from the
// public Overpass API. Usage: node scripts/world/fetch-osm.mjs [extract-id ...]
// Extracts are small and fetched rarely; please keep it that way (Overpass is a
// shared volunteer service).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

const city = (bbox) => `[out:json][timeout:180][bbox:${bbox}];
(
  way["highway"];
  way["building"];
  way["landuse"];
  way["leisure"];
  way["natural"];
  way["waterway"];
  way["amenity"];
  node["amenity"];
  node["shop"];
);
out body;
>;
out skel qt;`;

export const EXTRACTS = {
  ikoyi: { file: "ikoyi-extract.osm.json", bbox: "6.4400,3.4240,6.4580,3.4520", query: city },
  "victoria-island": { file: "victoria-island-extract.osm.json", bbox: "6.4220,3.4050,6.4400,3.4320", query: city },
  "link-bridge": {
    file: "link-bridge-extract.osm.json",
    bbox: "6.4440,3.4480,6.4520,3.4640",
    query: (bbox) => `[out:json][timeout:120][bbox:${bbox}];(way["highway"];);out body;>;out skel qt;`,
  },
  water: {
    file: "water-extract.osm.json",
    bbox: "6.4100,3.3950,6.4700,3.4900",
    // Lagos Lagoon, Five Cowries Creek and Commodore Channel multipolygons, full member geometry.
    query: () => `[out:json][timeout:180];(relation(2116203);relation(2116206);relation(17721809););out geom;`,
  },
  coastline: {
    file: "coastline-extract.osm.json",
    bbox: "6.4100,3.3950,6.4700,3.4900",
    query: (bbox) => `[out:json][timeout:120][bbox:${bbox}];(way["natural"="coastline"];);out body;>;out skel qt;`,
  },
  // Dubai holiday region: Dubai Marina, JBR and Bluewaters Island. Projected separately (lat0 25.08, lon0 55.14).
  "dubai-marina": {
    file: "dubai-marina-extract.osm.json",
    bbox: "25.0630,55.1120,25.0940,55.1530",
    query: (bbox) => `[out:json][timeout:180][bbox:${bbox}];
(
  way["highway"];
  way["building"];
  way["landuse"];
  way["leisure"];
  way["natural"];
  way["waterway"];
  way["man_made"="pier"];
);
out body;
>;
out skel qt;`,
  },
  // The Gulf coastline (open chains plus island rings) around the Marina, wide enough that the chain crosses the area once.
  "dubai-water": {
    file: "dubai-water-extract.osm.json",
    bbox: "25.0000,55.0500,25.1600,55.2100",
    query: (bbox) => `[out:json][timeout:120][bbox:${bbox}];(way["natural"="coastline"];);out body;>;out skel qt;`,
  },
};

const wanted = process.argv.slice(2);
for (const [id, extract] of Object.entries(EXTRACTS)) {
  if (wanted.length && !wanted.includes(id)) continue;
  const body = new URLSearchParams({ data: extract.query(extract.bbox) });
  let json = null;
  for (let attempt = 0; attempt < 6 && !json; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      headers: { "User-Agent": "LagosLiving/0.1 (development world build)" },
    }).catch((error) => ({ ok: false, status: error.message }));
    if (response.ok) json = await response.json();
    else {
      console.log(`${id}: ${endpoint} returned ${response.status}; retrying`);
      await new Promise((resolve) => setTimeout(resolve, 10_000 * (attempt + 1)));
    }
  }
  if (!json) throw new Error(`${id}: Overpass unavailable`);
  json.lagosLiving = { extract: id, bbox: extract.bbox };
  await writeFile(path.join(root, "data/osm", extract.file), JSON.stringify(json));
  console.log(`${id}: ${json.elements.length} elements, base ${json.osm3s?.timestamp_osm_base}`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
