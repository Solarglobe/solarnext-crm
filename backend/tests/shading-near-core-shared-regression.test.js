/**
 * TEST A / B — Non-régression nearShadingCore partagé (shared/shading).
 * - Parité chargement direct shared vs proxy frontend/calpinage (même exports).
 * - Cas nominal, sunVectors vides (fallback), obstacle cercle (normalisation), clés de sortie.
 * Usage: cd backend && node tests/shading-near-core-shared-regression.test.js
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");

const sharedPath = path.join(repoRoot, "shared", "shading", "nearShadingCore.cjs");
const frontendProxyPath = path.join(repoRoot, "frontend", "calpinage", "shading", "nearShadingCore.cjs");

const nearFromShared = require(sharedPath);
const nearFromFrontendProxy = require(frontendProxyPath);

const LAT = 48.8566;
const LON = 2.3522;
const CONFIG = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };

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

function assertNear(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

function buildBaseScenario() {
  const panels = [
    {
      id: "p1",
      polygonPx: [
        { x: 100, y: 160 },
        { x: 200, y: 160 },
        { x: 200, y: 220 },
        { x: 100, y: 220 },
      ],
    },
    {
      id: "p2",
      polygonPx: [
        { x: 220, y: 160 },
        { x: 320, y: 160 },
        { x: 320, y: 220 },
        { x: 220, y: 220 },
      ],
    },
  ];
  const obstacle = {
    id: "obs1",
    polygonPx: [
      { x: 100, y: 80 },
      { x: 320, y: 80 },
      { x: 320, y: 130 },
      { x: 100, y: 130 },
    ],
    heightM: 3,
  };
  return { panels, obstacles: [obstacle] };
}

async function run() {
  assertNear(nearFromShared === nearFromFrontendProxy, "shared et proxy frontend exportent le même module (référence)");

  const { getAnnualSunVectorsForNear } = await import("../services/shading/calpinageShading.service.js");
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const { panels, obstacles } = buildBaseScenario();

  const nominal = nearFromShared.computeNearShading({
    panels,
    obstacles,
    sunVectors,
    getZWorldAtXY: undefined,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: 1,
  });

  const GOLDEN_TOTAL = 0.010203482917434354;
  const GOLDEN_P0_LOSS = 0.009835026687642535;
  const GOLDEN_P1_LOSS = 0.01057193914722623;
  const eps = 1e-12;
  assertNear(
    Math.abs(nominal.totalLossPct - GOLDEN_TOTAL) < eps,
    "cas nominal : totalLossPct inchangé (golden pré-extraction)"
  );
  assertNear(
    Math.abs(nominal.perPanel[0].lossPct - GOLDEN_P0_LOSS) < eps && Math.abs(nominal.perPanel[1].lossPct - GOLDEN_P1_LOSS) < eps,
    "cas nominal : lossPct par panneau inchangés"
  );

  const emptySun = nearFromShared.computeNearShading({
    panels,
    obstacles,
    sunVectors: [],
    metersPerPixel: 1,
  });
  assertNear(emptySun.totalLossPct === 0, "sunVectors vides → totalLossPct 0 (fallback officiel)");
  assertNear(
    emptySun.perPanel.length === 2 && emptySun.perPanel.every((p) => p.lossPct === 0),
    "sunVectors vides → perPanel lossPct 0"
  );

  const circleObs = [
    {
      id: "c1",
      shape: "circle",
      shapeMeta: { centerX: 150, centerY: 100, radius: 40 },
      heightM: 2,
    },
  ];
  const norm = nearFromShared.normalizeObstacles(circleObs, undefined);
  assertNear(norm.length === 1 && norm[0].polygonPx.length >= 3, "normalisation obstacle cercle → polygone");

  const sunOne = [nearFromShared.computeSunVector(180, 35)];
  const withCircle = nearFromShared.computeNearShading({
    panels: [panels[0]],
    obstacles: norm,
    sunVectors: sunOne,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: 1,
  });
  assertNear(
    typeof withCircle.totalLossPct === "number" && withCircle.totalLossPct >= 0 && withCircle.totalLossPct <= 100,
    "obstacle cercle normalisé : totalLossPct fini dans [0,100]"
  );

  const keysResult = Object.keys(nominal).sort().join(",");
  assertNear(
    keysResult.includes("totalLossPct") && keysResult.includes("perPanel"),
    "structure JSON near : clés racine totalLossPct + perPanel (contrat)"
  );
  const pp0 = nominal.perPanel[0];
  assertNear(
    ["panelId", "shadedFractionAvg", "lossPct", "shadedSamplesCount"].every((k) => Object.prototype.hasOwnProperty.call(pp0, k)),
    "perPanel[0] contient panelId, shadedFractionAvg, lossPct, shadedSamplesCount"
  );

  console.log("\n--- RÉSUMÉ shading-near-core-shared-regression ---");
  console.log("Passed:", passed, "Failed:", failed);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
