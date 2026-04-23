/**
 * E2E — Page PDF V2 (entrée autonome pdf-render.html)
 * URL : /pdf-render.html?studyId=test&versionId=test
 * Pas de CRM, pas de router, pas d’auth. Mock uniquement l’API pdf-view-model.
 *
 * TEST 1 — Route accessible
 * TEST 2 — Chargement OK, données client
 * TEST 3 — Erreur API 404 → #pdf-error
 * TEST 4 — Marqueur #pdf-ready
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL?.replace(/\/crm\.html\/?$/, '') || 'http://localhost:5173';
const PDF_URL = `${BASE}/pdf-render.html?studyId=test&versionId=test`;

const viewModelOk = {
  ok: true,
  viewModel: {
    meta: { scenarioType: 'BASE' },
    client: { name: 'Jean Dupont', city: 'Paris' },
    production: { annualProductionKwh: 7200 },
    economics: { roiYears: 12 },
  },
};

test.describe('PDF V2 — Page preview (autonome)', () => {
  test('TEST 1 — Route accessible', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-loading, #pdf-root, #pdf-error')).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(/pdf-render/);
    await expect(page.locator('#legacy-pdf-container')).not.toBeAttached();
    console.log('TEST PASSED — Route accessible');
  });

  test('TEST 2 — Chargement OK : affichage données client', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Jean Dupont')).toBeVisible();
    await expect(page.getByText('Paris')).toBeVisible();
    console.log('TEST PASSED — Chargement OK');
  });

  test('TEST 3 — Erreur API 404 → #pdf-error', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'SNAPSHOT_NOT_FOUND' }) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-error')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Impossible de charger le document')).toBeVisible();
    console.log('TEST PASSED — Erreur API');
  });

  test('TEST 4 — Marqueur #pdf-ready[data-status="ready"] présent quand rendu complet', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-ready[data-status="ready"]')).toBeAttached({ timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible();
    console.log('TEST PASSED — Marqueur Playwright');
  });

  test('TEST 5 — LegacyPdfTemplate non monté', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#legacy-pdf-container')).not.toBeAttached();
    console.log('TEST PASSED — LegacyPdfTemplate non monté');
  });
});
