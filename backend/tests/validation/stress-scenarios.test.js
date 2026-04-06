/**
 * CP-FAR-012 — Validation physique & scénarios stress
 * 4 scénarios synthétiques contrôlés. Aucune modification du moteur.
 * Usage: node tests/validation/stress-scenarios.test.js
 */

import { computeCalpinageShading } from "../../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../../services/shading/shadingStructureBuilder.js";

const LAT = 48.8566;
const LON = 2.3522;

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

const geometry = { frozenBlocks: [{ panels: [panel] }] };

const baseDataCoverage = { mode: "RELIEF_ONLY", available: true, coveragePct: 1, ratio: 1, gridResolutionMeters: 25, provider: "RELIEF_ONLY" };

function buildMaskFlat0() {
  const mask = [];
  for (let i = 0; i < 180; i++) mask.push({ az: i * 2, elev: 0 });
  return { mask, source: "RELIEF_ONLY", radius_m: 500, step_deg: 2, resolution_m: 25, dataCoverage: baseDataCoverage };
}

function buildMaskVilleDense() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 90 && az <= 270 ? 18 : 4;
    mask.push({ az, elev });
  }
  return { mask, source: "SURFACE_DSM", radius_m: 500, step_deg: 2, resolution_m: 10, dataCoverage: { ...baseDataCoverage, mode: "SURFACE_DSM", gridResolutionMeters: 10, provider: "HTTP_GEOTIFF" } };
}

function buildMaskImmeubleSud() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 150 && az <= 210 ? 45 : 1;
    mask.push({ az, elev });
  }
  return { mask, source: "SURFACE_DSM", radius_m: 500, step_deg: 2, resolution_m: 5, dataCoverage: { ...baseDataCoverage, mode: "SURFACE_DSM", gridResolutionMeters: 5, provider: "HTTP_GEOTIFF" } };
}

function buildMaskArbreEst() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 60 && az <= 120 ? 12 : 0;
    mask.push({ az, elev });
  }
  return { mask, source: "SURFACE_DSM", radius_m: 500, step_deg: 2, resolution_m: 10, dataCoverage: { ...baseDataCoverage, mode: "SURFACE_DSM", gridResolutionMeters: 10, provider: "HTTP_GEOTIFF" } };
}

function farLossPctPerMonth(monthlyBaseline, monthlyFar) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const base = monthlyBaseline[m] || 0;
    const far = monthlyFar[m] || 0;
    out.push(base > 0 ? 100 * (1 - far / base) : 0);
  }
  return out;
}

function totalLossFromMonthly(monthlyBaseline, monthlyFarNear) {
  let sumBase = 0, sumFarNear = 0;
  for (let m = 0; m < 12; m++) {
    sumBase += monthlyBaseline[m] || 0;
    sumFarNear += monthlyFarNear[m] || 0;
  }
  return sumBase > 0 ? 100 * (1 - sumFarNear / sumBase) : 0;
}

function avgOverMonths(arr, months) {
  let sum = 0, n = 0;
  for (const m of months) {
    if (typeof arr[m] === "number") { sum += arr[m]; n++; }
  }
  return n > 0 ? sum / n : 0;
}

let passed = 0, failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

(async () => {
  // --- SCÉNARIO 1 — Campagne sans obstacle ---
  console.log("\n--- SCÉNARIO 1 — Campagne sans obstacle ---");
  const r1 = await computeCalpinageShading({
    lat: LAT, lon: LON, geometry,
    options: { __testHorizonMaskOverride: buildMaskFlat0(), __testReturnMonthly: true },
  });
  assert(r1.farLossPct <= 1, "farLossPct ≈ 0");
  assert(r1.nearLossPct <= 1, "nearLossPct ≈ 0");
  const shading1 = buildStructuredShading(r1, true, true, {});
  assert(["A", "A+"].includes(shading1.shadingQuality?.grade), "shadingQuality grade A ou A+");
  const farLoss1 = farLossPctPerMonth(r1.__testMonthly.monthlyBaselineEnergy, r1.__testMonthly.monthlyFarEnergy);
  const winter1 = avgOverMonths(farLoss1, [0, 1, 10, 11]);
  const summer1 = avgOverMonths(farLoss1, [4, 5, 6, 7]);
  assert(Math.abs(winter1 - summer1) < 3, "variation saison faible (plat)");

  // --- SCÉNARIO 2 — Ville dense ---
  console.log("\n--- SCÉNARIO 2 — Ville dense ---");
  const r2 = await computeCalpinageShading({
    lat: LAT, lon: LON, geometry,
    options: { __testHorizonMaskOverride: buildMaskVilleDense(), __testReturnMonthly: true },
  });
  assert(r2.farLossPct > 8, "farLossPct significatif (>8%)");
  const farLoss2 = farLossPctPerMonth(r2.__testMonthly.monthlyBaselineEnergy, r2.__testMonthly.monthlyFarEnergy);
  const winter2 = avgOverMonths(farLoss2, [0, 1, 10, 11]);
  const summer2 = avgOverMonths(farLoss2, [4, 5, 6, 7]);
  assert(winter2 > summer2, "Hiver > Été (soleil plus bas)");

  // --- SCÉNARIO 3 — Immeuble plein Sud ---
  console.log("\n--- SCÉNARIO 3 — Immeuble plein Sud ---");
  const r3 = await computeCalpinageShading({
    lat: LAT, lon: LON, geometry,
    options: { __testHorizonMaskOverride: buildMaskImmeubleSud(), __testReturnMonthly: true },
  });
  assert(r3.farLossPct > 15, "farLossPct très élevé (>15%)");
  const farLoss3 = farLossPctPerMonth(r3.__testMonthly.monthlyBaselineEnergy, r3.__testMonthly.monthlyFarEnergy);
  const winter3 = avgOverMonths(farLoss3, [0, 1, 10, 11]);
  const summer3 = avgOverMonths(farLoss3, [4, 5, 6, 7]);
  assert(winter3 > summer3, "perte hiver >> perte été");

  // --- SCÉNARIO 4 — Arbre à l'Est ---
  console.log("\n--- SCÉNARIO 4 — Arbre à l'Est ---");
  const r4 = await computeCalpinageShading({
    lat: LAT, lon: LON, geometry,
    options: { __testHorizonMaskOverride: buildMaskArbreEst(), __testReturnMonthly: true },
  });
  assert(r4.farLossPct > 0.5 && r4.farLossPct < 30, "perte annuelle modérée");
  const farLoss4 = farLossPctPerMonth(r4.__testMonthly.monthlyBaselineEnergy, r4.__testMonthly.monthlyFarEnergy);
  const eastMonths = [2, 3, 4, 5, 6, 7];
  const avgEast = avgOverMonths(farLoss4, eastMonths);
  assert(avgEast >= 0, "pertes matin cohérentes");

  // --- Vérifications générales ---
  console.log("\n--- Vérifications générales ---");
  for (const r of [r1, r2, r3, r4]) {
    assert(r.farLossPct >= 0 && r.farLossPct <= 100, "farLossPct dans [0,100]");
    assert(!Number.isNaN(r.totalLossPct), "pas de NaN");
    assert(r.nearLossPct >= 0, "nearLossPct >= 0");
  }

  // --- Monotonicité: angle horizon augmente => pertes augmentent ---
  console.log("\n--- Monotonicité ---");
  const mask5 = buildMaskFlat0();
  const mask10 = { ...mask5, mask: mask5.mask.map(({ az }) => ({ az, elev: 10 })) };
  const mask20 = { ...mask5, mask: mask5.mask.map(({ az }) => ({ az, elev: 20 })) };
  const r5 = await computeCalpinageShading({ lat: LAT, lon: LON, geometry, options: { __testHorizonMaskOverride: mask5 } });
  const r10 = await computeCalpinageShading({ lat: LAT, lon: LON, geometry, options: { __testHorizonMaskOverride: mask10 } });
  const r20 = await computeCalpinageShading({ lat: LAT, lon: LON, geometry, options: { __testHorizonMaskOverride: mask20 } });
  assert(r5.farLossPct <= r10.farLossPct, "elev 0 <= elev 10");
  assert(r10.farLossPct <= r20.farLossPct, "elev 10 <= elev 20");

  // --- Cohérence énergétique: annualLossFromMonthly ≈ combined.totalLossPct ---
  console.log("\n--- Cohérence énergétique ---");
  const annualFromMonthly = totalLossFromMonthly(r1.__testMonthly.monthlyBaselineEnergy, r1.__testMonthly.monthlyFarNearEnergy);
  assert(Math.abs(annualFromMonthly - r1.totalLossPct) < 0.5, "annualFromMonthly ≈ totalLossPct (<0.5%)");

  // --- Stabilité cache: 2 runs identiques ---
  console.log("\n--- Stabilité cache ---");
  const run1 = await computeCalpinageShading({ lat: LAT, lon: LON, geometry, options: { __testHorizonMaskOverride: buildMaskVilleDense() } });
  const run2 = await computeCalpinageShading({ lat: LAT, lon: LON, geometry, options: { __testHorizonMaskOverride: buildMaskVilleDense() } });
  assert(Math.abs(run1.farLossPct - run2.farLossPct) < 0.01, "run1 ≈ run2 (déterministe)");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
  console.log("\n✅ PASS");
  process.exit(0);
})();
