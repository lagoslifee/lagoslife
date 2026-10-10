import { expect, test } from "@playwright/test";
import { useLowGraphics, waitForGame } from "./helpers";

/** Two tabs in one browser: the newest plays, the other releases its graphics and can take over again. */
test("hands the city over between tabs of the same browser", async ({ page, context }) => {
  test.setTimeout(4 * 60_000);
  await useLowGraphics(page);
  await page.goto("/");
  await waitForGame(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(page.getByTestId("open-elsewhere")).toBeVisible({ timeout: 10_000 });
  await waitForGame(second);
  await page.getByRole("button", { name: "Play here instead" }).click();
  await expect(second.getByTestId("open-elsewhere")).toBeVisible({ timeout: 10_000 });
  await waitForGame(page);
});

/** A browser whose WebGL2 cannot make textures (as after a GPU crash) still starts, on the WebGL1 fallback. */
test("starts on the safe graphics path when textures cannot be created", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await useLowGraphics(page);
  await page.addInitScript(() => {
    if ("WebGL2RenderingContext" in window) WebGL2RenderingContext.prototype.createTexture = () => null;
  });
  await page.goto("/");
  await waitForGame(page);
  await expect(page.getByText("The city could not load")).toHaveCount(0);
  expect(await page.evaluate(() => window.__lagos.gpu().lost)).toBe(false);
});
