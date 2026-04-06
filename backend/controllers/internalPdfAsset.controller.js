/**
 * CP-PDF — Assets PDF (logo, couverture) pour le renderer Playwright
 * GET /api/internal/pdf-asset/:orgId/logo?renderToken=...&studyId=...&versionId=...
 * GET /api/internal/pdf-asset/:orgId/pdf-cover?renderToken=...&studyId=...&versionId=...
 * Logo : settings_json.logo_image_key OU fallback orgLogo (storage/org/{orgId}/logo.ext)
 */

import path from "path";
import logger from "../app/core/logger.js";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "../services/localStorage.service.js";
import { getLogoPath, resolveOrgLogoAbsolutePath } from "../services/orgLogo.service.js";
import {
  verifyPdfRenderToken,
  verifyFinancialQuoteRenderToken,
  verifyFinancialInvoiceRenderToken,
} from "../services/pdfRenderToken.service.js";

const orgId = (req) => req.params.orgId;

async function serveAsset(req, res, assetType) {
  try {
    const org = orgId(req);
    const renderToken = req.query.renderToken;
    const studyId = req.query.studyId;
    const versionId = req.query.versionId;

    if (!renderToken || !studyId || !versionId) {
      return res.status(400).json({ error: "renderToken, studyId, versionId requis" });
    }

    let decoded;
    try {
      decoded = verifyPdfRenderToken(renderToken, studyId, versionId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ error: "RENDER_TOKEN_INVALID" });
    }

    if (decoded.organizationId !== org) {
      return res.status(403).json({ error: "Organisation non autorisée" });
    }

    const r = await pool.query(
      "SELECT settings_json, pdf_cover_image_key FROM organizations WHERE id = $1",
      [org]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }

    const settings = r.rows[0].settings_json ?? {};
    let filePath = null;
    let resolvedKey = null;

    if (assetType === "logo") {
      resolvedKey = settings.logo_image_key;
      if (resolvedKey) {
        filePath = path.resolve(getAbsolutePath(resolvedKey));
      } else {
        const legacyPath = await getLogoPath(org);
        if (legacyPath) {
          filePath = path.resolve(legacyPath);
          resolvedKey = "orgLogo";
        }
      }
      if (process.env.NODE_ENV !== "production") {
        logger.info("PDF_ASSET_LOGO_REQUEST", { orgId: org, hasLogoKey: !!settings.logo_image_key, resolvedKey: resolvedKey || "none" });
      }
    } else if (assetType === "pdf-cover") {
      resolvedKey = settings.pdf_cover_image_key || r.rows[0].pdf_cover_image_key;
      if (resolvedKey) {
        filePath = path.resolve(getAbsolutePath(resolvedKey));
      }
      if (process.env.NODE_ENV !== "production") {
        logger.info("PDF_ASSET_COVER_REQUEST", { orgId: org, hasCoverKey: !!resolvedKey, resolvedKey: resolvedKey || "none" });
      }
    }

    if (!filePath) {
      return res.status(404).json({ error: `Asset ${assetType} non trouvé` });
    }

    res.sendFile(filePath);
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }
    res.status(500).json({ error: e.message });
  }
}

export async function getLogo(req, res) {
  return serveAsset(req, res, "logo");
}

export async function getPdfCover(req, res) {
  return serveAsset(req, res, "pdf-cover");
}

/**
 * Logo pour le PDF devis — token devis (pas study/version).
 * GET /api/internal/pdf-asset/:orgId/logo-for-quote?renderToken=...&quoteId=...
 */
export async function getLogoForQuote(req, res) {
  try {
    const org = orgId(req);
    const renderToken = req.query.renderToken;
    const quoteId = req.query.quoteId;

    if (!renderToken || !quoteId) {
      return res.status(400).json({ error: "renderToken et quoteId requis" });
    }

    let decoded;
    try {
      decoded = verifyFinancialQuoteRenderToken(renderToken, quoteId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ error: "RENDER_TOKEN_INVALID" });
    }

    if (decoded.organizationId !== org) {
      return res.status(403).json({ error: "Organisation non autorisée" });
    }

    const filePath = await resolveOrgLogoAbsolutePath(org);
    if (!filePath) {
      return res.status(404).json({ error: "Asset logo non trouvé" });
    }

    res.sendFile(filePath);
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * Logo pour le PDF facture — token facture.
 * GET /api/internal/pdf-asset/:orgId/logo-for-invoice?renderToken=...&invoiceId=...
 */
export async function getLogoForInvoice(req, res) {
  try {
    const org = orgId(req);
    const renderToken = req.query.renderToken;
    const invoiceId = req.query.invoiceId;

    if (!renderToken || !invoiceId) {
      return res.status(400).json({ error: "renderToken et invoiceId requis" });
    }

    let decoded;
    try {
      decoded = verifyFinancialInvoiceRenderToken(renderToken, invoiceId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ error: "RENDER_TOKEN_INVALID" });
    }

    if (decoded.organizationId !== org) {
      return res.status(403).json({ error: "Organisation non autorisée" });
    }

    const filePath = await resolveOrgLogoAbsolutePath(org);
    if (!filePath) {
      return res.status(404).json({ error: "Asset logo non trouvé" });
    }

    res.sendFile(filePath);
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }
    res.status(500).json({ error: e.message });
  }
}
