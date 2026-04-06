/**
 * Génère un PDF exemple + screenshot pour validation visuelle.
 * Usage: cd backend && node scripts/generate-horizon-mask-pdf-screenshot.js
 */

import "dotenv/config";
import { chromium } from "playwright";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";
import { generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const mockHorizonMask = [];
for (let i = 0; i <= 360; i += 5) {
  const rad = (i * Math.PI) / 180;
  const elev = 18 + 15 * Math.sin(rad) * Math.cos(((i - 180) * Math.PI) / 180);
  mockHorizonMask.push({ az: i, elev: Math.max(8, Math.min(40, elev)) });
}

const mockData = {
  address: "12 rue Example, 75001 Paris",
  date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
  lat: 48.8566,
  lon: 2.3522,
  orientationDeg: 180,
  tiltDeg: 30,
  horizonMask: { mask: mockHorizonMask, source: "RELIEF_ONLY" },
  horizonMeta: { source: "RELIEF_ONLY", confidence: 0.85 },
};

const html = buildHorizonMaskSinglePageHtml(mockData);
const pdfBuffer = await generatePdfFromHtml(html);

const outDir = join(process.cwd(), "scripts", "output");
try {
  mkdirSync(outDir, { recursive: true });
} catch (_) {}

const pdfPath = join(outDir, "horizon-mask-exemple.pdf");
writeFileSync(pdfPath, pdfBuffer);
console.log("PDF sauvegardé:", pdfPath);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded" });
await page.evaluate(() => new Promise(requestAnimationFrame));
const screenshotPath = join(outDir, "horizon-mask-screenshot.png");
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();
console.log("Screenshot sauvegardé:", screenshotPath);
