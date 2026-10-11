import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Vehicle = { id: string; modelId: string; status: string };
type Place = { id: string; door: [number, number] };

test("Lekki Motors sells real-world cars by category, and a bought Corolla drives", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);
  await shot("cars-street");

  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((place) => place.id === "lekki-motors")!;
  await walk(page, dealer.door);
  await until(async () => (await prompt(page))?.label.includes("Lekki Motors"), 8_000, "dealership prompt");
  await page.evaluate(() => window.__lagos.interact());

  await page.getByRole("tab", { name: "Sports & supercars" }).click();
  for (const id of ["ferrari-f8", "lamborghini-huracan", "porsche-911", "bmw-m4"]) await expect(page.getByTestId(`model-${id}`)).toBeVisible();
  await expect(page.getByTestId("model-eko-hatch")).toHaveCount(0);
  await page.getByTestId("model-lamborghini-huracan").locator("strong").click();
  await page.waitForTimeout(2_000);
  await shot("cars-dealer-huracan");

  await page.getByRole("tab", { name: "Luxury" }).click();
  await expect(page.getByTestId("model-rolls-royce-cullinan")).toBeVisible();
  await expect(page.getByTestId("model-mercedes-g63")).toBeVisible();

  await page.getByRole("tab", { name: /^All/ }).click();
  const corolla = page.getByTestId("model-toyota-corolla");
  await corolla.getByRole("button", { name: "Buy ₦240,000" }).click();
  await corolla.getByRole("button", { name: "Confirm ₦240,000" }).click();
  const owned = await until(async () => (await apiGet<Vehicle[]>(page, "/api/vehicles")).find((vehicle) => vehicle.modelId === "toyota-corolla"), 15_000, "corolla bought");

  await expect(page.getByRole("dialog", { name: "Lekki Motors" })).toBeHidden({ timeout: 10_000 });
  const car = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((vehicle) => vehicle.id === owned.id), 15_000, "corolla on the street");
  await walk(page, [car.x - Math.cos(car.yaw) * 1.7, car.z + Math.sin(car.yaw) * 1.7]);
  await until(async () => (await prompt(page))?.label.startsWith("Drive Toyota Corolla"), 10_000, "drive prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 15_000, "driving the corolla");
  const drive = page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 120_000), [car.x + 60, car.z] as const);
  await until(async () => ((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 0) > 4, 60_000, "corolla moving");
  await shot("cars-driving-corolla");
  await drive;
  expect(errors).toEqual([]);
});
