import { defineConfig } from "@playwright/test";

/**
 * Smoke test for a production build (static web behind nginx plus the bundled server), driven only through the
 * page: production bundles do not ship the development test hooks.
 *
 *   SMOKE_WEB_URL=http://localhost:8080 SMOKE_API_URL=http://localhost:2600 npm run test:e2e:prod -w @lagos-living/web
 */
const web = process.env.SMOKE_WEB_URL;
if (!web || !process.env.SMOKE_API_URL) throw new Error("Set SMOKE_WEB_URL and SMOKE_API_URL");

export default defineConfig({
  testDir: "./e2e-prod",
  timeout: 300_000,
  workers: 1,
  use: {
    baseURL: web,
    channel: "chrome",
    headless: true,
    viewport: { width: 1100, height: 700 },
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
});
