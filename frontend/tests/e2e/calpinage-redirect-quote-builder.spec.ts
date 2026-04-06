/**
 * E2E — Redirection Quote Builder après "Valider le calpinage".
 * Vérifie que la navigation vers /crm.html/studies/:id/quote-builder est bien effectuée.
 *
 * Fixture : study ID e2e-study-1 (même que navigation.spec, export-json.spec).
 * Les mocks fournissent une étude + versions ; l’overlay reçoit un état minimal pour activer le bouton Valider.
 */

import { test, expect } from '@playwright/test';

const STUDY_ID = 'e2e-study-1';

test.describe('Calpinage — Redirection Quote Builder', () => {
  test('après "Valider le calpinage", l’URL doit être /crm.html/studies/:id/quote-builder', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);

    // ——— Mocks auth ———
    await context.route('**/auth/me', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, email: 'e2e@test.com' }),
      });
    });
    await context.route('**/auth/permissions', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ permissions: ['study.manage'], superAdmin: false }),
      });
    });

    // ——— Mocks leads (pour le premier chargement /crm.html) ———
    await context.route('**/api/leads/kanban', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: [
            {
              id: 1,
              name: 'Nouveaux',
              stage_id: '1',
              stage_name: 'Nouveaux',
              leads: [{ id: '1', name: 'Lead E2E', full_name: 'Lead E2E', stage_id: '1', score: 50, potential_revenue: 0, inactivity_level: 'none', status: 'LEAD', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
            },
          ],
        }),
      });
    });
    await context.route('**/api/leads/meta', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }),
      });
    });
    await context.route('**/api/leads/1', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lead: { id: '1', full_name: 'Lead E2E', stage_id: '1', status: 'LEAD' },
          stage: { id: '1', name: 'Nouveaux' },
          stages: [{ id: '1', name: 'Nouveaux' }],
          site_address: null,
          billing_address: null,
          studies: [{ id: STUDY_ID, study_number: 'E2E-001', version_number: 1 }],
        }),
      });
    });

    // ——— GET étude unique (doit être en premier pour matcher avant **) ———
    await context.route(`**/api/studies/${STUDY_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study: {
            id: STUDY_ID,
            study_number: 'E2E-001',
            lead_id: '1',
            current_version: 1,
            title: 'E2E Study',
            client_id: '1',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          versions: [
            {
              id: 'version-uuid-1',
              study_id: STUDY_ID,
              version_number: 1,
              data: {},
              created_at: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // ——— Autres routes studies (list, POST calpinage, POST validate, GET calpinage) ———
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST' && url.includes('/versions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ versions: [{ version_number: 1 }] }),
        });
      }
      if (method === 'POST' && url.includes('/calpinage/validate')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ version_number: 1, status: 'validated', snapshotId: 'snap-1' }),
        });
      }
      if (method === 'POST' && url.includes('/calpinage')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      if (method === 'GET' && url.includes('/calpinage')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            calpinageData: null,
            geometry_json: { roofState: { contourBati: [] }, contours: [] },
          }),
        });
      }
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          ]),
        });
      }
      return route.fallback();
    });

    // ——— has-active-study (overlay) ———
    await context.route(`**/api/studies/${STUDY_ID}/has-active-study`, async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasActiveStudy: false }),
      });
    });

    // ——— Documents, PV, etc. ———
    await context.route('**/api/documents/**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await context.route('**/api/public/pv/**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.addInitScript(() => {
      localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
    });

    // ——— Aller sur le CRM puis naviguer en client vers l’étude (évite que Vite serve index.html pour /crm.html/studies/…) ———
    page.setDefaultNavigationTimeout(30000);
    await page.goto('/crm.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sn-leads-card').length > 0 ||
        document.querySelectorAll('table tbody tr').length > 0 ||
        document.querySelector('.sn-leads-page-error') !== null,
      { timeout: 15000 }
    );
    await page.locator('.sn-leads-card, table tbody tr').first().click();
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 15000 });

    // Onglet Études puis bouton Ouvrir sur l’étude (navigation client, pas de full page load)
    await page.getByRole('tab', { name: /Études/i }).click();
    await page.waitForSelector('button:has-text("Ouvrir")', { timeout: 10000 });
    await page.locator('button:has-text("Ouvrir")').first().click();
    await page.waitForURL(/\/studies\/e2e-study-1/, { timeout: 10000 });
    await page.waitForSelector('.study-detail-tabs, .study-detail-v2, [class*="study-detail"], button:has-text("Ouvrir calpinage")', { timeout: 20000 });
    const calpinageTab = page.locator('button.study-detail-tab:has-text("Calpinage"), [role="tab"]:has-text("Calpinage")');
    if ((await calpinageTab.count()) > 0) await calpinageTab.first().click();
    await page.waitForSelector('button:has-text("Ouvrir calpinage")', { timeout: 15000 });

    // ——— Ouvrir l’overlay calpinage ———
    await page.click('button:has-text("Ouvrir calpinage")');

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container, #calpinage-root', {
      state: 'attached',
      timeout: 20000,
    });

    // ——— État minimal pour que le bouton "Valider le calpinage" soit actif (cf. export-json.spec) ———
    await page.evaluate(() => {
      const w = window as Record<string, unknown> & {
        validatedRoofData?: unknown;
        CALPINAGE_STATE?: Record<string, unknown>;
        currentStudy?: Record<string, unknown>;
        PV_SELECTED_PANEL?: unknown;
        pvPlacementEngine?: { getAllPanels?: () => unknown[] };
      };
      const validatedRoof = {
        pans: [
          {
            id: 'PAN_1',
            orientationDeg: 180,
            tiltDeg: 30,
            surfaceM2: 50,
            polygonPx: [
              { x: 100, y: 100 },
              { x: 500, y: 100 },
              { x: 500, y: 400 },
              { x: 100, y: 400 },
            ],
          },
        ],
        scale: 1,
        north: 0,
        gps: { lat: 48.8566, lon: 2.3522 },
      };
      w.validatedRoofData = validatedRoof;
      w.PV_SELECTED_PANEL = {
        id: 'E2E_PANEL_1',
        powerWc: 500,
      };
      const panelInstance = {
        id: 'PANEL_1',
        enabled: true,
        wMm: 1760,
        hMm: 1134,
        orientation_deg: 180,
        tilt_deg: 30,
        polygonPx: [
          { x: 150, y: 150 },
          { x: 250, y: 150 },
          { x: 250, y: 250 },
          { x: 150, y: 250 },
        ],
      };
      w.CALPINAGE_STATE = w.CALPINAGE_STATE || {};
      (w.CALPINAGE_STATE as Record<string, unknown>).validatedRoofData = validatedRoof;
      (w.CALPINAGE_STATE as Record<string, unknown>).roof = { gps: validatedRoof.gps };
      (w.CALPINAGE_STATE as Record<string, unknown>).panels = [panelInstance];
      (w.CALPINAGE_STATE as Record<string, unknown>).shading = {
        normalized: { totalLossPct: 0, panelCount: 1, perPanel: [], computedAt: new Date().toISOString() },
      };
      w.currentStudy = w.currentStudy || {};
      (w.currentStudy as Record<string, unknown>).calpinage = {
        panels: [panelInstance],
        roof: validatedRoof,
        shading: { totalLossPct: 0, perPanel: [], computedAt: new Date().toISOString() },
        inverter: { id: 'E2E_INV_1', family: 'MICRO', model: 'E2E', phases: '1P' },
      };
      w.pvPlacementEngine = w.pvPlacementEngine || {};
      (w.pvPlacementEngine as { getAllPanels: () => unknown[] }).getAllPanels = () => [panelInstance];
    });

    // ——— Attendre que le bouton soit cliquable (Phase3 chargé) ———
    await page.waitForTimeout(1500);

    // ——— Cliquer "Valider le calpinage" (sidebar) → validation directe ———
    const validateBtn = page.locator('button:has-text("Valider le calpinage")');
    await validateBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await validateBtn.click({ force: true });

    // ——— Attendre la navigation vers quote-builder ———
    await page.waitForURL(/\/crm\.html\/studies\/.+\/quote-builder/, { timeout: 15000 });

    // ——— Assert URL finale ———
    await expect(page).toHaveURL(/\/crm\.html\/studies\/.+\/quote-builder/);
  });

  test('Validate succeeds even without shading (shading: null, geometry3d: null, no require crash)', async ({ page, context }) => {
    test.setTimeout(60000);
    let postCalpinageBody: { geometry_json?: unknown } | null = null;
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && text) consoleErrors.push(text);
    });

    await context.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, email: 'e2e@test.com' }) }));
    await context.route('**/auth/permissions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ permissions: ['study.manage'], superAdmin: false }) }));
    await context.route('**/api/leads/kanban', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ columns: [{ id: 1, name: 'Nouveaux', stage_id: '1', stage_name: 'Nouveaux', leads: [{ id: '1', name: 'Lead E2E', full_name: 'Lead E2E', stage_id: '1', score: 50, potential_revenue: 0, inactivity_level: 'none', status: 'LEAD', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }] }) }));
    await context.route('**/api/leads/meta', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }) }));
    await context.route('**/api/leads/1', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lead: { id: '1', full_name: 'Lead E2E', stage_id: '1', status: 'LEAD' }, stage: { id: '1', name: 'Nouveaux' }, stages: [{ id: '1', name: 'Nouveaux' }], site_address: null, billing_address: null, studies: [{ id: STUDY_ID, study_number: 'E2E-001', version_number: 1 }] }) }));
    await context.route(`**/api/studies/${STUDY_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ study: { id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', current_version: 1, title: 'E2E', client_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, versions: [{ id: 'v1', study_id: STUDY_ID, version_number: 1, data: {}, created_at: new Date().toISOString() }] }) });
    });
    await context.route(`**/api/studies/${STUDY_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study: { id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', current_version: 1, title: 'E2E', client_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          versions: [{ id: 'version-uuid-1', study_id: STUDY_ID, version_number: 1, data: {}, created_at: new Date().toISOString() }],
        }),
      });
    });
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST' && url.includes('/calpinage/validate')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version_number: 1, status: 'validated', snapshotId: 'snap-1' }) });
      }
      if (method === 'POST' && url.includes('/calpinage')) {
        try {
          const body = route.request().postDataJSON();
          postCalpinageBody = body && typeof body === 'object' ? (body as { geometry_json?: unknown }) : null;
        } catch (_) {}
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      if (method === 'GET' && url.includes('/calpinage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ calpinageData: null, geometry_json: {} }) });
      }
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]) });
      }
      return route.fallback();
    });
    await context.route(`**/api/studies/${STUDY_ID}/has-active-study`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasActiveStudy: false }) }));
    await context.route('**/api/documents/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await context.route('**/api/public/pv/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    await page.addInitScript(() => localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN'));
    await page.goto('/crm.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.sn-leads-card').length > 0 || document.querySelectorAll('table tbody tr').length > 0 || document.querySelector('.sn-leads-page-error') !== null, { timeout: 15000 });
    await page.locator('.sn-leads-card, table tbody tr').first().click();
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 15000 });
    await page.getByRole('tab', { name: /Études/i }).click();
    await page.waitForSelector('button:has-text("Ouvrir")', { timeout: 10000 });
    await page.locator('button:has-text("Ouvrir")').first().click();
    await page.waitForURL(/\/studies\/e2e-study-1/, { timeout: 10000 });
    await page.waitForSelector('.study-detail-tabs, .study-detail-v2, [class*="study-detail"], button:has-text("Ouvrir calpinage")', { timeout: 20000 });
    const calpinageTab = page.locator('button.study-detail-tab:has-text("Calpinage"), [role="tab"]:has-text("Calpinage")');
    if ((await calpinageTab.count()) > 0) await calpinageTab.first().click();
    await page.waitForSelector('button:has-text("Ouvrir calpinage")', { timeout: 15000 });
    await page.click('button:has-text("Ouvrir calpinage")');
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container, #calpinage-root', { state: 'attached', timeout: 20000 });

    // État SANS shading (normalized: null) pour prouver que validate fonctionne sans Analyse Ombres
    await page.evaluate(() => {
      const w = window as Record<string, unknown> & { CALPINAGE_STATE?: Record<string, unknown>; validatedRoofData?: unknown; PV_SELECTED_PANEL?: unknown; PV_SELECTED_INVERTER?: unknown; pvPlacementEngine?: { getAllPanels: () => unknown[] } };
      const roof = { pans: [{ id: 'PAN_1', orientationDeg: 180, tiltDeg: 30, surfaceM2: 50, polygonPx: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }] }], scale: 1, north: 0, gps: { lat: 48.8566, lon: 2.3522 } };
      const panel = { id: 'PANEL_1', enabled: true, polygonPx: [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }] };
      w.CALPINAGE_STATE = w.CALPINAGE_STATE || {};
      (w.CALPINAGE_STATE as Record<string, unknown>).validatedRoofData = roof;
      (w.CALPINAGE_STATE as Record<string, unknown>).roof = { gps: roof.gps };
      (w.CALPINAGE_STATE as Record<string, unknown>).panels = [panel];
      (w.CALPINAGE_STATE as Record<string, unknown>).shading = { normalized: null };
      w.validatedRoofData = roof;
      w.PV_SELECTED_PANEL = { id: 'E2E_PANEL_1', powerWc: 500 };
      w.PV_SELECTED_INVERTER = { id: 'E2E_INV_1', family: 'MICRO', model: 'E2E' };
      w.pvPlacementEngine = w.pvPlacementEngine || {};
      (w.pvPlacementEngine as { getAllPanels: () => unknown[] }).getAllPanels = () => [panel];
    });
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("Valider le calpinage")').click({ force: true });
    await page.waitForURL(/\/crm\.html\/studies\/.+\/quote-builder/, { timeout: 15000 });

    await expect(page).toHaveURL(/\/crm\.html\/studies\/.+\/quote-builder/);
    const requireError = consoleErrors.find((t) => t.includes('require is not defined'));
    expect(requireError, 'No "require is not defined" during validate').toBeUndefined();
    if (postCalpinageBody && postCalpinageBody.geometry_json && typeof postCalpinageBody.geometry_json === 'object') {
      const geom = postCalpinageBody.geometry_json as Record<string, unknown>;
      expect(geom.geometry3d === null || geom.geometry3d === undefined).toBe(true);
      expect(geom.shading === null || (typeof geom.shading === 'object' && geom.shading !== null)).toBe(true);
    }
  });

  test('Validate succeeds after Analyse Ombres and keeps shading in payload', async ({ page, context }) => {
    test.setTimeout(60000);
    let postCalpinageBody: { geometry_json?: Record<string, unknown> } | null = null;

    await context.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, email: 'e2e@test.com' }) }));
    await context.route('**/auth/permissions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ permissions: ['study.manage'], superAdmin: false }) }));
    await context.route('**/api/leads/kanban', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ columns: [{ id: 1, name: 'Nouveaux', stage_id: '1', stage_name: 'Nouveaux', leads: [{ id: '1', name: 'Lead E2E', full_name: 'Lead E2E', stage_id: '1', score: 50, potential_revenue: 0, inactivity_level: 'none', status: 'LEAD', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }] }) }));
    await context.route('**/api/leads/meta', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }) }));
    await context.route('**/api/leads/1', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lead: { id: '1', full_name: 'Lead E2E', stage_id: '1', status: 'LEAD' }, stage: { id: '1', name: 'Nouveaux' }, stages: [{ id: '1', name: 'Nouveaux' }], site_address: null, billing_address: null, studies: [{ id: STUDY_ID, study_number: 'E2E-001', version_number: 1 }] }) }));
    await context.route(`**/api/studies/${STUDY_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ study: { id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', current_version: 1, title: 'E2E', client_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, versions: [{ id: 'v1', study_id: STUDY_ID, version_number: 1, data: {}, created_at: new Date().toISOString() }] }) });
    });
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST' && url.includes('/calpinage/validate')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version_number: 1, status: 'validated', snapshotId: 'snap-1' }) });
      }
      if (method === 'POST' && url.includes('/calpinage')) {
        try {
          const body = route.request().postDataJSON();
          postCalpinageBody = body && typeof body === 'object' ? (body as { geometry_json?: Record<string, unknown> }) : null;
        } catch (_) {}
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      if (method === 'GET' && url.includes('/calpinage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ calpinageData: null, geometry_json: {} }) });
      }
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]) });
      }
      return route.fallback();
    });
    await context.route(`**/api/studies/${STUDY_ID}/has-active-study`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasActiveStudy: false }) }));
    await context.route('**/api/documents/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await context.route('**/api/public/pv/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    await page.addInitScript(() => localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN'));
    await page.goto('/crm.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.sn-leads-card').length > 0 || document.querySelectorAll('table tbody tr').length > 0 || document.querySelector('.sn-leads-page-error') !== null, { timeout: 15000 });
    await page.locator('.sn-leads-card, table tbody tr').first().click();
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 15000 });
    await page.getByRole('tab', { name: /Études/i }).click();
    await page.waitForSelector('button:has-text("Ouvrir")', { timeout: 10000 });
    await page.locator('button:has-text("Ouvrir")').first().click();
    await page.waitForURL(/\/studies\/e2e-study-1/, { timeout: 10000 });
    await page.waitForSelector('.study-detail-tabs, .study-detail-v2, [class*="study-detail"], button:has-text("Ouvrir calpinage")', { timeout: 20000 });
    const calpinageTab = page.locator('button.study-detail-tab:has-text("Calpinage"), [role="tab"]:has-text("Calpinage")');
    if ((await calpinageTab.count()) > 0) await calpinageTab.first().click();
    await page.waitForSelector('button:has-text("Ouvrir calpinage")', { timeout: 15000 });
    await page.click('button:has-text("Ouvrir calpinage")');
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container, #calpinage-root', { state: 'attached', timeout: 20000 });

    // État AVEC shading (comme après "Analyse Ombres")
    await page.evaluate(() => {
      const w = window as Record<string, unknown> & { CALPINAGE_STATE?: Record<string, unknown>; validatedRoofData?: unknown; PV_SELECTED_PANEL?: unknown; PV_SELECTED_INVERTER?: unknown; pvPlacementEngine?: { getAllPanels: () => unknown[] } };
      const roof = { pans: [{ id: 'PAN_1', orientationDeg: 180, tiltDeg: 30, surfaceM2: 50, polygonPx: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }] }], scale: 1, north: 0, gps: { lat: 48.8566, lon: 2.3522 } };
      const panel = { id: 'PANEL_1', enabled: true, polygonPx: [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }] };
      const normalized = { totalLossPct: 5.2, panelCount: 1, perPanel: [], computedAt: new Date().toISOString(), combined: { totalLossPct: 5.2 } };
      w.CALPINAGE_STATE = w.CALPINAGE_STATE || {};
      (w.CALPINAGE_STATE as Record<string, unknown>).validatedRoofData = roof;
      (w.CALPINAGE_STATE as Record<string, unknown>).roof = { gps: roof.gps };
      (w.CALPINAGE_STATE as Record<string, unknown>).panels = [panel];
      (w.CALPINAGE_STATE as Record<string, unknown>).shading = { normalized };
      w.validatedRoofData = roof;
      w.PV_SELECTED_PANEL = { id: 'E2E_PANEL_1', powerWc: 500 };
      w.PV_SELECTED_INVERTER = { id: 'E2E_INV_1', family: 'MICRO', model: 'E2E' };
      w.pvPlacementEngine = w.pvPlacementEngine || {};
      (w.pvPlacementEngine as { getAllPanels: () => unknown[] }).getAllPanels = () => [panel];
    });
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("Valider le calpinage")').click({ force: true });
    const confirmModal = page.locator('[role="dialog"]').filter({ has: page.locator('button:has-text("Valider"), button:has-text("Confirmer"), button:has-text("OK")') });
    if ((await confirmModal.count()) > 0) {
      await confirmModal.locator('button:has-text("Valider"), button:has-text("Confirmer"), button:has-text("OK")').first().click();
    }
    await page.waitForURL(/\/crm\.html\/studies\/.+\/quote-builder/, { timeout: 15000 });

    await expect(page).toHaveURL(/\/crm\.html\/studies\/.+\/quote-builder/);
    if (postCalpinageBody?.geometry_json && typeof postCalpinageBody.geometry_json === 'object') {
      const sh = (postCalpinageBody.geometry_json as Record<string, unknown>).shading;
      const totalLossPct = sh && typeof sh === 'object' && sh !== null && 'totalLossPct' in sh ? (sh as { totalLossPct?: number }).totalLossPct : (sh && typeof sh === 'object' && sh !== null && 'combined' in sh && (sh as { combined?: { totalLossPct?: number } }).combined ? ((sh as { combined: { totalLossPct?: number } }).combined.totalLossPct) : undefined);
      expect(typeof totalLossPct === 'number').toBe(true);
    }
  });

  test('No shading compute is triggered during validate (counter stays 0)', async ({ page, context }) => {
    test.setTimeout(60000);
    await context.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, email: 'e2e@test.com' }) }));
    await context.route('**/auth/permissions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ permissions: ['study.manage'], superAdmin: false }) }));
    await context.route('**/api/leads/kanban', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ columns: [{ id: 1, name: 'Nouveaux', stage_id: '1', stage_name: 'Nouveaux', leads: [{ id: '1', name: 'Lead E2E', full_name: 'Lead E2E', stage_id: '1', score: 50, potential_revenue: 0, inactivity_level: 'none', status: 'LEAD', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }] }) }));
    await context.route('**/api/leads/meta', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }) }));
    await context.route('**/api/leads/1', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lead: { id: '1', full_name: 'Lead E2E', stage_id: '1', status: 'LEAD' }, stage: { id: '1', name: 'Nouveaux' }, stages: [{ id: '1', name: 'Nouveaux' }], site_address: null, billing_address: null, studies: [{ id: STUDY_ID, study_number: 'E2E-001', version_number: 1 }] }) }));
    await context.route(`**/api/studies/${STUDY_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study: { id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', current_version: 1, title: 'E2E', client_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          versions: [{ id: 'version-uuid-1', study_id: STUDY_ID, version_number: 1, data: {}, created_at: new Date().toISOString() }],
        }),
      });
    });
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST' && url.includes('/calpinage/validate')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version_number: 1, status: 'validated', snapshotId: 'snap-1' }) });
      if (method === 'POST' && url.includes('/calpinage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      if (method === 'GET' && url.includes('/calpinage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ calpinageData: null, geometry_json: {} }) });
      if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: STUDY_ID, study_number: 'E2E-001', lead_id: '1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]) });
      return route.fallback();
    });
    await context.route(`**/api/studies/${STUDY_ID}/has-active-study`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasActiveStudy: false }) }));
    await context.route('**/api/documents/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await context.route('**/api/public/pv/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    await page.addInitScript(() => localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN'));
    await page.goto('/crm.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.sn-leads-card').length > 0 || document.querySelectorAll('table tbody tr').length > 0 || document.querySelector('.sn-leads-page-error') !== null, { timeout: 15000 });
    await page.locator('.sn-leads-card, table tbody tr').first().click();
    await page.waitForURL(/\/leads\/[^/]+/, { timeout: 15000 });
    await page.getByRole('tab', { name: /Études/i }).click();
    await page.waitForSelector('button:has-text("Ouvrir")', { timeout: 10000 });
    await page.locator('button:has-text("Ouvrir")').first().click();
    await page.waitForURL(/\/studies\/e2e-study-1/, { timeout: 10000 });
    await page.waitForSelector('.study-detail-tabs, .study-detail-v2, [class*="study-detail"], button:has-text("Ouvrir calpinage")', { timeout: 20000 });
    const calpinageTab = page.locator('button.study-detail-tab:has-text("Calpinage"), [role="tab"]:has-text("Calpinage")');
    if ((await calpinageTab.count()) > 0) await calpinageTab.first().click();
    await page.waitForSelector('button:has-text("Ouvrir calpinage")', { timeout: 15000 });
    await page.click('button:has-text("Ouvrir calpinage")');
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container, #calpinage-root', { state: 'attached', timeout: 20000 });

    await page.evaluate(() => {
      const w = window as Record<string, unknown> & { CALPINAGE_STATE?: Record<string, unknown>; validatedRoofData?: unknown; PV_SELECTED_PANEL?: unknown; PV_SELECTED_INVERTER?: unknown; pvPlacementEngine?: { getAllPanels: () => unknown[] }; computeCalpinageShading?: () => unknown; __shadingComputeCount?: number };
      const roof = { pans: [{ id: 'PAN_1', orientationDeg: 180, tiltDeg: 30, surfaceM2: 50, polygonPx: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }] }], scale: 1, north: 0, gps: { lat: 48.8566, lon: 2.3522 } };
      const panel = { id: 'PANEL_1', enabled: true, polygonPx: [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }] };
      w.__shadingComputeCount = 0;
      w.CALPINAGE_STATE = w.CALPINAGE_STATE || {};
      (w.CALPINAGE_STATE as Record<string, unknown>).validatedRoofData = roof;
      (w.CALPINAGE_STATE as Record<string, unknown>).roof = { gps: roof.gps };
      (w.CALPINAGE_STATE as Record<string, unknown>).panels = [panel];
      (w.CALPINAGE_STATE as Record<string, unknown>).shading = { normalized: null };
      w.validatedRoofData = roof;
      w.PV_SELECTED_PANEL = { id: 'E2E_PANEL_1', powerWc: 500 };
      w.PV_SELECTED_INVERTER = { id: 'E2E_INV_1', family: 'MICRO', model: 'E2E' };
      w.pvPlacementEngine = w.pvPlacementEngine || {};
      (w.pvPlacementEngine as { getAllPanels: () => unknown[] }).getAllPanels = () => [panel];
    });
    await page.waitForTimeout(1500);
    // Spy: si computeCalpinageShading est défini plus tard (par le module), on le wrappe pour compter les appels
    await page.evaluate(() => {
      const w = window as Record<string, unknown> & { computeCalpinageShading?: () => unknown; __shadingComputeCount?: number };
      const check = () => {
        if (typeof w.computeCalpinageShading === 'function') {
          const orig = w.computeCalpinageShading;
          w.computeCalpinageShading = function () {
            w.__shadingComputeCount = (w.__shadingComputeCount || 0) + 1;
            return (orig as () => unknown).call(this);
          };
        }
      };
      check();
      setTimeout(check, 2000);
    });

    await page.locator('button:has-text("Valider le calpinage")').click({ force: true });
    await page.waitForURL(/\/crm\.html\/studies\/.+\/quote-builder/, { timeout: 15000 });

    const count = await page.evaluate(() => (window as unknown as { __shadingComputeCount?: number }).__shadingComputeCount ?? -1);
    expect(count).toBe(0);
  });
});
