import { defineConfig, devices } from '@playwright/test';

/**
 * CI_MOBILE=1 → active les projets Mobile Chrome et Mobile Safari.
 * Ces projets ne font tourner que tests/e2e/mobile.smoke.spec.ts.
 *
 * En local ou sur des branches autres que main/staging, les projets mobile
 * sont désactivés par défaut pour ne pas alourdir le CI.
 *
 * Activation :
 *   CI_MOBILE=1 npx playwright test
 *   ou dans le pipeline GitHub Actions :
 *     env: { CI_MOBILE: '1' }  (uniquement sur main/staging)
 */
const CI_MOBILE = !!process.env.CI_MOBILE;

/** Projets mobile — injectés seulement si CI_MOBILE est positionné. */
const mobileProjects = CI_MOBILE
  ? [
      {
        name: 'Mobile Chrome',
        use: { ...devices['Pixel 5'] },
        // Smoke + régression M1-M4 — aucune interférence desktop.
        testMatch: [
          '**/e2e/mobile.smoke.spec.ts',
          '**/e2e/mobile.regression.spec.ts',
        ],
      },
      {
        name: 'Mobile Safari',
        use: { ...devices['iPhone 13'] },
        testMatch: [
          '**/e2e/mobile.smoke.spec.ts',
          '**/e2e/mobile.regression.spec.ts',
        ],
      },
    ]
  : [];

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
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173/',
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
      // Exclut les specs mobiles du projet desktop — pas de doublon d'exécution.
      testIgnore: ['**/mobile.smoke.spec.ts', '**/mobile.regression.spec.ts'],
    },
    // Projets mobile — vides si CI_MOBILE non défini
    ...mobileProjects,
  ],
});
