// Dev diagnostic: load the streamed world, log tile stats, then drive the tester's car through waypoints.
// Usage: node scripts/world-diag.mjs [x,z ...]
import { chromium } from "@playwright/test";

const waypoints = process.argv.slice(2).map((arg) => arg.split(",").map(Number));
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
page.on("console", (message) => {
  if (message.type() === "error") console.log("console.error", message.text());
});
const started = Date.now();
await page.goto("http://localhost:5173/");
await page.waitForFunction(() => window.__lagos && document.querySelector("[data-testid=current-location]") && !document.querySelector(".loading-overlay"), null, { timeout: 150_000 });
console.log("ready after", Date.now() - started, "ms");
await page.waitForTimeout(2000);
const report = async (label) => {
  const stats = await page.evaluate(() => window.__lagos.stats());
  const where = await page.evaluate(() => window.__lagos.state());
  const location = await page.evaluate(() => document.querySelector("[data-testid=current-location]")?.textContent);
  console.log(label, JSON.stringify({ x: where.x.toFixed(1), z: where.z.toFixed(1), location, tiles: stats.tiles, tileBuildMs: stats.tileBuildMs, fps: stats.fps, drawCalls: stats.drawCalls, meshes: stats.totalMeshes, cpu: stats.cpuFrameMs }));
};
await report("spawn");
await page.screenshot({ path: `${out}/world-spawn.png` });
if (waypoints.length) {
  const mine = (await page.evaluate(() => window.__lagos.vehicles())).find((v) => v.mine);
  if (!mine) throw new Error("tester has no car");
  const door = [mine.x - Math.cos(mine.yaw) * 1.7, mine.z + Math.sin(mine.yaw) * 1.7];
  await page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, false, 60_000), door);
  await page.evaluate((id) => window.__lagos.enterVehicle(id), mine.id);
  await page.waitForTimeout(1500);
  for (const [index, [x, z]] of waypoints.entries()) {
    const done = page.evaluate(([tx, tz]) => window.__lagos.driveTo(tx, tz, 240_000), [x, z]);
    let ok = null;
    for (let second = 0; second < 250 && ok === null; second += 1) {
      ok = await Promise.race([done, page.waitForTimeout(1000).then(() => null)]);
      if (second % 15 === 0) await report(`  leg ${index} t${second}`);
    }
    await report(`leg ${index} -> ${x},${z} ok=${ok}`);
    await page.screenshot({ path: `${out}/world-leg-${index}.png` });
  }
}
await browser.close();
