import { expect, test, type Page } from "@playwright/test";
import { until, waitForGame } from "./helpers";

type Quality = { step: number; scaling: number; shadows: boolean; viewDistance: number; fogDensity: number };
const quality = (page: Page) => page.evaluate(() => (window.__lagos as unknown as { quality(): Quality }).quality());

test("lowers detail on its own while frames are slow, and restores it when switched off", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("lagos-quality", "medium");
    localStorage.setItem("lagos-help-seen", "1");
  });
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/?manual=1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(`Auto${unique.slice(-7)}`);
  await page.getByLabel("Email").fill(`auto-${unique}@example.test`);
  await page.getByLabel("Password").fill("LocalTestPass!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForGame(page);

  const full = await quality(page);
  expect(full).toMatchObject({ step: 0, shadows: true, viewDistance: 1600 });
  const fps = await page.evaluate(() => window.__lagos.fps());
  test.skip(fps > 30, `this machine renders at ${fps.toFixed(0)} fps, so there is nothing to lower`);

  // Software rendering here runs well under 30 fps, so every step should be taken in turn.
  const started = Date.now();
  const reduced = await until(async () => {
    const now = await quality(page);
    return now.step >= 3 ? now : null;
  }, 120_000, "automatic quality to reach step 3");
  console.info(`started at ${fps.toFixed(1)} fps; reached step ${reduced.step} after ${((Date.now() - started) / 1000).toFixed(1)} s, now ${(await page.evaluate(() => window.__lagos.fps())).toFixed(1)} fps`);
  expect(reduced.scaling).toBeGreaterThan(full.scaling);
  expect(reduced.shadows).toBe(false);
  expect(reduced.viewDistance).toBeLessThan(1600);
  expect(reduced.fogDensity).toBeGreaterThan(full.fogDensity);
  await expect(page.getByTestId("perf")).toContainText("auto detail −");

  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Settings/ }).click();
  const toggle = page.getByLabel("Lower detail automatically when slow");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => quality(page)).toEqual(full);
  await page.waitForTimeout(12_000);
  expect(await quality(page)).toEqual(full);

  await page.reload();
  await waitForGame(page);
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByLabel("Lower detail automatically when slow")).not.toBeChecked();
  expect(errors).toEqual([]);
});
