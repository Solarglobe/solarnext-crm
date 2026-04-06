/**
 * CP-FAR-C-11 — Snapshot SVG masque horizon premium (dôme heure×élévation).
 * Vérifie : heatmap-layer, hour-rays-layer, clip dôme, génération PDF.
 * Usage: cd backend && node scripts/test-horizon-pdf-svg-snapshot.js
 */

import { buildPremiumHorizonMaskSvg, horizonElevation } from "../pdf/horizonMaskPremiumChart.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const maskConstant20 = [];
for (let i = 0; i <= 360; i += 5) {
  maskConstant20.push({ az: i, elev: 20 });
}

const mockData = {
  lat: 48.8566,
  lon: 2.3522,
  horizonMask: { mask: maskConstant20, source: "SYNTHETIC" },
};

const svg = buildPremiumHorizonMaskSvg(mockData);

const outDir = join(process.cwd(), "scripts", "output");
try {
  mkdirSync(outDir, { recursive: true });
} catch (_) {}

writeFileSync(join(outDir, "horizon-page1.svg"), svg, "utf8");
writeFileSync(join(outDir, "horizon-premium-snapshot.svg"), svg, "utf8");
console.log("SVG écrit: horizon-premium-snapshot.svg");

const elev0 = horizonElevation(mockData.horizonMask.mask, 0);
const elev90 = horizonElevation(mockData.horizonMask.mask, 90);
const elev180 = horizonElevation(mockData.horizonMask.mask, 180);
console.log("horizonElevation(0°,90°,180°):", [elev0, elev90, elev180].map((n) => n.toFixed(2)).join(", "));

const hasHeatmapLayer = svg.includes('id="heatmap-layer"');
const circleCount = (svg.match(/<circle/g) || []).length;
const hasHourRaysLayer = svg.includes('id="hour-rays-layer"');
const hasClipPath = svg.includes("dome-clip-premium") && svg.includes("<clipPath");
const hasAxisLabels = svg.includes('id="axis-labels"');
const hasSeasonalLayer = svg.includes('id="seasonal-layer"');

let pass = true;
if (!hasHeatmapLayer) {
  console.error('❌ id="heatmap-layer" requis');
  pass = false;
} else {
  console.log("✅ heatmap-layer présent");
}
if (circleCount < 10) {
  console.error("❌ au moins 10 cercles (ombre) attendus (actuel:", circleCount, ")");
  pass = false;
} else {
  console.log("✅ cercles heatmap count:", circleCount);
}
if (!hasHourRaysLayer) {
  console.error('❌ id="hour-rays-layer" requis');
  pass = false;
} else {
  console.log("✅ hour-rays-layer présent");
}
if (!hasClipPath) {
  console.error("❌ clipPath dôme requis");
  pass = false;
} else {
  console.log("✅ clip dôme présent");
}
if (!hasAxisLabels) {
  console.error('❌ id="axis-labels" requis');
  pass = false;
} else {
  console.log("✅ axis-labels présent");
}
if (!hasSeasonalLayer) {
  console.error('❌ id="seasonal-layer" requis');
  pass = false;
} else {
  console.log("✅ seasonal-layer présent");
}
if (elev0 < 0 || elev90 > 90) {
  console.error("❌ horizonElevation doit être clamp 0..90");
  pass = false;
} else {
  console.log("✅ horizonElevation sanity OK");
}

const svgHash = createHash("sha1").update(svg).digest("hex");
console.log(`SVG SHA1: ${svgHash}`);

async function generatePng() {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 520, height: 340 });
    await page.screenshot({ path: join(outDir, "horizon-premium-snapshot.png") });
    await browser.close();
    console.log("PNG écrit: horizon-premium-snapshot.png");
  } catch (e) {
    console.warn("⚠️ PNG non généré (playwright?):", e.message);
  }
}
await generatePng();

console.log("\n--- Résultat ---\n");
if (pass) {
  console.log("CP-FAR-C-11 PREMIUM_SNAPSHOT PASS\n");
  process.exit(0);
} else {
  console.error("CP-FAR-C-11 PREMIUM_SNAPSHOT FAIL\n");
  process.exit(1);
}
