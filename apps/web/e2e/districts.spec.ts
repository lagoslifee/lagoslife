import { expect, test, type Page } from "@playwright/test";
import { API, apiGet, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number; needs: { hunger: number; energy: number } };
type Place = { id: string; name: string; kind: string; door: [number, number]; kerb: [number, number] };
type Vehicle = { id: string; status: string; x: number; z: number };

const district = (page: Page) => page.getByTestId("current-location").locator("p").last();
const loadedTiles = (page: Page) => page.evaluate(() => (window.__lagos as unknown as { loadedTiles(): string[] }).loadedTiles());

async function spawnAt(page: Page, placeId: string) {
  const status = await page.evaluate(
    async ([api, id]) => (await fetch(`${api}/api/dev/spawn-at`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ placeId: id }) })).status,
    [API, placeId] as const,
  );
  expect(status).toBe(200);
  await page.reload();
  await waitForGame(page);
}

function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  return { errors, shot };
}

/** Milestone 7: the districts are one connected, streamed world you can drive across. */
test("drives from Lekki Phase 1 over the Link Bridge into Ikoyi, streaming tiles, and resumes there after reload", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await useLowGraphics(page);
  const { errors, shot } = setup(page);
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);
  await expect(district(page)).toHaveText("Lekki Phase 1 · Eti-Osa");
  const lekkiTiles = await loadedTiles(page);

  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  await walk(page, dealer.door);
  await until(async () => (await prompt(page))?.label.includes("Lekki Motors"), 8_000, "dealership prompt");
  await page.evaluate(() => window.__lagos.interact());
  const hatch = page.getByTestId("model-eko-hatch");
  await hatch.getByRole("button", { name: "Buy ₦120,000" }).click();
  await hatch.getByRole("button", { name: "Confirm ₦120,000" }).click();
  await expect(page.getByRole("dialog", { name: "Lekki Motors" })).toBeHidden({ timeout: 10_000 });
  const [bought] = await apiGet<Vehicle[]>(page, "/api/vehicles");
  const car = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.id === bought!.id), 10_000, "car in world");
  await walk(page, [car.x - Math.cos(car.yaw) * 1.7, car.z + Math.sin(car.yaw) * 1.7]);
  await until(async () => (await prompt(page))?.label.startsWith("Drive"), 10_000, "drive prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 10_000, "driving");

  // Midway along the bridge deck (OSM way 499678924), over the lagoon.
  expect(await page.evaluate(() => window.__lagos.driveTo(-1278.6, 648.4, 540_000))).toBe(true);
  await expect(district(page)).toHaveText("Lekki-Ikoyi Link Bridge · Eti-Osa");
  await shot("m7-link-bridge");
  // On into Ikoyi, at the west end of the bridge approach.
  expect(await page.evaluate(() => window.__lagos.driveTo(-2391, 648, 540_000))).toBe(true);
  await expect(district(page)).toHaveText("Ikoyi · Eti-Osa", { timeout: 10_000 });
  await shot("m7-ikoyi-street");

  const ikoyiTiles = await loadedTiles(page);
  expect(ikoyiTiles).toContain("-8_2");
  expect(ikoyiTiles.filter((key) => lekkiTiles.includes(key)), "tiles left behind in Lekki are unloaded").toEqual([]);
  const stats = await page.evaluate(() => window.__lagos.stats());
  test.info().annotations.push({ type: "streaming", description: `tiles resident ${stats.tiles}, cumulative tile build ${stats.tileBuildMs} ms, ${stats.fps} fps` });

  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 9) < 0.5, 10_000, "stopping");
  await page.evaluate(() => window.__lagos.exitVehicle());
  await until(async () => !(await page.evaluate(() => window.__lagos.driving())), 10_000, "stepping out");
  const parked = (await apiGet<Vehicle[]>(page, "/api/vehicles"))[0]!;
  expect(parked.status).toBe("parked");
  expect(parked.x).toBeLessThan(-2300);

  await page.reload();
  await waitForGame(page);
  await expect(district(page)).toHaveText("Ikoyi · Eti-Osa");
  const here = await state(page);
  expect(Math.hypot(here.x - parked.x, here.z - parked.z)).toBeLessThan(6);
  expect(errors).toEqual([]);
});

test("visits Ikoyi and Victoria Island venues with neutral effects and a once-a-day volunteer shift", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await useLowGraphics(page);
  const { errors, shot } = setup(page);
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  const economy = () => apiGet<Economy>(page, "/api/economy");
  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const venue = (id: string) => places.find((p) => p.id === id)!;
  const library = venue("ikoyi-reading-room");
  const church = venue("grace-assembly");
  const hall = venue("island-community-hall");

  await spawnAt(page, library.id);
  await expect(district(page)).toHaveText("Ikoyi · Eti-Osa");
  const startEnergy = (await economy()).needs.energy;

  await walk(page, library.door);
  await until(async () => (await prompt(page))?.label === `Read · ${library.name}`, 8_000, "library prompt");
  await page.evaluate(() => window.__lagos.interact());
  const sheet = page.getByTestId("community-sheet");
  await expect(sheet).toContainText("none gives more than another");
  await shot("m7-library-sheet");
  await sheet.getByRole("button", { name: "Read for a while" }).click();
  await expect(page.locator(".toast.success").last()).toContainText("(+8)");
  expect((await economy()).needs.energy).toBe(Math.min(100, startEnergy + 8));
  await page.getByRole("button", { name: "Close" }).click();

  // A place of worship gives the same rest on the same shared cooldown, so right after the library it adds nothing.
  await walk(page, church.door);
  await until(async () => (await prompt(page))?.label === `Visit · ${church.name}`, 8_000, "church prompt");
  await page.evaluate(() => window.__lagos.interact());
  await expect(page.getByTestId("quiet-cooldown")).toBeVisible();
  await sheet.getByRole("button", { name: "Spend a quiet moment" }).click();
  await expect(page.locator(".toast.success").last()).toContainText("energy is unchanged");
  expect((await economy()).needs.energy).toBe(Math.min(100, startEnergy + 8));
  await page.getByRole("button", { name: "Close" }).click();

  // On foot from Ikoyi over Falomo Bridge to the mosque in Victoria Island, on the same shared cooldown.
  const mosque = venue("al-noor-mosque");
  await walk(page, mosque.door);
  await expect(district(page)).toHaveText("Victoria Island · Eti-Osa");
  await until(async () => (await prompt(page))?.label === `Visit · ${mosque.name}`, 8_000, "mosque prompt");
  await page.evaluate(() => window.__lagos.interact());
  await expect(page.getByTestId("quiet-cooldown")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await spawnAt(page, hall.id);
  await expect(district(page)).toHaveText("Victoria Island · Eti-Osa");
  const before = (await economy()).balance;
  await walk(page, hall.door);
  await until(async () => (await prompt(page))?.label === `Community hall · ${hall.name}`, 8_000, "hall prompt");
  await page.evaluate(() => window.__lagos.interact());
  await sheet.getByRole("button", { name: "Volunteer · ₦1,500" }).click();
  await expect(page.getByTestId("volunteer-done")).toBeVisible({ timeout: 10_000 });
  await shot("m7-community-hall");
  expect((await economy()).balance).toBe(before + 1_500);
  await page.getByRole("button", { name: "Close" }).click();

  // After a reload the shift is still done for today, and the phone lists every venue.
  await page.reload();
  await waitForGame(page);
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("button", { name: /Community/ }).click();
  const app = page.getByTestId("community-app");
  await expect(app).toContainText("You volunteered today.");
  for (const place of [library, church, venue("al-noor-mosque"), venue("muri-okunola-park"), hall]) await expect(app).toContainText(place.name);
  await page.getByRole("button", { name: "Close phone" }).click();
  expect((await economy()).balance).toBe(before + 1_500);

  await page.getByRole("button", { name: /Map/ }).first().click();
  await page.locator(".map-districts").getByRole("button", { name: "Victoria Island" }).click();
  await shot("m7-map");
  expect(errors).toEqual([]);
});
