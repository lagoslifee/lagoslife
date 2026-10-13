import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on("pageerror", (e) => console.log("ERR", e.message)); page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
const views = JSON.parse(process.env.VIEWS);
for (const [name, q] of Object.entries(views)) {
  await page.goto(`http://localhost:5199/preview/${process.env.PAGE ?? "index"}.html?${q}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 25000 });
  await page.screenshot({ path: `/tmp/${name}-${Date.now()}.png` });
}
await browser.close();
