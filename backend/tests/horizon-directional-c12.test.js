/**
 * CP-FAR-C-12 — Tests heatmap directionnelle (perte par azimut + dominante saison).
 * 1) Directional bins length (36)
 * 2) totalEnergy > 0
 * 3) lossPctDir ∈ [0,1]
 * 4) dominantSeason ∈ enum
 * 5) Cas artificiel obstacle sud 180° → pic ≈ 180°
 * 6) Stabilité : pas de NaN, pas de division par 0
 */

import {
  computeDirectionalLoss,
  computeSeasonalDominant,
  renderDirectionalHeatmapSvg,
} from "../pdf/horizonMaskPremiumChart.js";

const CHELLES_LAT = 48.8938962;
const CHELLES_LON = 2.6210259;

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

// ——— 1) Directional bins length (36) ———
(function testBinsLength() {
  const mask = [];
  for (let az = 0; az <= 360; az += 10) mask.push({ az, elev: 2 });
  const { directionLoss } = computeDirectionalLoss(mask, CHELLES_LAT, CHELLES_LON);
  assert(
    directionLoss.length === 36,
    "directionLoss length = 36",
    "length=" + directionLoss.length
  );
})();

// ——— 2) totalEnergy > 0 ———
(function testTotalEnergy() {
  const mask = [];
  for (let az = 0; az <= 360; az += 10) mask.push({ az, elev: 0 });
  const { totalEnergy } = computeDirectionalLoss(mask, CHELLES_LAT, CHELLES_LON);
  assert(totalEnergy > 0, "totalEnergy > 0", "totalEnergy=" + totalEnergy);
})();

// ——— 3) lossPctDir ∈ [0,1] ———
(function testLossPctRange() {
  const mask = [];
  for (let az = 0; az <= 360; az += 5) mask.push({ az, elev: 5 });
  const { directionLoss } = computeDirectionalLoss(mask, CHELLES_LAT, CHELLES_LON);
  let allInRange = true;
  for (const d of directionLoss) {
    if (typeof d.lossPct !== "number" || d.lossPct < 0 || d.lossPct > 1) allInRange = false;
  }
  assert(allInRange, "tous lossPct ∈ [0,1]");
  assert(directionLoss.every((d) => typeof d.az === "number"), "tous az number");
})();

// ——— 4) dominantSeason ∈ enum ———
(function testDominantSeasonEnum() {
  const mask = [];
  for (let az = 0; az <= 360; az += 10) mask.push({ az, elev: 3 });
  const season = computeSeasonalDominant(mask, CHELLES_LAT, CHELLES_LON);
  const valid = ["WINTER", "SUMMER", "MID"].includes(season.dominantSeason);
  assert(valid, "dominantSeason ∈ {WINTER, SUMMER, MID}", "got " + season.dominantSeason);
  assert(typeof season.winterLossPct === "number" && season.winterLossPct >= 0 && season.winterLossPct <= 1, "winterLossPct ∈ [0,1]");
  assert(typeof season.summerLossPct === "number" && season.summerLossPct >= 0 && season.summerLossPct <= 1, "summerLossPct ∈ [0,1]");
  assert(typeof season.midSeasonLossPct === "number" && season.midSeasonLossPct >= 0 && season.midSeasonLossPct <= 1, "midSeasonLossPct ∈ [0,1]");
})();

// ——— 5) Cas artificiel : obstacle constant sud (180°) → pic ≈ 180° ———
(function testObstacleSouth() {
  const mask = [];
  for (let az = 0; az <= 360; az += 5) {
    let elev = 1;
    if (az >= 170 && az <= 190) elev = 35;
    mask.push({ az, elev });
  }
  const { directionLoss } = computeDirectionalLoss(mask, CHELLES_LAT, CHELLES_LON);
  const bin180 = directionLoss.find((d) => Math.abs(d.az - 180) < 15);
  const others = directionLoss.filter((d) => Math.abs(d.az - 180) >= 30);
  const maxOther = Math.max(...others.map((d) => d.lossPct));
  assert(bin180 != null, "bin proche 180° présent");
  assert(bin180.lossPct >= maxOther - 0.2, "pic perte vers 180° (sud)", "bin180.lossPct=" + bin180.lossPct + " maxOther=" + maxOther);
})();

// ——— 6) Stabilité : pas de NaN, pas de division par 0 ———
(function testStability() {
  const emptyMask = [];
  const { directionLoss: dirEmpty, totalEnergy: teEmpty } = computeDirectionalLoss(emptyMask, CHELLES_LAT, CHELLES_LON);
  assert(dirEmpty.length === 36, "empty mask → 36 bins");
  const hasNaN = dirEmpty.some((d) => Number.isNaN(d.lossPct) || Number.isNaN(d.az));
  assert(!hasNaN, "pas de NaN dans directionLoss (mask vide)");
  assert(teEmpty >= 0, "totalEnergy >= 0 (mask vide)");
  assert(dirEmpty.every((d) => d.lossPct === 0 || (d.lossPct >= 0 && d.lossPct <= 1)), "lossPct valides (mask vide)");

  const seasonEmpty = computeSeasonalDominant(emptyMask, CHELLES_LAT, CHELLES_LON);
  assert(!Number.isNaN(seasonEmpty.winterLossPct) && !Number.isNaN(seasonEmpty.dominantSeason), "season sans NaN");
})();

// ——— 7) renderDirectionalHeatmapSvg ———
(function testRenderSvg() {
  const directionLoss = Array.from({ length: 36 }, (_, i) => ({ az: i * 10 + 5, lossPct: Math.random() * 0.5 }));
  const svg = renderDirectionalHeatmapSvg(directionLoss, { dominantSeason: "WINTER" });
  assert(svg.includes("<svg"), "SVG valide");
  assert(svg.includes("horizon-directional-radar"), "class radar");
  assert(svg.includes("radar-wedges"), "wedges présents");
  assert(svg.includes("Dominante"), "légende dominante");
})();

console.log("\n--- RÉSUMÉ CP-FAR-C-12 ---");
console.log("Passed: " + passed + ", Failed: " + failed);
if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ CP-FAR-C-12 tests PASS\n");
process.exit(0);
