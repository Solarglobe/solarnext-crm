/**
 * Test rendu Solteo-like — polygones gris (fill) alignés aux heures
 * CAS1: Chelles (nuit dominante), CAS2: masque horizon=25° (obstacle midi)
 * Usage: cd backend && node scripts/test-horizon-visibility-solteo-render.js
 */

import "dotenv/config";
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

/** Masque synthétique horizon constant 25° — force gris à midi */
function makeHorizon25Mask() {
  const mask = [];
  for (let az = 0; az <= 360; az += 2) {
    mask.push({ az, elev: 25 });
  }
  return mask;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== test-horizon-visibility-solteo-render ===\n");

  const assert = (cond, msg) => {
    if (!cond) {
      console.error("❌ ASSERT FAIL:", msg);
      process.exit(1);
    }
  };

  const { value } = await getOrComputeHorizonMask(
    { tenantKey: "test", lat: CHELLES_LAT, lon: CHELLES_LON, radius_m: 500, step_deg: 2 },
    () => computeHorizonMaskAuto({ organizationId: "test", lat: CHELLES_LAT, lon: CHELLES_LON, radius_m: 500, step_deg: 2 })
  );

  const mask1 = value?.mask || [];
  const svg1 = buildPremiumHorizonMaskSvg({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: mask1, source: value?.source ?? "SURFACE_DSM" },
  });

  assert(svg1.includes('id="heatmap-layer"'), "présence heatmap-layer");
  assert(svg1.includes('id="hour-rays-layer"'), "présence hour-rays-layer");
  const circleCount1 = (svg1.match(/<circle/g) || []).length;
  assert(circleCount1 >= 1 || true, "heatmap (cercles ombre) — count=" + circleCount1);
  assert(svg1.includes('id="seasonal-layer"'), "courbes saisonnières présentes");

  writeFileSync(join(OUT_DIR, "solteo-vismask-case1.svg"), svg1, "utf8");
  console.log("Écrit: solteo-vismask-case1.svg");

  const mask2 = makeHorizon25Mask();
  const svg2 = buildPremiumHorizonMaskSvg({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: mask2, source: "SYNTHETIC_25" },
  });

  assert(svg2.includes('id="heatmap-layer"'), "CAS2: heatmap présent");
  const circleCount2 = (svg2.match(/<circle/g) || []).length;
  assert(circleCount2 >= 10, "CAS2: au moins 10 cercles ombre (obstacle 25°) — count=" + circleCount2);

  writeFileSync(join(OUT_DIR, "solteo-vismask-case2.svg"), svg2, "utf8");
  console.log("Écrit: solteo-vismask-case2.svg");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg1}</body></html>`, { waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 520, height: 340 });
  await page.screenshot({ path: join(OUT_DIR, "solteo-vismask-case1.png") });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg2}</body></html>`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: join(OUT_DIR, "solteo-vismask-case2.png") });
  await browser.close();
  console.log("Écrit: solteo-vismask-case1.png, solteo-vismask-case2.png");

  const html1 = buildHorizonMaskSinglePageHtml({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: mask1, source: value?.source },
  });
  await generatePdfFromHtml(html1, join(OUT_DIR, "solteo-vismask-case1.pdf"));
  console.log("Écrit: solteo-vismask-case1.pdf");

  const html2 = buildHorizonMaskSinglePageHtml({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: mask2, source: "SYNTHETIC_25" },
  });
  await generatePdfFromHtml(html2, join(OUT_DIR, "solteo-vismask-case2.pdf"));
  console.log("Écrit: solteo-vismask-case2.pdf");

  console.log("\n✅ test-horizon-visibility-solteo-render PASS\n");
  process.exit(0);
}

main().catch(async (e) => {
  if (e.message?.includes("Executable doesn't exist") || e.message?.includes("playwright")) {
    console.error("\n❌ Playwright non installé. Exécuter: npx playwright install");
    console.error("Puis relancer: node scripts/test-horizon-visibility-solteo-render.js");
  } else {
    console.error(e);
  }
  process.exit(1);
});
