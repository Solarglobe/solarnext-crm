/**
 * Production multi-pan — validations
 * 1) Mono-pan (1 pan) : résultat multi-pan == résultat historique mono-pan (tolérance 0.1%)
 * 2) Deux pans : panA != panB si azimuth/tilt différents, total = somme
 * 3) Shading par pan : pan 0% vs pan 20% reflété dans byPan
 * 4) Robustesse : pas de NaN, monthly length 12, valeurs >= 0
 */

import * as pvgisService from "../services/pvgisService.js";
import { computeProductionMultiPan } from "../services/productionMultiPan.service.js";

let passed = 0;
let failed = 0;
function ok(label) {
  console.log("✅ " + label);
  passed++;
}
function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}
function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

const SITE = { lat: 48.85, lon: 2.35 };
const SETTINGS = { pricing: { kit_panel_power_w: 485 } };

(async () => {
  // ----- 1) Mono-pan (1 pan) : résultat multi-pan == résultat historique mono-pan (tolérance 0.1%) -----
  console.log("\n--- 1) Mono-pan (1 pan) — parité avec flux mono ---");
  const ctxMono = {
    site: { ...SITE, orientation: "S", inclinaison: 30 },
    settings: SETTINGS,
  };
  const pvMonthlyMono = await pvgisService.computeProductionMonthly(ctxMono);
  const shadingPct = 5;
  const multiplier = 1 - shadingPct / 100;
  const kwpMono = (10 * 485) / 1000;
  const annualMono = (pvMonthlyMono.annual_kwh || 0) * multiplier * kwpMono;

  const onePan = [
    { id: "p1", azimuth: 180, tilt: 30, panelCount: 10, shadingCombinedPct: 5 },
  ];
  const r1 = await computeProductionMultiPan({
    site: SITE,
    settings: SETTINGS,
    pans: onePan,
    moduleWp: 485,
  });
  assert(Array.isArray(r1.byPan) && r1.byPan.length === 1, "byPan.length === 1");
  assert(r1.byPan[0].panId === "p1", "panId p1");
  const tolerancePct = 0.001;
  const diffPct = Math.abs(r1.annualKwh - annualMono) / (annualMono || 1);
  assert(diffPct <= tolerancePct, "1 pan = même résultat qu'avant (tolérance 0.1%)");
  assert(Array.isArray(r1.monthlyKwh) && r1.monthlyKwh.length === 12, "monthlyKwh length 12");

  // ----- 2) Deux pans : productions différentes si orientation différente, total = somme -----
  console.log("\n--- 2) Deux pans (azimuth/tilt différents) ---");
  const twoPans = [
    { id: "pa", azimuth: 180, tilt: 30, panelCount: 5, shadingCombinedPct: 0 },
    { id: "pb", azimuth: 90, tilt: 25, panelCount: 5, shadingCombinedPct: 0 },
  ];
  const r2 = await computeProductionMultiPan({
    site: SITE,
    settings: SETTINGS,
    pans: twoPans,
    moduleWp: 485,
  });
  assert(r2.byPan.length === 2, "byPan.length === 2");
  const sumByPan = r2.byPan[0].annualKwh + r2.byPan[1].annualKwh;
  assert(Math.abs(r2.annualKwh - sumByPan) < 0.02, "total = somme byPan");
  const diff = Math.abs(r2.byPan[0].annualKwh - r2.byPan[1].annualKwh);
  assert(diff > 1, "panA production != panB (azimuth/tilt différents)");

  // ----- 3) Shading par pan : 0% vs 20% -----
  console.log("\n--- 3) Shading par pan ---");
  const pansShading = [
    { id: "s0", azimuth: 180, tilt: 30, panelCount: 10, shadingCombinedPct: 0 },
    { id: "s20", azimuth: 180, tilt: 30, panelCount: 10, shadingCombinedPct: 20 },
  ];
  const r3 = await computeProductionMultiPan({
    site: SITE,
    settings: SETTINGS,
    pans: pansShading,
    moduleWp: 485,
  });
  const s0Pan = r3.byPan.find((p) => p.panId === "s0");
  const s20Pan = r3.byPan.find((p) => p.panId === "s20");
  assert(s0Pan && s20Pan, "byPan s0 et s20");
  assert(s0Pan.annualKwh > s20Pan.annualKwh, "pan 0% > pan 20%");
  const ratio = s20Pan.annualKwh / s0Pan.annualKwh;
  assert(ratio >= 0.78 && ratio <= 0.82, "pan 20% ≈ 80% du pan 0%");

  // ----- 4) Robustesse : pas de NaN, monthly 12, >= 0 -----
  console.log("\n--- 4) Robustesse ---");
  const r4 = await computeProductionMultiPan({
    site: SITE,
    settings: SETTINGS,
    pans: [{ id: "r", azimuth: 180, tilt: 30, panelCount: 1, shadingCombinedPct: 0 }],
    moduleWp: 485,
  });
  assert(!Number.isNaN(r4.annualKwh), "annualKwh pas NaN");
  assert(r4.monthlyKwh.every((v) => !Number.isNaN(v)), "monthlyKwh pas de NaN");
  assert(r4.monthlyKwh.length === 12, "monthlyKwh length 12");
  assert(r4.monthlyKwh.every((v) => typeof v === "number" && v >= 0), "monthlyKwh >= 0");

  // ----- Empty pans -----
  const r0 = await computeProductionMultiPan({ site: SITE, settings: SETTINGS, pans: [] });
  assert(r0.byPan.length === 0 && r0.annualKwh === 0 && r0.monthlyKwh.length === 12, "pans vides → byPan [], annual 0, monthly 12");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
