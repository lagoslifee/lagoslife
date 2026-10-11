import { RoadNavigator, type NavRoad } from "@lagos-living/shared";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

let navigator: RoadNavigator | null = null;

/** Same road graph the client navigates on, built on first use. */
export function roadNavigator() {
  if (navigator) return navigator;
  const tileDir =
    config.WORLD_TILE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/public/assets/world/tiles");
  const world = JSON.parse(readFileSync(path.join(tileDir, "..", "lagos.world.json"), "utf8")) as {
    roads: Array<NavRoad & { kind: string }>;
  };
  navigator = new RoadNavigator(world.roads.filter((road) => road.kind !== "service" || road.name));
  return navigator;
}
