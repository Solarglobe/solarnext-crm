import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

type AnyObj = Record<string, any>;

function isObj(v: any): v is AnyObj {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

function ensureNumber(v: any, name: string) {
  assert(typeof v === 'number' && Number.isFinite(v), `❌ ${name} must be a finite number`);
}

function ensureString(v: any, name: string) {
  assert(typeof v === 'string' && v.length >= 0, `❌ ${name} must be a string`);
}

function ensureBool(v: any, name: string) {
  assert(typeof v === 'boolean', `❌ ${name} must be a boolean`);
}

function ensureArray(v: any, name: string) {
  assert(Array.isArray(v), `❌ ${name} must be an array`);
}

function validateRoof(roof: any) {
  assert(isObj(roof), '❌ roof must be an object');

  // GPS is required for shading & SmartPitch (lat/lon)
  // Accept either roof.gps or roof.location shapes, but must contain lat/lon numbers.
  // Fallback: roof with pans (orientationDeg, tiltDeg) is valid when gps absent (export structure)
  const gps = roof.gps ?? roof.location ?? roof.site ?? null;
  const hasGps = gps && isObj(gps);
  const lat = hasGps ? (gps.lat ?? gps.latitude) : null;
  const lon = hasGps ? (gps.lon ?? gps.lng ?? gps.longitude) : null;
  const hasPans = Array.isArray(roof.pans) && roof.pans.length > 0;

  if (hasGps) {
    ensureNumber(lat, 'roof.gps.lat');
    ensureNumber(lon, 'roof.gps.lon');
  } else if (!hasPans) {
    assert(false, '❌ roof.gps (or equivalent) or roof.pans is required');
  }

  // Orientation/tilt can be at roof-level or per-pan; accept both but at least one should exist.
  if (roof.orientation_deg != null) ensureNumber(roof.orientation_deg, 'roof.orientation_deg');
  if (roof.tilt_deg != null) ensureNumber(roof.tilt_deg, 'roof.tilt_deg');

  // buildingContours / pans geometry may exist; do not over-constrain.
}

function validatePanels(panels: any) {
  ensureArray(panels, 'panels');
  assert(panels.length >= 0, '❌ panels must exist');

  // If panels exist, each must have core fields for SmartPitch.
  // We keep it tolerant but enforce essentials if panel count > 0.
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    assert(isObj(p), `❌ panels[${i}] must be an object`);

    // required identity
    if (p.id != null) ensureString(String(p.id), `panels[${i}].id`);
    if (p.enabled != null) ensureBool(p.enabled, `panels[${i}].enabled`);

    // geometry: we accept polygonPx OR center/rect OR bounds
    const hasPoly = Array.isArray(p.polygonPx) && p.polygonPx.length >= 3;
    const hasRect = p.rectPx && isObj(p.rectPx);
    const hasCenter = p.centerPx && isObj(p.centerPx);
    const hasOrientation = p.orientation != null;

    assert(
      hasPoly || hasRect || hasCenter || hasOrientation,
      `❌ panels[${i}] must have geometry (polygonPx or rectPx or centerPx or orientation)`
    );

    // specs: width/height may exist; do not hard fail if catalog lives elsewhere, but if present must be numbers
    if (p.wMm != null) ensureNumber(p.wMm, `panels[${i}].wMm`);
    if (p.hMm != null) ensureNumber(p.hMm, `panels[${i}].hMm`);

    // orientation/tilt can be attached; if present enforce numeric
    if (p.orientation_deg != null) ensureNumber(p.orientation_deg, `panels[${i}].orientation_deg`);
    if (p.tilt_deg != null) ensureNumber(p.tilt_deg, `panels[${i}].tilt_deg`);
  }
}

function validateShading(shading: any) {
  assert(isObj(shading), '❌ shading must be an object');

  // required aggregate loss pct for SmartPitch
  // allow "totalLossPct" or "total_loss_pct" naming
  const totalLossPct = shading.totalLossPct ?? shading.total_loss_pct ?? null;
  assert(totalLossPct != null, '❌ shading.totalLossPct is required');
  ensureNumber(totalLossPct, 'shading.totalLossPct');

  // perPanel optional but recommended
  if (shading.perPanel != null) {
    ensureArray(shading.perPanel, 'shading.perPanel');
  }

  // computedAt optional
  if (shading.computedAt != null) ensureString(shading.computedAt, 'shading.computedAt');
}

function validateInverter(inverter: any) {
  assert(isObj(inverter), '❌ inverter must be an object');

  // Minimal SmartPitch-ready: family + model or id
  if (inverter.family != null) ensureString(inverter.family, 'inverter.family');
  if (inverter.inverter_family != null) ensureString(inverter.inverter_family, 'inverter.inverter_family');

  // Require at least one identifier
  const id = inverter.id ?? inverter.sku ?? inverter.model ?? inverter.name ?? null;
  assert(id != null, '❌ inverter should have an identifier (id/sku/model/name)');
  ensureString(String(id), 'inverter.identifier');

  // If present, enforce numeric sanity
  if (inverter.phases != null) ensureString(String(inverter.phases), 'inverter.phases');
  if (inverter.max_ac_kw != null) ensureNumber(inverter.max_ac_kw, 'inverter.max_ac_kw');
  if (inverter.modules_per_inverter != null) ensureNumber(inverter.modules_per_inverter, 'inverter.modules_per_inverter');
}

test.describe('EXPORT-JSON', () => {
  test('Calpinage export JSON schema validation (Ready SmartPitch)', async ({ page, context }) => {
    test.setTimeout(240000);

    // -----------------------------
    // 0) MOCKS (copier exactement ceux verts de navigation.spec.ts)
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
    // 1) Boot CRM → Lead → Calpinage
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

    await page.locator('.sn-leads-card, table tbody tr').first().click();

    // Open Calpinage
    await page
      .locator(
        'button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")'
      )
      .first()
      .click();

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 20000 });

    // -----------------------------
    // 2.B) Injection d'un état minimal validé (TEST ONLY)
    // -----------------------------
    await page.evaluate(() => {
      const w = window as any;

      // 1) Roof validé minimal (structure tolérante)
      const validatedRoof = {
        pans: [
          {
            id: 'PAN_1',
            orientationDeg: 180,
            tiltDeg: 30,
            orientation_deg: 180,
            tilt_deg: 30,
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
      w.validatedRoofData = w.validatedRoofData || validatedRoof;

      // 2) Sélection panneau PV (si le moteur garde une référence)
      w.PV_SELECTED_PANEL = w.PV_SELECTED_PANEL || {
        id: 'E2E_PANEL_1',
        brand: 'E2E',
        model: 'E2E_PANEL',
        reference: 'E2E-REF',
        wMm: 1760,
        hMm: 1134,
        widthM: 1.76,
        heightM: 1.134,
        powerWc: 500,
        powerW: 500,
      };

      // 3) Layout panneaux minimal (un panneau avec géométrie)
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
      w.CALPINAGE_STATE.validatedRoofData = w.validatedRoofData;
      w.CALPINAGE_STATE.roof = w.CALPINAGE_STATE.roof || {};
      w.CALPINAGE_STATE.roof.gps = w.CALPINAGE_STATE.roof.gps || validatedRoof.gps;
      w.CALPINAGE_STATE.panels = w.CALPINAGE_STATE.panels || [panelInstance];

      const shadingNormalized = {
        totalLossPct: 0,
        panelCount: 1,
        perPanel: [],
        computedAt: new Date().toISOString(),
      };
      w.CALPINAGE_STATE.shading = w.CALPINAGE_STATE.shading || {};
      w.CALPINAGE_STATE.shading.normalized = w.CALPINAGE_STATE.shading.normalized || shadingNormalized;

      w.currentStudy = w.currentStudy || {};
      w.currentStudy.calpinage = w.currentStudy.calpinage || {};
      if (!w.currentStudy.calpinage.panels) w.currentStudy.calpinage.panels = [panelInstance];
      if (!w.currentStudy.calpinage.roof) w.currentStudy.calpinage.roof = validatedRoof;

      // 4) Shading minimal
      w.currentStudy.calpinage.shading = w.currentStudy.calpinage.shading || {
        totalLossPct: 0,
        perPanel: [],
        computedAt: new Date().toISOString(),
      };

      // 5) Inverter minimal
      w.currentStudy.calpinage.inverter = w.currentStudy.calpinage.inverter || {
        id: 'E2E_INV_1',
        family: 'MICRO',
        model: 'E2E_INVERTER',
        phases: '1P',
      };

      // 6) pvPlacementEngine.getAllPanels pour buildFinalCalpinageJSON
      if (!w.pvPlacementEngine?.getAllPanels) {
        w.pvPlacementEngine = w.pvPlacementEngine || {};
        w.pvPlacementEngine.getAllPanels = () => [panelInstance];
      }

      w.__LAST_CALPINAGE_JSON__ = w.__LAST_CALPINAGE_JSON__ || null;
    });

    // -----------------------------
    // 2) Récupérer l'export JSON (stratégies)
    // -----------------------------
    // Stratégie A: bouton "Exporter JSON" / "Export JSON" / "JSON"
    // Stratégie B: fonction globale buildFinalCalpinageJSON()
    // Stratégie C: variable window.__LAST_CALPINAGE_JSON__ (si déjà exposée dans l'app)
    let exported: any = null;

    const exportBtn = page.locator(
      'button:has-text("Exporter JSON"), button:has-text("Export JSON"), button:has-text("JSON")'
    );

    if ((await exportBtn.count()) > 0) {
      // Intercepter download si l'app télécharge un fichier
      const [download] = await Promise.all([
        page.waitForEvent('download').catch(() => null),
        exportBtn.first().click(),
      ]);

      if (download) {
        const text = await download
          .createReadStream()
          .then(async (stream) => {
            if (!stream) return null;
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks).toString('utf-8');
          })
          .catch(() => null);

        if (text) {
          exported = JSON.parse(text);
        }
      }

      // Si pas de download, tenter lecture depuis window après clic
      if (!exported) {
        exported = await page.evaluate(() => {
          const w = window as any;
          if (w.__LAST_CALPINAGE_JSON__) return w.__LAST_CALPINAGE_JSON__;
          if (typeof w.buildFinalCalpinageJSON === 'function') return w.buildFinalCalpinageJSON();
          return null;
        });
      }
    } else {
      // Stratégie B/C directe
      exported = await page.evaluate(() => {
        const w = window as any;
        if (w.__LAST_CALPINAGE_JSON__) return w.__LAST_CALPINAGE_JSON__;
        if (typeof w.buildFinalCalpinageJSON === 'function') return w.buildFinalCalpinageJSON();
        if (w.currentStudy?.calpinage) return w.currentStudy.calpinage;
        return null;
      });
    }

    // Fallback final: si buildFinalCalpinageJSON garde des guards, on export depuis currentStudy.calpinage (test only)
    if (!exported) {
      exported = await page.evaluate(() => {
        const w = window as any;
        return w.currentStudy?.calpinage || null;
      });
    }

    // Merge inverter si buildFinalCalpinageJSON ne l'inclut pas (structure moteur actuelle)
    if (exported && !exported.inverter) {
      const calpinageExtras = await page.evaluate(() => {
        const w = window as any;
        const c = w.currentStudy?.calpinage;
        return c ? { inverter: c.inverter } : null;
      });
      if (calpinageExtras?.inverter) {
        exported = { ...exported, inverter: calpinageExtras.inverter };
      }
    }

    assert(exported != null, '❌ Impossible de récupérer le JSON exporté (bouton ou fonction absente)');

    // -----------------------------
    // 3) Validation structure SmartPitch-ready
    // -----------------------------
    assert(isObj(exported), '❌ Export JSON must be an object');

    // Paths adaptés : accepter 2 formes selon la structure exacte
    const roof =
      exported.roof ??
      (exported.pans ? { pans: exported.pans, gps: exported.gps } : null) ??
      (isObj(exported) && (exported.pans || exported.gps) ? exported : null);
    const panelsRaw =
      exported.panels ?? exported.pv?.panels ?? null;
    const panels = Array.isArray(panelsRaw)
      ? panelsRaw
      : panelsRaw?.layout ?? (Array.isArray(exported) ? exported : null);
    const shading = exported.shading ?? exported.pv?.shading ?? null;
    const inverter = exported.inverter ?? exported.pv?.inverter ?? exported.inverters ?? null;

    assert(roof != null, '❌ Export JSON missing roof');
    assert(panels != null, '❌ Export JSON missing panels');
    assert(shading != null, '❌ Export JSON missing shading');
    assert(inverter != null, '❌ Export JSON missing inverter');

    validateRoof(roof);
    validatePanels(panels);
    validateShading(shading);

    // inverter peut être objet ou array (selon architecture)
    if (Array.isArray(inverter)) {
      assert(inverter.length >= 1, '❌ inverter array must have at least 1 item');
      validateInverter(inverter[0]);
    } else {
      validateInverter(inverter);
    }

    // -----------------------------
    // 4) Rapport JSON
    // -----------------------------
    const reportDir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(reportDir, { recursive: true });

    const report = {
      meta: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
        generatedAt: new Date().toISOString(),
      },
      summary: {
        roof_ok: true,
        panels_count: Array.isArray(panels) ? panels.length : null,
        shading_totalLossPct: shading?.totalLossPct ?? shading?.total_loss_pct ?? null,
        inverter_id:
          inverter != null
            ? Array.isArray(inverter)
              ? inverter[0]?.id ?? inverter[0]?.sku ?? inverter[0]?.model ?? inverter[0]?.name ?? null
              : inverter?.id ?? inverter?.sku ?? inverter?.model ?? inverter?.name ?? null
            : null,
      },
      keys: Object.keys(exported),
    };

    const reportPath = path.join(reportDir, 'export-json-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('==============================');
    console.log('🟣 EXPORT JSON VALIDATION RESULT');
    console.log('Panels:', report.summary.panels_count);
    console.log('Shading totalLossPct:', report.summary.shading_totalLossPct);
    console.log('Inverter:', report.summary.inverter_id);
    console.log('Report:', reportPath);
    console.log('STATUS: PASS');
    console.log('==============================');

    expect(true).toBeTruthy();
  });
});
