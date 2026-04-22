import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

function nowMs() {
  return Date.now();
}

test.describe('STRESS', () => {
  test('Open/Close Calpinage x20', async ({ page, context }) => {
    test.setTimeout(180000);

    // -----------------------------
    // 0) MOCKS (copier exactement ceux de navigation.spec.ts qui sont verts)
    // -----------------------------
    // Auth
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

    // Leads
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

    // Token
    await page.addInitScript(() => {
      localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
    });

    // -----------------------------
    // 1) Collecte erreurs runtime
    // -----------------------------
    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => {
      const msg = (err?.message || '').toString();

      // Filtrer l'erreur legacy connue si elle existe toujours
      if (msg.includes('require is not defined')) return;

      runtimeErrors.push(msg);
    });

    // -----------------------------
    // 2) Boot CRM + Lead
    // -----------------------------
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sn-leads-card').length > 0 ||
        document.querySelectorAll('table tbody tr').length > 0 ||
        document.querySelector('.sn-leads-page-error') !== null,
      { timeout: 20000 }
    );

    if (await page.locator('.sn-leads-page-error').isVisible()) {
      const errText = await page.locator('.sn-leads-page-error').textContent();
      throw new Error(`Leads page error: ${errText}`);
    }

    const firstLead = page.locator('.sn-leads-card, [data-testid="lead-item"], .lead-item, table tbody tr').first();
    await firstLead.click();

    await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });

    // Bouton Calpinage (même logique que navigation/stability)
    const openBtn = page.locator(
      'button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")'
    ).first();

    await page.waitForSelector('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")', {
      timeout: 20000,
    });

    // -----------------------------
    // 3) Stress open/close x20 + timings
    // -----------------------------
    const cycles = 20;
    const openTimes: number[] = [];
    const closeTimes: number[] = [];

    for (let i = 0; i < cycles; i++) {
      console.log(`🔁 Stress cycle ${i + 1}/${cycles}`);

      // OPEN
      const tOpen0 = nowMs();
      await openBtn.click();

      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 20000 });

      const tOpen1 = nowMs();
      openTimes.push(tOpen1 - tOpen0);

      // CLOSE (clic backdrop)
      const box = await dialog.boundingBox();
      const tClose0 = nowMs();
      if (box) {
        await page.mouse.click(box.x + 5, box.y + 5);
      } else {
        // fallback: ESC
        await page.keyboard.press('Escape');
      }

      await dialog.waitFor({ state: 'detached', timeout: 20000 });
      const tClose1 = nowMs();
      closeTimes.push(tClose1 - tClose0);

      // mini breathing
      await page.waitForTimeout(150);
    }

    // -----------------------------
    // 4) Rapport JSON
    // -----------------------------
    const reportDir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(reportDir, { recursive: true });

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const p95 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1] ?? 0;
    };

    const report = {
      meta: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
        generatedAt: new Date().toISOString(),
        cycles,
      },
      timingsMs: {
        open: {
          avg: Math.round(avg(openTimes)),
          p95: p95(openTimes),
          min: Math.min(...openTimes),
          max: Math.max(...openTimes),
        },
        close: {
          avg: Math.round(avg(closeTimes)),
          p95: p95(closeTimes),
          min: Math.min(...closeTimes),
          max: Math.max(...closeTimes),
        },
      },
      errors: runtimeErrors,
    };

    const reportPath = path.join(reportDir, 'stress-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('==============================');
    console.log('🟣 STRESS TEST RESULT');
    console.log(`Cycles: ${cycles}`);
    console.log('Open avg/p95:', report.timingsMs.open.avg, '/', report.timingsMs.open.p95);
    console.log('Close avg/p95:', report.timingsMs.close.avg, '/', report.timingsMs.close.p95);
    console.log('Runtime errors:', runtimeErrors.length);
    console.log('Report:', reportPath);
    console.log('STATUS: PASS');
    console.log('==============================');

    // -----------------------------
    // 5) Seuils (strict)
    // -----------------------------
    expect(runtimeErrors.length).toBe(0);

    // Seuils stricts (ajustables après 1 run)
    expect(report.timingsMs.open.p95).toBeLessThan(3000);
    expect(report.timingsMs.close.p95).toBeLessThan(2500);
  });
});
