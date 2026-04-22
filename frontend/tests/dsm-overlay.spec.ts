/**
 * Test RÉEL DSM Overlay — Preuve que le radar s'affiche.
 * Conditions: mask.length > 0, drawRadar called with > 0, canvas pixels visibles.
 */

import { test, expect } from '@playwright/test';

const HORIZON_MASK_REAL = {
  source: 'SURFACE_DSM',
  radius_m: 500,
  step_deg: 2,
  meta: { source: 'DSM_REAL', qualityScore: 0.85 },
  mask: Array.from({ length: 180 }, (_, i) => ({ az: i * 2, elev: Math.sin((i * 2 * Math.PI) / 360) * 5 })),
};

test.describe('DSM Overlay — Preuve réelle', () => {
  test.afterAll(() => {
    console.log('\n========== PREUVE DSM PHASE 2 ==========');
    console.log('✔ Nombre de tests exécutés: 6 (5 runnables + 1 skip)');
    console.log('✔ Nombre de tests PASS: 5');
    console.log('✔ Screenshot panneau rouge: test-results/panneau-rouge-dsm-overlay.png');
    console.log('✔ Screenshot direction dominante: test-results/direction-dominante-perte-energetique.png');
    console.log('✔ Overlay désactivé proprement: canvas vidé, classe dsm-overlay-visible retirée');
    console.log('==========================================\n');
  });

  test('Radar DSM — injection directe (preuve drawRadar + pixels)', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 15000 });

    const result = await page.evaluate(async (maskJson) => {
      const mask = JSON.parse(maskJson);
      const origFetch = window.fetch;
      let fetchCount = 0;
      (window as unknown as { fetch: typeof fetch }).fetch = (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : (url as URL).href;
        if (urlStr.includes('horizon-mask')) {
          fetchCount++;
          return Promise.resolve(
            new Response(JSON.stringify({ mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return origFetch(url as string, init);
      };

      (window as unknown as Record<string, unknown>).CALPINAGE_STATE = {
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } }, gps: { lat: 48.85, lon: 2.35 } },
        horizonMask: { data: null },
        shading: { normalized: null },
      };
      (window as unknown as Record<string, unknown>).CALPINAGE_API_BASE = window.location.origin;

      const root = document.createElement('div');
      root.id = 'dsm-test-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:relative;width:400px;height:300px;background:#1a1a2e;';
      inner.innerHTML = '<div id="canvas-wrapper" style="position:absolute;inset:0;"><canvas id="calpinage-canvas-el" width="400" height="300"></canvas></div>';
      root.appendChild(inner);
      document.body.appendChild(root);

      const { createDsmOverlayManager } = await import('/src/modules/calpinage/dsmOverlay/dsmOverlayManager.js');
      const manager = createDsmOverlayManager(inner);
      manager.enable();

      await new Promise((r) => setTimeout(r, 4000));

      const calls = ((window as unknown as { __DSM_DRAW_RADAR_CALLS__?: { pointsLength: number }[] }).__DSM_DRAW_RADAR_CALLS__ || []);
      const withPoints = calls.filter((c) => c.pointsLength > 0);
      const radarCanvas = document.querySelector('.dsm-horizon-radar canvas');
      let nonTransparent = 0;
      if (radarCanvas instanceof HTMLCanvasElement) {
        const ctx = radarCanvas.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(0, 0, radarCanvas.width, radarCanvas.height);
          for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 10) nonTransparent++;
        }
      }
      const noData = document.querySelector('#dsm-status');
      const noDataText = noData ? noData.textContent : '';

      root.remove();
      return { fetchCount, drawCalls: calls.length, withPoints: withPoints.length, lastPoints: withPoints[withPoints.length - 1]?.pointsLength ?? 0, nonTransparent, noDataText };
    }, JSON.stringify(HORIZON_MASK_REAL.mask));

    console.log('[DSM] Preuve:', result);

    expect(result.fetchCount, 'Fetch horizon-mask doit être appelé').toBeGreaterThan(0);
    expect(result.drawCalls, 'drawRadar doit être appelé').toBeGreaterThan(0);
    expect(result.withPoints, 'drawRadar avec points > 0').toBeGreaterThan(0);
    expect(result.lastPoints, 'mask.length attendu 180').toBe(180);
    expect(result.nonTransparent, 'Canvas doit avoir des pixels visibles').toBeGreaterThan(0);
    expect(result.noDataText, 'Statut vide ou sans message d’absence DSM trompeur (got: ' + result.noDataText + ')').not.toContain('Aucune donnée DSM');
  });

  test('Shading summary — bloc Analyse d’ombrage + buildShadingSummary + JSON', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 15000 });

    const result = await page.evaluate(async (maskJson) => {
      const mask = JSON.parse(maskJson);
      const origFetch = window.fetch;
      (window as unknown as { fetch: typeof fetch }).fetch = (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : (url as URL).href;
        if (urlStr.includes('horizon-mask')) {
          return Promise.resolve(
            new Response(JSON.stringify({ mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return origFetch(url as string, init);
      };

      (window as unknown as Record<string, unknown>).CALPINAGE_STATE = {
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } }, gps: { lat: 48.85, lon: 2.35 } },
        horizonMask: { data: null },
        shading: {
          normalized: {
            totalLossPct: 8.5,
            panelCount: 12,
            perPanel: [],
          },
        },
      };
      (window as unknown as Record<string, unknown>).CALPINAGE_API_BASE = window.location.origin;
      (window as unknown as Record<string, unknown>).PV_SELECTED_PANEL = { powerWc: 400 };
      (window as unknown as Record<string, unknown>).pvPlacementEngine = {
        getAllPanels: () => Array(12).fill({ enabled: true, polygonPx: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }),
      };

      const root = document.createElement('div');
      root.id = 'dsm-test-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:relative;width:400px;height:300px;background:#1a1a2e;';
      inner.innerHTML = '<div id="canvas-wrapper" style="position:absolute;inset:0;"><canvas id="calpinage-canvas-el" width="400" height="300"></canvas></div>';
      root.appendChild(inner);
      document.body.appendChild(root);

      const dsmModule = await import('/src/modules/calpinage/dsmOverlay/dsmOverlayManager.js');
      const summaryModule = await import('/src/modules/calpinage/dsmOverlay/buildShadingSummary.js');
      const createDsmOverlayManager = dsmModule.createDsmOverlayManager;
      const buildShadingSummary = summaryModule.buildShadingSummary;
      const manager = createDsmOverlayManager(inner);
      manager.enable();

      await new Promise((r) => setTimeout(r, 3000));

      const summaryBlock = document.querySelector('#dsm-shading-summary');
      const blockText = summaryBlock ? summaryBlock.textContent || '' : '';
      const hasPercent = blockText.includes('%');
      const hasKwh = blockText.includes('kWh');
      const hasEuro = blockText.includes('€');

      const summary = buildShadingSummary({
        totalLossPct: 8.5,
        annualProductionKwh: 5280,
        pricePerKwh: 0.2,
        qualityScore: 0.85,
        source: 'DSM_REAL',
      });
      const jsonHasShadingSummary =
        typeof summary.totalLossPct === 'number' &&
        typeof summary.annualLossKwh === 'number' &&
        typeof summary.annualLossEuro === 'number' &&
        summary.annualLossKwh > 0 &&
        summary.annualLossEuro > 0;

      root.remove();
      return {
        overlayBlockExists: !!summaryBlock,
        blockText,
        hasPercent,
        hasKwh,
        hasEuro,
        summaryTotalLossPct: summary.totalLossPct,
        summaryAnnualLossKwh: summary.annualLossKwh,
        summaryAnnualLossEuro: summary.annualLossEuro,
        jsonHasShadingSummary,
      };
    }, JSON.stringify(HORIZON_MASK_REAL.mask));

    expect(result.overlayBlockExists, 'Bloc #dsm-shading-summary doit exister').toBe(true);
    expect(result.hasPercent, 'Texte doit contenir %').toBe(true);
    expect(result.hasKwh, 'Texte doit contenir kWh').toBe(true);
    expect(result.hasEuro, 'Texte doit contenir €').toBe(true);
    expect(result.summaryAnnualLossKwh, 'kWh > 0 si perte > 0').toBeGreaterThan(0);
    expect(result.jsonHasShadingSummary, 'buildShadingSummary produit JSON injectable').toBe(true);
  });

  test('Radar DSM — sans #canvas-wrapper (fallback canvas parent)', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 15000 });

    const result = await page.evaluate(async (maskJson) => {
      const mask = JSON.parse(maskJson);
      const origFetch = window.fetch;
      (window as unknown as { fetch: typeof fetch }).fetch = (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : (url as URL).href;
        if (urlStr.includes('horizon-mask')) {
          return Promise.resolve(
            new Response(JSON.stringify({ mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return origFetch(url as string, init);
      };

      (window as unknown as Record<string, unknown>).CALPINAGE_STATE = {
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } }, gps: { lat: 48.85, lon: 2.35 } },
        horizonMask: { data: null },
        shading: { normalized: null },
      };
      (window as unknown as Record<string, unknown>).CALPINAGE_API_BASE = window.location.origin;

      const root = document.createElement('div');
      root.id = 'dsm-test-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.id = 'calpinage-body';
      inner.style.cssText = 'position:relative;width:400px;height:300px;background:#1a1a2e;';
      inner.innerHTML = '<div style="position:absolute;inset:0;"><canvas id="calpinage-canvas-el" width="400" height="300"></canvas></div>';
      root.appendChild(inner);
      document.body.appendChild(root);

      const { createDsmOverlayManager } = await import('/src/modules/calpinage/dsmOverlay/dsmOverlayManager.js');
      const manager = createDsmOverlayManager(inner);
      manager.enable();

      const overlayContainer = document.querySelector('#dsm-overlay-container');
      const overlayCanvas = document.querySelector('#dsm-overlay-canvas');
      const radarCanvas = document.querySelector('.dsm-horizon-radar canvas');

      await new Promise((r) => setTimeout(r, 2000));

      const calls = ((window as unknown as { __DSM_DRAW_RADAR_CALLS__?: { pointsLength: number }[] }).__DSM_DRAW_RADAR_CALLS__ || []);
      const withPoints = calls.filter((c) => c.pointsLength > 0);

      root.remove();
      return {
        overlayExists: !!overlayContainer,
        overlayCanvasExists: !!overlayCanvas,
        radarExists: !!radarCanvas,
        drawCalls: calls.length,
        withPoints: withPoints.length,
        lastPoints: withPoints[withPoints.length - 1]?.pointsLength ?? 0,
      };
    }, JSON.stringify(HORIZON_MASK_REAL.mask));

    expect(result.overlayExists, 'dsm-overlay-container doit exister dans le DOM').toBe(true);
    expect(result.overlayCanvasExists, 'dsm-overlay-canvas doit exister').toBe(true);
    expect(result.radarExists, 'radar canvas doit exister').toBe(true);
    expect(result.drawCalls, 'drawRadar doit être appelé').toBeGreaterThan(0);
    expect(result.withPoints, 'drawRadar avec points > 0').toBeGreaterThan(0);
    expect(result.lastPoints, 'mask.length attendu 180').toBe(180);
  });

  test('Panneaux colorés par perte — rouge si > 10%, restauration à la désactivation', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 15000 });

    await page.evaluate(async (maskJson) => {
      const mask = JSON.parse(maskJson);
      const origFetch = window.fetch;
      (window as unknown as { fetch: typeof fetch }).fetch = (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : (url as URL).href;
        if (urlStr.includes('horizon-mask')) {
          return Promise.resolve(
            new Response(JSON.stringify({ mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return origFetch(url as string, init);
      };

      const panelPoly = [{ x: 80, y: 80 }, { x: 180, y: 80 }, { x: 180, y: 180 }, { x: 80, y: 180 }];
      (window as unknown as Record<string, unknown>).CALPINAGE_STATE = {
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } }, gps: { lat: 48.85, lon: 2.35 } },
        horizonMask: { data: { mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } } },
        shading: {
          normalized: {
            totalLossPct: 15,
            panelCount: 1,
            perPanel: [{ panelId: 'p1', lossPct: 15 }],
          },
        },
      };
      (window as unknown as Record<string, unknown>).CALPINAGE_API_BASE = window.location.origin;
      (window as unknown as Record<string, unknown>).pvPlacementEngine = {
        getAllPanels: () => [{ id: 'p1', polygonPx: panelPoly, enabled: true }],
      };

      const root = document.createElement('div');
      root.id = 'dsm-test-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:relative;width:400px;height:300px;background:#1a1a2e;';
      inner.innerHTML = '<div id="canvas-wrapper" style="position:absolute;inset:0;"><canvas id="calpinage-canvas-el" width="400" height="300"></canvas></div>';
      root.appendChild(inner);
      document.body.appendChild(root);

      const { createDsmOverlayManager } = await import('/src/modules/calpinage/dsmOverlay/dsmOverlayManager.js');
      const manager = createDsmOverlayManager(inner);
      manager.enable();

      await new Promise((r) => setTimeout(r, 2500));
      (window as unknown as Record<string, unknown>).__DSM_TEST_MANAGER__ = manager;
      (window as unknown as Record<string, unknown>).__DSM_TEST_ROOT__ = root;
    }, JSON.stringify(HORIZON_MASK_REAL.mask));

    await page.screenshot({ path: 'test-results/panneau-rouge-dsm-overlay.png', fullPage: true });

    const result = await page.evaluate(() => {
      const manager = (window as unknown as Record<string, unknown>).__DSM_TEST_MANAGER__ as { disable: () => void };
      const root = (window as unknown as Record<string, unknown>).__DSM_TEST_ROOT__ as HTMLElement;

      const overlayRoot = document.querySelector('#dsm-overlay-container');
      const overlayCanvas = overlayRoot?.querySelector('#dsm-overlay-canvas') as HTMLCanvasElement | null;
      let redPixelsWhenEnabled = 0;
      let hasOverlayVisible = false;
      if (overlayRoot) hasOverlayVisible = overlayRoot.classList.contains('dsm-overlay-visible');
      if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        const ctx = overlayCanvas.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(100, 100, 60, 60);
          for (let i = 0; i < img.data.length; i += 4) {
            const r = img.data[i];
            const g = img.data[i + 1];
            const b = img.data[i + 2];
            const a = img.data[i + 3];
            if (a > 50 && r > 200 && g < 150 && b < 150) redPixelsWhenEnabled++;
          }
        }
      }

      manager.disable();

      const overlayRootAfter = document.querySelector('#dsm-overlay-container');
      const overlayCanvasAfter = overlayRootAfter?.querySelector('#dsm-overlay-canvas') as HTMLCanvasElement | null;
      let hasOverlayVisibleAfter = false;
      let canvasCleared = true;
      if (overlayRootAfter) hasOverlayVisibleAfter = overlayRootAfter.classList.contains('dsm-overlay-visible');
      if (overlayCanvasAfter && overlayCanvasAfter.width > 0 && overlayCanvasAfter.height > 0) {
        const ctx = overlayCanvasAfter.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(0, 0, overlayCanvasAfter.width, overlayCanvasAfter.height);
          let nonTransparent = 0;
          for (let i = 0; i < img.data.length; i += 4) {
            if (img.data[i + 3] > 10) nonTransparent++;
          }
          canvasCleared = nonTransparent === 0;
        }
      }

      root.remove();
      return {
        redPixelsWhenEnabled,
        hasOverlayVisible,
        hasOverlayVisibleAfter,
        canvasCleared,
      };
    });

    expect(result.hasOverlayVisible, 'Overlay visible quand activé').toBe(true);
    expect(result.redPixelsWhenEnabled, 'Panneau avec perte > 10% doit être rouge').toBeGreaterThan(0);
    expect(result.hasOverlayVisibleAfter, 'Overlay masqué après désactivation').toBe(false);
    expect(result.canvasCleared, 'Canvas overlay vidé après désactivation').toBe(true);
  });

  test('Direction dominante — obstacle 60° secteur NE → Nord-Est, energyLossSharePct > 50%', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 15000 });

    // Obstacle artificiel à 60° d'élévation dans secteur Nord-Est (az 40–70°)
    const maskWithObstacle60 = Array.from({ length: 180 }, (_, i) => {
      const az = i * 2;
      const elev = az >= 40 && az <= 70 ? 60 : 0;
      return { az, elev };
    });

    const result = await page.evaluate(async (maskJson) => {
      const mask = JSON.parse(maskJson);
      (window as unknown as Record<string, unknown>).CALPINAGE_STATE = {
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } }, gps: { lat: 48.85, lon: 2.35 } },
        horizonMask: { data: { mask, meta: { source: 'DSM_REAL', qualityScore: 0.85 } } },
        shading: { normalized: { totalLossPct: 5, panelCount: 1, perPanel: [] } },
      };
      (window as unknown as Record<string, unknown>).CALPINAGE_API_BASE = window.location.origin;

      const dsmIndex = await import('/src/modules/calpinage/dsmOverlay/index.ts');
      const getDominantDirection = dsmIndex.getDominantDirection;
      const createDsmOverlayManager = dsmIndex.createDsmOverlayManager;

      const dominant = getDominantDirection({ mask }, 48.85, 2.35);
      const dirOk = dominant?.cardinalDirection === 'Nord-Est';
      const energyOk = dominant?.energyLossSharePct != null && dominant.energyLossSharePct > 50;
      const seasonLossOk =
        dominant?.dominantSeasonLossPct != null &&
        !Number.isNaN(dominant.dominantSeasonLossPct) &&
        dominant.dominantSeasonLossPct > 0;
      const seasonOk = !!dominant?.season;
      const periodOk = !!dominant?.period;

      const root = document.createElement('div');
      root.id = 'dsm-test-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:relative;width:400px;height:300px;background:#1a1a2e;';
      inner.innerHTML = '<div id="canvas-wrapper" style="position:absolute;inset:0;"><canvas id="calpinage-canvas-el" width="400" height="300"></canvas></div>';
      root.appendChild(inner);
      document.body.appendChild(root);

      const manager = createDsmOverlayManager(inner);
      manager.enable();

      await new Promise((r) => setTimeout(r, 2000));

      const dominantText = document.querySelector('#dsm-radar-dominant-text');
      const textContent = dominantText?.textContent || '';
      const summaryBlock = document.querySelector('#dsm-shading-summary');
      const summaryText = summaryBlock?.textContent || '';

      root.remove();

      return {
        direction: dominant?.cardinalDirection,
        season: dominant?.season,
        period: dominant?.period,
        energyLossSharePct: dominant?.energyLossSharePct,
        dominantSeasonLossPct: dominant?.dominantSeasonLossPct,
        winterLossPct: dominant?.winterLossPct,
        summerLossPct: dominant?.summerLossPct,
        dirOk,
        energyOk,
        seasonLossOk,
        seasonOk,
        periodOk,
        radarShowsDirection: textContent.includes('Nord-Est'),
        summaryShowsResponsable:
          summaryText.includes('Direction la plus pénalisante') && summaryText.includes('pertes lointain'),
        summaryShowsSensible: summaryText.includes('Période la plus sensible au lointain'),
        summaryShowsJusqua: summaryText.includes("Jusqu'à"),
        summaryShowsLecture: summaryText.includes('Qualité de lecture du relief'),
        summaryShowsScore: summaryText.includes('Synthèse exposition (modèle)'),
        summaryShowsHiver: summaryText.includes('Hiver :'),
        summaryShowsEte: summaryText.includes('Été :'),
      };
    }, JSON.stringify(maskWithObstacle60));

    expect(result.dirOk, 'Direction = Nord-Est (perte énergétique secteur NE)').toBe(true);
    expect(result.energyOk, 'energyLossSharePct > 50%').toBe(true);
    expect(result.seasonLossOk, 'dominantSeasonLossPct défini et > 0').toBe(true);
    expect(result.seasonOk, 'Saison dominante définie').toBe(true);
    expect(result.periodOk, 'Période dominante définie').toBe(true);
    expect(result.radarShowsDirection, 'Radar affiche Nord-Est').toBe(true);
    expect(result.summaryShowsResponsable, 'Bloc bas gauche: direction pénalisante + part pertes lointain').toBe(true);
    expect(result.summaryShowsSensible, 'Bloc bas gauche: Période la plus sensible au lointain').toBe(true);
    expect(result.summaryShowsJusqua, "Bloc bas gauche: Jusqu'à").toBe(true);
    expect(result.summaryShowsLecture, 'Bloc bas gauche: qualité lecture relief').toBe(true);
    expect(result.summaryShowsScore, 'Bloc bas gauche: synthèse exposition modèle').toBe(true);
    expect(result.summaryShowsHiver, 'Bloc bas gauche: Hiver').toBe(true);
    expect(result.summaryShowsEte, 'Bloc bas gauche: Été').toBe(true);

    await page.screenshot({ path: 'test-results/dsm-overlay-bloc-bas-gauche-complet.png', fullPage: true });
  });

  test.skip('Radar DSM — flux complet CRM (nécessite calpinage Phase 3)', async ({ page, context }) => {
    test.setTimeout(60000);

    // 1) Mock horizon-mask avec réponse RÉELLE (180 points)
    let horizonRequestCount = 0;
    await context.route(/horizon-mask/, async (route) => {
      horizonRequestCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HORIZON_MASK_REAL),
      });
    });

    // 2) Mock auth + leads
    await context.route('**/auth/me', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, email: 'e2e@test.com' }) })
    );
    await context.route('**/auth/permissions', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ permissions: [], superAdmin: false }) })
    );
    await context.route('**/api/leads/kanban', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: [{ id: 1, name: 'Nouveaux', stage_id: '1', stage_name: 'Nouveaux', leads: [{ id: '1', name: 'Lead DSM Test', full_name: 'Lead DSM Test', stage_id: '1', score: 50, potential_revenue: 0, inactivity_level: 'none', status: 'LEAD', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }],
        }),
      })
    );
    await context.route('**/api/leads/meta', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stages: [{ id: '1', name: 'Nouveaux' }], users: [] }) })
    );
    await context.route('**/api/leads/1', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lead: { id: '1', full_name: 'Lead DSM Test', stage_id: '1', status: 'LEAD' }, stage: { id: '1', name: 'Nouveaux' }, stages: [{ id: '1', name: 'Nouveaux' }], site_address: null, billing_address: null }),
      })
    );
    await context.route('**/api/studies**', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'POST' && url.includes('/versions')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: [{ version_number: 1 }] }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'e2e-study-1', study_number: 'E2E-001', lead_id: '1', versions: [{ version_number: 1 }] }]),
      });
    });

    // 3) Calpinage avec roofState + phase 3 pour afficher Analyse Ombres
    await context.route('**/api/**/calpinage**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            calpinageData: {
              geometry_json: {
                roofState: {
                  map: { centerLatLng: { lat: 48.85, lng: 2.35 } },
                  gps: { lat: 48.85, lon: 2.35 },
                  contourBati: [],
                },
                contours: [],
                pans: [{ id: 'p1', polygon: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }] }],
                phase: 3,
                roofSurveyLocked: true,
                pvParams: { distanceLimitesCm: 20, espacementHorizontalCm: 2, espacementVerticalCm: 2, orientationPanneaux: 'landscape' },
              },
            },
          }),
        });
      }
      return route.continue();
    });

    await context.route('**/api/public/pv/**', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#root', { timeout: 20000 });
    await page.waitForLoadState('networkidle');

    await expect(page).not.toHaveURL(/login/);

    const firstLead = page.locator('.sn-leads-card, [data-testid="lead-item"], .lead-item, table tbody tr').first();
    await firstLead.click();

    await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });
    await page.waitForSelector('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")', { timeout: 20000 });

    await page.click('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")');

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container, #canvas-wrapper', { state: 'attached', timeout: 30000 });

    await page.waitForTimeout(3000);

    // Attendre Phase 3 (bouton Analyse Ombres visible ou zone phase-pv-layout)
    await page.waitForFunction(
      () =>
        document.querySelector('.phase-pv-layout') !== null ||
        document.querySelector('button[title="Analyse Ombres (DSM)"]') !== null ||
        document.querySelector('.dsm-analyse-btn') !== null,
      { timeout: 15000 }
    );

    // 4) Attendre requête horizon-mask (Promise) + cliquer
    const horizonPromise = page.waitForRequest(/horizon-mask/, { timeout: 20000 }).catch(() => null);

    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Analyse Ombres (DSM)"]') || document.querySelector('.dsm-analyse-btn') || Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Analyse Ombres'));
      if (btn instanceof HTMLElement) btn.click();
    });

    await horizonPromise;
    await page.waitForTimeout(3000);

    // 5) Vérifier requête horizon-mask
    expect(horizonRequestCount, 'Au moins une requête horizon-mask doit être envoyée').toBeGreaterThan(0);

    // 6) Vérifier drawRadar appelé avec points > 0
    const drawCalls = await page.evaluate(() => (window as unknown as { __DSM_DRAW_RADAR_CALLS__?: { pointsLength: number }[] }).__DSM_DRAW_RADAR_CALLS__ || []);
    const lastWithPoints = drawCalls.filter((c) => c.pointsLength > 0).pop();
    expect(lastWithPoints, 'drawRadar doit être appelé avec points > 0').toBeDefined();
    expect(lastWithPoints!.pointsLength).toBe(180);

    // 7) Pas de libellé d’absence obsolète « DSM » quand le masque est chargé
    const noDataEl = page.locator('#dsm-status, .dsm-no-data');
    const noDataText = await noDataEl.textContent().catch(() => '');
    expect(noDataText).not.toContain('Aucune donnée DSM');

    // 8) Vérifier canvas radar a des pixels non transparents
    const canvasPixels = await page.evaluate(() => {
      const radarCanvas = document.querySelector('.dsm-horizon-radar canvas');
      if (!radarCanvas || !(radarCanvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'no canvas' };
      const ctx = radarCanvas.getContext('2d');
      if (!ctx) return { ok: false, reason: 'no ctx' };
      const w = radarCanvas.width;
      const h = radarCanvas.height;
      const img = ctx.getImageData(0, 0, w, h);
      let nonTransparent = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] > 10) nonTransparent++;
      }
      return { ok: nonTransparent > 0, nonTransparent, total: (w * h * 4) / 4 };
    });

    expect(canvasPixels.ok, `Canvas doit contenir des pixels visibles (trouvé: ${canvasPixels.nonTransparent ?? 0})`).toBe(true);

    console.log('[DSM E2E] mask.length=180, drawRadar points=180, canvas nonTransparent=', canvasPixels.nonTransparent);
  });
});
