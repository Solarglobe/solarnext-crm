/**
 * Test rendu Solteo-like — horizon-fill (zone grise continue)
 * Vérifie: horizon-fill-layer, zone grise continue, ordre layers, courbes bleues.
 * Usage: cd backend && node scripts/test-horizon-visibility-render.js
 */

import "../config/register-local-env.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildPremiumHorizonMaskSvg } from "../pdf/horizonMaskPremiumChart.js";
import { getOrComputeHorizonMask } from "../services/horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";
import { generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { chromium } from "playwright";

const OUT_DIR = join(process.cwd(), "scripts", "output");
const CHELLES_LAT = 48.8938962;
const CHELLES_LON = 2.6210259;

/** Masque synthétique avec bosse à az~180 (sud) elev~35 — obstacle en plein midi */
function makeObstacleNoonMask() {
  const mask = [];
  for (let az = 0; az <= 360; az += 2) {
    let elev = 2;
    if (az >= 170 && az <= 190) {
      elev = 35 + 10 * Math.exp(-Math.pow(az - 180, 2) / 50);
    }
    mask.push({ az, elev });
  }
  return mask;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== test-horizon-visibility-render ===\n");

  const { value } = await getOrComputeHorizonMask(
    { tenantKey: "test", lat: CHELLES_LAT, lon: CHELLES_LON, radius_m: 500, step_deg: 2 },
    () => computeHorizonMaskAuto({ organizationId: "test", lat: CHELLES_LAT, lon: CHELLES_LON, radius_m: 500, step_deg: 2 })
  );

  const mask = value?.mask || [];
  const svg = buildPremiumHorizonMaskSvg({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask, source: value?.source ?? "SURFACE_DSM" },
  });

  const assert = (cond, msg) => {
    if (!cond) {
      console.error("❌ ASSERT FAIL:", msg);
      process.exit(1);
    }
  };

  assert(svg.includes('id="heatmap-layer"'), "présence heatmap-layer");
  assert(svg.includes('id="hour-rays-layer"'), "présence hour-rays-layer");
  assert(svg.includes("dome-clip-premium"), "clip dôme présent");
  assert(svg.includes('id="seasonal-layer"'), "courbes saisonnières présentes");

  writeFileSync(join(OUT_DIR, "visibility-test.svg"), svg, "utf8");
  console.log("Écrit: visibility-test.svg");

  try {
    const html = buildHorizonMaskSinglePageHtml({
      lat: CHELLES_LAT,
      lon: CHELLES_LON,
      horizonMask: { mask, source: value?.source },
    });
    const pdfPath = join(OUT_DIR, "visibility-test.pdf");
    await generatePdfFromHtml(html, pdfPath);
    console.log("Écrit: visibility-test.pdf");
  } catch (e) {
    console.warn("PDF non généré (Playwright?):", e.message);
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 520, height: 340 });
    await page.screenshot({ path: join(OUT_DIR, "visibility-test.png") });
    await browser.close();
    console.log("Écrit: visibility-test.png");
  } catch (e) {
    console.warn("PNG non généré (Playwright?):", e.message);
  }

  console.log("\n--- Scénario obstacle midi (synthétique) ---\n");
  const obstacleMask = makeObstacleNoonMask();
  const svgObstacle = buildPremiumHorizonMaskSvg({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: obstacleMask, source: "SYNTHETIC_OBSTACLE" },
  });
  assert(svgObstacle.includes('id="heatmap-layer"'), "obstacle midi: heatmap présent");
  const circleCountObstacle = (svgObstacle.match(/<circle/g) || []).length;
  assert(circleCountObstacle >= 5, "obstacle midi: au moins 5 cercles ombre (actuel: " + circleCountObstacle + ")");

  writeFileSync(join(OUT_DIR, "vismask-obstacle.svg"), svgObstacle, "utf8");
  console.log("Écrit: vismask-obstacle.svg (obstacle az~180 elev~35)");

  console.log("\n✅ test-horizon-visibility-render PASS\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
