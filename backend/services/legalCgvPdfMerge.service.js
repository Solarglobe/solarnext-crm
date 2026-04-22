/**
 * Append le PDF CGV organisationnel au buffer PDF principal.
 * Produit : réservé au PDF **devis** (`FINANCIAL_DOCUMENT_PDF_KIND.QUOTE` dans `quotes/service.js`).
 * Les PDF **proposition** étude (`pdfGeneration.controller.js`) n’appellent plus cette fusion.
 */

import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "./localStorage.service.js";
import logger from "../app/core/logger.js";
import { getLegalCgvRaw } from "./legalCgv.service.js";

/**
 * @param {Buffer} mainBuffer
 * @param {string} organizationId
 * @returns {Promise<Buffer>}
 */
export async function mergeOrganizationCgvPdfAppend(mainBuffer, organizationId) {
  try {
    const raw = await getLegalCgvRaw(organizationId);
    if (!raw || raw.mode !== "pdf" || !raw.pdf_document_id) {
      return mainBuffer;
    }

    const docRes = await pool.query(
      `SELECT storage_key, mime_type FROM entity_documents
       WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [raw.pdf_document_id, organizationId]
    );
    if (docRes.rows.length === 0) {
      logger.warn("CGV_PDF_MERGE_SKIP", { reason: "document_not_found", organizationId });
      return mainBuffer;
    }
    const { storage_key: storageKey, mime_type: mimeType } = docRes.rows[0];
    if (!String(mimeType || "").toLowerCase().includes("pdf")) {
      logger.warn("CGV_PDF_MERGE_SKIP", { reason: "not_pdf", organizationId });
      return mainBuffer;
    }

    const pathAbs = getAbsolutePath(storageKey);
    const annexBytes = await fs.readFile(pathAbs);
    const mainDoc = await PDFDocument.load(mainBuffer);
    const annexDoc = await PDFDocument.load(annexBytes);
    const indices = annexDoc.getPageIndices();
    const copied = await mainDoc.copyPages(annexDoc, indices);
    copied.forEach((p) => mainDoc.addPage(p));
    const out = await mainDoc.save();
    logger.info("CGV_PDF_MERGED", { organizationId, annexPages: indices.length });
    return Buffer.from(out);
  } catch (e) {
    logger.error("CGV_PDF_MERGE_FAILED", { organizationId, message: e.message });
    return mainBuffer;
  }
}
