/**
 * Pack premium gouvernance shading — contrat, golden near/far, solaire, cohérence, sync.
 * Aucune logique métier nouvelle : garde-fous uniquement.
 * Usage: cd backend && npm run test:shading:lock
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { buildStructuredShading } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { computeSunPosition } from "../services/shading/solarPosition.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");

let passed = 0;
let failed = 0;

function ok(m) {
  console.log("✅ " + m);
  passed++;
}
function fail(m) {
  console.log("❌ " + m);
  failed++;
}

function assert(cond, m) {
  if (cond) ok(m);
  else fail(m);
}

// --- TEST 1 — Contrat shading V2 normalisé (clés critiques) ---
async function testOfficialContract() {
  const panel = { id: "p1", polygon: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }] };
  const geometry = { frozenBlocks: [{ panels: [panel] }] };
  const shadingResult = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry });
  const raw = buildStructuredShading(shadingResult, true, true, {});
  const meta = {
    step_deg: shadingResult.farMetadata?.step_deg,
    resolution_m: shadingResult.farMetadata?.resolution_m,
    algorithm: shadingResult.farMetadata?.meta?.algorithm,
  };
  const s = normalizeCalpinageShading(raw, meta);

  assert(s && typeof s === "object", "contract: objet racine");
  assert(s.near && typeof s.near.totalLossPct === "number", "contract: near.totalLossPct number");
  assert(s.far && typeof s.far === "object", "contract: far objet");
  assert(Object.prototype.hasOwnProperty.call(s.far, "totalLossPct"), "contract: far.totalLossPct présent");
  assert(s.combined && typeof s.combined.totalLossPct === "number", "contract: combined.totalLossPct number");
  assert(typeof s.totalLossPct === "number", "contract: totalLossPct racine (miroir)");
  assert(s.shadingQuality && typeof s.shadingQuality.score === "number", "contract: shadingQuality.score");
  assert(Array.isArray(s.perPanel), "contract: perPanel array");
  assert(s.far.dataCoverage && typeof s.far.dataCoverage.ratio === "number", "contract: far.dataCoverage.ratio");
}

// --- TEST 2 — Golden near (aligné shading-near-core-shared-regression) ---
async function testGoldenNear() {
  const near = require(path.join(repoRoot, "shared/shading/nearShadingCore.cjs"));
  const { getAnnualSunVectorsForNear } = await import("../services/shading/calpinageShading.service.js");
  const LAT = 48.8566;
  const LON = 2.3522;
  const CONFIG = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };
  const panels = [
    { id: "p1", polygonPx: [{ x: 100, y: 160 }, { x: 200, y: 160 }, { x: 200, y: 220 }, { x: 100, y: 220 }] },
    { id: "p2", polygonPx: [{ x: 220, y: 160 }, { x: 320, y: 160 }, { x: 320, y: 220 }, { x: 220, y: 220 }] },
  ];
  const obstacles = [
    { id: "obs1", polygonPx: [{ x: 100, y: 80 }, { x: 320, y: 80 }, { x: 320, y: 130 }, { x: 100, y: 130 }], heightM: 3 },
  ];
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const r = near.computeNearShading({
    panels,
    obstacles,
    sunVectors,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: 1,
  });
  const GOLDEN_TOTAL = 0.010203482917434354;
  const eps = 1e-12;
  assert(Math.abs(r.totalLossPct - GOLDEN_TOTAL) < eps, "golden near: totalLossPct inchangé");
}

// --- TEST 3 — Golden far / horizon (fixture officielle) ---
async function testGoldenFarHorizon() {
  const fixturePath = path.join(__dirname, "fixtures/horizonMasks/ign_like_step1_hd.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const MINIMAL_PANEL = {
    id: "p1",
    polygon: [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 60 },
    ],
  };
  const back = await computeCalpinageShading({
    lat: fixture.lat,
    lon: fixture.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    options: { __testHorizonMaskOverride: fixture.horizonMask },
  });
  const GOLDEN = 8.823;
  assert(
    back && Math.abs(Number(back.totalLossPct) - GOLDEN) < 0.0005,
    "golden far/horizon: totalLossPct fixture ign_like_step1_hd ≈ " + GOLDEN
  );
}

// --- TEST 4 — Solar safety (plages nominatives) ---
function testSolarSafety() {
  const d = new Date(Date.UTC(2026, 5, 21, 12, 0, 0, 0));
  const p = computeSunPosition(d, 48.8566, 2.3522);
  assert(p && p.elevationDeg > 55 && p.elevationDeg < 72, "solar: été Paris midi UTC — élévation dans plage attendue");
  assert(p.azimuthDeg >= 0 && p.azimuthDeg < 360, "solar: azimut [0,360)");
  const winter = new Date(Date.UTC(2026, 0, 15, 12, 0, 0, 0));
  const w = computeSunPosition(winter, 48.8566, 2.3522);
  assert(w && w.elevationDeg > 15 && w.elevationDeg < 45, "solar: hiver Paris midi UTC — élévation modérée (pas aberrante)");
}

// --- TEST 5 — Cohérence front/back annual (shared core vs backend, même fixture) ---
async function testFrontBackAnnual() {
  const fixturePath = path.join(__dirname, "fixtures/horizonMasks/relief_only_step2_flat.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const MINIMAL_PANEL = {
    id: "p1",
    polygon: [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 60 },
    ],
  };
  const CONFIG = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };
  const core = require(path.join(repoRoot, "shared/shading/annualFarHorizonWeightedLossCore.cjs"));
  const front = core.computeAnnualShadingLoss({
    latDeg: fixture.lat,
    lonDeg: fixture.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    roofPans: [],
    horizonMask: fixture.horizonMask,
    config: CONFIG,
  });
  const back = await computeCalpinageShading({
    lat: fixture.lat,
    lon: fixture.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    options: { __testHorizonMaskOverride: fixture.horizonMask },
  });
  assert(
    front && back && Math.abs(front.annualLossPercent - back.totalLossPct) < 0.001,
    "front/back annual: annualLossPercent (core) === totalLossPct (backend) flat"
  );
}

// --- TEST 6 — Fichiers synchronisés (verify frontend) ---
function testGeneratedSync() {
  try {
    execSync(`node "${path.join(repoRoot, "frontend/scripts/verify-calpinage-shading-from-shared.cjs")}"`, {
      stdio: "inherit",
      cwd: repoRoot,
    });
    ok("generated: verify-calpinage-shading-from-shared OK");
  } catch {
    fail("generated: verify-calpinage-shading-from-shared");
  }
}

async function main() {
  console.log("\n=== shading-premium-lock (gouvernance) ===\n");
  await testOfficialContract();
  await testGoldenNear();
  await testGoldenFarHorizon();
  testSolarSafety();
  await testFrontBackAnnual();
  testGeneratedSync();

  console.log("\n--- RÉSUMÉ ---\nPassed:", passed, " Failed:", failed);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
