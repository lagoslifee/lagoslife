import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number };
const UNLOCK = 100;
const DEPOSIT = 2_000;
const PER_MINUTE = 15;

/** Bike hire: unlock at Adebayo, pedal to Kayode, dock for a refund; then lock mid-hire, reload, find it, dock. */
test("hires a bike, rides and docks it, and finds a locked hire bike after reload", async ({ page }) => {
  test.setTimeout(12 * 60_000);
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
  const balance = async () => (await apiGet<Economy>(page, "/api/economy")).balance;
  const stations = await page.evaluate(() => window.__lagos.bikes().stations) as Array<{ id: string; point: [number, number]; stock: number }>;
  const adebayo = stations.find((s) => s.id === "adebayo")!;
  const kayode = stations.find((s) => s.id === "kayode")!;

  const before = await balance();
  await walk(page, adebayo.point);
  await until(async () => (await prompt(page))?.label.startsWith("Hire a bike"), 10_000, "hire prompt");
  await shot("bike-station");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 10_000, "riding hired bike");
  expect(await balance()).toBe(before - UNLOCK - DEPOSIT);
  await expect(page.getByTestId("speedometer")).toContainText("Hire ·");
  await until(async () => (await page.evaluate(() => window.__lagos.bikes().stations.find((s: { id: string }) => s.id === "adebayo")!.stock)) === adebayo.stock - 1, 5_000, "stock down");

  const started = Date.now();
  const arrived = page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 300_000), kayode.point);
  await page.waitForTimeout(5_000);
  await shot("bike-pedalling");
  expect(await arrived).toBe(true);
  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 9) < 1, 10_000, "stopped");
  await until(async () => (await prompt(page))?.label === "Dock the bike & end the hire", 5_000, "dock prompt");
  const minutes = Math.max(1, Math.ceil((Date.now() - started + 2_000) / 60_000));
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await page.evaluate(() => window.__lagos.driving())), 10_000, "docked");
  const afterDock = await until(async () => {
    const value = await balance();
    return value > before - UNLOCK - DEPOSIT ? value : null;
  }, 10_000, "deposit back");
  const usage = before - UNLOCK - afterDock;
  expect(usage % PER_MINUTE).toBe(0);
  expect(usage / PER_MINUTE).toBeGreaterThanOrEqual(1);
  expect(usage / PER_MINUTE).toBeLessThanOrEqual(minutes + 1);
  expect(await page.evaluate(() => window.__lagos.bikes().hire)).toBeNull();

  // Hire again, lock it on the street away from any dock, reload, and the bike is still there.
  await walk(page, kayode.point);
  await until(async () => (await prompt(page))?.label.startsWith("Hire a bike"), 10_000, "second hire prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 10_000, "second hire");
  const away = await page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 120_000), [kayode.point[0] + 80, kayode.point[1]] as [number, number]);
  expect(away).toBe(true);
  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 9) < 1, 10_000, "stopped away");
  await until(async () => (await prompt(page))?.label === "Lock the bike here", 5_000, "lock prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await page.evaluate(() => window.__lagos.driving())), 10_000, "locked");
  const locked = (await page.evaluate(() => window.__lagos.bikes().hire))!;
  await page.reload();
  await waitForGame(page);
  const restored = await until(async () => page.evaluate(() => window.__lagos.bikes().hire), 15_000, "hire restored");
  expect(Math.hypot(restored.point[0] - locked.point[0], restored.point[1] - locked.point[1])).toBeLessThan(3);
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Transport/ }).click();
  await expect(page.getByTestId("bike-hire")).toContainText("locked on the street");
  await shot("bike-phone");
  await page.keyboard.press("Escape");
  await walk(page, restored.point);
  await until(async () => (await prompt(page))?.label.startsWith("Ride"), 10_000, "ride prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 10_000, "back on bike");
  expect(await page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 120_000), kayode.point)).toBe(true);
  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 9) < 1, 10_000, "stopped at dock");
  await until(async () => (await prompt(page))?.label === "Dock the bike & end the hire", 5_000, "second dock prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await page.evaluate(() => window.__lagos.bikes().hire)), 10_000, "second hire returned");
  expect(errors).toEqual([]);
});
