import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { until, useLowGraphics, waitForGame } from "./helpers";

type Hooks = { loadedTiles(): string[]; stats(): { buildings: number } };
const tileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/assets/world/tiles");
/** Tiles with no content (open water, district edges) have no file and no buildings. */
const buildingsIn = (keys: string[]) =>
  keys.reduce((total, key) => {
    const file = path.join(tileDir, `${key}.json`);
    return total + (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { buildings: unknown[] }).buildings.length : 0);
  }, 0);

test("retries a world tile that fails to load instead of leaving it empty", async ({ page }) => {
  test.setTimeout(180_000);
  await useLowGraphics(page);
  let refused = 0;
  // 0_1 holds the starter home and Admiralty Way: the first tile anyone needs.
  await page.route("**/assets/world/tiles/0_1.json", async (route) => {
    if (refused < 2) {
      refused += 1;
      await route.fulfill({ status: 503, body: "busy" });
    } else await route.continue();
  });
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().startsWith("World tile")) warnings.push(message.text());
  });
  await page.goto("/");
  await waitForGame(page);

  const hooks = () => page.evaluate(() => {
    const lagos = window.__lagos as unknown as Hooks;
    return { keys: lagos.loadedTiles(), buildings: lagos.stats().buildings };
  });
  const settled = await until(async () => {
    const now = await hooks();
    return now.keys.includes("0_1") && now.buildings === buildingsIn(now.keys) ? now : null;
  }, 60_000, "every loaded tile, including the refused one, to have its buildings");
  expect(refused).toBe(2);
  expect(warnings.filter((text) => text.includes("0_1"))).toHaveLength(2);
  expect(buildingsIn(["0_1"])).toBeGreaterThan(0);
  expect(settled.buildings).toBeGreaterThan(0);
});
