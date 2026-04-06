/**
 * CP-FAR-C-03 — Cohérence mensuelle avancée (far shading)
 * Distribution saisonnière, biais hiver/été, double comptage, pondération, stabilité.
 * Usage: node backend/scripts/test-far-monthly-coherence.js
 * Exit 0 = PASS, 1 = FAIL
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const LAT = 48.8566;
const LON = 2.3522;
const STEP_DEG = 2;
const TOL_DOUBLE_COUNT = 0.005; // 0.5% en ratio (total vs far+(1-far)*near)
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WINTER_MONTHS = [0, 1, 10, 11];   // Jan, Feb, Nov, Dec
const SUMMER_MONTHS = [5, 6, 7];        // Jun, Jul, Aug

function buildMaskUniform(stepDeg, elevDeg) {
  const mask = [];
  const n = Math.round(360 / stepDeg);
  for (let i = 0; i < n; i++) {
    const az = (i * stepDeg) % 360;
    mask.push({ az, elev: elevDeg });
  }
  return { mask };
}

function buildMaskSouthOnly(stepDeg, elevDeg, southMin = 135, southMax = 225, otherElev = 0) {
  const mask = [];
  const n = Math.round(360 / stepDeg);
  for (let i = 0; i < n; i++) {
    const az = (i * stepDeg) % 360;
    const inRange = az >= southMin && az <= southMax;
    mask.push({ az, elev: inRange ? elevDeg : otherElev });
  }
  return { mask };
}

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

async function run(label, maskOverride) {
  return computeCalpinageShading({
    lat: LAT,
    lon: LON,
    geometry,
    options: {
      __testHorizonMaskOverride: maskOverride,
      __testReturnMonthly: true,
    },
  });
}

function sum(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function safeRatio(num, denom, defaultVal = 0) {
  if (denom == null || !Number.isFinite(denom) || denom <= 0) return defaultVal;
  const v = num / denom;
  return Number.isFinite(v) ? v : defaultVal;
}

function buildMonthlyLosses(monthlyBaseline, monthlyFar, monthlyFarNear) {
  const farLossPct = [];
  const nearLossPct = [];
  const totalLossPct = [];
  for (let m = 0; m < 12; m++) {
    const base = monthlyBaseline[m] ?? 0;
    const far = monthlyFar[m] ?? 0;
    const fn = monthlyFarNear[m] ?? 0;
    const fl = base > 0 ? (1 - safeRatio(far, base, 0)) * 100 : 0;
    const nl = far > 0 ? (1 - safeRatio(fn, far, 0)) * 100 : 0;
    const tl = base > 0 ? (1 - safeRatio(fn, base, 0)) * 100 : 0;
    farLossPct.push(fl);
    nearLossPct.push(nl);
    totalLossPct.push(tl);
  }
  return { farLossPct, nearLossPct, totalLossPct };
}

function checkNumericalStability(monthlyBaseline, monthlyFar, monthlyFarNear) {
  const issues = [];
  for (let m = 0; m < 12; m++) {
    const b = monthlyBaseline[m];
    const f = monthlyFar[m];
    const fn = monthlyFarNear[m];
    if (b != null && (Number.isNaN(b) || !Number.isFinite(b) || b < 0)) issues.push(`baseline[${m}] invalid`);
    if (f != null && (Number.isNaN(f) || !Number.isFinite(f) || f < 0)) issues.push(`far[${m}] invalid`);
    if (fn != null && (Number.isNaN(fn) || !Number.isFinite(fn) || fn < 0)) issues.push(`farNear[${m}] invalid`);
  }
  const totalB = sum(monthlyBaseline);
  const totalF = sum(monthlyFar);
  const totalFn = sum(monthlyFarNear);
  if (Number.isNaN(totalB) || !Number.isFinite(totalB)) issues.push("sum baseline NaN/Inf");
  if (Number.isNaN(totalF) || !Number.isFinite(totalF)) issues.push("sum far NaN/Inf");
  if (Number.isNaN(totalFn) || !Number.isFinite(totalFn)) issues.push("sum farNear NaN/Inf");
  return { ok: issues.length === 0, issues };
}

async function main() {
  console.log("CP-FAR-C-03 — Cohérence mensuelle avancée (far shading)\n");
  console.log("Site:", LAT, LON, "| radius_m=500 | step_deg=2 | stepMinutes=60 | near=0\n");

  const scenarios = [
    { label: "A", desc: "Horizon 0° uniforme", mask: buildMaskUniform(STEP_DEG, 0) },
    { label: "B", desc: "Horizon 30° uniforme", mask: buildMaskUniform(STEP_DEG, 30) },
    { label: "C", desc: "Horizon 60° Sud uniquement", mask: buildMaskSouthOnly(STEP_DEG, 60, 135, 225, 0) },
    { label: "D", desc: "Horizon 15° uniforme", mask: buildMaskUniform(STEP_DEG, 15) },
  ];

  const results = {};
  let baselineAnnualStable = true;
  let firstBaselineSum = null;

  for (const sc of scenarios) {
    const r = await run(sc.label, sc.mask);
    if (!r.__testMonthly) {
      console.error("Missing __testMonthly for", sc.label);
      process.exit(1);
    }
    const { monthlyBaselineEnergy, monthlyFarEnergy, monthlyFarNearEnergy } = r.__testMonthly;
    const annualBaseline = sum(monthlyBaselineEnergy);
    const annualFar = sum(monthlyFarEnergy);
    const annualFarNear = sum(monthlyFarNearEnergy);
    if (firstBaselineSum != null && Math.abs(annualBaseline - firstBaselineSum) > 0.01) {
      baselineAnnualStable = false;
    }
    firstBaselineSum = firstBaselineSum ?? annualBaseline;

    const { farLossPct, nearLossPct, totalLossPct } = buildMonthlyLosses(
      monthlyBaselineEnergy,
      monthlyFarEnergy,
      monthlyFarNearEnergy
    );
    results[sc.label] = {
      monthlyBaselineEnergy,
      monthlyFarEnergy,
      monthlyFarNearEnergy,
      farLossPct,
      nearLossPct,
      totalLossPct,
      annualBaseline,
      annualFar,
      annualFarNear,
    };

    console.log(`--- Scénario ${sc.label}: ${sc.desc} ---`);
    console.log("Month\tBaseline\tFar\tFarNear\tfarLoss%\tnearLoss%\ttotalLoss%");
    for (let m = 0; m < 12; m++) {
      const b = monthlyBaselineEnergy[m];
      const f = monthlyFarEnergy[m];
      const fn = monthlyFarNearEnergy[m];
      console.log(
        [
          MONTH_NAMES[m],
          b != null ? b.toFixed(2) : "—",
          f != null ? f.toFixed(2) : "—",
          fn != null ? fn.toFixed(2) : "—",
          farLossPct[m].toFixed(2),
          nearLossPct[m].toFixed(2),
          totalLossPct[m].toFixed(2),
        ].join("\t")
      );
    }
    console.log("");
  }

  const failures = [];

  // --- A) Distribution saisonnière (cas C) ---
  const rc = results.C;
  const farLossJan = rc.farLossPct[0];
  const farLossJun = rc.farLossPct[5];
  const farLossDec = rc.farLossPct[11];
  const farLossJul = rc.farLossPct[6];
  if (!(farLossJan > farLossJun)) {
    failures.push(`Distribution: farLossJan > farLossJun (C): ${farLossJan} vs ${farLossJun}`);
  }
  if (!(farLossDec > farLossJul)) {
    failures.push(`Distribution: farLossDec > farLossJul (C): ${farLossDec} vs ${farLossJul}`);
  }
  let progressiveOk = true;
  for (let m = 1; m < 12; m++) {
    const d = rc.farLossPct[m] - rc.farLossPct[m - 1];
    if (Math.abs(d) > 40) {
      progressiveOk = false;
      failures.push(`Distribution: pic isolé C month ${m} (delta=${d.toFixed(1)}%)`);
    }
  }
  const distSeasonalOk = failures.filter((f) => f.startsWith("Distribution")).length === 0;

  // --- B) Biais hiver (horizon 0° = A) ---
  const rA = results.A;
  const baselineWinter = sum(WINTER_MONTHS.map((m) => rA.monthlyBaselineEnergy[m]));
  const baselineSummer = sum(SUMMER_MONTHS.map((m) => rA.monthlyBaselineEnergy[m]));
  if (baselineWinter <= 0) {
    failures.push("Biais hiver: baseline hiver quasi nul (scénario A)");
  }
  const biasWinterOk = baselineWinter > 0;

  // --- C) Double comptage (tous scénarios, tous mois) ---
  let doubleCountOk = true;
  for (const label of ["A", "B", "C", "D"]) {
    const r = results[label];
    for (let m = 0; m < 12; m++) {
      const base = r.monthlyBaselineEnergy[m] || 0;
      const far = r.monthlyFarEnergy[m] || 0;
      const fn = r.monthlyFarNearEnergy[m] || 0;
      if (base <= 0) continue;
      const totalRatio = 1 - fn / base;
      const farRatio = 1 - far / base;
      const nearRatio = far > 0 ? 1 - fn / far : 0;
      const expectedTotal = farRatio + (1 - farRatio) * nearRatio;
      const diff = Math.abs(totalRatio - expectedTotal);
      if (diff > TOL_DOUBLE_COUNT) {
        doubleCountOk = false;
        failures.push(
          `Double comptage ${label} ${MONTH_NAMES[m]}: total=${(totalRatio * 100).toFixed(2)}% expected=${(expectedTotal * 100).toFixed(2)}% (diff=${(diff * 100).toFixed(2)}%)`
        );
      }
    }
  }

  // --- D) Pondération cos(elevation) ---
  // Dans calpinageShading.service.js : weight = Math.max(0, sunDir.dz) (l.349), appliqué une
  // seule fois par sample ; même poids pour baseline, far et farNear (farNear = weight*(1-avgFraction)).
  // baseline >= far (égalité pour horizon 0°) ; far >= farNear (égalité quand near=0).
  let weightOrderOk = true;
  for (const label of ["A", "B", "C", "D"]) {
    const r = results[label];
    if (r.annualBaseline < r.annualFar - 0.01) {
      weightOrderOk = false;
      failures.push(`Pondération ${label}: baseline >= far attendu (baseline=${r.annualBaseline} far=${r.annualFar})`);
    }
    if (r.annualFar < r.annualFarNear - 0.01) {
      weightOrderOk = false;
      failures.push(`Pondération ${label}: far >= farNear attendu (far=${r.annualFar} farNear=${r.annualFarNear})`);
    }
  }
  if (!baselineAnnualStable) {
    failures.push("Pondération: baselineWeight annuel doit être stable entre scénarios");
    weightOrderOk = false;
  }

  // --- Stabilité numérique ---
  let stabilityOk = true;
  for (const label of ["A", "B", "C", "D"]) {
    const r = results[label];
    const { ok, issues } = checkNumericalStability(
      r.monthlyBaselineEnergy,
      r.monthlyFarEnergy,
      r.monthlyFarNearEnergy
    );
    if (!ok) {
      stabilityOk = false;
      issues.forEach((i) => failures.push(`Stabilité ${label}: ${i}`));
    }
    for (let m = 0; m < 12; m++) {
      const b = r.monthlyBaselineEnergy[m];
      if (b != null && b === 0) {
        const fl = r.farLossPct[m];
        const tl = r.totalLossPct[m];
        if (!Number.isFinite(fl) || !Number.isFinite(tl)) {
          stabilityOk = false;
          failures.push(`Stabilité ${label} ${MONTH_NAMES[m]}: baseline=0 mais pertes non gérées`);
        }
      }
    }
  }

  // --- Résumé verdicts ---
  console.log("--- Verdicts ---");
  console.log("Distribution saisonnière (C: Jan>Jun, Dec>Jul, progressive):", distSeasonalOk ? "OK" : "FAIL");
  console.log("Biais hiver (baseline hiver > 0):", biasWinterOk ? "OK" : "FAIL");
  console.log("Double comptage (total ≈ far + (1-far)*near, tol 0.5%):", doubleCountOk ? "OK" : "FAIL");
  console.log("Pondération cos(elev) (baseline>far>farNear, baseline stable):", weightOrderOk ? "OK" : "FAIL");
  console.log("Stabilité numérique (pas NaN/Inf, div par zéro gérée):", stabilityOk ? "OK" : "FAIL");
  console.log("");

  if (failures.length > 0) {
    console.log("Détails échecs:");
    failures.slice(0, 15).forEach((f) => console.log("  -", f));
    if (failures.length > 15) console.log("  ... et", failures.length - 15, "autres");
    console.log("\n🔴 VERDICT FINAL : FAIL");
    process.exit(1);
  }
  console.log("🟢 VERDICT FINAL : PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
