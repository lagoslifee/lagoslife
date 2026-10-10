#!/usr/bin/env node
// Drives the running dev game in headless Chrome to capture evidence screenshots and measure
// real-time movement. Usage (dev servers running):
//   STEPS=straight MAXDT=1 QUALITY=low W=640 H=400 node scripts/playtest-capture.mjs
//   STEPS=shots,junction,danfo,home QUALITY=medium MAXDT=1 node scripts/playtest-capture.mjs
// Steps: reset, speed, straight, shots, junction, danfo, home, view. OUT sets the output folder.
// MAXDT raises the frame-time clamp for GPU-less machines; leave it unset on real hardware.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const quality = process.env.QUALITY ?? "low";
const steps = (process.env.STEPS ?? "reset,speed,shots,junction").split(",");
const out = process.env.OUT ?? "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) } });
page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") console.log(`[error] ${m.text().slice(0, 300)}`); });
await page.addInitScript((q) => { localStorage.setItem("lagos-quality", q); localStorage.setItem("lagos-help-seen", "1"); }, quality);

async function ready() {
  await page.waitForFunction(() => window.__lagos && document.querySelector("[data-testid=current-location]") && !document.querySelector(".loading-overlay"), null, { timeout: 150000 });
  await page.waitForTimeout(2500);
}
const hud = async () => page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, " | "));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await page.goto("http://localhost:5173/");
await ready();
log("stats", JSON.stringify(await page.evaluate(() => window.__lagos.stats())));
if (process.env.MAXDT) await page.evaluate((v) => window.__lagos.setMaxFrameDt(v), Number(process.env.MAXDT));

if (steps.includes("reset")) {
  const r = await page.evaluate(async () => (await fetch("http://localhost:2567/api/dev/reset-progress", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" })).status);
  log("reset status", r);
  await page.reload();
  await ready();
  log("after reset", await hud());
}

async function measured(fn) {
  await page.evaluate(() => {
    window.__samples = [];
    window.__sampler = setInterval(() => { const s = window.__lagos.state(); window.__samples.push({ t: performance.now(), x: s.x, z: s.z, v: s.speed }); }, 50);
  });
  const result = await fn();
  const samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
  return { result, samples };
}

function summarise(label, samples) {
  // Steady-state speed: displacement over sliding 1 s windows where the reported speed is near its max.
  const vmax = Math.max(...samples.map((s) => s.v));
  const steady = samples.filter((s) => s.v > vmax * 0.97);
  let dist = 0;
  let time = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].v > vmax * 0.97 && samples[i - 1].v > vmax * 0.97) {
      dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      time += (samples[i].t - samples[i - 1].t) / 1000;
    }
  }
  const avg = dist / time;
  log(`${label}: steady samples ${steady.length}, measured ground speed ${avg.toFixed(2)} m/s over ${dist.toFixed(1)} m → 30 m in ${(30 / avg).toFixed(2)} s (+ ~0.1 s acceleration)`);
}

if (steps.includes("speed")) {
  if (process.env.MAXDT) await page.evaluate((v) => window.__lagos.setMaxFrameDt(v), Number(process.env.MAXDT));
  const fps = await page.evaluate(() => window.__lagos.fps());
  log("fps", fps.toFixed(1));
  const start = await page.evaluate(() => window.__lagos.state());
  const stops = await page.evaluate(() => window.__lagos.stops());
  const nearest = stops.map((s) => ({ ...s, d: Math.hypot(s.alight[0] - start.x, s.alight[1] - start.z) })).sort((a, b) => a.d - b.d)[0];
  log("walking to", nearest.name, nearest.d.toFixed(1), "m");
  const jog = await measured(() => page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, false, 120000), nearest.alight));
  log("arrived", jog.result);
  summarise("jog", jog.samples);
  const far = stops.map((s) => ({ ...s, d: Math.hypot(s.alight[0] - nearest.alight[0], s.alight[1] - nearest.alight[1]) })).filter((s) => s.d > 60).sort((a, b) => a.d - b.d)[0];
  log("sprinting to", far.name, far.d.toFixed(1), "m");
  const sprint = await measured(() => page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, true, 120000), far.alight));
  log("arrived", sprint.result);
  summarise("sprint", sprint.samples);
  log("fps", (await page.evaluate(() => window.__lagos.fps())).toFixed(1));
  log("hud", await hud());
}

if (steps.includes("straight")) {
  if (process.env.MAXDT) await page.evaluate((v) => window.__lagos.setMaxFrameDt(v), Number(process.env.MAXDT));
  for (const [label, sprint, yaw] of [["jog", false, Math.PI / 2], ["sprint", true, -Math.PI / 2], ["walk", "walk", Math.PI / 2]]) {
    const result = await page.evaluate(async ([sprint, yaw]) => {
      const L = window.__lagos;
      L.setCamera(yaw, 0.3, 5);
      await new Promise((r) => setTimeout(r, 1500));
      const start = L.state();
      if (sprint === "walk") { L.key("KeyC", true); L.key("KeyC", false); }
      if (sprint === true) L.key("ShiftLeft", true);
      L.key("KeyW", true);
      const t0 = performance.now();
      let maxLateral = 0;
      let state = start;
      while (performance.now() - t0 < 40000) {
        await new Promise((r) => setTimeout(r, 16));
        state = L.state();
        if (Math.hypot(state.x - start.x, state.z - start.z) >= 30) break;
      }
      const t = (performance.now() - t0) / 1000;
      L.key("KeyW", false);
      L.key("ShiftLeft", false);
      if (sprint === "walk") { L.key("KeyC", true); L.key("KeyC", false); }
      await new Promise((r) => setTimeout(r, 800));
      return { t, d: Math.hypot(state.x - start.x, state.z - start.z), fps: L.fps(), start, end: state };
    }, [sprint, yaw]);
    log(`${label} straight: ${result.d.toFixed(2)} m in ${result.t.toFixed(2)} s (fps ${result.fps.toFixed(1)}) from (${result.start.x.toFixed(1)},${result.start.z.toFixed(1)}) to (${result.end.x.toFixed(1)},${result.end.z.toFixed(1)})`);
  }
}

if (steps.includes("shots")) {
  await page.screenshot({ path: `${out}/street-${quality}.png` });
  await page.locator("[data-testid=current-location]").screenshot({ path: `${out}/current-location.png` });
  await page.locator("[data-testid=minimap]").screenshot({ path: `${out}/minimap.png` });
  log("shots saved");
}

if (steps.includes("junction")) {
  const state = await page.evaluate(() => window.__lagos.state());
  const junctions = await page.evaluate(() => window.__lagos.junctions());
  const pick = junctions.map((j) => ({ ...j, d: Math.hypot(j.point[0] - state.x, j.point[1] - state.z) })).sort((a, b) => a.d - b.d)[0];
  log("junction", pick.names.join(" × "), pick.d.toFixed(1), "m");
  const ok = await page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, true, 120000), pick.point);
  const here = await page.evaluate(() => window.__lagos.state());
  // Step back from the pole and look at it.
  const away = Math.atan2(here.x - pick.point[0], here.z - pick.point[1]);
  log("at junction", ok, JSON.stringify(here));
  await page.evaluate(([x, z]) => window.__lagos.walkDirect(x, z, 8000), [pick.point[0] + Math.sin(away) * 5, pick.point[1] + Math.cos(away) * 5]);
  const pos = await page.evaluate(() => window.__lagos.state());
  const yaw = Math.atan2(pick.point[0] - pos.x, pick.point[1] - pos.z);
  await page.evaluate((y) => window.__lagos.setCamera(y, 0.05, 3.2), yaw);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/junction-sign-${quality}.png` });
  log("junction shot", await hud());
}

if (steps.includes("danfo")) {
  const here = await page.evaluate(() => window.__lagos.state());
  const stops = await page.evaluate(() => window.__lagos.stops());
  const stop = stops.map((s) => ({ ...s, d: Math.hypot(s.alight[0] - here.x, s.alight[1] - here.z) })).sort((a, b) => a.d - b.d)[0];
  await page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, true, 120000), stop.alight);
  // Step back from the kerb so the whole bus fits in frame.
  const t0 = Date.now();
  let bus = null;
  while (Date.now() - t0 < 300000) {
    bus = (await page.evaluate(() => window.__lagos.buses())).find((b) => b.stopId === stop.id && b.doorOpen);
    if (bus) break;
    await page.waitForTimeout(500);
  }
  if (bus) {
    const pos = await page.evaluate(() => window.__lagos.state());
    const yaw = Math.atan2(bus.cx - pos.x, bus.cz - pos.z) + 0.35;
    await page.evaluate((y) => window.__lagos.setCamera(y, 0.12, 7.5), yaw);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/danfo-at-stop-${quality}.png` });
    log("danfo shot", bus.id);
  } else log("no danfo arrived");
}

if (steps.includes("home")) {
  const flat = (await page.evaluate(() => window.__lagos.places())).find((p) => p.id === "lekki-adebayo-flat-2");
  await page.evaluate(([x, z]) => window.__lagos.walkTo(x, z, true, 120000), flat.door);
  const pos = await page.evaluate(() => window.__lagos.state());
  await page.evaluate((y) => window.__lagos.setCamera(y, 0.15, 5.5), Math.atan2(flat.door[0] - pos.x, flat.door[1] - pos.z) + Math.PI + 0.6);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/rental-sign-${quality}.png` });
  await page.evaluate(() => window.__lagos.interact());
  await page.getByText("Total upfront").or(page.getByText("You rent this")).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/rental-sheet-${quality}.png` });
  const enter = page.getByRole("button", { name: "Enter home" });
  if (await enter.isVisible()) {
    await enter.click();
    await page.waitForFunction(() => window.__lagos.state().indoors, null, { timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${out}/home-interior-${quality}.png` });
    log("interior shot");
  }
}

if (steps.includes("view")) {
  const [yaw, pitch, dist] = (process.env.CAM ?? "0,0.3,5").split(",").map(Number);
  await page.evaluate(([y, p, d]) => window.__lagos.setCamera(y, p, d), [yaw, pitch, dist]);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${process.env.NAME ?? "view"}.png` });
}
await browser.close();
