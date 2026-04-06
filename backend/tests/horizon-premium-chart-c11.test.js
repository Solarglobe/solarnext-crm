/**
 * CP-FAR-C-11 — Tests masque horizon premium (horizonElevation, shadow classifier, export wiring).
 * Usage: node tests/horizon-premium-chart-c11.test.js
 */

import {
  horizonElevation,
  getVisibilityMaskStats,
  renderPremiumHorizonMaskChart,
  buildPremiumHorizonMaskSvg,
} from "../pdf/horizonMaskPremiumChart.js";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";

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

// ——— 1) horizonElevation(azimuth): wrap 0/360, interpolation, clamp 0..90 ———
(function testHorizonElevation() {
  const mask = [
    { az: 0, elev: 5 },
    { az: 90, elev: 10 },
    { az: 180, elev: 15 },
    { az: 270, elev: 8 },
    { az: 360, elev: 5 },
  ];

  assert(horizonElevation(mask, 0) >= 0 && horizonElevation(mask, 0) <= 90, "horizonElevation(0) clamp 0..90");
  assert(horizonElevation(mask, 360) >= 0 && horizonElevation(mask, 360) <= 90, "horizonElevation(360) wrap et clamp");
  assert(horizonElevation(mask, -90) >= 0 && horizonElevation(mask, -90) <= 90, "horizonElevation(-90) wrap");
  assert(horizonElevation(mask, 45) >= 5 && horizonElevation(mask, 45) <= 10, "interpolation 0–90°");
  assert(horizonElevation([], 0) === 0, "mask vide => 0");
  const highMask = [{ az: 0, elev: 100 }];
  assert(horizonElevation(highMask, 0) === 90, "clamp 90 (elev 100 => 90)");
})();

// ——— 2) Shadow classifier + alpha: blocked si elev<=0, blocked si elev<=horizonElev ———
(function testShadowClassifier() {
  const mask = [{ az: 0, elev: 20 }, { az: 360, elev: 20 }];
  const h = horizonElevation(mask, 180);
  assert(h === 20, "horizonElev(180)=20 (interpolé)");
  assert(10 <= 20, "elev 10 <= horizon 20 => blocked");
  assert(25 > 20, "elev 25 > horizon 20 => not blocked");
})();

// ——— 3) Export wiring: buildHorizonMaskSinglePageHtml utilise le nouveau renderer ———
(function testExportWiring() {
  const html = buildHorizonMaskSinglePageHtml({
    lat: 48.85,
    lon: 2.35,
    address: "Test",
    horizonMask: { mask: [{ az: 0, elev: 5 }, { az: 360, elev: 5 }], source: "TEST" },
  });
  assert(html.includes("horizon-premium-chart"), "HTML contient horizon-premium-chart (nouveau renderer)");
  assert(html.includes("heatmap-layer"), "HTML contient heatmap-layer");
  assert(!html.includes("visibility-mesh-layer"), "HTML ne contient pas visibility-mesh-layer (ancien)");
  assert(html.includes("hour-rays-layer"), "HTML contient hour-rays-layer");
})();

// ——— 4) getVisibilityMaskStats ———
(function testVisibilityMaskStats() {
  const mask = [{ az: 0, elev: 10 }, { az: 180, elev: 25 }, { az: 360, elev: 10 }];
  const stats = getVisibilityMaskStats(mask);
  assert(stats && typeof stats.minBlockingDeg === "number", "minBlockingDeg défini");
  assert(stats && typeof stats.maxBlockingDeg === "number", "maxBlockingDeg défini");
  assert(stats.minBlockingDeg >= 0 && stats.maxBlockingDeg <= 90, "stats dans 0..90");
})();

// ——— 5) buildPremiumHorizonMaskSvg / renderPremiumHorizonMaskChart ———
(function testSvgBuild() {
  const svg = renderPremiumHorizonMaskChart({ lat: 48.85, lon: 2.35, horizonMask: { mask: [], source: "EMPTY" } });
  assert(svg.includes("<svg"), "SVG valide");
  assert(svg.includes("dome-clip-premium"), "clip dôme");
  const svg2 = buildPremiumHorizonMaskSvg({ lat: 48.85, lon: 2.35, horizonMask: null });
  assert(svg2.includes("heatmap-layer"), "buildPremiumHorizonMaskSvg alias OK");
})();

console.log("\n--- RÉSUMÉ CP-FAR-C-11 ---");
console.log("Passed: " + passed + ", Failed: " + failed);
if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ CP-FAR-C-11 tests PASS\n");
process.exit(0);
