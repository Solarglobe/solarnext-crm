/**
 * CP-FAR-C-08 PROMPT 2 — Test alignement Frontend vs Backend (écart < 0,2%).
 * Charge les fixtures horizonMasks, calcule loss côté backend et référence partagée
 * (shared/shading/annualFarHorizonWeightedLossCore.cjs — parité shadingEngine.js),
 * compare totalLossPct / annualLossPercent. Aucun changement au moteur backend prod.
 *
 * Usage: cd backend && npm run test:horizon-align
 */

import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createRequire } from "module";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../tests/fixtures/horizonMasks");
const TOLERANCE_PCT = 0.2;

// Panneau minimal identique pour backend et frontend (pas d'obstacles => near = 0, total = far)
const MINIMAL_PANEL = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

// Config identique au backend (year 2026, stepMinutes 60, minSunElevationDeg 3)
const SHADING_CONFIG = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };

function loadFixtures() {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = readFileSync(path.join(FIXTURES_DIR, f), "utf8");
    return JSON.parse(raw);
  });
}

function runBackend(fixture) {
  return computeCalpinageShading({
    lat: fixture.lat,
    lon: fixture.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    options: { __testHorizonMaskOverride: fixture.horizonMask },
  });
}

function runFrontend(fixture) {
  const require = createRequire(import.meta.url);
  const corePath = path.join(__dirname, "../../shared/shading/annualFarHorizonWeightedLossCore.cjs");
  const { computeAnnualShadingLoss } = require(corePath);
  const result = computeAnnualShadingLoss({
    latDeg: fixture.lat,
    lonDeg: fixture.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    roofPans: [],
    horizonMask: fixture.horizonMask,
    config: SHADING_CONFIG,
  });
  return result;
}

async function main() {
  console.log("CP-FAR-C-08 — Front/Back horizon alignment test (tolerance ±" + TOLERANCE_PCT + "%)\n");

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures in " + FIXTURES_DIR);
    process.exit(2);
  }
  console.log("Fixtures loaded:", fixtures.length, "\n");

  let passed = 0;
  let failed = 0;

  for (const fixture of fixtures) {
    const name = fixture.name || "unnamed";
    let lossBackend, lossFrontend;
    try {
      const backResult = await runBackend(fixture);
      lossBackend = backResult != null ? backResult.totalLossPct : NaN;
    } catch (e) {
      console.log("[ " + name + " ] FAIL backend error:", (e && e.message) || e);
      failed++;
      continue;
    }
    try {
      const frontResult = runFrontend(fixture);
      lossFrontend = frontResult != null ? frontResult.annualLossPercent : NaN;
    } catch (e) {
      console.log("[ " + name + " ] FAIL frontend error:", (e && e.message) || e);
      failed++;
      continue;
    }

    const diff = Math.abs(lossFrontend - lossBackend);
    if (diff <= TOLERANCE_PCT) {
      console.log("[ " + name + " ] PASS diff=" + diff.toFixed(2) + "% (front=" + lossFrontend.toFixed(3) + "% back=" + lossBackend.toFixed(3) + "%)");
      passed++;
    } else {
      console.log("[ " + name + " ] FAIL diff=" + diff.toFixed(2) + "% front=" + lossFrontend.toFixed(3) + "% back=" + lossBackend.toFixed(3) + "%");
      failed++;
    }
  }

  console.log("\n---");
  console.log("PASS:", passed, " FAIL:", failed);
  if (failed > 0) {
    process.exit(2);
  }
  console.log("CP-FAR-C-08 horizon alignment: all fixtures within ±" + TOLERANCE_PCT + "%");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
