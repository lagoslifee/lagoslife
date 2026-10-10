import { registerFootprints, registeredFootprintCount, type Vec2 } from "@lagos-living/shared";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const tileDir =
  config.WORLD_TILE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/public/assets/world/tiles");

// Every tile is registered up front so the server validates positions in districts no client has loaded.
for (const file of readdirSync(tileDir)) {
  if (!file.endsWith(".json")) continue;
  const tile = JSON.parse(readFileSync(path.join(tileDir, file), "utf8")) as { buildings: Array<{ id: number; points: Vec2[] }> };
  registerFootprints(tile.buildings);
}

export const footprintCount = registeredFootprintCount();
