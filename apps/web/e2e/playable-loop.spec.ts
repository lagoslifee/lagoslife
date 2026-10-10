import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number; progress: Record<string, string>; activeJob: { destinationX: number; destinationZ: number; reward: number; destinationLabel: string } | null };
type Listing = { id: string; placeId: string | null; isMine: boolean; tenureType: string | null; upfrontRent: number };

/**
 * The finish-line journey: danfo ride → delivery wage → food → rent → enter home → reload.
 * Uses the auto-signed-in LocalTester account and resets its progress first.
 */
test("rides a danfo, earns a wage, eats, rents a flat, moves in and keeps progress after reload", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);
  const economy = () => apiGet<Economy>(page, "/api/economy");
  const start = await economy();
  expect(start.balance).toBe(250_000);
  await expect(page.getByTestId("current-location")).toContainText(/Street|Road|Way|Avenue|Unnamed/);
  await expect(page.getByTestId("objective")).toContainText("Find a place to live");

  // Danfo: walk to the nearest stop, board only once it has stopped, pay once, request a stop, step off.
  const here = await state(page);
  const stops = await page.evaluate(() => window.__lagos.stops());
  const stop = [...stops].sort((a, b) => Math.hypot(a.alight[0] - here.x, a.alight[1] - here.z) - Math.hypot(b.alight[0] - here.x, b.alight[1] - here.z))[0]!;
  await walk(page, stop.alight, false);
  const bus = await until(async () => (await page.evaluate(() => window.__lagos.buses())).find((b) => b.stopId === stop.id && b.doorOpen), 300_000, "a danfo at the stop");
  await until(async () => (await prompt(page))?.label.startsWith("Board"), 8_000, "board prompt").catch(async () => {
    await page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 4_000), [bus.cx, bus.cz] as const);
  });
  await page.evaluate(() => window.__lagos.interact());
  const seated = await until(async () => { const s = await state(page); return s.busId ? s : null; }, 10_000, "a seat");
  expect(seated.seat).not.toBeNull();
  expect((await economy()).balance).toBe(start.balance - 300);
  await expect(page.getByTestId("bus-panel")).toBeVisible();

  await page.evaluate(() => window.__lagos.requestStop());
  await until(async () => { const b = (await page.evaluate(() => window.__lagos.buses())).find((x) => x.id === seated.busId); return b?.doorOpen && b.stopId && b.stopId !== stop.id; }, 300_000, "the next stop");
  await page.waitForTimeout(800);
  if ((await state(page)).busId) await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await state(page)).busId, 10_000, "stepping off");
  await page.evaluate(() => window.__lagos.interact());
  await page.waitForTimeout(1_500);
  expect((await state(page)).busId, "pressing E right after stepping off must not re-board").toBeNull();
  const afterRide = await economy();
  expect(afterRide.balance).toBe(start.balance - 300);
  expect(afterRide.progress.first_ride).toBeTruthy();

  // Delivery job.
  const places = await page.evaluate(() => window.__lagos.places());
  const place = (id: string) => places.find((p) => p.id === id)!;
  await walk(page, place("swift-parcel-hub").door);
  await until(async () => (await prompt(page))?.label.includes("Swift Parcel"), 8_000, "hub prompt");
  await page.evaluate(() => window.__lagos.interact());
  await page.getByRole("button", { name: /Collect a parcel/ }).click();
  await expect(page.getByTestId("job-status")).toBeVisible();
  const job = (await economy()).activeJob!;
  expect(job).toBeTruthy();
  await walk(page, [job.destinationX, job.destinationZ]);
  await until(async () => (await prompt(page))?.label === "Deliver parcel", 8_000, "deliver prompt");
  const beforeWage = (await economy()).balance;
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await economy()).activeJob, 10_000, "delivery");
  expect((await economy()).balance).toBe(beforeWage + job.reward);

  // Food.
  await walk(page, place("mama-titi-buka").door);
  await until(async () => (await prompt(page))?.label.includes("Mama Titi"), 8_000, "buka prompt");
  await page.evaluate(() => window.__lagos.interact());
  await page.getByRole("button", { name: /^Buy ₦/ }).first().click();
  await page.getByRole("button", { name: /^Eat$/ }).first().click();
  await until(async () => (await economy()).progress.first_meal, 10_000, "a meal");
  await page.getByRole("button", { name: "Close" }).click();

  // Rent Adebayo Court, then enter with the digital key.
  const flat = place("lekki-adebayo-flat-2");
  await walk(page, flat.door);
  await until(async () => (await prompt(page))?.label.includes(flat.name), 8_000, "rental prompt");
  await page.evaluate(() => window.__lagos.interact());
  await expect(page.getByText("Total upfront")).toBeVisible();
  await expect(page.getByTestId("unit-availability")).toContainText(/\d+ of 12 flats free to rent/);
  const beforeRent = (await economy()).balance;
  await page.getByRole("button", { name: "Rent this flat" }).click();
  await page.getByRole("button", { name: /^Confirm ₦/ }).click();
  await expect(page.getByRole("button", { name: "Enter home" })).toBeVisible();
  const listing = (await apiGet<Listing[]>(page, "/api/properties")).find((p) => p.placeId === flat.id && p.isMine)!;
  expect(listing.isMine).toBe(true);
  expect(listing.tenureType).toBe("rented");
  const afterRent = (await economy()).balance;
  expect(beforeRent - afterRent).toBe(listing.upfrontRent);
  await page.getByRole("button", { name: "Enter home" }).click();
  await until(async () => (await state(page)).indoors, 20_000, "being indoors");
  expect((await state(page)).location).toBe(`home:${listing.id}`);
  await expect(page.getByTestId("current-location")).toContainText(flat.name);

  // Reload: money, tenancy and progress survive.
  await page.reload();
  await waitForGame(page);
  const reloaded = await economy();
  expect(reloaded.balance).toBe(afterRent);
  for (const key of ["first_ride", "first_wage", "first_meal", "first_rental"]) expect(reloaded.progress[key]).toBeTruthy();
  expect((await apiGet<Listing[]>(page, "/api/properties")).find((p) => p.id === listing.id)?.isMine).toBe(true);
  expect(errors).toEqual([]);
});

test("'Get me unstuck' moves the player to a safe spot", async ({ page }) => {
  await useLowGraphics(page);
  await page.goto("/");
  await waitForGame(page);
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Help/ }).click();
  await page.getByRole("button", { name: /Get me unstuck/ }).click();
  await expect(page.getByText(/Moved to a safe spot/)).toBeVisible({ timeout: 10_000 });
});
