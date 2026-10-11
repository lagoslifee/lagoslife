import { expect, test, type Page } from "@playwright/test";
import { apiGet, prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Vehicle = { id: string };
type Place = { id: string; door: [number, number]; kerb: [number, number] };
type Camera = { yaw: number; pitch: number; view: string; x: number; y: number; z: number; ground: number };

const camera = (page: Page) => page.evaluate(() => window.__lagos.camera()) as Promise<Camera>;
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** One camera controller: above the car, keeps the player's orbit, drifts back gently, switches views. */
test("driving camera sits above the car, keeps an orbit without snapping and switches views", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await useLowGraphics(page);
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);

  const walking = await camera(page);
  expect(walking.y - walking.ground, "on foot the camera is above head height").toBeGreaterThan(2);

  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  const mechanic = places.find((p) => p.id === "ade-auto-works")!;
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

  page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 240_000), mechanic.kerb).catch(() => undefined);
  await until(async () => ((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 0) > 6, 120_000, "cruising");
  const chase = await camera(page);
  expect(chase.view).toBe("chase");
  expect(chase.y - chase.ground, "chase camera above the roof, not at bumper height").toBeGreaterThan(2.2);
  await shot("camera-chase");
  for (let i = 0; i < 5; i += 1) {
    expect(await page.evaluate(() => window.__lagos.seatOffset()), "driver stays in the seat at speed").toBeLessThan(0.05);
    await page.waitForTimeout(120);
  }

  // Orbit to the side: it stays there while the player is looking, with no per-frame jumps.
  const before = await camera(page);
  await page.evaluate(() => window.__lagos.look(500, 0));
  await page.waitForTimeout(250);
  const orbited = await camera(page);
  expect(angle(orbited.yaw, before.yaw)).toBeGreaterThan(0.8);
  const samples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(150);
    samples.push((await camera(page)).yaw);
  }
  expect(angle(samples.at(-1)!, orbited.yaw), "no snap back while the orbit is fresh").toBeLessThan(0.15);
  await shot("camera-orbit");

  // After the idle delay it drifts back behind the car smoothly.
  await page.waitForTimeout(2_500);
  let previous = (await camera(page)).yaw;
  let largest = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const yaw = (await camera(page)).yaw;
    largest = Math.max(largest, angle(yaw, previous));
    previous = yaw;
  }
  expect(largest, "recentring eases rather than snapping").toBeLessThan(0.4);
  const driving = (await page.evaluate(() => window.__lagos.driving()))!;
  expect(angle(previous, driving.yaw)).toBeLessThan(0.6);

  // Camera switch: far chase, then back.
  await page.getByTestId("camera-switch").click();
  await page.waitForTimeout(600);
  const far = await camera(page);
  expect(far.view).toBe("far");
  expect(far.y - far.ground).toBeGreaterThan(chase.y - chase.ground);
  await shot("camera-far");
  await page.getByTestId("camera-switch").click();
  expect((await camera(page)).view).toBe("chase");
});
