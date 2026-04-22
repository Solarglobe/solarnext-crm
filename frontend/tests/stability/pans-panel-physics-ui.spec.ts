import { test, expect, type Route } from '@playwright/test';

/**
 * Validation runtime (DOM) : panneau Pans après recalcul physique.
 * Prérequis : `npm run dev` (prebuild copie pans-bundle → public), puis :
 *   E2E_BASE_URL=http://localhost:5176/ npx playwright test tests/stability/pans-panel-physics-ui.spec.ts
 * (adapter le port si différent).
 */
test.describe('PANS_PANEL_PHYSICS_UI', () => {
  test('panneau Pans : pente et orientation non triviales après contour + faîtage + h (runtime)', async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const base = process.env.E2E_BASE_URL || 'http://localhost:5173/';

    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => {
      if (!err.message.includes('require is not defined')) runtimeErrors.push(err.message);
    });

    const fulfillAuthMe = async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '1',
          email: 'e2e-pans@test.com',
          organizationId: 'e2e-org',
          role: 'user',
        }),
      });
    };
    await context.route('**/auth/me', fulfillAuthMe);
    const fulfillPerm = async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ permissions: [], superAdmin: false }),
      });
    };
    await context.route('**/auth/permissions', fulfillPerm);
    await context.route('**/api/organizations', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'e2e-org', name: 'E2E Org' }]),
      });
    });
    const kanbanBody = JSON.stringify({
      columns: [
        {
          id: 1,
          name: 'Nouveaux',
          stage_id: '1',
          stage_name: 'Nouveaux',
          leads: [
            {
              id: '1',
              name: 'Lead Pans UI',
              full_name: 'Lead Pans UI',
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
    });
    const listLeadsBody = JSON.stringify([
      {
        id: '1',
        full_name: 'Lead Pans UI',
        stage_id: '1',
        status: 'LEAD',
        score: 50,
        potential_revenue: 0,
        inactivity_level: 'none',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    await context.route(/\/api\/leads\/kanban(\?|$)/, async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: kanbanBody });
    });
    /* Vue liste par défaut : GET /api/leads?view=leads */
    await context.route(/\/api\/leads\?/, async (route) => {
      const u = route.request().url();
      if (u.includes('view=leads')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: listLeadsBody });
      }
      if (u.includes('/kanban') || u.includes('kanban')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: kanbanBody });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: listLeadsBody });
    });
    await context.route('**/api/leads/meta**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }),
      });
    });
    const leadDetailBody = JSON.stringify({
      lead: { id: '1', full_name: 'Lead Pans UI', stage_id: '1', status: 'LEAD' },
      stage: { id: '1', name: 'Nouveaux' },
      stages: [{ id: '1', name: 'Nouveaux' }],
      site_address: null,
      billing_address: null,
    });
    await context.route(/\/api\/leads\/1(\/|\?|$)/, async (route) => {
      const url = route.request().url();
      if (url.includes('/activities')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [] }),
        });
      }
      if (url.includes('/meters')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      if (url.includes('/consumption')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      if (url.includes('/documents')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: leadDetailBody,
      });
    });
    await context.route('**/api/documents/lead/**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await context.route('**/api/quotes**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    const studyRow = {
      id: 'e2e-pans-study',
      study_number: 'PANS-001',
      lead_id: '1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const versionRow = { id: 'e2e-pans-v1', version_number: 1 };
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'POST' && url.includes('/versions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'e2e-pans-v2', version_number: 2 }),
        });
      }
      if (method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            study: studyRow,
            versions: [versionRow],
          }),
        });
      }
      if (method === 'GET' && url.includes('lead_id=')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([studyRow]),
        });
      }
      if (method === 'GET' && url.includes('/api/studies/e2e-pans-study')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            study: { id: 'e2e-pans-study', lead_id: '1' },
            versions: [versionRow],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([studyRow]),
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.addInitScript(() => {
      const enc = (o: Record<string, unknown>) =>
        btoa(JSON.stringify(o))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
      const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
        exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
        id: '1',
        email: 'e2e-pans@test.com',
        organizationId: 'e2e-org',
        role: 'user',
      })}.e2e`;
      localStorage.setItem('solarnext_token', token);
    });

    await page.goto(new URL('crm.html/leads', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root', { timeout: 25000 });
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sn-leads-card').length > 0 ||
        document.querySelectorAll('table tbody tr').length > 0 ||
        document.querySelectorAll('.sn-leads-premium__row--data').length > 0 ||
        document.querySelectorAll('button[aria-label*="ouvrir la fiche"]').length > 0,
      { timeout: 25000 },
    );
    await page
      .locator(
        '.sn-leads-card, [data-testid="lead-item"], .sn-leads-premium__row--data, button[aria-label*="ouvrir la fiche"], table tbody tr',
      )
      .first()
      .click();
    await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });
    await page.waitForSelector(
      'button:has-text("Nouvelle étude"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")',
      { timeout: 20000 },
    );
    await page
      .locator('button:has-text("Nouvelle étude"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")')
      .first()
      .click();
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 25000 });

    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __calpinageRecomputePansFromGeometryAndUI?: () => void }).__calpinageRecomputePansFromGeometryAndUI ===
          'function' &&
        (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE != null &&
        (window as unknown as { CalpinagePans?: unknown }).CalpinagePans != null,
      { timeout: 40000 },
    );

    const snapshot = await page.evaluate(() => {
      const w = window as unknown as {
        CALPINAGE_STATE: {
          contours: unknown[];
          ridges: unknown[];
          traits: unknown[];
          roof: Record<string, unknown>;
          pans?: Array<{
            id?: string;
            physical?: {
              slope?: { computedDeg?: number | null };
              orientation?: { azimuthDeg?: number | null; label?: string | null };
              slopeDirectionLabel?: string | null;
            };
          }>;
        };
        __calpinageRecomputePansFromGeometryAndUI: () => void;
      };
      const st = w.CALPINAGE_STATE;
      st.contours = [
        {
          id: 'contour-pans-ui-1',
          roofRole: 'bati',
          points: [
            { x: 100, y: 250, h: 4 },
            { x: 400, y: 250, h: 4 },
            { x: 400, y: 100, h: 10 },
            { x: 100, y: 100, h: 10 },
          ],
        },
      ];
      st.ridges = [
        {
          id: 'ridge-pans-ui-1',
          a: { x: 100, y: 175, h: 8 },
          b: { x: 400, y: 175, h: 8 },
        },
      ];
      st.traits = [];
      st.roof = st.roof || {};
      const roof = st.roof as { scale?: { metersPerPixel?: number }; north?: { angleDeg?: number } };
      roof.scale = roof.scale || {};
      roof.scale.metersPerPixel = 0.02;
      roof.north = roof.north || { angleDeg: 30 };

      w.__calpinageRecomputePansFromGeometryAndUI();

      const slopeRows = Array.from(document.querySelectorAll('.pan-panel-slope-computed')).map((el) =>
        (el.textContent || '').trim(),
      );
      const inclValues = Array.from(document.querySelectorAll('.pan-panel-inclinaison-row input')).map((el) =>
        (el as HTMLInputElement).value.trim(),
      );
      const orientValues = Array.from(document.querySelectorAll('.pans-accordion-body .pan-panel-value')).map((el) =>
        (el.textContent || '').trim(),
      );

      const pans = (st.pans || []).map((p) => ({
        id: p.id,
        computedDeg: p.physical && p.physical.slope ? p.physical.slope.computedDeg : null,
        azimuthDeg: p.physical && p.physical.orientation ? p.physical.orientation.azimuthDeg : null,
        orientLabel: p.physical && p.physical.orientation ? p.physical.orientation.label : null,
        slopeDirectionLabel: p.physical?.slopeDirectionLabel ?? null,
      }));

      return { slopeRows, inclValues, orientValues, pans, panCount: (st.pans || []).length };
    });

    expect(runtimeErrors, `pageerror: ${runtimeErrors.join('; ')}`).toEqual([]);
    expect(snapshot.panCount, 'au moins un pan dérivé').toBeGreaterThan(0);

    const hasNonZeroSlopeUi = snapshot.slopeRows.some((t) => /\b[1-9]\d*\s*°/.test(t) || /:\s*[1-9]/.test(t));
    const hasNonZeroSlopeState = snapshot.pans.some(
      (p) => typeof p.computedDeg === 'number' && Number.isFinite(p.computedDeg) && p.computedDeg > 0.5,
    );
    expect(
      hasNonZeroSlopeUi || hasNonZeroSlopeState,
      `attendu pente > 0 (UI: ${JSON.stringify(snapshot.slopeRows)} state: ${JSON.stringify(snapshot.pans)})`,
    ).toBe(true);

    const hasNonTrivialAzimuth = snapshot.pans.some(
      (p) => typeof p.azimuthDeg === 'number' && Number.isFinite(p.azimuthDeg) && p.azimuthDeg > 1,
    );
    expect(
      hasNonTrivialAzimuth,
      `attendu azimut non nul (state: ${JSON.stringify(snapshot.pans)})`,
    ).toBe(true);

    console.log('[PANS_PANEL_UI_RUNTIME]', JSON.stringify(snapshot, null, 2));
  });
});
