import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Vehicle = { id: string; plate: string; colour: string; modelId: string; status: string; x: number; z: number; condition: number };
type Place = { id: string; door: [number, number]; kerb: [number, number] };
type Economy = { balance: number };

/** Tow & repair: request from the phone, watch the truck collect the car, and get the same car back beside you. */
test("tows, repairs and returns the same car to the player's current location", async ({ page }) => {
  test.setTimeout(6 * 60_000);
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

  // Walk off down the street so "my current location" is somewhere else.
  const away: [number, number] = [car.x + Math.sin(car.yaw) * 60, car.z + Math.cos(car.yaw) * 60];
  await walk(page, away);
  const before = (await apiGet<Economy>(page, "/api/economy")).balance;

  await page.getByRole("button", { name: "Open phone" }).click();
  const phone = page.getByRole("dialog", { name: "Phone" });
  await phone.getByRole("button", { name: /Vehicles/ }).click();
  await phone.getByRole("button", { name: /Tow & repair/ }).click();
  const request = phone.getByTestId("tow-request");
  await expect(request).toContainText("Where should we return your car?");
  await expect(request).toContainText("₦4,000");
  await request.getByLabel(/My current location/).check();
  await shot("tow-request");
  await request.getByRole("button", { name: /Send the truck/ }).click();
  await expect(phone.getByTestId("tow-arriving")).toBeVisible({ timeout: 10_000 });
  await until(async () => (await apiGet<Economy>(page, "/api/economy")).balance === before - 4_000, 10_000, "charged once");
  await page.keyboard.press("Escape");

  const line = page.getByTestId("tow-line");
  await expect(line).toContainText("Truck arriving");
  const truck = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.id.startsWith("tow-")), 10_000, "truck in world");
  expect(truck).toBeTruthy();
  await walk(page, [car.x + Math.sin(car.yaw) * 14, car.z + Math.cos(car.yaw) * 14]);
  const lookAtTruck = () => page.evaluate(() => {
    const truck = window.__lagos.vehicles().find((v: { id: string }) => v.id.startsWith("tow-"));
    const me = window.__lagos.state();
    if (truck) window.__lagos.setCamera(Math.atan2(truck.cx - me.x, truck.cz - me.z), 0.3, 13);
  });
  await expect(line).toContainText("Loading your car", { timeout: 40_000 });
  await lookAtTruck();
  await page.waitForTimeout(800);
  await shot("tow-loading-start");
  await page.waitForTimeout(1_800);
  await lookAtTruck();
  await shot("tow-loading");
  await expect(line).toContainText(/Collected|Repairing|Returning/, { timeout: 15_000 });
  const collectedAt = Date.now();
  const spot = await page.evaluate(() => ({ x: window.__lagos.state().x, z: window.__lagos.state().z }));
  await expect(line).toContainText("Returning", { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await lookAtTruck();
  await page.waitForTimeout(500);
  await shot("tow-returning");
  await expect(line).toBeHidden({ timeout: 25_000 });
  const elapsed = (Date.now() - collectedAt) / 1000;
  expect(elapsed).toBeLessThan(16);

  const [back] = await apiGet<Vehicle[]>(page, "/api/vehicles");
  expect(back!.id).toBe(bought!.id);
  expect([back!.plate, back!.colour, back!.modelId]).toEqual([bought!.plate, bought!.colour, bought!.modelId]);
  expect(back!.status).toBe("parked");
  expect(back!.condition).toBe(100);
  expect(Math.hypot(back!.x - spot.x, back!.z - spot.z)).toBeLessThan(45);
  expect(await apiGet<Vehicle[]>(page, "/api/vehicles")).toHaveLength(1);
  const inWorld = (await page.evaluate(() => window.__lagos.vehicles())).filter((v) => v.id === bought!.id);
  expect(inWorld).toHaveLength(1);
  await shot("tow-delivered");
  expect((await apiGet<Economy>(page, "/api/economy")).balance).toBe(before - 4_000);
  expect(errors).toEqual([]);
});
