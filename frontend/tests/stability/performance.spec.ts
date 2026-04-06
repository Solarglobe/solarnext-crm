import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

function nowMs() {
  return Date.now();
}

// Agrégation simple d'événements de trace Chrome (dur en microsecondes)
function aggregateTraceDurations(traceJson: { traceEvents?: Array<{ name?: string; dur?: number }> }) {
  const events = traceJson?.traceEvents || [];
  const buckets: Record<string, number> = {
    RecalculateStyle: 0,
    Layout: 0,
    UpdateLayerTree: 0,
    Paint: 0,
    CompositeLayers: 0,
    RasterTask: 0,
    FunctionCall: 0,
    EvaluateScript: 0,
    MinorGC: 0,
    MajorGC: 0,
  };

  for (const e of events) {
    const name = e?.name;
    const dur = typeof e?.dur === 'number' ? e.dur : 0; // microseconds
    if (!name || !dur) continue;
    if (name in buckets) buckets[name] += dur;
  }

  // Convert to ms
  const msBuckets: Record<string, number> = {};
  for (const k of Object.keys(buckets)) msBuckets[k] = Math.round((buckets[k] / 1000) * 100) / 100;

  return msBuckets;
}

test.describe('PERFORMANCE', () => {
  test('Calpinage performance profiling (capture / shading / repaint)', async ({ page, context }) => {
    test.setTimeout(300000);

    // -----------------------------
    // 0) MOCKS (même stratégie que navigation.spec.ts)
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
                  full_name: 'Lead E2E Test',
                  stage_id: '1',
                  status: 'LEAD',
                  score: 80,
                  potential_revenue: 0,
                  inactivity_level: 'none',
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

    await page.addInitScript(() => {
      localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
    });

    // -----------------------------
    // 1) Démarrage CDP (Perf + Trace)
    // -----------------------------
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    const tracePath = path.join(process.cwd(), 'test-results', 'perf-trace.json');
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });

    const traceChunks: string[] = [];
    cdp.on('Tracing.dataCollected', (payload: { value?: unknown[] }) => {
      if (payload?.value) {
        for (const e of payload.value) traceChunks.push(JSON.stringify(e));
      }
    });

    const tracingCompletePromise = new Promise<void>((resolve) => {
      cdp.once('Tracing.tracingComplete', () => resolve());
    });

    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-devtools.timeline.paint',
        'disabled-by-default-devtools.timeline.stack',
        'blink.user_timing',
        'v8',
        'v8.execute',
        'v8.gc',
      ].join(','),
    });

    // -----------------------------
    // 2) Ouvrir CRM + Lead
    // -----------------------------
    await page.goto('/crm.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root', { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sn-leads-card').length > 0 ||
        document.querySelectorAll('table tbody tr').length > 0,
      { timeout: 20000 }
    );

    const leadCard = page.locator('.sn-leads-card, table tbody tr').first();
    await leadCard.click();

    await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });

    // -----------------------------
    // 3) Mesures PERF: Capture / Shading / Repaint
    // -----------------------------
    const openBtn = page.locator(
      'button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")'
    ).first();

    const tOpen0 = nowMs();
    await openBtn.click();

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 20000 });
    const tOpen1 = nowMs();
    const openMs = tOpen1 - tOpen0;

    // Mesure (B) CAPTURE
    let captureMs: number | null = null;
    const captureBtn = page.locator(
      'button:has-text("Capture"), button:has-text("Capturer"), button:has-text("Exporter"), button:has-text("Export")'
    ).first();

    if ((await captureBtn.count()) > 0) {
      const tC0 = nowMs();
      await captureBtn.click();
      await page.waitForTimeout(500);
      const tC1 = nowMs();
      captureMs = tC1 - tC0;
    } else {
      const tC0 = nowMs();
      await page.screenshot({
        path: path.join(process.cwd(), 'test-results', 'perf-capture.png'),
        fullPage: false,
      });
      const tC1 = nowMs();
      captureMs = tC1 - tC0;
    }

    // Mesure (C) SHADING (si bouton visible et enabled)
    let shadingMs: number | null = null;
    const shadingBtn = page.locator(
      'button:has-text("Valider le calpinage"), button:has-text("Calculer ombrage"), button:has-text("Shading"), button:has-text("Ombre")'
    ).first();

    const shadingVisible = (await shadingBtn.count()) > 0 && (await shadingBtn.isVisible());
    const shadingEnabled = shadingVisible && !(await shadingBtn.isDisabled());

    if (shadingEnabled) {
      const tS0 = nowMs();
      await shadingBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const tS1 = nowMs();
      shadingMs = tS1 - tS0;
    }

    // Fermer Calpinage (unmount)
    const dialog = page.locator('[role="dialog"]');
    const box = await dialog.boundingBox();
    if (box) await page.mouse.click(box.x + 5, box.y + 5);
    await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

    // -----------------------------
    // 4) Pull metrics CDP (repaint/layout/script)
    // -----------------------------
    let metrics: Record<string, number> = {};
    try {
      const perfMetrics = await cdp.send('Performance.getMetrics');
      const metricsArr: Array<{ name: string; value: number }> = (perfMetrics as { metrics?: Array<{ name: string; value: number }> })?.metrics || [];
      for (const m of metricsArr) metrics[m.name] = m.value;
    } catch {
      // Performance.getMetrics peut échouer selon le navigateur
    }

    await cdp.send('Tracing.end');
    await tracingCompletePromise;

    const traceEvents = traceChunks
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const traceJson = { traceEvents };

    fs.writeFileSync(tracePath, JSON.stringify(traceJson));

    const bucketsMs = aggregateTraceDurations(traceJson);

    // -----------------------------
    // 5) Rapport final JSON CI-ready
    // -----------------------------
    const report = {
      meta: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
        generatedAt: new Date().toISOString(),
      },
      timingsMs: {
        calpinageOpenMs: openMs,
        captureMs,
        shadingMs,
      },
      cdpMetrics: {
        TaskDuration: metrics.TaskDuration,
        ScriptDuration: metrics.ScriptDuration,
        LayoutDuration: metrics.LayoutDuration,
        RecalcStyleDuration: metrics.RecalcStyleDuration,
        JSHeapUsedSize: metrics.JSHeapUsedSize,
        JSHeapTotalSize: metrics.JSHeapTotalSize,
        Nodes: metrics.Nodes,
        Documents: metrics.Documents,
        Frames: metrics.Frames,
        JSEventListeners: metrics.JSEventListeners,
      },
      traceBucketsMs: bucketsMs,
      thresholds: {
        maxOpenMs: 4000,
        maxCaptureMs: 2500,
        maxShadingMs: 10000,
        maxLayoutMs: 2000,
        maxPaintMs: 2000,
      },
    };

    const reportPath = path.join(process.cwd(), 'test-results', 'perf-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('==============================');
    console.log('🟣 PERFORMANCE TEST RESULT');
    console.log(`Open Calpinage: ${openMs} ms`);
    console.log(`Capture: ${captureMs ?? 'n/a'} ms`);
    console.log(`Shading: ${shadingMs ?? 'n/a'} ms`);
    console.log('CDP metrics (subset):', report.cdpMetrics);
    console.log('Trace buckets ms:', bucketsMs);
    console.log('Report:', reportPath);
    console.log('Trace:', tracePath);
    console.log('==============================');

    // -----------------------------
    // 6) Seuils (fail auto si régression)
    // -----------------------------
    expect(openMs).toBeLessThan(report.thresholds.maxOpenMs);

    if (typeof captureMs === 'number') {
      expect(captureMs).toBeLessThan(report.thresholds.maxCaptureMs);
    }

    if (typeof shadingMs === 'number') {
      expect(shadingMs).toBeLessThan(report.thresholds.maxShadingMs);
    }

    if (typeof bucketsMs.Layout === 'number') {
      expect(bucketsMs.Layout).toBeLessThan(report.thresholds.maxLayoutMs);
    }
    if (typeof bucketsMs.Paint === 'number') {
      expect(bucketsMs.Paint).toBeLessThan(report.thresholds.maxPaintMs);
    }
  });
});
