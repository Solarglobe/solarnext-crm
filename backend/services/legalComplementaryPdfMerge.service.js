/**
 * Append PDFs RGE / assurance décennale après le corps du devis (et après fusion CGV PDF le cas échéant).
 */

import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";
import { getAbsolutePath } from "./localStorage.service.js";
import logger from "../app/core/logger.js";
import {
  getOrganizationLegalDocument,
} from "./organizationLegalDocuments.service.js";
import { ORGANIZATION_LEGAL_DOC_KIND } from "../constants/organizationLegalDocumentTypes.js";

/**
 * @param {Buffer} mainBuffer
 * @param {Buffer} annexBuffer
 * @returns {Promise<Buffer>}
 */
async function appendPdfBuffer(mainBuffer, annexBuffer) {
  const mainDoc = await PDFDocument.load(mainBuffer);
  const annexDoc = await PDFDocument.load(annexBuffer);
  const indices = annexDoc.getPageIndices();
  const copied = await mainDoc.copyPages(annexDoc, indices);
  copied.forEach((p) => mainDoc.addPage(p));
  return Buffer.from(await mainDoc.save());
}

/**
 * @param {Buffer} mainBuffer
 * @param {string} organizationId
 * @param {{ id: string, storage_key: string, mime_type: string|null }} row
 * @returns {Promise<Buffer>}
 */
async function appendOneOrgPdf(mainBuffer, organizationId, row) {
  const mimeType = String(row.mime_type || "").toLowerCase();
  if (!mimeType.includes("pdf")) {
    logger.warn("LEGAL_COMPLEMENTARY_MERGE_SKIP", { reason: "not_pdf", organizationId, documentId: row.id });
    return mainBuffer;
  }
  const pathAbs = getAbsolutePath(row.storage_key);
  const annexBytes = await fs.readFile(pathAbs);
  const out = await appendPdfBuffer(mainBuffer, annexBytes);
  logger.info("LEGAL_COMPLEMENTARY_MERGED", { organizationId, documentId: row.id, kind: "annex" });
  return out;
}

/**
 * Ordre : RGE puis décennale (après CGV).
 * @param {Buffer} mainBuffer
 * @param {string} organizationId
 * @param {{ include_rge?: boolean, include_decennale?: boolean }|null|undefined} legal_documents — doit être validé avant appel
 * @returns {Promise<Buffer>}
 */
export async function mergeQuoteLegalComplementaryPdfsAppend(mainBuffer, organizationId, legal_documents) {
  const ld = legal_documents && typeof legal_documents === "object" ? legal_documents : {};
  let buf = mainBuffer;
  if (ld.include_rge) {
    const row = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.RGE);
    if (row) buf = await appendOneOrgPdf(buf, organizationId, row);
  }
  if (ld.include_decennale) {
    const row = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.DECENNALE);
    if (row) buf = await appendOneOrgPdf(buf, organizationId, row);
  }
  return buf;
}
