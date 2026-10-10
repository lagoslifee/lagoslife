import { Client } from "@colyseus/sdk";
import { expect, test, type Page } from "@playwright/test";
import { useLowGraphics, waitForGame } from "./helpers";

async function register(page: Page, prefix: string, password = "LocalTestPass!42") {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${prefix.toLowerCase()}-${unique}@example.test`;
  const playerName = `${prefix}${unique.slice(-7)}`;
  await useLowGraphics(page);
  await page.goto("/?manual=1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForGame(page);
  return { email, playerName, password };
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Settings/ }).click();
}

test("localhost enters the development account automatically", async ({ page }) => {
  await useLowGraphics(page);
  await page.goto("/");
  await waitForGame(page);
  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "Phone" })).toContainText("LocalTester");
});

test("registers, enters Lekki, and persists character appearance across sign-in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const account = await register(page, "Resident");
  await expect(page.getByTestId("wallet")).toContainText("₦250,000");
  await openSettings(page);
  await page.getByRole("button", { name: "Customise character" }).click();
  await page.getByLabel("Skin tone").selectOption("deep");
  await page.getByLabel("Hair").selectOption("braids");
  await page.getByLabel("Outfit").selectOption("ankara-day");
  await page.getByRole("button", { name: "Save character" }).click();

  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Enter Lagos" }).click();
  await waitForGame(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Customise character" }).click();
  await expect(page.getByLabel("Skin tone")).toHaveValue("deep");
  await expect(page.getByLabel("Hair")).toHaveValue("braids");
  await expect(page.getByLabel("Outfit")).toHaveValue("ankara-day");
  expect(errors).toEqual([]);
});

test("two residents see each other online and moving", async ({ browser }) => {
  test.setTimeout(300_000);
  const firstContext = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const secondContext = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await register(first, "First");
    await register(second, "Second");
    await expect(first.getByTestId("network")).toContainText(/[2-9] online/, { timeout: 20_000 });
    await expect(second.getByTestId("network")).toContainText(/[2-9] online/, { timeout: 20_000 });
    const before = await first.evaluate(() => window.__lagos.state());
    await first.evaluate(() => window.__lagos.key("KeyW", true));
    await first.waitForTimeout(2_500);
    await first.evaluate(() => window.__lagos.key("KeyW", false));
    const after = await first.evaluate(() => window.__lagos.state());
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test("multiplayer rejects unauthenticated room joins", async () => {
  await expect(new Client("http://localhost:2567").joinOrCreate("lagos", {})).rejects.toThrow();
});

test("completes password recovery through captured development email", async ({ page, request }) => {
  const account = await register(page, "Recover", "OldLocalPass!42");
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that account exists");

  type Inbox = { items: Array<{ id: string; to: Array<{ address: string }> }> };
  const findId = async () => {
    const inbox = (await (await request.get("http://localhost:8025/api/email/summary")).json()) as Inbox;
    return inbox.items.find((item) => item.to.some((recipient) => recipient.address === account.email))?.id;
  };
  await expect.poll(findId).toBeTruthy();
  const captured = (await (await request.get(`http://localhost:8025/api/email/${await findId()}`)).json()) as { text: string };
  const resetUrl = captured.text.match(/https?:\/\/\S+/)?.[0];
  expect(resetUrl).toBeTruthy();
  await page.goto(resetUrl!);
  await page.getByLabel("New password").fill("NewLocalPass!84");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("NewLocalPass!84");
  await page.getByRole("button", { name: "Enter Lagos" }).click();
  await waitForGame(page);
});
