import { expect, test, type Page } from "@playwright/test";

const API = process.env.SMOKE_API_URL!;

async function register(page: Page, prefix: string, path = "/?manual=1") {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const playerName = `${prefix}${unique.slice(-7)}`;
  await page.addInitScript(() => {
    localStorage.setItem("lagos-quality", "low");
    localStorage.setItem("lagos-help-seen", "1");
  });
  await page.goto(path);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(`${prefix.toLowerCase()}-${unique}@example.test`);
  await page.getByLabel("Password").fill("SmokeTestPass!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await inWorld(page);
  return playerName;
}

async function inWorld(page: Page) {
  await expect(page.getByTestId("current-location")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator(".loading-overlay")).toHaveCount(0, { timeout: 150_000 });
  await expect(page.getByTestId("network")).toContainText("online", { timeout: 30_000 });
}

test("production build: sign up, enter Lekki, chat with a neighbour, session survives reload", async ({ browser, request }) => {
  const errors: string[] = [];
  const first = await (await browser.newContext()).newPage();
  const second = await (await browser.newContext()).newPage();
  for (const page of [first, second]) page.on("pageerror", (error) => errors.push(error.message));

  // Plain "/" on localhost tries the development sign-in first; production must refuse it and show the form.
  await register(first, "Smoke", "/");
  await register(second, "Smoke");
  expect(await first.evaluate(() => "__lagos" in window)).toBe(false);
  await expect(first.getByTestId("wallet")).toContainText("₦");
  await expect(first.getByTestId("network")).toContainText(/[2-9]\d* online/, { timeout: 30_000 });

  await second.keyboard.press("Enter");
  const input = second.getByLabel("Chat message");
  await expect(input).toBeFocused();
  await input.fill("Production smoke hello, ring 0803 555 1234");
  await input.press("Enter");
  const heard = first.getByTestId("chat-line").filter({ hasText: "Production smoke hello" });
  await expect(heard).toBeVisible({ timeout: 15_000 });
  await expect(heard).not.toContainText("0803");

  await first.reload();
  await inWorld(first);

  for (const path of ["/api/dev/sign-in", "/api/dev/reset-progress", "/api/dev/staff", "/api/dev/citation", "/api/dev/spawn-at"]) {
    expect((await request.post(`${API}${path}`, { data: {} })).status(), path).toBe(404);
  }
  const html = await (await request.get("/")).text();
  const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(script).toBeTruthy();
  expect((await request.get(script!)).headers()["cache-control"]).toContain("immutable");
  expect((await request.get("/")).headers()["cache-control"]).toBe("no-cache");
  expect(errors).toEqual([]);
});
