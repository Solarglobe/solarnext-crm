import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/calpinage-visual-report.json" }],
  ],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  expect: {
    timeout: 15000,
    toHaveScreenshot: {
      maxDiffPixelRatio: Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_RATIO ?? "0.018"),
      maxDiffPixels: Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_PIXELS ?? "4500"),
    },
  },
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5174/",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx vite --mode test --host 127.0.0.1 --port 5174 --strictPort",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
