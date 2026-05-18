import { defineConfig, devices } from "./frontend/node_modules/@playwright/test";

const CI = !!process.env.CI;
const startServers = process.env.E2E_START_SERVERS === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    extraHTTPHeaders: { "x-e2e-suite": "critical-business-flows" },
    headless: CI ? true : process.env.E2E_HEADED !== "1",
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: startServers
    ? [
        {
          command: "npm.cmd run start",
          cwd: "./backend",
          url: process.env.E2E_API_URL || "http://127.0.0.1:3000",
          reuseExistingServer: !CI,
          timeout: 120_000,
          env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: process.env.E2E_API_PORT || "3000",
          },
        },
        {
          command: "npm.cmd run dev -- --host 127.0.0.1",
          cwd: "./frontend",
          url: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
          reuseExistingServer: !CI,
          timeout: 120_000,
        },
      ]
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

