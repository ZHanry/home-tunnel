import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 20_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4176",
    locale: "zh-CN",
    viewport: { width: 1440, height: 960 },
    launchOptions: process.env.PLAYWRIGHT_CHROME_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
      : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/ui-preview.mjs",
    url: "http://127.0.0.1:4176",
    env: { UI_PREVIEW_PORT: "4176" },
    reuseExistingServer: !process.env.CI,
  },
});
