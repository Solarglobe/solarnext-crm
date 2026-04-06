/**
 * PV hourly scaling — mono mode : ctx.pv.hourly = production totale installation.
 * Cas : PVGIS 1000 kWh/an pour 1 kWp, installation 6 kWc → sum(ctx.pv.hourly) ≈ 6000 kWh/an.
 */

import { buildHourlyPV } from "../services/solarModelService.js";

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(function () {
  console.log("=== pvHourlyScaling tests ===\n");

  const ANNUAL_1KWP = 1000;
  const KWC = 6;
  const EXPECTED_ANNUAL = ANNUAL_1KWP * KWC;

  const monthly1kwp = Array.from({ length: 12 }, () => ANNUAL_1KWP / 12);
  const sum1kwp = sum(monthly1kwp);
  assert(Math.abs(sum1kwp - ANNUAL_1KWP) < 0.01, "monthly 1 kWp somme = 1000");

  const monthly_total = monthly1kwp.map((v) => v * KWC);
  const pvHourly = buildHourlyPV(monthly_total);
  assert(Array.isArray(pvHourly) && pvHourly.length === 8760, "hourly length 8760");

  const annualTotal = sum(pvHourly);
  const tol = 1;
  assert(
    Math.abs(annualTotal - EXPECTED_ANNUAL) <= tol,
    `sum(ctx.pv.hourly) ≈ 6000 — got ${annualTotal.toFixed(2)}`
  );

  console.log("✅ PVGIS 1000 kWh/an (1 kWp) × 6 kWc → sum(hourly) ≈", Math.round(annualTotal), "kWh/an");
  console.log("\n--- pvHourlyScaling OK ---");
})();
