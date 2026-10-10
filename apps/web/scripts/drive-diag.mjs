// Dev diagnostic: enter the tester's car, drive to a target with the test autopilot and log the pose.
// Usage: node scripts/drive-diag.mjs <x> <z>
import { chromium } from "@playwright/test";

const [tx, tz] = process.argv.slice(2).map(Number);
const out = process.env.OUT ?? "/tmp";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  localStorage.setItem("lagos-quality", "low");
  localStorage.setItem("lagos-help-seen", "1");
});
const seenErrors = new Set();
page.on("pageerror", (error) => {
  if (seenErrors.has(error.message)) return;
  seenErrors.add(error.message);
  console.log("pageerror", error.stack);
});
await page.goto("http://localhost:5173/");
await page.waitForFunction(() => window.__lagos && document.querySelector("[data-testid=current-location]") && !document.querySelector(".loading-overlay"), null, { timeout: 150_000 });
await page.waitForTimeout(2000);
const mine = (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.mine);
console.log("vehicle", mine);
if (!mine) process.exit(1);
const door = [mine.x - Math.cos(mine.yaw) * 1.7, mine.z + Math.sin(mine.yaw) * 1.7];
console.log("walk", await page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, false, 30_000), door));
await page.evaluate((id) => window.__lagos.enterVehicle(id), mine.id);
await page.waitForTimeout(1500);
console.log("driving", await page.evaluate(() => window.__lagos.driving()));
await page.screenshot({ path: `${out}/drive-0.png` });
if (Number.isFinite(tx)) {
  const done = page.evaluate(([x, z]) => window.__lagos.driveTo(x, z, 90_000), [tx, tz]);
  for (let i = 0; i < 90; i += 1) {
    const result = await Promise.race([done.then((ok) => ({ ok })), page.waitForTimeout(1000).then(() => null)]);
    const d = await page.evaluate(() => window.__lagos.driving());
    console.log(i, d && `${d.x.toFixed(1)},${d.z.toFixed(1)} yaw ${d.yaw.toFixed(2)} v ${d.speed.toFixed(1)} cond ${d.condition}`);
    if (i % 10 === 0) await page.screenshot({ path: `${out}/drive-${i}.png` });
    if (result) {
      console.log("result", result);
      break;
    }
  }
}
await page.screenshot({ path: `${out}/drive-end.png` });
await page.evaluate(() => window.__lagos.exitVehicle());
await page.waitForTimeout(1500);
await browser.close();
