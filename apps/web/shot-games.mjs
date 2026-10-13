import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 760 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto("http://localhost:5199/preview/games.html");
await page.waitForFunction(() => window.ready);
await page.getByText("1 vs computer").click();
for (let i = 0; i < 14; i++) {
  const roll = page.getByRole("button", { name: "Roll" });
  if (await roll.isEnabled()) await roll.click();
  await page.waitForTimeout(500);
  const pick = page.locator(".ludo-pick").first();
  if (await pick.count()) await pick.click({ force: true });
  await page.waitForTimeout(1600);
}
await page.screenshot({ path: "/tmp/ludo.png" });
await page.getByRole("tab", { name: /Pool/ }).click();
await page.waitForTimeout(300);
const box = await page.locator(".pool-table").boundingBox();
await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
await page.screenshot({ path: "/tmp/pool-aim.png" });
await page.getByRole("button", { name: "Shoot" }).click();
await page.waitForTimeout(7000);
await page.screenshot({ path: "/tmp/pool-after.png" });
console.log(await page.locator(".pool p.muted").textContent());
await browser.close();
