import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { estimateQuickPv } from "../domains/pv-catalog/pv-calculator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("quick PV estimator returns deterministic field-ready indicators", () => {
  const a = estimateQuickPv({
    roofAreaM2: 40,
    orientation: "S",
    tiltDeg: 30,
    postalCode: "13001",
    annualConsumptionKwh: 5000,
  });
  const b = estimateQuickPv({
    roofAreaM2: 40,
    orientation: "S",
    tiltDeg: 30,
    postalCode: "13001",
    annualConsumptionKwh: 5000,
  });

  assert.equal(a.results.installable_power_kwc, 6.8);
  assert.equal(a.results.panel_count, 16);
  assert.equal(a.results.annual_production_kwh, 8976);
  assert.equal(a.results.annual_savings_eur, 971);
  assert.equal(a.results.indicative_payback_years, 15.4);
  assert.deepEqual({ ...a, computed_at: "x" }, { ...b, computed_at: "x" });
});

test("quick PV estimator is wired to lead route and study prefill", () => {
  const router = readFileSync(join(__dirname, "../domains/leads/leads.router.js"), "utf8");
  const controller = readFileSync(join(__dirname, "../domains/leads/leadPvEstimator.controller.js"), "utf8");
  const hook = readFileSync(join(__dirname, "../../frontend/src/hooks/lead/useLeadDetail.ts"), "utf8");
  const component = readFileSync(join(__dirname, "../../frontend/src/components/lead-detail/LeadPvEstimator.tsx"), "utf8");

  assert.match(router, /\/:id\/pv-estimation/);
  assert.match(controller, /quick_pv_estimation/);
  assert.match(controller, /energy_profile = \$3::jsonb/);
  assert.match(hook, /quick_pv_estimation/);
  assert.match(component, /Estimation rapide PV/);
});
