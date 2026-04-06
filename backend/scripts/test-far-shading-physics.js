/**
 * CP-FAR-C-02 — Test physique extrême far shading
 * Valide mathématiquement le moteur far et la fusion far+near.
 * Usage: node backend/scripts/test-far-shading-physics.js
 * Exit 0 = PASS, 1 = FAIL
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const LAT = 48.8566;
const LON = 2.3522;
const STEP_DEG = 2;
const NEAR_TOLERANCE_PCT = 1;
const FAR_A_TOLERANCE_PCT = 1;
const FAR_D_MIN_PCT = 98;
const TOTAL_VS_FAR_TOLERANCE_PCT = 1;
const ANNUAL_KWH_TOLERANCE_PCT = 0.5;
const ANNUAL_KWH_BASE = 10000;

// --- Helpers masques (override, pas de cache/DSM/API) ---

/**
 * Masque uniforme 0..360 par pas stepDeg, elev = elevDeg.
 * @param {number} stepDeg
 * @param {number} elevDeg
 * @returns {{ mask: Array<{az: number, elev: number}> }}
 */
function buildMaskUniform(stepDeg, elevDeg) {
  const mask = [];
  const n = Math.round(360 / stepDeg);
  for (let i = 0; i < n; i++) {
    const az = (i * stepDeg) % 360;
    mask.push({ az, elev: elevDeg });
  }
  return { mask };
}

/**
 * elevDeg sur azimut [southMin, southMax], sinon otherElev.
 * @param {number} stepDeg
 * @param {number} elevDeg
 * @param {number} southMin
 * @param {number} southMax
 * @param {number} otherElev
 * @returns {{ mask: Array<{az: number, elev: number}> }}
 */
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

// --- Géométrie : 1 panneau, 0 obstacles (near ≈ 0) ---
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

function run(label, maskOverride, options = {}) {
  return computeCalpinageShading({
    lat: LAT,
    lon: LON,
    geometry,
    options: {
      __testHorizonMaskOverride: maskOverride,
      __testReturnMonthly: true,
      ...options,
    },
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pct(x) {
  return typeof x === "number" ? Number(x.toFixed(3)) : null;
}

// --- Formule prod application shading à kWh (répliquée depuis calc.controller) ---
function applyShadingToAnnualKwh(annualKwhBase, totalLossPct) {
  if (typeof annualKwhBase !== "number" || typeof totalLossPct !== "number") return null;
  const factor = 1 - Math.min(Math.max(totalLossPct, 0), 100) / 100;
  return annualKwhBase * factor;
}

// --- Far loss % par mois (si monthly dispo) ---
function farLossPctPerMonth(monthlyBaseline, monthlyFar) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const base = monthlyBaseline[m] || 0;
    const far = monthlyFar[m] || 0;
    out.push(base > 0 ? 100 * (1 - far / base) : 0);
  }
  return out;
}

async function main() {
  console.log("CP-FAR-C-02 — Test physique extrême far shading\n");
  console.log("Site:", LAT, LON, "| radius_m=500 (prod) | step_deg=2 (prod) | stepMinutes=60 (prod)");
  console.log("Override horizon: 4 masques forcés (pas de cache/DSM/API)\n");

  const results = [];
  let monthlyAvailable = false;
  let caseCWinterGreaterThanSummer = null;

  try {
    // A) Horizon 0°
    const rA = await run("A", buildMaskUniform(STEP_DEG, 0));
    results.push({
      case: "A",
      farLossPct: pct(rA.farLossPct),
      nearLossPct: pct(rA.nearLossPct),
      totalLossPct: pct(rA.totalLossPct),
      annual_kwh_after: null,
      notes: [],
    });
    if (rA.__testMonthly) {
      monthlyAvailable = true;
      results[results.length - 1].notes.push("monthly ok");
    } else {
      results[results.length - 1].notes.push("monthly missing");
    }

    // B) Horizon 30° uniforme
    const rB = await run("B", buildMaskUniform(STEP_DEG, 30));
    results.push({
      case: "B",
      farLossPct: pct(rB.farLossPct),
      nearLossPct: pct(rB.nearLossPct),
      totalLossPct: pct(rB.totalLossPct),
      annual_kwh_after: null,
      notes: [],
    });
    if (rB.__testMonthly) results[results.length - 1].notes.push("monthly ok");
    else results[results.length - 1].notes.push("monthly missing");

    // C) Horizon 60° Sud uniquement (135..225)
    const rC = await run("C", buildMaskSouthOnly(STEP_DEG, 60, 135, 225, 0));
    results.push({
      case: "C",
      farLossPct: pct(rC.farLossPct),
      nearLossPct: pct(rC.nearLossPct),
      totalLossPct: pct(rC.totalLossPct),
      annual_kwh_after: null,
      notes: [],
    });
    if (rC.__testMonthly) {
      const { monthlyBaselineEnergy, monthlyFarEnergy } = rC.__testMonthly;
      const farLossByMonth = farLossPctPerMonth(monthlyBaselineEnergy, monthlyFarEnergy);
      const winterMonths = [0, 1, 10, 11];
      const summerMonths = [5, 6, 7];
      const winterAvg =
        winterMonths.reduce((s, m) => s + farLossByMonth[m], 0) / winterMonths.length;
      const summerAvg =
        summerMonths.reduce((s, m) => s + farLossByMonth[m], 0) / summerMonths.length;
      caseCWinterGreaterThanSummer = winterAvg > summerAvg;
      results[results.length - 1].notes.push(
        "monthly ok, winter>summer: " + (caseCWinterGreaterThanSummer ? "yes" : "no")
      );
    } else {
      results[results.length - 1].notes.push("monthly missing");
    }

    // D) Horizon 90° uniforme
    const rD = await run("D", buildMaskUniform(STEP_DEG, 90));
    results.push({
      case: "D",
      farLossPct: pct(rD.farLossPct),
      nearLossPct: pct(rD.nearLossPct),
      totalLossPct: pct(rD.totalLossPct),
      annual_kwh_after: null,
      notes: [],
    });
    if (rD.__testMonthly) results[results.length - 1].notes.push("monthly ok");
    else results[results.length - 1].notes.push("monthly missing");

    // Application kWh (formule prod)
    for (const row of results) {
      const after = applyShadingToAnnualKwh(ANNUAL_KWH_BASE, row.totalLossPct);
      row.annual_kwh_after = after != null ? Number(after.toFixed(2)) : null;
    }

    // --- Tableau ---
    console.log("--- Résultats ---");
    console.log(
      "Case\tfarLossPct\tnearLossPct\ttotalLossPct\tannual_kwh_after\tnotes"
    );
    console.log("-".repeat(90));
    for (const r of results) {
      console.log(
        [
          r.case,
          r.farLossPct,
          r.nearLossPct,
          r.totalLossPct,
          r.annual_kwh_after ?? "—",
          r.notes.join("; "),
        ].join("\t")
      );
    }

    // --- Assertions ---
    const failures = [];

    // Monotonie far
    if (results[0].farLossPct > FAR_A_TOLERANCE_PCT) {
      failures.push(`farLoss(A) ≈ 0: got ${results[0].farLossPct}% (tol ≤ ${FAR_A_TOLERANCE_PCT}%)`);
    }
    if (results[1].farLossPct <= results[0].farLossPct) {
      failures.push(`farLoss(B) > farLoss(A): ${results[1].farLossPct} vs ${results[0].farLossPct}`);
    }
    if (results[3].farLossPct < FAR_D_MIN_PCT) {
      failures.push(`farLoss(D) ≥ ${FAR_D_MIN_PCT}%: got ${results[3].farLossPct}%`);
    }

    // Near stable
    for (const r of results) {
      if (r.nearLossPct > NEAR_TOLERANCE_PCT) {
        failures.push(`nearLoss(${r.case}) ≤ ${NEAR_TOLERANCE_PCT}%: got ${r.nearLossPct}%`);
      }
    }

    // Total cohérent
    for (const r of results) {
      if (r.totalLossPct < r.farLossPct - 0.01) {
        failures.push(`totalLossPct ≥ farLossPct (${r.case}): ${r.totalLossPct} vs ${r.farLossPct}`);
      }
      const totalVsFar = Math.abs(r.totalLossPct - r.farLossPct);
      if (r.nearLossPct <= NEAR_TOLERANCE_PCT && totalVsFar > TOTAL_VS_FAR_TOLERANCE_PCT) {
        failures.push(
          `total ≈ far when near≈0 (${r.case}): total=${r.totalLossPct} far=${r.farLossPct} (tol ≤ ${TOTAL_VS_FAR_TOLERANCE_PCT}%)`
        );
      }
    }

    // C entre A et D
    if (results[2].farLossPct < results[0].farLossPct || results[2].farLossPct > results[3].farLossPct) {
      failures.push(
        `farLoss(C) between A and D: got ${results[2].farLossPct} (A=${results[0].farLossPct}, D=${results[3].farLossPct})`
      );
    }

    // Saisonnalité C (si monthly dispo)
    if (monthlyAvailable && caseCWinterGreaterThanSummer === false) {
      failures.push("C: expected winter far loss > summer (South-only mask)");
    }

    // Test production-kwh
    const annualA = results[0].annual_kwh_after;
    const annualD = results[3].annual_kwh_after;
    const annualB = results[1].annual_kwh_after;
    const expectedB = ANNUAL_KWH_BASE * (1 - results[1].totalLossPct / 100);
    if (annualA != null && Math.abs(annualA - ANNUAL_KWH_BASE) > ANNUAL_KWH_BASE * (ANNUAL_KWH_TOLERANCE_PCT / 100)) {
      failures.push(`annual_kwh A ~ ${ANNUAL_KWH_BASE}: got ${annualA}`);
    }
    if (annualD != null && annualD > ANNUAL_KWH_BASE * 0.02) {
      failures.push(`annual_kwh D ~ 0: got ${annualD}`);
    }
    if (annualB != null && expectedB != null) {
      const diff = Math.abs(annualB - expectedB);
      if (diff > expectedB * (ANNUAL_KWH_TOLERANCE_PCT / 100)) {
        failures.push(
          `annual_kwh B = 10000*(1-totalLossPct/100): got ${annualB}, expected ~${expectedB.toFixed(2)} (tol ${ANNUAL_KWH_TOLERANCE_PCT}%)`
        );
      }
    }

    // --- Verdict ---
    console.log("");
    if (failures.length > 0) {
      console.log("Assertions KO:");
      failures.forEach((f) => console.log("  -", f));
      console.log("\n❌ FAIL");
      process.exit(1);
    }
    console.log("✅ PASS");
    process.exit(0);
  } catch (err) {
    console.error(err);
    console.log("\n❌ FAIL (exception)");
    process.exit(1);
  }
}

main();
