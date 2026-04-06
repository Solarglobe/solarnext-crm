/**
 * AUDIT — Flux DB direct (sans HTTP) pour horizon mask
 * Usage: cd backend && STUDY_ID=xxx ORG_ID=yyy node scripts/audit-horizon-runtime-db.js
 * Ou: node scripts/audit-horizon-runtime-db.js <studyId> <orgId> [version]
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { getDsmAnalysisData } from "../services/dsmAnalysisPdf.service.js";
import { getHorizonMaskPdfData } from "../services/horizonMaskPdf.service.js";
import { buildDsmCombinedHtml } from "../pdf/dsmCombinedHtmlBuilder.js";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";
import { generateDsmAnalysisPDF } from "../pdf/playwright-dsm-analysis.js";
import { chromium } from "playwright";

const OUT_DIR = join(process.cwd(), "scripts", "output");

const studyId = process.env.STUDY_ID || process.argv[2];
const orgId = process.env.ORG_ID || process.argv[3];
const versionId = parseInt(process.env.VERSION || process.argv[4] || "1", 10);

function extractPage1Svg(html) {
  const match = html.match(/<svg[^>]*class="horizon-cartesian-chart"[^>]*>[\s\S]*?<\/svg>/);
  return match ? match[0] : null;
}

function sha1(content) {
  return createHash("sha1").update(typeof content === "string" ? content : content).digest("hex");
}

(async () => {
  if (!studyId || !orgId) {
    console.error("Usage: STUDY_ID=xxx ORG_ID=yyy node audit-horizon-runtime-db.js");
    console.error("   ou: node audit-horizon-runtime-db.js <studyId> <orgId> [version]");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== AUDIT DB DIRECT — studyId =", studyId, "orgId =", orgId, "version =", versionId, "===\n");

  let data;
  let useHorizonOnly = false;
  try {
    data = await getDsmAnalysisData({ studyId, versionId, orgId });
  } catch (e) {
    if (e.message === "CALPINAGE_REQUIRED") {
      console.log("CALPINAGE_REQUIRED — fallback sur getHorizonMaskPdfData (page masque seule)");
      data = await getHorizonMaskPdfData({ studyId, versionId, orgId });
      useHorizonOnly = true;
    } else {
      console.error("getDsmAnalysisData échoué:", e.message);
      process.exit(1);
    }
  }

  const mask = data.horizonMask?.mask || [];
  const maskPointsCount = Array.isArray(mask) ? mask.length : 0;
  const elevs = mask.map((m) => (m && typeof m.elev === "number" ? m.elev : 0));
  const minElev = elevs.length ? Math.min(...elevs) : null;
  const maxElev = elevs.length ? Math.max(...elevs) : null;

  console.log("maskPointsCount:", maskPointsCount);
  console.log("minElev:", minElev != null ? minElev.toFixed(2) : "N/A");
  console.log("maxElev:", maxElev != null ? maxElev.toFixed(2) : "N/A");
  if (mask.length > 0) {
    console.log("10 premiers points:", JSON.stringify(mask.slice(0, 10)));
  }

  const html = useHorizonOnly ? buildHorizonMaskSinglePageHtml(data) : buildDsmCombinedHtml(data);
  writeFileSync(join(OUT_DIR, "db-runtime.html"), html, "utf8");
  console.log("\nÉcrit: db-runtime.html");

  const svgContent = extractPage1Svg(html) || "";
  if (svgContent) {
    writeFileSync(join(OUT_DIR, "db-page1.svg"), svgContent, "utf8");
    console.log("Écrit: db-page1.svg");
  } else {
    console.log("⚠️ Aucun SVG horizon-cartesian-chart trouvé dans le HTML");
    writeFileSync(join(OUT_DIR, "db-page1.svg"), "<!-- NO SVG EXTRACTED -->", "utf8");
  }
  const hasVisibilityMask = svgContent.includes('id="visibility-mask-area"');
  const hasFill = svgContent.includes("rgba(100,116,139,0.35)");
  console.log("\ndb-page1.svg contient visibility-mask-area:", hasVisibilityMask ? "OUI" : "NON");
  console.log("db-page1.svg contient fill rgba(100,116,139,0.35):", hasFill ? "OUI" : "NON");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: join(OUT_DIR, "db-runtime.png"), fullPage: true });
  await browser.close();
  console.log("Écrit: db-runtime.png");

  const pdfBuffer = await generateDsmAnalysisPDF(html);
  writeFileSync(join(OUT_DIR, "db-runtime.pdf"), pdfBuffer);
  console.log("Écrit: db-runtime.pdf");

  const svgForSha = svgContent || "<!-- empty -->";
  console.log("\nSHA1 db-page1.svg:", sha1(svgForSha));
  console.log("SHA1 db-runtime.pdf:", sha1(pdfBuffer));
})();
