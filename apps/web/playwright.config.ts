import { defineConfig, devices } from "@playwright/test";

/** E2E: API (4000) + web (3000) çalışır durumda ve sentetik seed yüklü olmalı. Bkz. docs/verification.md */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined }, baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", locale: "tr-TR", timezoneId: "Europe/Istanbul", trace: "retain-on-failure" },
  projects: [
    { name: "masaustu", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "telefon-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } },
  ],
});
