import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number; progress: Record<string, string> };
type Vehicle = { id: string; plate: string; status: string; x: number; z: number; condition: number; odometerMetres: number; insured: boolean };
type Place = { id: string; door: [number, number]; kerb: [number, number] };

/** Milestone 6 journey: buy at Lekki Motors, drive to Ade Auto Works, park, insure, service, reload. */
test("buys a car, drives it across Lekki, parks, insures and services it, and finds it after reload", async ({ page }) => {
  test.setTimeout(15 * 60_000);
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
  const economy = () => apiGet<Economy>(page, "/api/economy");
  const vehicles = () => apiGet<Vehicle[]>(page, "/api/vehicles");
  expect(await vehicles()).toHaveLength(0);

  const places = await page.evaluate(() => window.__lagos.places()) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  const mechanic = places.find((p) => p.id === "ade-auto-works")!;

  // Dealership: choose a colour, confirm once, pay once.
  await walk(page, dealer.door);
  await until(async () => (await prompt(page))?.label.includes("Lekki Motors"), 8_000, "dealership prompt");
  await page.evaluate(() => window.__lagos.interact());
  const hatch = page.getByTestId("model-eko-hatch");
  await hatch.getByRole("radio", { name: "Colour #1f3a5f" }).click();
  await hatch.getByRole("button", { name: "Buy ₦120,000" }).click();
  const confirm = hatch.getByRole("button", { name: "Confirm ₦120,000" });
  await shot("m6-dealership-sheet");
  await confirm.click();
  await expect(page.getByRole("dialog", { name: "Lekki Motors" })).toBeHidden({ timeout: 10_000 });
  const [bought] = await vehicles();
  expect(bought).toBeTruthy();
  expect((await economy()).balance).toBe(250_000 - 120_000);
  expect((await economy()).progress.first_vehicle).toBeTruthy();

  // The car appears outside for this player, marked as theirs.
  const car = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.id === bought!.id && v.mine), 10_000, "car in world");
  const driverDoor: [number, number] = [car.x - Math.cos(car.yaw) * 1.7, car.z + Math.sin(car.yaw) * 1.7];
  await walk(page, driverDoor);
  await until(async () => (await prompt(page))?.label.startsWith("Drive Eko Hatch"), 10_000, "drive prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 10_000, "driving");
  await expect(page.getByTestId("speedometer")).toContainText("km/h");

  // Drive along Admiralty Way to the mechanic, sampling speed.
  let topSpeed = 0;
  const sampler = setInterval(() => {
    void page.evaluate(() => window.__lagos.driving()?.speed ?? 0).then((speed) => { topSpeed = Math.max(topSpeed, speed); }).catch(() => undefined);
  }, 300);
  const drive = page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 240_000), mechanic.kerb);
  await until(async () => ((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 0) > 6, 120_000, "cruising");
  await shot("m6-driving");
  const arrived = await drive;
  clearInterval(sampler);
  expect(arrived).toBe(true);
  expect(topSpeed, "a car must outrun a sprinting resident (6 m/s)").toBeGreaterThan(6.5);
  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 9) < 0.5, 10_000, "stopping");
  await page.evaluate(() => window.__lagos.exitVehicle());
  await until(async () => !(await page.evaluate(() => window.__lagos.driving())), 10_000, "stepping out");
  const parked = (await vehicles())[0]!;
  expect(parked.status).toBe("parked");
  expect(parked.odometerMetres).toBeGreaterThan(200);
  expect(Math.hypot(parked.x - mechanic.door[0], parked.z - mechanic.door[1])).toBeLessThan(40);

  // Insurance from the phone.
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("button", { name: /Vehicles/ }).click();
  const card = page.getByTestId(`vehicle-${parked.id}`);
  await expect(card).toContainText(parked.plate);
  const beforeCover = (await economy()).balance;
  await card.getByRole("button", { name: /Insure 7 days/ }).click();
  await expect(card).toContainText("Insured until", { timeout: 10_000 });
  expect((await economy()).balance).toBe(beforeCover - 3_600);
  await page.getByRole("button", { name: "Close phone" }).click();

  // Mechanic: the drive put distance on the clock, so a routine service is available.
  await walk(page, mechanic.door);
  await until(async () => (await prompt(page))?.label.includes("Ade Auto Works"), 8_000, "mechanic prompt");
  await page.evaluate(() => window.__lagos.interact());
  const row = page.getByTestId(`service-${parked.id}`);
  const service = row.getByRole("button", { name: /Service ₦|Running well/ });
  await expect(service).toBeVisible();
  await shot("m6-mechanic-sheet");
  const label = (await service.textContent()) ?? "";
  test.info().annotations.push({ type: "mechanic", description: label });
  if (label.startsWith("Service")) {
    const beforeService = (await economy()).balance;
    await service.click();
    await expect(row.getByRole("button", { name: "Running well" })).toBeVisible({ timeout: 10_000 });
    expect((await economy()).balance).toBeLessThan(beforeService);
    expect((await vehicles())[0]!.condition).toBe(100);
  }
  await page.getByRole("button", { name: "Close" }).click();

  // Reload: the car is still parked where it was left.
  await page.reload();
  await waitForGame(page);
  const afterReload = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.id === parked.id), 15_000, "car after reload");
  expect(Math.hypot(afterReload.x - parked.x, afterReload.z - parked.z)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});
