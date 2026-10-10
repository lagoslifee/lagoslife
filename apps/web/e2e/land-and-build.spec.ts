import { expect, test } from "@playwright/test";
import { apiGet, apiPost, prompt, resetProgress, state, until, useLowGraphics, waitForGame, walk } from "./helpers";

type Economy = { balance: number; progress: Record<string, string> };
type Listing = { id: string; isMine: boolean; isHome: boolean; listingType: string; tenureType: string | null };

/**
 * A new player's first choice: the welcome offers rent, buy or build; choosing build sends them to free land,
 * where they lease a plot, pick a cottage and pay the builders stage by stage until it is their home.
 * Stage timers are skipped with the dev-only finish-stage endpoint; payments go through the UI.
 */
test("welcome → lease land → build a cottage stage by stage → move in → survives reload", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.addInitScript(() => sessionStorage.setItem("lagos-test-welcome", "1"));
  await useLowGraphics(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await waitForGame(page);
  await resetProgress(page);
  await page.evaluate(() => localStorage.removeItem("lagos-housing"));
  await page.reload();
  await waitForGame(page);
  const economy = () => apiGet<Economy>(page, "/api/economy");
  expect((await economy()).balance).toBe(250_000);

  const welcome = page.getByTestId("welcome");
  await expect(welcome).toBeVisible({ timeout: 20_000 });
  await expect(welcome).toContainText("Rent a flat");
  await expect(welcome).toContainText("Buy a house");
  await page.getByTestId("welcome-build").click();
  await expect(welcome).toBeHidden();
  const guide = page.getByTestId("objective");
  await expect(guide).toContainText(/Lease or buy Plot \d+/);
  const plotName = (await guide.innerText()).match(/Plot \d+/)![0];
  const plots = await page.evaluate(() => window.__lagos.plots());
  const plot = plots.find((entry) => entry.id === `lekki-plot-${plotName.split(" ")[1]}`)!;
  expect(plot.state?.status).toBe("available");

  await walk(page, plot.gate);
  await until(async () => (await prompt(page))?.label.includes("lease or buy land"), 8_000, "plot prompt");
  await page.getByTestId("prompt").click();
  const sheet = page.getByTestId("plot-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Lease ·/ }).click();
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(sheet.getByTestId("design-self-contain")).toBeVisible();
  expect((await economy()).balance).toBe(250_000 - 15_000);
  await expect(guide).toContainText("Choose a house to build");

  await sheet.getByTestId("design-self-contain").getByRole("button").click();
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(sheet.getByTestId("build-stages")).toBeVisible();
  expect((await economy()).balance).toBe(250_000 - 15_000 - 20_000);

  const fees = [25_000, 20_000, 15_000];
  for (const fee of fees) {
    expect((await apiPost(page, "/api/dev/finish-stage")).status).toBe(200);
    const pay = sheet.getByRole("button", { name: /^Pay builders/ });
    await expect(pay).toBeVisible({ timeout: 10_000 });
    const before = (await economy()).balance;
    await pay.click();
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await until(async () => (await economy()).balance === before - fee, 10_000, `stage fee ${fee}`);
  }
  expect((await apiPost(page, "/api/dev/finish-stage")).status).toBe(200);
  await expect(sheet.getByRole("button", { name: "Enter your house" })).toBeVisible({ timeout: 15_000 });
  const home = (await apiGet<Listing[]>(page, "/api/properties")).find((listing) => listing.listingType === "built" && listing.isMine)!;
  expect(home.id).toBe(`built-${plot.id}`);
  expect(home.isHome).toBe(true);
  expect(home.tenureType).toBe("owned");
  await sheet.getByRole("button", { name: "Enter your house" }).click();
  await until(async () => (await state(page)).indoors, 20_000, "being indoors");
  expect((await state(page)).location).toBe(`home:${home.id}`);

  await page.reload();
  await waitForGame(page);
  await expect(welcome).toBeHidden();
  const after = await until(() => page.evaluate((id) => window.__lagos.plots().find((entry) => entry.id === id)?.state, plot.id), 15_000, "plot state after reload");
  expect(after?.status).toBe("mine");
  expect(after?.construction?.completed).toBe(true);
  expect((await economy()).progress.first_built_home).toBeTruthy();
  expect(errors).toEqual([]);
});
