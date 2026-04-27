/**
 * AUDIT — Pourquoi visibility-mask-area n'apparaît pas dans le PDF runtime
 * Analyse uniquement, dumps dans backend/scripts/output/
 * Usage: cd backend && node scripts/audit-visibility-mask-runtime.js
 */

import "../config/register-local-env.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { buildDsmCombinedHtml } from "../pdf/dsmCombinedHtmlBuilder.js";
import { generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { getVisibilityMaskStats } from "../pdf/horizonMaskPremiumChart.js";
import { chromium } from "playwright";

const OUT_DIR = join(process.cwd(), "scripts", "output");

const mockHorizonMask = [];
for (let i = 0; i <= 360; i += 10) {
  const elev = 5 + 15 * Math.sin((i * Math.PI) / 180) * Math.cos(((i - 180) * Math.PI) / 180);
  mockHorizonMask.push({ az: i, elev: Math.max(0, Math.min(50, elev)) });
}

const mockData = {
  address: "12 rue Example, 75001 Paris",
  date: "25 février 2025",
  lat: 48.8566,
  lon: 2.3522,
  orientationDeg: 180,
  tiltDeg: 30,
  horizonMask: { mask: mockHorizonMask, source: "RELIEF_ONLY" },
  horizonMeta: { source: "RELIEF_ONLY", confidence: 0.85 },
  installation: { shading_loss_pct: 8.5, shading: {} },
  geometry: {
    frozenBlocks: [
      {
        panels: [
          { id: "P1", polygonPx: [{ x: 50, y: 50 }, { x: 80, y: 50 }, { x: 80, y: 80 }, { x: 50, y: 80 }] },
        ],
      },
    ],
  },
  shading: {
    near: { totalLossPct: 4.2 },
    far: { totalLossPct: 3.1 },
    combined: { totalLossPct: 8.5 },
    shadingQuality: { score: 82, grade: "B" },
    perPanel: [{ panelId: "P1", lossPct: 2.1 }],
  },
};

function sha1(content) {
  return createHash("sha1").update(typeof content === "string" ? content : content).digest("hex");
}

function extractPage1Svg(html) {
  const match = html.match(/<svg[^>]*class="horizon-premium-chart"[^>]*>[\s\S]*?<\/svg>/) ||
    html.match(/<svg[^>]*class="horizon-cartesian-chart"[^>]*>[\s\S]*?<\/svg>/);
  return match ? match[0] : null;
}

function extractAllPathIds(svg) {
  if (!svg) return [];
  const ids = [];
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(svg)) !== null) ids.push(m[1]);
  return ids;
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\n=== 1) Données masque DSM (10 premiers points + min/max) ===\n");
  const mask = mockData.horizonMask?.mask || [];
  const elevs = mask.map((m) => m.elev);
  console.log("10 premiers points:", JSON.stringify(mask.slice(0, 10)));
  console.log("elev min:", Math.min(...elevs).toFixed(2), "max:", Math.max(...elevs).toFixed(2));

  const stats = getVisibilityMaskStats(mask);
  if (stats) {
    console.log("minBlockingDeg:", stats.minBlockingDeg.toFixed(2));
    console.log("maxBlockingDeg:", stats.maxBlockingDeg.toFixed(2));
  }

  console.log("\n=== 2) Génération HTML (même chaîne que /internal/pdf/dsm-analysis) ===\n");
  const html = buildDsmCombinedHtml(mockData);
  writeFileSync(join(OUT_DIR, "runtime-dsm-analysis.html"), html, "utf8");
  console.log("Écrit: runtime-dsm-analysis.html");

  const page1Svg = extractPage1Svg(html);
  if (page1Svg) {
    writeFileSync(join(OUT_DIR, "runtime-page1.svg"), page1Svg, "utf8");
    console.log("Écrit: runtime-page1.svg");
  } else {
    console.log("⚠️ Aucun SVG horizon-cartesian-chart trouvé dans le HTML");
  }

  console.log("\n=== 3) Fingerprint et visibility-mask-area ===\n");
  const hasFingerprint = html.includes('data-fingerprint="AUDIT-RUNTIME-2025-02-25"');
  const hasVisibilityMask = html.includes('id="visibility-mask-area"');
  const hasFill = html.includes("rgba(100,116,139,0.35)");
  console.log("Fingerprint présent:", hasFingerprint ? "OUI" : "NON");
  console.log("visibility-mask-area présent:", hasVisibilityMask ? "OUI" : "NON");
  console.log("fill rgba(100,116,139,0.35) présent:", hasFill ? "OUI" : "NON");

  if (page1Svg) {
    const pathIds = extractAllPathIds(page1Svg);
    console.log("IDs <path> dans le SVG:", pathIds.length ? pathIds.join(", ") : "(aucun)");
  }

  console.log("\n=== 4) Screenshot Playwright (avant PDF) ===\n");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: join(OUT_DIR, "runtime-horizon-mask-screenshot.png"), fullPage: true });
  await browser.close();
  console.log("Écrit: runtime-horizon-mask-screenshot.png");

  console.log("\n=== 5) Génération PDF ===\n");
  const pdfBuffer = await generatePdfFromHtml(html);
  writeFileSync(join(OUT_DIR, "runtime-dsm-analysis.pdf"), pdfBuffer);
  console.log("Écrit: runtime-dsm-analysis.pdf");

  console.log("\n=== 6) SHA1 des artefacts ===\n");
  const svgContent = page1Svg || "";
  const pdfContent = pdfBuffer;
  console.log("SHA1 runtime-page1.svg:", sha1(svgContent));
  console.log("SHA1 runtime-dsm-analysis.pdf:", sha1(pdfContent));

  console.log("\n=== RAPPORT AUDIT ===\n");
  console.log("Fichier chart exécuté: backend/pdf/horizonMaskPremiumChart.js (CP-FAR-C-11)");
  console.log("Fingerprint dans runtime:", hasFingerprint ? "PRÉSENT" : "ABSENT");
  console.log("visibility-mask-area dans SVG:", hasVisibilityMask ? "PRÉSENT" : "ABSENT");
  console.log("SHA1 runtime-page1.svg:", sha1(svgContent));
  console.log("SHA1 runtime-dsm-analysis.pdf:", sha1(pdfContent));
})();
