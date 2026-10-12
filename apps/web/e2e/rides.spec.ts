import { expect, test } from "@playwright/test";
import { apiGet, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number };
type Place = { id: string; name: string; door: [number, number]; kerb: [number, number] };

/** Naija World Ride: quote, book, driver arrives, board, ride on real roads, arrive; then a free cancellation. */
test("books a Naija World Ride, boards, arrives, and gets a full refund for a quick cancel", async ({ page }) => {
  test.setTimeout(12 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Frame error")) errors.push(message.text());
  });
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);
  const balance = async () => (await apiGet<Economy>(page, "/api/economy")).balance;
  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  const destination = places.find((p) => p.id === "ade-auto-works")!;

  await walk(page, dealer.kerb);
  const before = await balance();
  const phone = page.getByRole("dialog", { name: "Phone" });
  const openRide = async () => {
    await page.getByRole("button", { name: "Open phone" }).click();
    await phone.getByRole("button", { name: /Ride/ }).click();
  };

  // Too close: explained, cannot book.
  await openRide();
  await phone.getByTestId("ride-search").fill(dealer.name);
  await phone.getByRole("button", { name: new RegExp(dealer.name) }).first().click();
  await expect(phone.getByTestId("ride-problem")).toContainText("short walk");
  await expect(phone.getByTestId("ride-book")).toBeDisabled();

  // Quote and book.
  await phone.getByRole("button", { name: "Change destination" }).click();
  await phone.getByTestId("ride-search").fill(destination.name);
  await phone.getByRole("button", { name: new RegExp(destination.name) }).first().click();
  const quote = phone.getByTestId("ride-quote");
  await expect(quote).toContainText("Fare");
  await shot("ride-quote");
  await phone.getByTestId("ride-book").click();
  const booked = await until(async () => (await page.evaluate(() => window.__lagos.ride()))?.status === "approaching" && page.evaluate(() => window.__lagos.ride()), 10_000, "ride booked");
  expect(await balance()).toBe(before - booked!.fare);
  await expect(phone.getByTestId("ride-status")).toContainText("Driver arriving");
  await shot("ride-approaching");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ride-line")).toBeVisible();

  // Driver arrives at the kerb; walk over and get in.
  const waiting = await until(async () => {
    const ride = await page.evaluate(() => window.__lagos.ride());
    return ride?.status === "waiting" ? ride : null;
  }, 100_000, "driver arrived");
  const car = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.id === waiting.vehicleId), 10_000, "ride car");
  expect(car.npc).toBe(true);
  await walk(page, [car.x + Math.cos(car.yaw) * 1.9, car.z - Math.sin(car.yaw) * 1.9]);
  await until(async () => (await prompt(page))?.label.includes("Naija World Ride"), 10_000, "get in prompt");
  await shot("ride-waiting");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => (await page.evaluate(() => window.__lagos.ride()))?.status === "riding", 10_000, "riding");
  await page.waitForTimeout(6_000);
  await shot("ride-riding");
  const moving = await state(page);
  expect(Math.hypot(moving.x - car.x, moving.z - car.z)).toBeGreaterThan(10);
  const progress = setInterval(() => {
    void page.evaluate(() => [window.__lagos.rideCar(), window.__lagos.state()]).then(([car, me]) => console.log("ride", JSON.stringify(car), me.x.toFixed(1), me.z.toFixed(1))).catch(() => undefined);
  }, 15_000);
  const done = await until(async () => {
    const ride = await page.evaluate(() => window.__lagos.ride());
    return ride && ride.status !== "riding" ? ride : null;
  }, 6 * 60_000, "ride finished");
  clearInterval(progress);
  expect(done.status).toBe("completed");
  const end = await state(page);
  expect(Math.hypot(end.x - done.dropoff[0], end.z - done.dropoff[1])).toBeLessThan(45);
  expect(await balance()).toBe(before - booked!.fare);
  await shot("ride-arrived");

  // Book back and cancel inside the free minute: full refund.
  const afterTrip = await balance();
  await openRide();
  await phone.getByTestId("ride-search").fill(dealer.name);
  await phone.getByRole("button", { name: new RegExp(dealer.name) }).first().click();
  await phone.getByTestId("ride-book").click();
  await until(async () => (await page.evaluate(() => window.__lagos.ride()))?.status === "approaching", 10_000, "second booking");
  await phone.getByTestId("ride-cancel").click();
  await until(async () => (await page.evaluate(() => window.__lagos.ride()))?.status === "cancelled", 10_000, "cancelled");
  await until(async () => (await balance()) === afterTrip, 10_000, "full refund");
  await expect(phone.getByTestId("ride-result")).toContainText("refunded");
  expect(errors).toEqual([]);
});

/** Express ride: the far side of town in a few seconds, charged once, with no car left behind. */
test("takes an express ride across town in under five seconds", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await useLowGraphics(page);
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.reload();
  await waitForGame(page);
  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  const mosque = places.find((p) => p.id === "al-noor-mosque")!;
  await walk(page, dealer.kerb);
  const before = (await apiGet<Economy>(page, "/api/economy")).balance;
  const phone = page.getByRole("dialog", { name: "Phone" });
  await page.getByRole("button", { name: "Open phone" }).click();
  await phone.getByRole("button", { name: /Ride/ }).click();
  await phone.getByTestId("ride-search").fill(mosque.name);
  await phone.getByRole("button", { name: new RegExp(mosque.name) }).first().click();
  await expect(phone.getByTestId("ride-quote")).toContainText("Fare");
  const started = Date.now();
  await phone.getByTestId("ride-express").click();
  const done = await until(async () => {
    const ride = await page.evaluate(() => window.__lagos.ride());
    return ride?.status === "completed" ? ride : null;
  }, 5_000, "express arrival");
  const me = await state(page);
  expect(Math.hypot(me.x - done.dropoff[0], me.z - done.dropoff[1])).toBeLessThan(45);
  await expect(page.getByTestId("transfer-veil")).toHaveCount(0, { timeout: 8_000 });
  console.log(`express arrival after ${Date.now() - started} ms`);
  expect((await apiGet<Economy>(page, "/api/economy")).balance).toBe(before - done.fare);
  expect((await page.evaluate(() => window.__lagos.vehicles())).some((v) => v.id.startsWith("ride-"))).toBe(false);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/ride-express-arrived.png` });
});

/** Phone navigation: next-turn line on a real road route. */
test("shows next-turn guidance on the road route", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await useLowGraphics(page);
  await page.goto("/");
  await waitForGame(page);
  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const dealer = places.find((p) => p.id === "lekki-motors")!;
  const destination = places.find((p) => p.id === "ade-auto-works")!;
  await walk(page, dealer.kerb);
  await page.evaluate((point) => window.__lagos.navigate(point, "Ade Auto Works"), destination.door);
  const line = page.getByTestId("nav-line");
  await expect(line).toContainText(/Turn|Bear|Arrive|Continue|U-turn/, { timeout: 10_000 });
  const nav = await page.evaluate(() => window.__lagos.navigation());
  expect(nav?.reachable).toBe(true);
  expect(nav?.guidance?.remaining).toBeGreaterThan(100);
});
