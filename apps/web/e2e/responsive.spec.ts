import { devices, expect, test, type Page } from "@playwright/test";
import { prompt, resetProgress, until, useLowGraphics, waitForGame, walk } from "./helpers";

const HUD = [".hud-location", ".hud-status", ".objective", ".guide-tab", ".hud-buttons", ".minimap", ".prompt", ".touch-stick", ".touch-buttons", ".chat-lines", ".chat-open", ".osm-credit", ".bus-panel", ".speedometer", ".rent-reminder", ".controls-card", ".perf"];

/** Every pair of visible HUD boxes that overlap, anything poking off-screen, and whether the page can scroll. */
async function layoutProblems(page: Page) {
  return page.evaluate((selectors) => {
    const boxes = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => ({ selector, r: el.getBoundingClientRect(), style: getComputedStyle(el) })))
      .filter((b) => b.style.display !== "none" && b.style.visibility !== "hidden" && b.r.width > 0 && b.r.height > 0);
    const problems: string[] = [];
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!.r;
        const b = boxes[j]!.r;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push(`${boxes[i]!.selector} overlaps ${boxes[j]!.selector}`);
      }
    for (const b of boxes) if (b.r.left < -1 || b.r.top < -1 || b.r.right > innerWidth + 1 || b.r.bottom > innerHeight + 1) problems.push(`${b.selector} is off-screen`);
    const root = document.scrollingElement!;
    if (root.scrollWidth > innerWidth || root.scrollHeight > innerHeight) problems.push("the page scrolls");
    return problems;
  }, HUD);
}

const { defaultBrowserType: _se, ...iPhoneSE } = devices["iPhone SE"];
const { defaultBrowserType: _px, ...pixel7 } = devices["Pixel 7"];
const { defaultBrowserType: _ls, ...landscape } = devices["iPhone 13 landscape"];
const { defaultBrowserType: _ip, ...iPad } = devices["iPad (gen 7)"];
const targets = [
  { name: "iPhone SE", use: iPhoneSE, touch: true },
  { name: "Pixel 7", use: pixel7, touch: true },
  { name: "iPhone 13 landscape", use: landscape, touch: true },
  { name: "iPad", use: iPad, touch: true },
  { name: "desktop 1366×768", use: { viewport: { width: 1366, height: 768 } }, touch: false },
];

for (const target of targets) {
  test.describe(target.name, () => {
    test.use(target.use);
    test("welcome, guide and prompt fit without overlapping", async ({ page }) => {
      test.setTimeout(5 * 60_000);
      await page.addInitScript(() => sessionStorage.setItem("lagos-test-welcome", "1"));
      await useLowGraphics(page);
      await page.goto("/");
      await waitForGame(page);
      await resetProgress(page);
      await page.evaluate(() => localStorage.removeItem("lagos-housing"));
      await page.reload();
      await waitForGame(page);

      const welcome = page.getByTestId("welcome");
      await expect(welcome).toBeVisible({ timeout: 20_000 });
      await expect(welcome).toContainText(target.touch ? "drag the circle to walk" : "walk");
      await page.getByTestId("welcome-build").scrollIntoViewIfNeeded();
      await page.getByTestId("welcome-build").click();

      const guide = page.getByTestId("objective");
      await expect(guide).toContainText(/Lease or buy Plot \d+/);
      await expect(guide).toContainText(target.touch ? "tap ✋" : "press E");
      await expect(page.locator(".controls-card")).toHaveCount(0);
      await expect(page.locator(".touch-stick")).toHaveCount(target.touch ? 1 : 0);
      expect(await layoutProblems(page)).toEqual([]);

      const plot = (await page.evaluate(() => window.__lagos.plots()))[0]!;
      await walk(page, plot.gate);
      await until(async () => (await prompt(page))?.label.includes("Plot"), 8_000, "plot prompt");
      await expect(page.getByTestId("prompt")).toBeVisible();
      expect(await layoutProblems(page)).toEqual([]);

      // The prompt itself is the tap target on touch screens.
      await page.getByTestId("prompt").click();
      const sheet = page.getByTestId("plot-sheet");
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(page.locator(".touch-stick")).toHaveCount(0);
    });
  });
}
