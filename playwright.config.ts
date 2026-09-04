import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const fullStack = process.env.E2E_FULL_STACK === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: fullStack || process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  globalSetup: fullStack ? "./tests/e2e/global-setup.ts" : undefined,
  globalTeardown: fullStack ? "./tests/e2e/global-teardown.ts" : undefined,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "en-US",
    colorScheme: "dark",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
