/**
 * CP-PDF-V2-019 — Token court pour le renderer PDF Playwright
 * Permet au renderer d'obtenir le pdf-view-model sans JWT utilisateur.
 */

import jwt from "jsonwebtoken";
import logger from "../app/core/logger.js";

const USAGE = "pdf-render";
/** Jeton pour le renderer PDF devis (Playwright) — sans studyId/versionId */
const USAGE_FINANCIAL_QUOTE = "pdf-quote-render";
const USAGE_FINANCIAL_INVOICE = "pdf-invoice-render";
const EXPIRES_IN = "5m";

/**
 * Crée un token signé pour le renderer PDF.
 * @param {string} studyId
 * @param {string} versionId
 * @param {string} organizationId
 * @param {{ snapshotPreviewKey?: string }} [extra] — clé stock côté serveur (snapshot éphémère, non persisté)
 * @returns {string} token JWT
 */
export function createPdfRenderToken(studyId, versionId, organizationId, extra = {}) {
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    throw new Error("JWT_SECRET manquant — impossible de créer le renderToken");
  }
  const payload = {
    studyId,
    versionId,
    organizationId,
    usage: USAGE,
    ...(extra && typeof extra === "object" && extra.snapshotPreviewKey
      ? { snapshotPreviewKey: extra.snapshotPreviewKey }
      : {}),
  };
  const token = jwt.sign(payload, secret, { expiresIn: EXPIRES_IN });
  logger.info("PDF_RENDER_TOKEN_CREATED", { studyId, versionId, organizationId, hasPreview: !!payload.snapshotPreviewKey });
  return token;
}

/**
 * Vérifie et décode le renderToken.
 * @param {string} token
 * @param {string} studyId - doit correspondre au token
 * @param {string} versionId - doit correspondre au token
 * @returns {{ studyId: string, versionId: string, organizationId: string, snapshotPreviewKey?: string }}
 * @throws {Error} si token invalide, expiré ou usage incorrect
 */
export function verifyPdfRenderToken(token, studyId, versionId) {
  if (!token || typeof token !== "string") {
    const e = new Error("renderToken manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    const e = new Error("JWT_SECRET manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      logger.warn("PDF_RENDER_INTERNAL_VIEWMODEL_FAIL", { reason: "token_expired" });
      const e = new Error("renderToken expiré");
      e.code = "RENDER_TOKEN_EXPIRED";
      throw e;
    }
    logger.warn("PDF_RENDER_INTERNAL_VIEWMODEL_FAIL", { reason: "token_invalid" });
    const e = new Error("renderToken invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.usage !== USAGE) {
    logger.warn("PDF_RENDER_INTERNAL_VIEWMODEL_FAIL", { reason: "usage_mismatch" });
    const e = new Error("usage invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.studyId !== studyId || decoded.versionId !== versionId) {
    logger.warn("PDF_RENDER_INTERNAL_VIEWMODEL_FAIL", {
      reason: "studyId_versionId_mismatch",
      tokenStudyId: decoded.studyId,
      tokenVersionId: decoded.versionId,
    });
    const e = new Error("studyId ou versionId incohérent avec le token");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  return {
    studyId: decoded.studyId,
    versionId: decoded.versionId,
    organizationId: decoded.organizationId,
    ...(decoded.snapshotPreviewKey ? { snapshotPreviewKey: decoded.snapshotPreviewKey } : {}),
  };
}

/**
 * Token pour le renderer PDF devis (route interne + assets logo).
 * @param {string} quoteId
 * @param {string} organizationId
 * @returns {string}
 */
export function createFinancialQuoteRenderToken(quoteId, organizationId) {
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    throw new Error("JWT_SECRET manquant — impossible de créer le renderToken devis");
  }
  const payload = {
    quoteId,
    organizationId,
    usage: USAGE_FINANCIAL_QUOTE,
  };
  const token = jwt.sign(payload, secret, { expiresIn: EXPIRES_IN });
  logger.info("PDF_QUOTE_RENDER_TOKEN_CREATED", { quoteId, organizationId });
  return token;
}

/**
 * @param {string} token
 * @param {string} quoteId
 * @returns {{ quoteId: string, organizationId: string }}
 */
export function verifyFinancialQuoteRenderToken(token, quoteId) {
  if (!token || typeof token !== "string") {
    const e = new Error("renderToken manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    const e = new Error("JWT_SECRET manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      const e = new Error("renderToken expiré");
      e.code = "RENDER_TOKEN_EXPIRED";
      throw e;
    }
    const e = new Error("renderToken invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.usage !== USAGE_FINANCIAL_QUOTE) {
    const e = new Error("usage invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.quoteId !== quoteId) {
    const e = new Error("quoteId incohérent avec le token");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  return {
    quoteId: decoded.quoteId,
    organizationId: decoded.organizationId,
  };
}

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 * @returns {string}
 */
export function createFinancialInvoiceRenderToken(invoiceId, organizationId) {
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    throw new Error("JWT_SECRET manquant — impossible de créer le renderToken facture");
  }
  const payload = {
    invoiceId,
    organizationId,
    usage: USAGE_FINANCIAL_INVOICE,
  };
  const token = jwt.sign(payload, secret, { expiresIn: EXPIRES_IN });
  logger.info("PDF_INVOICE_RENDER_TOKEN_CREATED", { invoiceId, organizationId });
  return token;
}

/**
 * @param {string} token
 * @param {string} invoiceId
 * @returns {{ invoiceId: string, organizationId: string }}
 */
export function verifyFinancialInvoiceRenderToken(token, invoiceId) {
  if (!token || typeof token !== "string") {
    const e = new Error("renderToken manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    const e = new Error("JWT_SECRET manquant");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      const e = new Error("renderToken expiré");
      e.code = "RENDER_TOKEN_EXPIRED";
      throw e;
    }
    const e = new Error("renderToken invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.usage !== USAGE_FINANCIAL_INVOICE) {
    const e = new Error("usage invalide");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  if (decoded.invoiceId !== invoiceId) {
    const e = new Error("invoiceId incohérent avec le token");
    e.code = "RENDER_TOKEN_INVALID";
    throw e;
  }
  return {
    invoiceId: decoded.invoiceId,
    organizationId: decoded.organizationId,
  };
}
