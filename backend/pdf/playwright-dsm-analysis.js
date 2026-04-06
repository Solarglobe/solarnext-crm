/**
 * CP-DSM-PDF-004/005 — Export PDF "Analyse Ombres" Premium
 * 2 pages : Masque Horizon (preuve) + Analyse Énergétique.
 * CP-DSM-PDF-006 : Export PDF "Masque d'ombrage" 1 page (site-level).
 * Génère un PDF à partir d'HTML construit côté backend.
 * Ne modifie pas les exports PDF existants.
 */

import { chromium } from "playwright";
import { buildDsmCombinedHtml } from "./dsmCombinedHtmlBuilder.js";

/**
 * Génère un PDF à partir d'HTML (générique).
 * @param {string} html - HTML complet
 * @param {{ format?: string, margin?: object }} [opts] - options page.pdf
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generatePdfFromHtml(html, opts = {}) {
  if (!html || typeof html !== "string") {
    throw new Error("generatePdfFromHtml : html manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(html, {
    waitUntil: "domcontentloaded",
  });

  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const pdfBuffer = await page.pdf({
    format: opts.format ?? "A4",
    printBackground: opts.printBackground ?? true,
    margin: opts.margin ?? {
      top: "12mm",
      bottom: "12mm",
      left: "12mm",
      right: "12mm",
    },
  });

  await browser.close();
  return pdfBuffer;
}

/**
 * Génère le PDF Analyse Ombres (2 pages).
 * @param {string} html - HTML complet (sortie de buildDsmCombinedHtml)
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateDsmAnalysisPDF(html) {
  return generatePdfFromHtml(html);
}
