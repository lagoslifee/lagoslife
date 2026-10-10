import { expect, test, type Page } from "@playwright/test";
import { API, apiGet, resetProgress, useLowGraphics, waitForGame } from "./helpers";

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

async function devPost(page: Page, path: string, body: unknown = {}) {
  return page.evaluate(
    async ([api, p, b]) => {
      const response = await fetch(`${api}${p}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
      return { status: response.status, body: await response.json() };
    },
    [API, path, body] as const,
  );
}

async function say(page: Page, text: string) {
  await page.getByTestId("game-canvas").focus().catch(() => undefined);
  await page.keyboard.press("Enter");
  const input = page.getByLabel("Chat message");
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toBeHidden();
}

async function openPhoneApp(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Open phone" }).click();
  await page.getByRole("dialog", { name: "Phone" }).getByRole("button", { name }).click();
}

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

/** Milestone 8: chat, player safety tools and the moderation console, across two real browsers. */
test("chats nearby, filters contact details, reports, blocks, and a moderator mutes then suspends live", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const modContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const speakerContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const mod = await modContext.newPage();
  const speaker = await speakerContext.newPage();
  const errors: string[] = [];
  for (const page of [mod, speaker]) page.on("pageerror", (error) => errors.push(error.message));
  try {
    await useLowGraphics(mod);
    await mod.goto("/");
    await waitForGame(mod);
    await resetProgress(mod);
    expect((await devPost(mod, "/api/dev/staff", { role: "moderator" })).status).toBe(200);
    await mod.reload();
    await waitForGame(mod);

    const speakerName = await register(speaker, "Speaker");
    await expect(mod.getByTestId("network")).toContainText(/[2-9] online/, { timeout: 30_000 });

    await say(speaker, "Hello neighbour! Call me on 0803 555 1234");
    const heard = mod.getByTestId("chat-line").filter({ hasText: "Hello neighbour" });
    await expect(heard).toBeVisible({ timeout: 15_000 });
    await expect(heard).not.toContainText("0803");
    await expect(speaker.getByTestId("chat-line").filter({ hasText: "Hello neighbour" })).toBeVisible();
    await shot(mod, "m8-chat");

    await heard.getByRole("button", { name: `Actions for ${speakerName}` }).click();
    await heard.getByRole("button", { name: "Report" }).click();
    const dialog = mod.getByTestId("report-dialog");
    await dialog.getByLabel("Reason").selectOption("spam");
    await dialog.getByLabel(/What happened/).fill("Keeps posting a phone number");
    await shot(mod, "m8-report-dialog");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(mod.locator(".toast.success").filter({ hasText: "Report sent" })).toBeVisible();

    await mod.getByTestId("chat-line").filter({ hasText: "Hello neighbour" }).getByRole("button", { name: `Actions for ${speakerName}` }).click();
    await mod.getByRole("button", { name: "Block" }).click();
    await expect(mod.locator(".toast.success").filter({ hasText: "is blocked" })).toBeVisible();
    await expect(mod.getByTestId("chat-line").filter({ hasText: "Hello neighbour" })).toHaveCount(0);
    await say(speaker, "Can anyone hear me?");
    await expect(speaker.getByTestId("chat-line").filter({ hasText: "Can anyone hear me" })).toBeVisible();
    await mod.waitForTimeout(3_000);
    await expect(mod.getByTestId("chat-line").filter({ hasText: "Can anyone hear me" })).toHaveCount(0);

    await openPhoneApp(mod, /Safety/);
    const safety = mod.getByTestId("safety-app");
    await expect(safety).toContainText(speakerName);
    await safety.getByRole("button", { name: "Unblock" }).click();
    await expect(safety).toContainText("Nobody");
    await expect(safety.getByTestId("open-moderation")).toBeVisible();
    await mod.getByRole("button", { name: "Close phone" }).click();
    await speaker.waitForTimeout(800);
    await say(speaker, "Back again");
    await expect(mod.getByTestId("chat-line").filter({ hasText: "Back again" })).toBeVisible({ timeout: 15_000 });

    const consolePage = await modContext.newPage();
    consolePage.on("pageerror", (error) => errors.push(error.message));
    await consolePage.goto("/moderation");
    await expect(consolePage.getByTestId("moderation-console")).toBeVisible({ timeout: 30_000 });
    const report = consolePage.getByTestId("mod-report").filter({ hasText: speakerName });
    await expect(report).toContainText("Call me on 0803 555 1234");
    await expect(report).toContainText("Keeps posting a phone number");
    await shot(consolePage, "m8-moderation-reports");
    await report.getByRole("button", { name: "Review resident" }).click();
    const record = consolePage.getByTestId("mod-resident");
    await expect(record).toContainText("Can anyone hear me?");

    const form = consolePage.getByTestId("mod-action-form");
    await form.getByLabel("Action").selectOption("mute");
    await form.getByLabel(/Duration/).fill("1");
    await form.getByLabel(/Reason/).fill("Sharing phone numbers in chat");
    await form.getByRole("button", { name: /Apply/ }).click();
    await expect(consolePage.getByTestId("mod-message")).toContainText("Mute chat applied");
    await expect(speaker.locator(".toast").filter({ hasText: "muted your chat" })).toBeVisible({ timeout: 10_000 });
    await say(speaker, "Am I muted?");
    await expect(speaker.locator(".toast").filter({ hasText: "muted your chat" }).last()).toBeVisible();
    await mod.waitForTimeout(2_000);
    await expect(mod.getByTestId("chat-line").filter({ hasText: "Am I muted" })).toHaveCount(0);

    await form.getByLabel("Action").selectOption("suspend");
    await form.getByLabel(/Duration/).fill("24");
    await form.getByLabel(/Reason/).fill("Repeated spam after a mute");
    await form.getByRole("button", { name: /Apply/ }).click();
    await expect(consolePage.getByTestId("mod-message")).toContainText("Suspend account applied");
    await expect(speaker.getByTestId("suspended-screen")).toBeVisible({ timeout: 15_000 });
    await expect(speaker.getByTestId("suspended-screen")).toContainText("Repeated spam after a mute");
    await shot(speaker, "m8-suspended");
    await speaker.reload();
    await expect(speaker.getByTestId("suspended-screen")).toBeVisible({ timeout: 15_000 });
    const token = await speaker.evaluate(async (api) => (await fetch(`${api}/api/multiplayer-token`, { method: "POST", credentials: "include" })).status, API);
    expect(token).toBe(403);

    await consolePage.getByRole("tab", { name: "Audit" }).click();
    const audit = consolePage.getByTestId("mod-audit");
    await expect(audit).toContainText("Repeated spam after a mute");
    await expect(audit).toContainText("Sharing phone numbers in chat");
    await shot(consolePage, "m8-moderation-audit");
    await consolePage.getByRole("tab", { name: "Reports" }).click();
    await consolePage.getByRole("button", { name: "actioned" }).click();
    await expect(consolePage.getByTestId("mod-report").filter({ hasText: speakerName })).toContainText("mute: Sharing phone numbers");
    expect(errors).toEqual([]);
  } finally {
    await devPost(mod, "/api/dev/staff", { role: null }).catch(() => undefined);
    await modContext.close();
    await speakerContext.close();
  }
});

type Citation = { id: string; status: string; fine: number };

test("files an appeal that another moderator overturns, and pays a second fine once", async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const residentContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const wardenContext = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const resident = await residentContext.newPage();
  const warden = await wardenContext.newPage();
  try {
    await useLowGraphics(resident);
    await resident.goto("/");
    await waitForGame(resident);
    await resetProgress(resident);
    await resident.reload();
    await waitForGame(resident);
    const issued = await devPost(resident, "/api/dev/citation");
    expect(issued.status).toBe(200);

    await openPhoneApp(resident, /Justice/);
    const justice = resident.getByTestId("justice-app");
    const ticket = justice.getByTestId("citation").first();
    await expect(ticket).toContainText("Careless driving · ₦2,500");
    await expect(ticket).toContainText("Unpaid");
    await ticket.getByRole("button", { name: "Appeal" }).click();
    await ticket.getByLabel("Appeal statement").fill("A danfo pulled out in front of me without warning.");
    await ticket.getByRole("button", { name: "File appeal" }).click();
    await expect(ticket).toContainText("Appeal under review");
    await expect(ticket.getByRole("button", { name: /Pay/ })).toHaveCount(0);
    await shot(resident, "m8-justice-appeal");

    await register(warden, "Warden");
    expect((await devPost(warden, "/api/dev/staff", { role: "moderator" })).status).toBe(200);
    await warden.goto("/moderation");
    await warden.getByRole("tab", { name: "Appeals" }).click();
    const appeal = warden.getByTestId("mod-appeal").filter({ hasText: "LocalTester" });
    await expect(appeal).toContainText("A danfo pulled out in front of me");
    await appeal.getByLabel("Decision note").fill("Dashcam shows the danfo cut in.");
    await shot(warden, "m8-moderation-appeal");
    await appeal.getByRole("button", { name: "Overturn" }).click();
    await expect(warden.getByTestId("mod-message")).toContainText("Appeal overturned");

    await resident.getByRole("button", { name: "Back" }).click();
    await resident.getByRole("dialog", { name: "Phone" }).getByRole("button", { name: /Justice/ }).click();
    await expect(justice.getByTestId("citation").first()).toContainText("Overturned on appeal");
    await expect(justice.getByTestId("citation").first()).toContainText("Dashcam shows the danfo cut in.");

    await resetProgress(resident);
    await resident.reload();
    await waitForGame(resident);
    expect((await devPost(resident, "/api/dev/citation")).status).toBe(200);
    const before = (await apiGet<{ balance: number }>(resident, "/api/economy")).balance;
    await openPhoneApp(resident, /Justice/);
    await justice.getByTestId("citation").first().getByRole("button", { name: "Pay ₦2,500" }).dblclick();
    await expect(justice.getByTestId("citation").first()).toContainText("Paid");
    const after = (await apiGet<{ balance: number }>(resident, "/api/economy")).balance;
    expect(before - after).toBe(2_500);
    const citations = await apiGet<Citation[]>(resident, "/api/justice");
    expect(citations.map(({ status }) => status)).toEqual(["paid"]);
  } finally {
    await devPost(warden, "/api/dev/staff", { role: null }).catch(() => undefined);
    await residentContext.close();
    await wardenContext.close();
  }
});
