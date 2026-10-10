import { expect, test, type Page } from "@playwright/test";
import { Client } from "@colyseus/sdk";

async function registerResident(page: Page, prefix: string) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${prefix}-${unique}@example.test`;
  const playerName = `${prefix}${unique.slice(-7)}`;
  await page.goto("/?manual=1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("NetworkPass!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Ikoyi Preview")).toBeVisible();
  await expect(page.getByText("Loading resident…")).toBeHidden();
  return { email, playerName };
}

test("registers, renders Lagos, and persists character appearance", async ({ page }) => {
  const unique = Date.now().toString(36);
  const email = `resident-${unique}@example.test`;
  const playerName = `Resident${unique.slice(-7)}`;
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?manual=1");
  await expect(page.getByRole("heading", { name: /live lagos/i })).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalTestPass!42");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Ikoyi Preview")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Customise character" }).click();
  await page.getByLabel("Skin tone").selectOption("deep");
  await page.getByLabel("Hair").selectOption("braids");
  await page.getByLabel("Outfit").selectOption("ankara-day");
  await page.getByRole("button", { name: "Save character" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalTestPass!42");
  await page.getByRole("button", { name: "Enter Lagos" }).click();
  await page.getByRole("button", { name: "Customise character" }).click();
  await expect(page.getByLabel("Skin tone")).toHaveValue("deep");
  await expect(page.getByLabel("Hair")).toHaveValue("braids");
  await expect(page.getByLabel("Outfit")).toHaveValue("ankara-day");
  await page.getByRole("button", { name: "Cancel" }).click();

  const position = page.getByTestId("player-position");
  await expect(position).toBeVisible();
  await expect(page.getByText("Loading resident…")).toBeHidden();
  await expect(page.getByTestId("multiplayer-status")).toContainText("online");
  await page.getByRole("button", { name: /game naira/i }).click();
  await expect(page.getByRole("heading", { name: "Falomo Corner Shop" })).toBeVisible();
  const water = page.locator(".catalogue-grid article").filter({ hasText: "Chilled Water" });
  await water.getByRole("button", { name: /Buy/ }).click();
  await expect(
    page.locator(".economy-columns .economy-section").first().getByText("Chilled Water"),
  ).toBeVisible();
  await expect(page.locator(".economy-columns .economy-section").first()).toContainText("×1");
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Deliver to the gold marker")).toBeVisible();
  await page.getByRole("button", { name: "Close wallet" }).click();
  const start = await position.textContent();
  await page.keyboard.down("w");
  await expect(page.locator("canvas")).toHaveAttribute("data-last-input", "forward:down");
  await expect(page.locator("canvas")).toHaveAttribute("data-telemetry", /Walking/);
  await page.keyboard.up("w");
  await expect.poll(() => position.textContent()).not.toBe(start);
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await expect(page.getByText("Idle", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStart = await position.textContent();
  const forward = page.getByRole("button", { name: "Move forward" });
  await forward.dispatchEvent("pointerdown", { pointerId: 1 });
  await page.waitForTimeout(500);
  await forward.dispatchEvent("pointerup", { pointerId: 1 });
  await expect.poll(() => position.textContent()).not.toBe(mobileStart);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.screenshot({
    path: "/opt/cursor/artifacts/lagos-living-milestone-2.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("localhost enters the development account automatically", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Ikoyi Preview")).toBeVisible();
  await expect(page.locator(".profile-menu strong")).toHaveText("LocalTester");
});

test("two authenticated residents share authoritative movement", async ({ browser }) => {
  test.setTimeout(120_000);
  const firstContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const secondContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await Promise.all([
      registerResident(first, "First"),
      registerResident(second, "Second"),
    ]);
    await first.getByLabel("Graphics").selectOption("low");
    await second.getByLabel("Graphics").selectOption("low");
    await expect(first.getByTestId("multiplayer-status")).toContainText("2 online");
    await expect(second.getByTestId("multiplayer-status")).toContainText("2 online");

    const secondStatus = second.getByTestId("multiplayer-status");
    await expect(secondStatus).not.toHaveAttribute("data-remote-position", "");
    const before = await secondStatus.getAttribute("data-remote-position");
    await first.keyboard.down("w");
    await first.waitForTimeout(900);
    await first.keyboard.up("w");
    await expect.poll(() => secondStatus.getAttribute("data-remote-position")).not.toBe(before);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test("multiplayer rejects unauthenticated room joins", async () => {
  await expect(new Client("http://localhost:2567").joinOrCreate("lagos", {})).rejects.toThrow();
});

test("completes password recovery through captured development email", async ({ page, request }) => {
  const unique = `${Date.now().toString(36)}r`;
  const email = `recovery-${unique}@example.test`;
  const playerName = `Recover${unique.slice(-7)}`;
  await page.goto("/?manual=1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Player name").fill(playerName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("OldLocalPass!42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Ikoyi Preview")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that account exists");

  await expect.poll(async () => {
    const response = await request.get("http://localhost:8025/api/email/summary");
    const inbox = (await response.json()) as {
      items: Array<{ id: string; to: Array<{ address: string }> }>;
    };
    return inbox.items.find((item) => item.to.some((recipient) => recipient.address === email))?.id;
  }).toBeTruthy();

  const summary = (await (await request.get("http://localhost:8025/api/email/summary")).json()) as {
    items: Array<{ id: string; to: Array<{ address: string }> }>;
  };
  const id = summary.items.find((item) =>
    item.to.some((recipient) => recipient.address === email),
  )!.id;
  const captured = (await (await request.get(`http://localhost:8025/api/email/${id}`)).json()) as {
    text: string;
  };
  const resetUrl = captured.text.match(/https?:\/\/\S+/)?.[0];
  expect(resetUrl).toBeTruthy();
  await page.goto(resetUrl!);
  await page.getByLabel("New password").fill("NewLocalPass!84");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("NewLocalPass!84");
  await page.getByRole("button", { name: "Enter Lagos" }).click();
  await expect(page.getByText("Ikoyi Preview")).toBeVisible();
});
