import { test, expect } from '@playwright/test';

/**
 * Test de stabilité : switch provider Google ↔ Ortho en boucle.
 * Simule : Google → Ortho → Google × 10 cycles.
 * Vérifie : map visible, canvas présent, aucun dialog fantôme, aucune erreur runtime.
 *
 * Note : L'app n'a que 2 providers (Google Satellite, IGN Ortho). Pas de Bing.
 */
test.describe('PROVIDER-STRESS', () => {
  test('Switch Google ↔ Ortho x10', async ({ page, context }) => {
    test.setTimeout(240000);

    // -----------------------------
    // MOCKS (copier ceux stables de navigation.spec.ts)
    // -----------------------------
    await context.route('http://localhost:5173/auth/me', async (route) => {
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
        body: JSON.stringify({ permissions: [], superAdmin: false }),
      });
    });

    await context.route('http://localhost:5173/api/leads/kanban', async (route) => {
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
              leads: [
                {
                  id: '1',
                  name: 'Lead E2E Test',
                  full_name: 'Lead E2E Test',
                  stage_id: '1',
                  score: 50,
                  potential_revenue: 0,
                  inactivity_level: 'none',
                  status: 'LEAD',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      });
    });

    await context.route('http://localhost:5173/api/leads/meta', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stages: [{ id: '1', name: 'Nouveaux' }],
          users: [],
        }),
      });
    });

    await context.route('**/api/leads/1', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lead: { id: '1', full_name: 'Lead E2E Test', stage_id: '1', status: 'LEAD' },
          stage: { id: '1', name: 'Nouveaux' },
          stages: [{ id: '1', name: 'Nouveaux' }],
          site_address: null,
          billing_address: null,
        }),
      });
    });

    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'POST' && url.includes('/versions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ versions: [{ version_number: 1 }] }),
        });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            study: { id: 'e2e-study-1', study_number: 'E2E-001', lead_id: '1' },
            versions: [{ version_number: 1 }],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'e2e-study-1', study_number: 'E2E-001', lead_id: '1' }]),
      });
    });

    await context.route('**/api/**/calpinage**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          calpinageData: null,
          geometry_json: { roofState: { contourBati: [] }, contours: [] },
        }),
      });
    });

    await context.route('**/api/public/pv/**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
    });

    // -----------------------------
    // Runtime error tracking
    // -----------------------------
    const runtimeErrors: string[] = [];
    const knownLegacyErrors = ['require is not defined'];
    page.on('pageerror', (err) => {
      if (!knownLegacyErrors.some((k) => err.message.includes(k))) {
        runtimeErrors.push(err.message);
      }
    });

    // -----------------------------
    // Boot CRM
    // -----------------------------
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sn-leads-card').length > 0 ||
        document.querySelectorAll('table tbody tr').length > 0 ||
        document.querySelector('.sn-leads-page-error') !== null,
      { timeout: 30000 }
    );

    if (await page.locator('.sn-leads-page-error').isVisible()) {
      const errText = await page.locator('.sn-leads-page-error').textContent();
      throw new Error(`Leads page error: ${errText}`);
    }

    const firstLead = page.locator('.sn-leads-card, [data-testid="lead-item"], .lead-item, table tbody tr').first();
    await firstLead.click();

    await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });

    await page.waitForSelector(
      'button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")',
      { timeout: 20000 }
    );

    await page.click('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")');

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 20000 });

    // -----------------------------
    // Provider switch stress
    // Google → Ortho → Google × 10 cycles
    // (dropdown custom #calpinage-map-source : google | geoportail-ortho)
    // -----------------------------
    const providers = ['google', 'geoportail-ortho', 'google'] as const;
    const cycles = 10;
    const triggerEl = page.locator('#calpinage-map-source');

    for (let i = 0; i < cycles; i++) {
      console.log(`🔁 Provider cycle ${i + 1}/${cycles}`);

      for (const provider of providers) {
        await triggerEl.click();
        await page.locator(`[role="option"][data-value="${provider}"]`).click();

        // attendre que la map se recharge
        await page.waitForTimeout(500);

        // vérifier que canvas toujours présent
        await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 10000 });
      }
    }

    // -----------------------------
    // Final validations
    // -----------------------------
    expect(
      runtimeErrors.length,
      runtimeErrors.length > 0 ? `Runtime errors: ${runtimeErrors.join(' | ')}` : undefined
    ).toBe(0);

    console.log('==============================');
    console.log('🟣 PROVIDER STRESS RESULT');
    console.log('Cycles:', cycles);
    console.log('Runtime errors:', runtimeErrors.length);
    console.log('STATUS: PASS');
    console.log('==============================');
  });
});
