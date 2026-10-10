import { expect, test } from "@playwright/test";
import { state, until, useLowGraphics, waitForGame } from "./helpers";

test("captions a car honking at a resident who blocks its lane", async ({ page }) => {
  test.setTimeout(300_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await waitForGame(page);

  const honks = () => page.evaluate(() => window.__lagos.honks());
  const before = await honks();
  // Step into a lane a car will reach in about 9 s, then stand there until it honks.
  await until(async () => {
    const here = await state(page);
    const lanes = await page.evaluate(() => window.__lagos.lanesAhead(9));
    const meet = lanes
      .filter((lane) => Math.hypot(lane.now[0] - lane.x, lane.now[1] - lane.z) > 45)
      .map((lane) => ({ ...lane, distance: Math.hypot(lane.x - here.x, lane.z - here.z) }))
      .filter((lane) => lane.distance < 28)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!meet) {
      await page.waitForTimeout(1_000);
      return null;
    }
    await page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 7_000), [meet.x, meet.z] as const);
    return until(async () => ((await honks()) > before ? true : null), 9_000, "a honk").catch(() => null);
  }, 240_000, "a car to honk at the resident");

  await expect(page.getByTestId("subtitle")).toHaveText("[A car honks — you are blocking the road]");
  await expect(page.getByTestId("subtitle")).toHaveClass(/sound/);
  // The car stops a few metres from the resident, often right where the follow camera sits.
  for (let sample = 0; sample < 6; sample += 1) {
    expect(await page.evaluate(() => window.__lagos.cameraInsideCar())).toBe(false);
    await page.waitForTimeout(250);
  }
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/caption-honk.png` });
  expect(errors).toEqual([]);
});
