/**
 * Tests unitaires — calcResponseBuilder.js
 *
 * Fonction pure : aucune DB, aucun HTTP, aucun mock externe nécessaire.
 * Runner : node --test tests/calcResponseBuilder.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProductionBlock, buildCalcResponse } from "../services/calc/calcResponseBuilder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCtx(overrides = {}) {
  return {
    meta: { version: "test", generated_at: "2025-01-01T00:00:00.000Z" },
    site: { lat: 48.8, lon: 2.3 },
    house: { surface_m2: 120 },
    pv: { total_kwh: 5000, monthly: Array(12).fill(417) },
    settings: { economics: {} },
    productionMultiPan: null,
    ...overrides,
  };
}

function makeScenario(id, v2 = true) {
  return {
    id,
    _v2: v2,
    energy: { prod: 5000, auto: 3000, surplus: 2000, import: 2000, conso: 5000 },
    finance: {},
    metadata: { kwc: 6 },
  };
}

// ---------------------------------------------------------------------------
// resolveProductionBlock
// ---------------------------------------------------------------------------
describe("resolveProductionBlock", () => {
  it("retourne le bloc productionMultiPan si présent", () => {
    const ctx = makeCtx({
      productionMultiPan: {
        byPan: [{ id: "pan-1" }],
        annualKwh: 6000,
        monthlyKwh: Array(12).fill(500),
      },
    });
    const result = resolveProductionBlock(ctx);
    assert.equal(result.annualKwh, 6000);
    assert.equal(result.byPan.length, 1);
    assert.equal(result.monthlyKwh.length, 12);
  });

  it("retourne le bloc pv.monthly si productionMultiPan est null", () => {
    const ctx = makeCtx({ productionMultiPan: null });
    const result = resolveProductionBlock(ctx);
    assert.equal(result.annualKwh, 5000);
    assert.deepEqual(result.byPan, []);
    assert.equal(result.monthlyKwh.length, 12);
  });

  it("retourne null si ni productionMultiPan ni pv.monthly", () => {
    const ctx = makeCtx({ productionMultiPan: null, pv: {} });
    assert.equal(resolveProductionBlock(ctx), null);
  });

  it("retourne null si pv.total_kwh est null", () => {
    const ctx = makeCtx({ productionMultiPan: null, pv: { monthly: Array(12).fill(0), total_kwh: null } });
    assert.equal(resolveProductionBlock(ctx), null);
  });
});

// ---------------------------------------------------------------------------
// buildCalcResponse — structure du payload
// ---------------------------------------------------------------------------
describe("buildCalcResponse", () => {
  // Minimal stubs : mapScenarioToV2 et buildCalculationConfidenceFromCalc
  // sont importés par calcResponseBuilder — on teste la forme du retour
  // avec des scénarios réels (le mapper est une fonction pure légère).

  const baseParams = () => ({
    ctx: makeCtx(),
    form: { erpnext_lead_id: "LEAD-42" },
    conso: { hourly: Array(8760).fill(0.5), annual_kwh: 4380 },
    annualExact: 4380,
    pilotage: { stats: { piloted_kwh: 200 } },
    scenariosFinal: { BASE: makeScenario("BASE") },
    finance: { roi_years: 10 },
    impact: { co2_avoided_kg: 1500 },
  });

  it("retourne un objet avec toutes les clés attendues", () => {
    const result = buildCalcResponse(baseParams());
    const expectedKeys = [
      "meta", "site", "erpnext_lead_id", "house", "conso", "pv",
      "production", "pilotage", "scenarios", "scenarios_v2",
      "finance", "impact", "settings", "calculation_confidence",
    ];
    for (const key of expectedKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(result, key), `Clé manquante : ${key}`);
    }
  });

  it("propage erpnext_lead_id depuis form", () => {
    const result = buildCalcResponse(baseParams());
    assert.equal(result.erpnext_lead_id, "LEAD-42");
  });

  it("erpnext_lead_id vaut null si absent du form", () => {
    const params = baseParams();
    params.form = {};
    const result = buildCalcResponse(params);
    assert.equal(result.erpnext_lead_id, null);
  });

  it("house.conso_annuelle_kwh = annualExact", () => {
    const result = buildCalcResponse(baseParams());
    assert.equal(result.house.conso_annuelle_kwh, 4380);
  });

  it("conso.annual_kwh est écrasé par annualExact", () => {
    const params = baseParams();
    params.conso.annual_kwh = 9999; // valeur originale différente
    const result = buildCalcResponse(params);
    assert.equal(result.conso.annual_kwh, 4380); // annualExact prime
  });

  it("pilotage = pilotage.stats", () => {
    const result = buildCalcResponse(baseParams());
    assert.deepEqual(result.pilotage, { piloted_kwh: 200 });
  });

  it("scenarios = scenariosFinal (référence directe)", () => {
    const params = baseParams();
    const result = buildCalcResponse(params);
    assert.equal(result.scenarios, params.scenariosFinal);
  });

  it("scenarios_v2 ne contient que les scénarios _v2=true", () => {
    const params = baseParams();
    params.scenariosFinal = {
      BASE: makeScenario("BASE", true),
      LEGACY: makeScenario("LEGACY", false),
    };
    const result = buildCalcResponse(params);
    // scenarios_v2 mapped from only _v2=true entries
    const ids = result.scenarios_v2.map((s) => s?.id ?? s?.name ?? s?.scenario_id).filter(Boolean);
    // LEGACY (_v2=false) ne doit pas apparaître dans scenarios_v2
    assert.ok(!ids.includes("LEGACY"), "LEGACY ne doit pas être dans scenarios_v2");
  });

  it("production utilise productionMultiPan si présent dans ctx", () => {
    const params = baseParams();
    params.ctx.productionMultiPan = {
      byPan: [{ id: "p1" }, { id: "p2" }],
      annualKwh: 8000,
      monthlyKwh: Array(12).fill(667),
    };
    const result = buildCalcResponse(params);
    assert.equal(result.production.annualKwh, 8000);
    assert.equal(result.production.byPan.length, 2);
  });

  it("production utilise pv.monthly si productionMultiPan absent", () => {
    const params = baseParams();
    params.ctx.productionMultiPan = null;
    const result = buildCalcResponse(params);
    assert.equal(result.production.annualKwh, 5000);
    assert.deepEqual(result.production.byPan, []);
  });

  it("ne lève pas d'exception si scenariosFinal est vide", () => {
    const params = baseParams();
    params.scenariosFinal = {};
    assert.doesNotThrow(() => buildCalcResponse(params));
  });
});
