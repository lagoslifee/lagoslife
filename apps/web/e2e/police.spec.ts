import { expect, test, type Page } from "@playwright/test";
import { API, apiGet, apiPost, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Place = { id: string; door: [number, number]; kerb: [number, number] };
type Vehicle = { id: string; modelId: string };
type Citation = { offence: string; fine: number };
type Economy = { balance: number };

const ADMIRALTY_CHECKPOINT: [number, number] = [-299.8, 376.1];

async function spawnAt(page: Page, placeId: string) {
  expect((await apiPost(page, "/api/dev/spawn-at", { placeId })).status).toBe(200);
  await page.reload();
  await waitForGame(page);
}

async function register(page: Page, prefix: string) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const playerName = `${prefix}${unique.slice(-7)}`;
  await useLowGraphics(page);
  await page.goto("/?manual=1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(`${prefix.toLowerCase()}-${unique}@example.test`);
  await page.getByLabel("Password").fill("LocalTestPass!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForGame(page);
  return playerName;
}

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

const placeById = async (page: Page, id: string) => ((await page.evaluate(() => window.__lagos.places())) as Place[]).find((place) => place.id === id)!;

test("an uninsured car is fined at the Admiralty checkpoint, guards follow in a Hilux, and the police station takes reports", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await spawnAt(page, "lekki-motors");

  const dealer = await placeById(page, "lekki-motors");
  await walk(page, dealer.door);
  await until(async () => (await prompt(page))?.label.includes("Lekki Motors"), 8_000, "dealership prompt");
  await page.evaluate(() => window.__lagos.interact());
  await page.getByRole("tab", { name: /^All/ }).click();
  const corolla = page.getByTestId("model-toyota-corolla");
  await corolla.getByRole("button", { name: "Buy ₦240,000" }).click();
  await corolla.getByRole("button", { name: "Confirm ₦240,000" }).click();
  const owned = await until(async () => (await apiGet<Vehicle[]>(page, "/api/vehicles")).find((vehicle) => vehicle.modelId === "toyota-corolla"), 15_000, "corolla bought");
  await expect(page.getByRole("dialog", { name: "Lekki Motors" })).toBeHidden({ timeout: 10_000 });
  const car = await until(async () => (await page.evaluate(() => window.__lagos.vehicles())).find((vehicle) => vehicle.id === owned.id), 15_000, "corolla on the street");
  await walk(page, [car.x - Math.cos(car.yaw) * 1.7, car.z + Math.sin(car.yaw) * 1.7]);
  await until(async () => (await prompt(page))?.label.startsWith("Drive Toyota Corolla"), 10_000, "drive prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => page.evaluate(() => window.__lagos.driving()), 15_000, "driving the corolla");

  void page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 120_000), ADMIRALTY_CHECKPOINT);
  const stop = page.getByTestId("checkpoint");
  await expect(stop).toBeVisible({ timeout: 120_000 });
  await expect(stop).toContainText("ADMIRALTY WAY CHECKPOINT");
  await until(async () => (await page.evaluate(() => window.__lagos.meshesNamed("cone "))).length >= 7, 10_000, "cones at the checkpoint");
  await until(async () => Math.abs((await page.evaluate(() => window.__lagos.driving()))?.speed ?? 99) < 0.5, 15_000, "car waved to a halt");
  await page.waitForTimeout(1_000);
  await shot(page, "police-checkpoint");
  await stop.getByTestId("checkpoint-comply").click();
  await expect(page.locator(".toast").filter({ hasText: /Fined ₦5,000 for driving without valid papers/ })).toBeVisible({ timeout: 15_000 });
  const citations = await apiGet<Citation[]>(page, "/api/justice");
  expect(citations.some((citation) => citation.offence === "no_papers" && citation.fine === 5_000)).toBe(true);
  await page.evaluate(() => window.__lagos.exitVehicle());
  await until(async () => !(await page.evaluate(() => window.__lagos.driving())), 15_000, "out of the car");

  await resetProgress(page);
  await spawnAt(page, "eko-shield-security");
  const office = await placeById(page, "eko-shield-security");
  await walk(page, office.door);
  await until(async () => (await prompt(page))?.label.startsWith("Hire security"), 8_000, "security prompt");
  const before = (await apiGet<Economy>(page, "/api/economy")).balance;
  await page.evaluate(() => window.__lagos.interact());
  const sheet = page.getByTestId("security-sheet");
  await sheet.getByTestId("hire-pair").click({ timeout: 10_000 });
  await expect(sheet.getByTestId("security-active")).toContainText("2 guards on duty");
  expect((await apiGet<Economy>(page, "/api/economy")).balance).toBe(before - 25_000);
  await sheet.getByRole("button", { name: "Close" }).click();
  await until(async () => (await page.evaluate(() => window.__lagos.meshesNamed("escort self"))).length > 0, 15_000, "escort Hilux");
  await until(async () => (await page.evaluate(() => window.__lagos.meshesNamed("guard self 1"))).some((mesh) => mesh.visible), 15_000, "guards on foot");
  const here = await state(page);
  await walk(page, office.kerb);
  await page.waitForTimeout(2_500);
  const guards = await page.evaluate(() => window.__lagos.meshesNamed("guard self"));
  const guardCentre = guards.find((mesh) => mesh.visible)!.centre;
  const now = await state(page);
  expect(Math.hypot(guardCentre[0]! - now.x, guardCentre[2]! - now.z)).toBeLessThan(6);
  expect(Math.hypot(here.x - now.x, here.z - now.z)).toBeGreaterThan(0.5);
  await page.evaluate(() => window.__lagos.setCamera(Math.PI, 0.35, 8));
  await page.waitForTimeout(800);
  await shot(page, "security-guards");

  await spawnAt(page, "lekki-police-division");
  const station = await placeById(page, "lekki-police-division");
  await walk(page, station.door);
  await until(async () => (await prompt(page))?.label.startsWith("Police station"), 8_000, "police prompt");
  await page.evaluate(() => window.__lagos.interact());
  const police = page.getByTestId("police-sheet");
  await expect(police).toContainText("desk sergeant");
  await shot(page, "police-station");
  expect(errors).toEqual([]);
});

test("one resident holds up another, and a report at the police station returns the money", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const robberContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const victimContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const robber = await robberContext.newPage();
  const victim = await victimContext.newPage();
  const errors: string[] = [];
  for (const page of [robber, victim]) page.on("pageerror", (error) => errors.push(error.message));
  try {
    const robberName = await register(robber, "Robber");
    const victimName = await register(victim, "Victim");
    expect((await apiPost(victim, "/api/dev/age-account")).status).toBe(200);
    await spawnAt(robber, "lekki-motors");
    await spawnAt(victim, "lekki-motors");
    const dealer = await placeById(victim, "lekki-motors");
    await walk(victim, dealer.kerb);
    const spot = await state(victim);
    await expect(robber.getByTestId("network")).toContainText(/[2-9] online/, { timeout: 30_000 });
    await walk(robber, [spot.x + 1.2, spot.z]);
    await until(async () => (await prompt(robber))?.label === `Hold up ${victimName}`, 15_000, "hold-up prompt");
    await robber.evaluate(() => window.__lagos.interact());
    await robber.getByTestId("rob-go").click();

    const holdUp = victim.getByTestId("holdup");
    await expect(holdUp).toBeVisible({ timeout: 15_000 });
    await expect(holdUp).toContainText(robberName);
    await shot(victim, "robbery-victim");
    const before = (await apiGet<Economy>(victim, "/api/economy")).balance;
    await holdUp.getByTestId("holdup-comply").click();
    await expect(victim.locator(".toast").filter({ hasText: `${robberName} took` })).toBeVisible({ timeout: 15_000 });
    await expect(robber.locator(".toast").filter({ hasText: `${victimName} handed over` })).toBeVisible({ timeout: 15_000 });
    const taken = before - (await apiGet<Economy>(victim, "/api/economy")).balance;
    expect(taken).toBeGreaterThan(0);

    await spawnAt(victim, "lekki-police-division");
    const station = await placeById(victim, "lekki-police-division");
    await walk(victim, station.door);
    await until(async () => (await prompt(victim))?.label.startsWith("Police station"), 8_000, "police prompt");
    await victim.evaluate(() => window.__lagos.interact());
    const police = victim.getByTestId("police-sheet");
    await expect(police.getByTestId("unreported")).toContainText(robberName);
    await police.getByTestId("report-name").fill(robberName);
    await police.getByTestId("report-submit").click();
    await expect(victim.locator(".toast").filter({ hasText: "charged with armed robbery" })).toBeVisible({ timeout: 15_000 });
    expect((await apiGet<Economy>(victim, "/api/economy")).balance).toBe(before);
    const charges = await apiGet<Citation[]>(robber, "/api/justice");
    expect(charges.some((citation) => citation.offence === "armed_robbery")).toBe(true);
    await shot(victim, "police-report");
    expect(errors).toEqual([]);
  } finally {
    await robberContext.close();
    await victimContext.close();
  }
});

void API;
