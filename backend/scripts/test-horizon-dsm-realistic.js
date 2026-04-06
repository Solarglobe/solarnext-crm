/**
 * Test DSM horizon mask réaliste — Chelles ou lat/lon en args
 * Asserts: maskPointsCount=180, maxElev>1 si SURFACE_DSM, fallback si plat.
 * Usage: cd backend && node scripts/test-horizon-dsm-realistic.js [lat] [lon]
 *   ou: STUDY_ID=xxx ORG_ID=yyy node scripts/test-horizon-dsm-realistic.js
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getOrComputeHorizonMask } from "../services/horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { buildPremiumHorizonMaskSvg } from "../pdf/horizonMaskPremiumChart.js";
import { getHorizonMaskPdfData } from "../services/horizonMaskPdf.service.js";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";
import { generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { chromium } from "playwright";

const OUT_DIR = join(process.cwd(), "scripts", "output");
const CHELLES_LAT = 48.8938962;
const CHELLES_LON = 2.6210259;

async function main() {
  let lat = parseFloat(process.argv[2]) || CHELLES_LAT;
  let lon = parseFloat(process.argv[3]) || CHELLES_LON;
  const studyId = process.env.STUDY_ID;
  const orgId = process.env.ORG_ID;

  if (studyId && orgId) {
    try {
      const data = await getHorizonMaskPdfData({ studyId, versionId: 1, orgId });
      lat = data.lat;
      lon = data.lon;
    } catch (e) {
      console.warn("getHorizonMaskPdfData failed, using lat/lon args:", e.message);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== test-horizon-dsm-realistic — lat=", lat, "lon=", lon, "===\n");

  const { value } = await getOrComputeHorizonMask(
    { tenantKey: orgId || "test", lat, lon, radius_m: 500, step_deg: 2 },
    () => computeHorizonMaskAuto({ organizationId: orgId || "test", lat, lon, radius_m: 500, step_deg: 2 })
  );

  const mask = value?.mask || [];
  const maskPointsCount = mask.length;
  const elevs = mask.map((m) => m.elev ?? 0).filter((e) => !isNaN(e));
  const minElev = elevs.length ? Math.min(...elevs) : 0;
  const maxElev = elevs.length ? Math.max(...elevs) : 0;
  const source = value?.source ?? "UNKNOWN";
  const hasNaN = mask.some((m) => isNaN(m.elev));

  console.log("source:", source);
  console.log("maskPointsCount:", maskPointsCount);
  console.log("minElev:", minElev.toFixed(2));
  console.log("maxElev:", maxElev.toFixed(2));

  const assert = (cond, msg) => {
    if (!cond) {
      console.error("❌ ASSERT FAIL:", msg);
      process.exit(1);
    }
  };

  assert(maskPointsCount === 180, "maskPointsCount === 180 (step=2°)");
  assert(!hasNaN, "aucun NaN dans mask");
  if (source === "SURFACE_DSM") {
    assert(maxElev > 1.0, "maxElev > 1.0 si source=SURFACE_DSM (actuel: " + maxElev.toFixed(2) + ")");
  } else {
    assert(maxElev <= 0.1 || source === "RELIEF_ONLY", "si maxElev<=0.1 alors source DOIT être RELIEF_ONLY");
  }

  writeFileSync(join(OUT_DIR, "dsm-mask.json"), JSON.stringify({ mask, source, minElev, maxElev }, null, 2), "utf8");
  console.log("\nÉcrit: dsm-mask.json");

  const svg = buildPremiumHorizonMaskSvg({
    lat,
    lon,
    horizonMask: value,
  });
  writeFileSync(join(OUT_DIR, "dsm-horizon.svg"), svg, "utf8");
  console.log("Écrit: dsm-horizon.svg");

  const html = buildHorizonMaskSinglePageHtml({
    lat,
    lon,
    horizonMask: value,
    horizonMeta: { source },
    address: "Test",
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: join(OUT_DIR, "dsm-horizon.png"), fullPage: true });
  await browser.close();
  console.log("Écrit: dsm-horizon.png");

  const pdfBuffer = await generatePdfFromHtml(html);
  writeFileSync(join(OUT_DIR, "dsm-horizon.pdf"), pdfBuffer);
  console.log("Écrit: dsm-horizon.pdf");

  const pathYValues = (svg.match(/L [\d.]+ ([\d.]+)/g) || []).map((m) => parseFloat(m.split(" ")[2]));
  const uniqueY = [...new Set(pathYValues.filter((y) => !isNaN(y)))];
  assert(uniqueY.length > 1, "path du masque doit avoir des y qui varient (pas tous y=bas)");

  console.log("\n✅ test:horizon-dsm-real PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
