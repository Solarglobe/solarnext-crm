/**
 * E2E — PDF Renderer V2 (StudySnapshotPdfPage natif)
 * URL : /pdf-render.html?studyId=XXX&versionId=YYY
 *
 * Vérifie que le renderer monte StudySnapshotPdfPage directement, sans LegacyPdfTemplate.
 * Mock de l'API pdf-view-model uniquement.
 */

import { test, expect } from '@playwright/test';

const PDF_RENDERER_BASE = process.env.E2E_BASE_URL?.replace(/\/crm\.html\/?$/, '') || 'http://localhost:5173';
const PDF_URL = `${PDF_RENDERER_BASE}/pdf-render.html?studyId=test-study&versionId=test-version`;

/** fullReport minimal pour legacyPdfViewModelMapper + P10 (signal __pdf_render_ready). */
const fullReportStub = {
  p1: { p1_auto: { p1_client: 'Jean Dupont' } },
  p2: { p2_auto: {} },
  p3: { meta: {}, offer: {}, finance: {}, tech: {} },
  p3b: { p3b_auto: {} },
  p4: {},
  p5: { meta: {}, production_kw: [], consommation_kw: [], batterie_kw: [] },
  p6: { p6: {} },
  p7: {},
  p8: null,
  p9: { meta: {}, scenario: null, error: null, warnings: [] },
  p10: {
    meta: { client: 'Jean Dupont', ref: '—', date: '—' },
    best: {
      kwc: 6,
      savings_year1_eur: 1000,
      roi_years: 12,
      tri_pct: 8,
      lcoe_eur_kwh: 0.08,
      gains_25_eur: 25000,
      autoprod_pct: 55,
      autonomy_pct: 45,
      nb_panels: 10,
      annual_production_kwh: 7200,
    },
  },
  p11: {},
  p12: {},
  p13: {},
  p14: {},
};

const viewModelOk = {
  ok: true,
  viewModel: {
    meta: { scenarioType: 'BASE' },
    selectedScenario: { label: 'Sans batterie' },
    client: { name: 'Jean Dupont', city: 'Paris' },
    production: { annualProductionKwh: 7200 },
    economics: { roiYears: 12 },
    fullReport: fullReportStub,
  },
};

test.describe('PDF Renderer V2 — /pdf-render.html?studyId=&versionId=', () => {
  test('Charge StudySnapshotPdfPage (pas LegacyPdfTemplate)', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#legacy-pdf-container')).not.toBeAttached();
  });

  test('API pdf-view-model appelée', async ({ page }) => {
    let viewModelCalled = false;
    await page.route(/pdf-view-model/, (r) => {
      viewModelCalled = true;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) });
    });
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    expect(viewModelCalled).toBe(true);
  });

  test('Affiche les données du ViewModel', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Jean Dupont')).toBeVisible();
    await expect(page.getByText('Paris')).toBeVisible();
    await expect(page.getByText(/7[\s\u202f]200/)).toBeVisible();
    await expect(page.getByText('12 ans')).toBeVisible();
  });

  test('LegacyPdfTemplate n\'est pas monté (#legacy-pdf-container absent)', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    const legacyContainer = page.locator('#legacy-pdf-container');
    await expect(legacyContainer).not.toBeAttached();
    await expect(page.locator('#p1')).toBeAttached();
  });

  test('window.__pdf_render_ready === true quand rendu complet', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready === true, { timeout: 10000 });
    const ready = await page.evaluate(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready);
    expect(ready).toBe(true);
  });

  test('studyId/versionId manquants → #pdf-error avec message explicite', async ({ page }) => {
    const urlWithoutParams = `${PDF_RENDERER_BASE}/pdf-render.html`;
    await page.goto(urlWithoutParams, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-error')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/studyId|versionId|paramètres/i)).toBeVisible();
  });

  test('CP-PDF-V2-014 — Succès : __pdf_render_ready passe à true', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready === true, { timeout: 10000 });
    expect(await page.evaluate(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready)).toBe(true);
  });

  test('CP-PDF-V2-014 — Erreur API : __pdf_render_ready reste false', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-error')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);
    const ready = await page.evaluate(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready);
    expect(ready).not.toBe(true);
  });

  test('CP-PDF-V2-014 — studyId/versionId manquants : pas de ready', async ({ page }) => {
    await page.goto(`${PDF_RENDERER_BASE}/pdf-render.html`, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-error')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);
    const ready = await page.evaluate(() => (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready);
    expect(ready).not.toBe(true);
  });

  test('CP-PDF-V2-014 — Marqueur DOM #pdf-ready[data-status="ready"] présent quand rendu complet', async ({ page }) => {
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelOk) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-ready[data-status="ready"]')).toBeAttached({ timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible();
  });

  test('CP-PDF-V2-017 — Champs manquants affichent "Non renseigné" (pas de placeholder —)', async ({ page }) => {
    const viewModelEmpty = {
      ok: true,
      viewModel: {
        meta: { scenarioType: '' },
        client: { name: '', city: '' },
        production: { annualProductionKwh: null },
        economics: { roiYears: null },
        fullReport: {
          ...fullReportStub,
          p1: { p1_auto: { p1_client: 'Non renseigné' } },
          p10: {
            meta: { client: 'Non renseigné', ref: '—', date: '—' },
            best: {
              kwc: 0,
              savings_year1_eur: 0,
              roi_years: 0,
              tri_pct: null,
              lcoe_eur_kwh: null,
              gains_25_eur: 0,
              autoprod_pct: null,
              autonomy_pct: null,
              nb_panels: 0,
              annual_production_kwh: 0,
            },
          },
        },
      },
    };
    await page.route(/pdf-view-model/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewModelEmpty) })
    );
    await page.goto(PDF_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.locator('#pdf-root')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Non renseigné').first()).toBeVisible();
    await expect(page.getByText('Étude photovoltaïque')).toBeVisible();
  });
});
