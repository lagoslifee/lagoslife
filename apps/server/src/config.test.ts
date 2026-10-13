import { describe, expect, it } from "vitest";
import { originMatcher, parseConfig } from "./config.js";

const production = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "a".repeat(64),
  WEB_ORIGIN: "https://play.example.com",
  BETTER_AUTH_URL: "https://api.example.com",
};

describe("production configuration", () => {
  it("accepts https origins with a unique secret", () => {
    const config = parseConfig({ ...production, TRUSTED_PROXIES: " 10.0.0.0/8, 127.0.0.1 ", SMTP_SECURE: "true" });
    expect(config.TRUSTED_PROXIES).toEqual(["10.0.0.0/8", "127.0.0.1"]);
    expect(config.SMTP_SECURE).toBe(true);
  });

  it("refuses the development secret", () => {
    const { BETTER_AUTH_SECRET: _secret, ...rest } = production;
    expect(() => parseConfig(rest)).toThrow(/unique BETTER_AUTH_SECRET/);
  });

  it("refuses plain http origins other than localhost", () => {
    expect(() => parseConfig({ ...production, WEB_ORIGIN: "http://play.example.com" })).toThrow(/WEB_ORIGIN must use https/);
    expect(() => parseConfig({ ...production, BETTER_AUTH_URL: "http://localhost:2567" })).not.toThrow();
  });

  it("accepts extra https web origins and refuses plain http ones", () => {
    const config = parseConfig({ ...production, EXTRA_WEB_ORIGINS: " https://naija-world.vercel.app/ , https://play2.example.com" });
    expect(config.EXTRA_WEB_ORIGINS).toEqual(["https://naija-world.vercel.app", "https://play2.example.com"]);
    expect(() => parseConfig({ ...production, EXTRA_WEB_ORIGINS: "http://naija-world.example.com" })).toThrow(/EXTRA_WEB_ORIGINS must use https/);
    expect(() => parseConfig({ ...production, EXTRA_WEB_ORIGINS: "not a url" })).toThrow();
  });

  it("lets a wildcard origin cover every deployment on a host, and nothing else", () => {
    expect(parseConfig({ ...production, EXTRA_WEB_ORIGINS: "https://*.vercel.app" }).EXTRA_WEB_ORIGINS).toEqual(["https://*.vercel.app"]);
    const vercel = originMatcher("https://*.vercel.app");
    expect(vercel.test("https://naija-world-git-main-lagos.vercel.app")).toBe(true);
    expect(vercel.test("https://evil.com/.vercel.app")).toBe(false);
    expect(vercel.test("https://a.b.vercel.app")).toBe(false);
    expect(vercel.test("http://naija.vercel.app")).toBe(false);
    expect(originMatcher("https://play.example.com").test("https://playxexample.com")).toBe(false);
  });

  it("keeps development defaults outside production", () => {
    const config = parseConfig({});
    expect(config.NODE_ENV).toBe("development");
    expect(config.TRUSTED_PROXIES).toEqual([]);
    expect(config.SMTP_SECURE).toBe(false);
  });
});
