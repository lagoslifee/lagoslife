import { expect, test, type Page } from "@playwright/test";
import { API, apiGet, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Place = { id: string; name: string; kind: string; door: [number, number]; kerb: [number, number] };
type Economy = { balance: number; needs: { hunger: number; energy: number } };

const BAR: [number, number] = [4996.3, 5000.4];
const FLOOR: [number, number] = [5000.4, 5000.7];
const TABLE_2: [number, number] = [5003.3, 4999.8];

async function spawnAt(page: Page, placeId: string) {
  const status = await page.evaluate(
    async ([api, id]) => (await fetch(`${api}/api/dev/spawn-at`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ placeId: id }) })).status,
    [API, placeId] as const,
  );
  expect(status).toBe(200);
  await page.reload();
  await waitForGame(page);
}

const walkInside = (page: Page, point: [number, number]) => page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 30_000), point);

test("pays the cover at Eko Nights, orders at the bar and dances", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name: string) => {
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  };
  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await spawnAt(page, "eko-nights");

  const places = (await page.evaluate(() => window.__lagos.places())) as Place[];
  const club = places.find((place) => place.id === "eko-nights")!;
  expect(club.kind).toBe("club");
  await walk(page, club.door);
  await until(async () => (await prompt(page))?.label.startsWith("Enter club"), 8_000, "club prompt");
  await shot("club-outside");
  const before = (await apiGet<Economy>(page, "/api/economy")).balance;
  await page.evaluate(() => window.__lagos.interact());
  const door = page.getByTestId("club-door");
  await expect(door).toContainText("DJ Kemi");
  await door.getByRole("button", { name: "Pay ₦3,500 and go in" }).click();
  await until(async () => (await state(page)).indoors, 15_000, "inside the club");
  expect((await apiGet<Economy>(page, "/api/economy")).balance).toBe(before - 3_500);
  await until(async () => (await page.evaluate(() => window.__lagos.meshesNamed("club floor"))).length > 0, 10_000, "dance floor");
  await shot("club-inside");

  await walkInside(page, BAR);
  await until(async () => (await prompt(page))?.label === "Order at the bar", 8_000, "bar prompt");
  await page.evaluate(() => window.__lagos.interact());
  const bar = page.getByTestId("club-bar");
  await bar.locator("li", { hasText: "Chapman" }).getByRole("button").click();
  await expect(page.getByText(/Chapman, ₦1,200/)).toBeVisible();
  await bar.getByRole("button", { name: "Close" }).click();
  await shot("club-bar");

  await walkInside(page, FLOOR);
  await until(async () => (await prompt(page))?.label === "Dance", 8_000, "dance prompt");
  await page.evaluate(() => window.__lagos.interact());
  await page.waitForTimeout(1_500);
  await shot("club-dance");

  await walkInside(page, TABLE_2);
  await until(async () => (await prompt(page))?.label === "VIP table 2", 8_000, "table prompt");
  await page.evaluate(() => window.__lagos.interact());
  const table = page.getByTestId("club-table");
  await table.getByRole("button", { name: "Book for ₦60,000" }).click();
  await expect(table.getByTestId("table-owner")).toContainText("Your table while you're here");
  await table.locator("li", { hasText: "Moët" }).getByRole("button").click();
  await expect(page.getByText(/on its way to table 2/)).toBeVisible();
  await table.getByRole("button", { name: "Close" }).click();
  await until(async () => (await page.evaluate(() => window.__lagos.meshesNamed("bottle "))).length > 0, 20_000, "bottle on the table");
  await shot("club-table");

  // Leaving and coming back the same night is free.
  await walkInside(page, [5000, 4996.1]);
  await until(async () => (await prompt(page))?.label === "Leave", 8_000, "exit prompt");
  await page.evaluate(() => window.__lagos.interact());
  await until(async () => !(await state(page)).indoors, 15_000, "back on the street");
  await until(async () => (await prompt(page))?.label.startsWith("Enter club"), 8_000, "club prompt again");
  await page.evaluate(() => window.__lagos.interact());
  await expect(page.getByTestId("club-door")).toContainText("tonight's wristband");
  await page.getByRole("button", { name: "Go inside" }).click();
  await until(async () => (await state(page)).indoors, 15_000, "back inside");
  expect(errors).toEqual([]);
});
