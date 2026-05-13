/**
 * Définitions KPI énergie (audit) — cas chiffré de référence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeExportPct,
  computePvSelfConsumptionPct,
  computeSiteAutonomyPct,
  computeSolarCoveragePct,
} from "../services/energyKpiDefinitions.service.js";

function approx(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

test("cas audit officiel (kWh)", () => {
  const production_kwh = 4500;
  const consumption_kwh = 3300;
  const total_pv_used_on_site_kwh = 1500;
  const surplus_kwh = 3000;
  const grid_import_kwh = 1800;

  assert.ok(approx(computePvSelfConsumptionPct({ production_kwh, total_pv_used_on_site_kwh }), 33.33, 0.02));
  assert.ok(approx(computeSiteAutonomyPct({ consumption_kwh, grid_import_kwh }), 45.45, 0.02));
  assert.ok(approx(computeSolarCoveragePct({ consumption_kwh, total_pv_used_on_site_kwh }), 45.45, 0.02));
  assert.ok(approx(computeExportPct({ production_kwh, surplus_kwh }), 66.67, 0.02));
});

test("division par zéro → null", () => {
  assert.equal(computePvSelfConsumptionPct({ production_kwh: 0, total_pv_used_on_site_kwh: 1 }), null);
  assert.equal(computeSiteAutonomyPct({ consumption_kwh: 0, grid_import_kwh: 0 }), null);
  assert.equal(computeSolarCoveragePct({ consumption_kwh: 0, total_pv_used_on_site_kwh: 1 }), null);
  assert.equal(computeExportPct({ production_kwh: 0, surplus_kwh: 1 }), null);
});
