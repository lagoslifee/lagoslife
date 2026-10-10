import { expect, type Page } from "@playwright/test";

export const API = "http://localhost:2567";

type Vec2 = [number, number];
type LagosHooks = {
  state(): { x: number; z: number; speed: number; location: string | null; busId: string | null; seat: number | null; indoors: boolean };
  buses(): Array<{ id: string; routeId: string; stopId: string | null; doorOpen: boolean; cx: number; cz: number }>;
  stops(): Array<{ id: string; name: string; alight: Vec2; routeId: string }>;
  places(): Array<{ id: string; name: string; kind: string; door: Vec2 }>;
  prompt(): { label: string; disabled?: boolean } | null;
  walkTo(x: number, z: number, sprint: boolean, timeoutMs: number): Promise<boolean>;
  walkDirect(x: number, z: number, timeoutMs: number): Promise<boolean>;
  interact(): void;
  requestStop(): void;
  key(code: string, down: boolean): void;
  setCamera(yaw: number, pitch?: number, distance?: number): void;
  setMaxFrameDt(seconds: number): void;
  fps(): number;
  vehicles(): Array<{ id: string; modelId: string; plate: string; mine: boolean; driverSessionId: string | null; x: number; z: number; yaw: number; cx: number; cz: number }>;
  driving(): { vehicleId: string; condition: number; x: number; z: number; speed: number } | null;
  enterVehicle(id: string): void;
  exitVehicle(): void;
  driveTo(x: number, z: number, timeoutMs?: number): Promise<boolean>;
  appearance(): Appearance | null;
  remoteAppearances(): Record<string, Appearance | null>;
  meshesNamed(prefix: string): Array<{ name: string; enabled: boolean; visible: boolean; centre: number[]; size: number[] }>;
};
type Appearance = { skinTone: string; hairstyle: string; outfit: string; accessory: string };
declare global {
  interface Window {
    __lagos: LagosHooks;
  }
}

/** Low graphics keeps software-rendered (GPU-less) runs fast enough to play in real time. */
export async function useLowGraphics(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("lagos-quality", "low");
    localStorage.setItem("lagos-help-seen", "1");
  });
}

export async function waitForGame(page: Page) {
  await page.waitForFunction(() => window.__lagos && document.querySelector("[data-testid=current-location]") && !document.querySelector(".loading-overlay"), null, { timeout: 150_000 });
  await expect(page.getByTestId("network")).toContainText("online", { timeout: 20_000 });
}

export async function apiGet<T>(page: Page, path: string) {
  return page.evaluate(async ([api, p]) => (await fetch(`${api}${p}`, { credentials: "include" })).json(), [API, path] as const) as Promise<T>;
}

export async function resetProgress(page: Page) {
  const status = await page.evaluate(async (api) => (await fetch(`${api}/api/dev/reset-progress`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" })).status, API);
  expect(status).toBe(200);
}

export const state = (page: Page) => page.evaluate(() => window.__lagos.state());
export const prompt = (page: Page) => page.evaluate(() => window.__lagos.prompt());

export async function walk(page: Page, point: Vec2, sprint = true) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ok = await page.evaluate(([x, z, s]) => window.__lagos.walkTo(x, z, s, 90_000), [point[0], point[1], sprint] as const);
    const here = await state(page);
    if (ok || Math.hypot(here.x - point[0], here.z - point[1]) < 2.5) return;
  }
  throw new Error(`Could not walk to ${point.join(",")}`);
}

export async function until<T>(fn: () => Promise<T>, timeout: number, label: string): Promise<NonNullable<T>> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
