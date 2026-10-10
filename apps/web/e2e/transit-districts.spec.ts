import { expect, test, type Page } from "@playwright/test";
import { API, apiGet, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number };

async function spawnAt(page: Page, placeId: string) {
  const status = await page.evaluate(
    async ([api, id]) => (await fetch(`${api}/api/dev/spawn-at`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ placeId: id }) })).status,
    [API, placeId] as const,
  );
  expect(status).toBe(200);
  await page.reload();
  await waitForGame(page);
}

/** Walks to the nearest stop of a route, boards its danfo once it has stopped, and rides to the next stop. */
async function ride(page: Page, routeId: string, routeLabel: string) {
  const economy = () => apiGet<Economy>(page, "/api/economy");
  const here = await state(page);
  const stops = await page.evaluate(() => window.__lagos.stops());
  const stop = stops
    .filter((candidate) => candidate.routeId === routeId)
    .sort((a, b) => Math.hypot(a.alight[0] - here.x, a.alight[1] - here.z) - Math.hypot(b.alight[0] - here.x, b.alight[1] - here.z))[0]!;
  await walk(page, stop.alight, false);
  const before = (await economy()).balance;
  const bus = await until(async () => (await page.evaluate(() => window.__lagos.buses())).find((b) => b.stopId === stop.id && b.doorOpen), 360_000, `a ${routeLabel} danfo at ${stop.name}`);
  expect(bus.routeId).toBe(routeId);
  await until(async () => (await prompt(page))?.label.startsWith("Board danfo"), 8_000, "board prompt").catch(async () => {
    await page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 4_000), [bus.cx, bus.cz] as const);
  });
  expect((await prompt(page))?.label).toContain(routeLabel.split(" ")[0]!);
  await page.evaluate(() => window.__lagos.interact());
  const seated = await until(async () => { const s = await state(page); return s.busId ? s : null; }, 10_000, "a seat");
  expect((await economy()).balance).toBe(before - 300);
  await expect(page.getByTestId("bus-panel")).toContainText(routeLabel);

  await page.evaluate(() => window.__lagos.requestStop());
  const routeStops = new Set(stops.filter((candidate) => candidate.routeId === routeId).map(({ id }) => id));
  const next = await until(async () => {
    const b = (await page.evaluate(() => window.__lagos.buses())).find((x) => x.id === seated.busId);
    return b?.doorOpen && b.stopId && b.stopId !== stop.id ? b.stopId : null;
  }, 300_000, "the next stop");
  expect(routeStops.has(next), `${next} belongs to ${routeId}`).toBe(true);
  await page.waitForTimeout(800);
  if ((await state(page)).busId) await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await state(page)).busId, 10_000, "stepping off");
  const off = stops.find(({ id }) => id === next)!;
  const after = await state(page);
  expect(Math.hypot(after.x - off.alight[0], after.z - off.alight[1])).toBeLessThan(3);
  expect((await economy()).balance).toBe(before - 300);
  return off;
}

test("rides the Ikoyi and Victoria Island danfo loops", async ({ page }) => {
  test.setTimeout(25 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);

  await spawnAt(page, "grace-assembly");
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("button", { name: /Transport/ }).click();
  await expect(page.getByTestId("route-I1")).toContainText("Bourdillon Road Loop");
  await expect(page.getByRole("button", { name: /nearest stop \(I1\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Close phone" }).click();
  const ikoyi = await ride(page, "bourdillon-loop", "I1 · Bourdillon Road Loop");
  expect(ikoyi.name).toMatch(/^Bourdillon Road · /);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/transit-ikoyi.png` });

  await spawnAt(page, "island-community-hall");
  const island = await ride(page, "adeola-odeku-loop", "V1 · Adeola Odeku Loop");
  expect(island.name).toMatch(/^Adeola Odeku Street · /);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/transit-victoria-island.png` });
  expect(errors).toEqual([]);
});
