import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/stability-report.json' }],
  ],
  expect: { timeout: 10000 },

  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173/crm.html/',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'npx vite --mode test',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
