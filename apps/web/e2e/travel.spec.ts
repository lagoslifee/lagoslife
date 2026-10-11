import { expect, test, type Page } from "@playwright/test";
import { API, prompt, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Place = { id: string; name: string; kind: string; door: [number, number]; kerb: [number, number] };
type Economy = { balance: number };
type Travel = { visa: { status: string } | null; ticket: { outbound: string; return: string; immigrationDone: boolean } | null; bookings: Array<{ status: string }>; activities: Array<{ activity: string }> };

const ORIGIN: [number, number] = [5000, 5000];
const at = (dx: number, dz: number): [number, number] => [ORIGIN[0] + dx, ORIGIN[1] + dz];

/** Its own guest account (Bearer token), so it never shares the fixed local tester with other runs. */
async function call<T>(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ([api, p, b]) => {
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("lagos-session-token") ?? ""}` };
    const response = await fetch(`${api}${p}`, b === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(b) });
    return { status: response.status, body: await response.json() };
  }, [API, path, body] as const) as Promise<{ status: number; body: T }>;
}
const apiGet = async <T>(page: Page, path: string) => (await call<T>(page, path)).body;

async function spawnAt(page: Page, placeId: string) {
  expect((await call(page, "/api/dev/spawn-at", { placeId })).status).toBe(200);
  await page.reload();
  await waitForGame(page);
}

const walkInside = (page: Page, point: [number, number]) => page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 40_000), point);

async function useSpot(page: Page, point: [number, number], label: string) {
  await walkInside(page, point);
  await until(async () => {
    const shown = await prompt(page);
    return shown && !shown.disabled ? shown : null;
  }, 10_000, `${label} prompt`);
  await page.evaluate(() => window.__lagos.interact());
}

async function openPlace(page: Page, place: Place, point: [number, number] = place.door) {
  await walk(page, point);
  await until(async () => prompt(page), 10_000, `${place.name} prompt`);
  await page.evaluate(() => window.__lagos.interact());
}

/** Lagos → Dubai and back: visa, return ticket, check-in, boarding, flight, immigration, hotel, dhow cruise, home. */
test("flies Lagos to Dubai, stays in a hotel, takes the dhow cruise and flies home", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await useLowGraphics(page);
  await page.addInitScript(() => sessionStorage.setItem("lagos-dev-sign-in-attempted", "1"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  await page.goto("/");
  await waitForGame(page);
  expect((await call(page, "/api/dev/reset-progress", {})).status).toBe(200);
  const balance = async () => (await apiGet<Economy>(page, "/api/economy")).balance;
  const travel = () => apiGet<Travel>(page, "/api/travel");
  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const place = (id: string) => places.find((entry) => entry.id === id)!;

  // Consular office: visa at the counter.
  await spawnAt(page, "dubai-consular-office");
  const start = await balance();
  await openPlace(page, place("dubai-consular-office"));
  await page.getByTestId("enter-consulate").click();
  await until(async () => (await state(page)).indoors, 15_000, "inside the consulate");
  await shot("travel-consulate");
  await useSpot(page, at(2.6, 2.4), "visa counter");
  await page.getByTestId("visa-single-14").click();
  await until(async () => (await travel()).visa?.status === "issued", 30_000, "visa issued");
  expect(await balance()).toBe(start - 20_000);
  await page.getByTestId("visa-counter").getByRole("button", { name: "Close" }).click();

  // Lagos airport: ticket, check-in, gate.
  await spawnAt(page, "lagos-air-terminal");
  await openPlace(page, place("lagos-air-terminal"));
  await page.getByTestId("enter-airport").click();
  await until(async () => (await state(page)).indoors, 15_000, "inside the terminal");
  await shot("travel-airport-los");
  await useSpot(page, at(-11.2, -3.5), "ticket desk");
  await page.getByTestId("buy-economy").click();
  await until(async () => (await travel()).ticket, 10_000, "ticket");
  expect(await balance()).toBe(start - 20_000 - 95_000);
  await page.getByTestId("ticket-desk").getByRole("button", { name: "Close" }).click();
  await useSpot(page, at(-11.2, 2.5), "check-in");
  await page.getByTestId("do-checkin").click();
  await until(async () => (await travel()).ticket?.outbound === "checked_in", 10_000, "checked in");
  await useSpot(page, at(0, 7.6), "gate");
  await page.getByTestId("do-board").click();
  await expect(page.getByTestId("flight-panel")).toBeVisible({ timeout: 15_000 });
  await shot("travel-cabin");
  // Land on the shared clock (10 s boarding + 60 s flight), no skipping.
  await until(async () => (await state(page)).location?.startsWith("airport:dxb") ?? false, 110_000, "landed in Dubai");
  await shot("travel-airport-dxb");

  // Arrival: immigration, baggage, out to the pickup.
  await useSpot(page, at(8, 2.2), "immigration");
  await page.getByTestId("do-immigration").click();
  await until(async () => (await travel()).ticket?.immigrationDone, 10_000, "immigration");
  await useSpot(page, at(11, -3.5), "baggage");
  await page.getByTestId("do-baggage").click();
  await expect(page.getByTestId("trip-hint")).toContainText("pickup", { timeout: 10_000 });
  await useSpot(page, at(0, -8.6), "exit");
  await until(async () => !(await state(page)).indoors, 15_000, "outside Dubai arrivals");

  // Hotel: book, check in, go up, room service.
  await spawnAt(page, "marina-sands-inn");
  let money = await balance();
  await openPlace(page, place("marina-sands-inn"));
  await page.getByTestId("book-standard").click();
  await until(async () => (await travel()).bookings.length > 0, 10_000, "booking");
  expect(await balance()).toBe(money - 6_000);
  await page.getByTestId("hotel-checkin").click();
  await expect(page.getByTestId("hotel-stay")).toContainText("Digital key", { timeout: 10_000 });
  await page.getByTestId("hotel-go-up").click();
  await until(async () => (await state(page)).location?.startsWith("hotel:") ?? false, 15_000, "in the hotel room");
  await shot("travel-hotel");
  money = await balance();
  await useSpot(page, at(2.6, 2.8), "room service");
  await page.getByTestId("order-karak-tea").click();
  await until(async () => (await balance()) === money - 1_200, 10_000, "room service charged once");
  await page.getByTestId("menu-room-service").getByRole("button", { name: "Close" }).click();

  // Waterfront activity: dhow cruise.
  await spawnAt(page, "marina-dhow-pier");
  money = await balance();
  await openPlace(page, place("marina-dhow-pier"), place("marina-dhow-pier").kerb);
  await page.getByTestId("book-dhow-cruise").click();
  await expect(page.getByTestId("excursion-panel")).toBeVisible({ timeout: 15_000 });
  await shot("travel-dhow");
  expect(await balance()).toBe(money - 12_000);
  await until(async () => (await state(page)).location === "street", 90_000, "back at the pier");
  expect((await travel()).activities.some((entry) => entry.activity === "dhow-cruise")).toBe(true);

  // Home: Dubai departures, check in, board, skip the flight.
  await spawnAt(page, "dubai-arrivals");
  await openPlace(page, place("dubai-arrivals"));
  await page.getByTestId("enter-airport").click();
  await until(async () => (await state(page)).location === "airport:dxb", 15_000, "Dubai departures");
  await useSpot(page, at(-11.2, 2.5), "check-in");
  await page.getByTestId("do-checkin").click();
  await until(async () => (await travel()).ticket?.return === "checked_in", 10_000, "checked in for home");
  await useSpot(page, at(-4, 7.6), "gate");
  await page.getByTestId("do-board").click();
  await expect(page.getByTestId("flight-panel")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("skip-flight").click();
  await until(async () => (await state(page)).location === "airport:los", 20_000, "home in Lagos");
  await shot("travel-home");
  expect(errors).toEqual([]);
});
