/**
 * Lot PANNEAUX — priorité pv_panels quand panel_id connu (applyPanelPowerFromCatalog + scénario V2 kWc).
 * node --test backend/tests/panelCatalogTruth.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyPanelPowerFromCatalog } from "../services/pv/resolvePanelFromDb.service.js";
import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { computeInstalledKwcRounded3 } from "../utils/resolvePanelPowerWc.js";

function mockPool(row) {
  return {
    async query() {
      return { rows: row ? [row] : [] };
    },
  };
}

const row500 = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  power_wc: 500,
  brand: "TestBrand",
  model_ref: "TB-500",
  name: "Module 500",
  width_mm: 1134,
  height_mm: 1722,
  temp_coeff_pct_per_deg: -0.35,
  degradation_annual_pct: 0.4,
  degradation_first_year_pct: 2,
};

test("applyPanelPowerFromCatalog : snapshot obsolète → power_wc DB", async () => {
  const pool = mockPool(row500);
  const out = await applyPanelPowerFromCatalog(pool, {
    panel_id: row500.id,
    power_wc: 400,
    brand: "Old",
  });
  assert.equal(out.power_wc, 500);
  assert.equal(out.panel_id, row500.id);
  assert.equal(out.id, row500.id);
  assert.equal(out.brand, "TestBrand");
  assert.equal(out.width_mm, 1134);
  assert.equal(out.height_mm, 1722);
});

test("applyPanelPowerFromCatalog : panel_id via id (alias)", async () => {
  const pool = mockPool(row500);
  const out = await applyPanelPowerFromCatalog(pool, {
    id: row500.id,
    power_wc: 485,
  });
  assert.equal(out.power_wc, 500);
});

test("applyPanelPowerFromCatalog : aucun id → inchangé", async () => {
  const pool = mockPool(null);
  const inp = { power_wc: 420, brand: "X" };
  const out = await applyPanelPowerFromCatalog(pool, inp);
  assert.equal(out.power_wc, 420);
  assert.equal(out.brand, "X");
});

test("applyPanelPowerFromCatalog : ligne absente → inchangé (legacy)", async () => {
  const pool = mockPool(null);
  const inp = { panel_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", power_wc: 430 };
  const out = await applyPanelPowerFromCatalog(pool, inp);
  assert.equal(out.power_wc, 430);
});

test("Scénario V2 fallback : 61 × 500 Wc → 30,5 kWc (2 déc.)", () => {
  const scen = buildScenarioBaseV2({
    form: {
      maison: { panneaux_max: 61 },
      panel_input: { panel_id: row500.id, power_wc: 500 },
    },
    settings: { pricing: { kit_panel_power_w: 485 } },
  });
  assert.equal(scen.metadata.kwc, 30.5);
  assert.equal(scen.metadata.nb_panneaux, 61);
});

test("Quote-prep équation : 61 × 485 Wc → 29,585 kWc (3 déc.)", () => {
  assert.equal(computeInstalledKwcRounded3(61, 485), 29.585);
});

test("Scénario V2 fallback : 61 × 485 Wc (arrondi moteur 2 déc.)", () => {
  const scen = buildScenarioBaseV2({
    form: {
      maison: { panneaux_max: 61 },
      panel_input: { panel_id: row500.id, power_wc: 485 },
    },
    settings: { pricing: { kit_panel_power_w: 500 } },
  });
  assert.equal(scen.metadata.kwc, 29.59);
});
