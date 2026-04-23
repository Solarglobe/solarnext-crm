/**
 * PDF V2 — Génération server-side du PDF SolarNext via Playwright
 * Ouvre le renderer frontend, attend __pdf_render_ready + #pdf-ready (fallback waitForSelector).
 */

import { chromium } from "playwright";
import logger from "../app/core/logger.js";
import { JWT_SECRET } from "../config/auth.js";

const PAGE_LOAD_TIMEOUT = 30000;

/** Railway / Linux container : sandbox souvent indisponible. */
const CHROMIUM_LAUNCH_OPTIONS = {
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

/**
 * Délai d’attente du signal ready côté renderer (ms).
 * @returns {number}
 */
export function getPdfRenderReadyTimeoutMs() {
  const n = Number(process.env.PDF_RENDER_READY_TIMEOUT);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

/**
 * Base URL du renderer (PDF études + financiers).
 * En production : obligatoire (Playwright sur Railway ne peut pas servir le front sur localhost:5173).
 * En dev : repli `http://localhost:5173` (Vite).
 * @returns {string} sans slash final
 */
export function getPdfRendererBaseUrl() {
  const fromEnv = (process.env.PDF_RENDERER_BASE_URL || process.env.FRONTEND_URL || "").trim();
  const isProd = process.env.NODE_ENV === "production";
  const raw = fromEnv || (!isProd ? "http://localhost:5173" : "");
  if (!raw) {
    throw new Error(
      isProd
        ? "PDF impossible en production : définir PDF_RENDERER_BASE_URL ou FRONTEND_URL (URL absolue du front Vercel, ex. https://votre-projet.vercel.app). Le backend appelle ce domaine en Playwright pour les entrées HTML pdf-render / financial-quote-pdf-render / calpinage-render (.html)."
        : "PDF impossible : URL du renderer vide. Définir PDF_RENDERER_BASE_URL ou FRONTEND_URL (ex. https://crm.example.com)."
    );
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`PDF impossible : URL du renderer invalide (${raw}).`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`PDF impossible : protocole du renderer non supporté (${parsed.protocol}).`);
  }
  const base = raw.replace(/\/$/, "");
  return base;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} rendererUrl
 * @param {string} logLabel
 */
async function waitForPdfPageReady(page, rendererUrl, logLabel) {
  const timeoutMs = getPdfRenderReadyTimeoutMs();
  console.log("[PDF] waiting for ready...", { timeoutMs, logLabel });
  logger.info("PDF waiting for renderer ready", { timeoutMs, logLabel, rendererUrl });

  const jwtHint = JWT_SECRET.slice(0, 12);
  console.log("[PDF] using JWT_SECRET prefix:", jwtHint);

  try {
    await page.waitForFunction(
      () =>
        window.__pdf_render_ready === true &&
        document.querySelector('#pdf-ready[data-status="ready"]') != null,
      { timeout: timeoutMs }
    );
  } catch (err) {
    const isTimeout = err.message && /timeout|Timeout/i.test(err.message);
    if (!isTimeout) throw err;
    logger.warn("PDF waitForFunction timeout, fallback waitForSelector", { rendererUrl, logLabel });
    const fallbackMs = Math.min(20000, timeoutMs);
    try {
      await page.waitForSelector('#pdf-ready[data-status="ready"]', { timeout: fallbackMs });
    } catch (selErr) {
      throw err;
    }
    const flagOk = await page.evaluate(() => window.__pdf_render_ready === true);
    if (!flagOk) {
      throw err;
    }
  }
}

/**
 * Génère un buffer PDF à partir de l'URL du renderer.
 * @param {string} rendererUrl - URL complète (ex: http://localhost:5173/pdf-render.html?studyId=...&versionId=...)
 * @returns {Promise<Buffer>} buffer PDF
 * @throws {Error} code PDF_RENDER_TIMEOUT | PDF_RENDER_FAILED
 */
export async function generatePdfFromRendererUrl(rendererUrl) {
  console.log("[PDF] rendererUrl:", rendererUrl);
  logger.info("PDF generation started", { rendererUrl });

  const readyTimeoutMs = getPdfRenderReadyTimeoutMs();
  console.log("[PDF] PDF_RENDER_READY_TIMEOUT ms:", readyTimeoutMs);

  let browser;
  try {
    browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(rendererUrl, {
        waitUntil: "networkidle",
        timeout: PAGE_LOAD_TIMEOUT,
      });
      logger.info("Renderer loaded", { rendererUrl });

      await waitForPdfPageReady(page, rendererUrl, "study");
      logger.info("Renderer ready", { rendererUrl });

      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
      });
      const size = pdfBuffer ? pdfBuffer.length : 0;
      logger.info("PDF generated", { rendererUrl, pdfSize: size });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
      await context.close();
    }
  } catch (err) {
    if (err.message && /timeout|Timeout/i.test(err.message)) {
      logger.error("PDF_RENDER_TIMEOUT", { rendererUrl, message: err.message });
      const e = new Error("PDF_RENDER_TIMEOUT");
      e.code = "PDF_RENDER_TIMEOUT";
      throw e;
    }
    logger.error("PDF_RENDER_FAILED", { rendererUrl, message: err.message });
    const e = new Error(err.message || "PDF_RENDER_FAILED");
    e.code = "PDF_RENDER_FAILED";
    throw e;
  } finally {
    if (browser) await browser.close();
    logger.info("PDF generation finished", { rendererUrl });
  }
}

/**
 * Construit l'URL du renderer V2 pour une étude/version donnée.
 * CP-PDF-V2-019 : inclut renderToken pour auth Playwright.
 * @param {string} studyId - ID de l'étude
 * @param {string} versionId - ID de la version
 * @param {string} [renderToken] - token court pour la route interne pdf-view-model
 * @returns {string} URL complète
 */
export function buildRendererUrl(studyId, versionId, renderToken) {
  const base = getPdfRendererBaseUrl();
  let url = `${base}/pdf-render.html?studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
  if (renderToken) {
    url += `&renderToken=${encodeURIComponent(renderToken)}`;
  }
  console.log("[PDF] rendererUrl:", url);
  logger.info("PDF_RENDER_URL", { PDF_RENDER_URL: url, studyId, versionId });
  return url;
}

/**
 * URL du renderer à utiliser (priorité : PDF_RENDERER_TEST_URL pour les tests, sinon buildRendererUrl).
 * @param {string} studyId - ID de l'étude
 * @param {string} versionId - ID de la version
 * @param {string} [renderToken] - token pour auth Playwright (ignoré si PDF_RENDERER_TEST_URL)
 * @returns {string}
 */
export function getRendererUrl(studyId, versionId, renderToken) {
  const testUrl = (process.env.PDF_RENDERER_TEST_URL || "").trim();
  if (testUrl) {
    console.log("[PDF] rendererUrl:", testUrl);
    logger.info("PDF_RENDER_URL", { PDF_RENDER_URL: testUrl, studyId, versionId });
    return testUrl;
  }
  return buildRendererUrl(studyId, versionId, renderToken);
}

/**
 * URL du renderer PDF devis (portrait A4) — query financialQuoteId + renderToken.
 * @param {string} quoteId
 * @param {string} renderToken
 * @param {{ quoteSigned?: boolean }} [opts] — quoteSigned=1 : inclut signatures persistées dans le rendu
 */
export function buildFinancialQuoteRendererUrl(quoteId, renderToken, opts = {}) {
  const base = getPdfRendererBaseUrl();
  let url = `${base}/financial-quote-pdf-render.html?financialQuoteId=${encodeURIComponent(quoteId)}&renderToken=${encodeURIComponent(renderToken)}`;
  if (opts.quoteSigned === true) {
    url += "&quoteSigned=1";
  }
  console.log("[PDF] rendererUrl:", url);
  logger.info("PDF_QUOTE_RENDER_URL", { quoteId, rendererBase: base, quoteSigned: !!opts.quoteSigned });
  return url;
}

/**
 * URL du renderer PDF facture (portrait A4) — query financialInvoiceId + renderToken.
 * @param {string} invoiceId
 * @param {string} renderToken
 */
export function buildFinancialInvoiceRendererUrl(invoiceId, renderToken) {
  const base = getPdfRendererBaseUrl();
  const url = `${base}/pdf-render.html?financialInvoiceId=${encodeURIComponent(invoiceId)}&renderToken=${encodeURIComponent(renderToken)}`;
  console.log("[PDF] rendererUrl:", url);
  logger.info("PDF_INVOICE_RENDER_URL", { invoiceId, rendererBase: base });
  return url;
}

/**
 * PDF portrait A4 — devis / facture (Playwright, même pipeline).
 * @param {string} rendererUrl
 * @param {string} [logLabel]
 * @param {{ useCssPageMargins?: boolean }} [opts] — si true (devis uniquement) : marges pilotées par @page CSS (preferCSSPageSize), sans double marge Playwright
 * @returns {Promise<Buffer>}
 */
export async function generatePdfFromPortraitFinanceUrl(rendererUrl, logLabel = "finance", opts = {}) {
  console.log("[PDF] rendererUrl:", rendererUrl);
  logger.info(`PDF ${logLabel} generation started`, { rendererUrl });

  const readyTimeoutMs = getPdfRenderReadyTimeoutMs();
  console.log("[PDF] PDF_RENDER_READY_TIMEOUT ms:", readyTimeoutMs);

  const useCssPageMargins = opts.useCssPageMargins === true;
  const pdfOptions = useCssPageMargins
    ? {
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        preferCSSPageSize: true,
      }
    : {
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" },
      };

  let browser;
  try {
    browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(rendererUrl, {
        waitUntil: "networkidle",
        timeout: PAGE_LOAD_TIMEOUT,
      });
      logger.info(`${logLabel} renderer loaded`, { rendererUrl });

      await waitForPdfPageReady(page, rendererUrl, logLabel);
      logger.info(`${logLabel} renderer ready`, { rendererUrl });

      const pdfBuffer = await page.pdf(pdfOptions);
      const size = pdfBuffer ? pdfBuffer.length : 0;
      logger.info(`PDF ${logLabel} generated`, { rendererUrl, pdfSize: size });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
      await context.close();
    }
  } catch (err) {
    if (err.message && /timeout|Timeout/i.test(err.message)) {
      logger.error(`PDF_${logLabel.toUpperCase()}_RENDER_TIMEOUT`, { rendererUrl, message: err.message });
      const e = new Error("PDF_RENDER_TIMEOUT");
      e.code = "PDF_RENDER_TIMEOUT";
      throw e;
    }
    logger.error(`PDF_${logLabel.toUpperCase()}_RENDER_FAILED`, { rendererUrl, message: err.message });
    const e = new Error(err.message || "PDF_RENDER_FAILED");
    e.code = "PDF_RENDER_FAILED";
    throw e;
  } finally {
    if (browser) await browser.close();
    logger.info(`PDF ${logLabel} generation finished`, { rendererUrl });
  }
}

/**
 * @param {string} rendererUrl
 * @returns {Promise<Buffer>}
 */
export async function generatePdfFromFinancialQuoteUrl(rendererUrl) {
  return generatePdfFromPortraitFinanceUrl(rendererUrl, "quote", { useCssPageMargins: true });
}

/**
 * @param {string} rendererUrl
 * @returns {Promise<Buffer>}
 */
export async function generatePdfFromFinancialInvoiceUrl(rendererUrl) {
  return generatePdfFromPortraitFinanceUrl(rendererUrl, "invoice");
}
