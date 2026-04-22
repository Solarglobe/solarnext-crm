/**
 * Génération PDF DP : dédoublonnage par (lead, dp_piece), option forceReplace,
 * ou PDF brut si pas de leadId (scripts / hors CRM).
 */

import { tryParseJwtUser, enforceSuperAdminWriteAccess } from "../middleware/auth.middleware.js";
import { pool } from "../config/db.js";
import {
  userIsLiveSuperAdminByDb,
  sendSuperAdminJwtStale,
} from "../lib/superAdminUserGuards.js";
import {
  assertLeadBelongsToOrganization,
  deleteDocument,
  findExistingLeadDpDocumentByPiece,
  saveLeadDpGeneratedPdfDocument,
} from "./documents.service.js";
import logger from "../app/core/logger.js";
import { getDpPdfFileName, normalizeDpPieceKey } from "../constants/dpPdfFileNames.js";

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {{ piece: string, generate: () => Promise<Buffer> }} meta
 */
export async function respondWithDpPdfOrJson(req, res, meta) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const rawLead = body.leadId ?? body.lead_id;
  const leadId = rawLead != null && String(rawLead).trim() !== "" ? String(rawLead).trim() : "";

  const pieceKey = normalizeDpPieceKey(meta.piece);
  const forceReplace =
    body.forceReplace === true ||
    body.forceReplace === "true" ||
    body.force_replace === true ||
    body.force_replace === "true";

  const safeName = String(getDpPdfFileName(pieceKey, "")).replace(/[\r\n"]/g, "_");

  /** PDF sans persistance lead */
  if (!leadId) {
    let pdfBuffer;
    try {
      pdfBuffer = await meta.generate();
    } catch (e) {
      logger.error("DP_PDF_GENERATE_ERROR", { error: e, piece: pieceKey });
      return res.status(500).json({ error: e.message || "Erreur génération PDF" });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    return res.send(pdfBuffer);
  }

  /**
   * Préférer req.user (verifyJWT : signature + rôle super aligné DB).
   * Fallback tryParseJwtUser uniquement si appel hors verifyJWT — dans ce cas on révalide SUPER_ADMIN en base.
   */
  let user = req.user ?? tryParseJwtUser(req);
  if (!user?.organizationId) {
    return res.status(401).json({ error: "Authentification requise pour enregistrer le PDF sur le dossier" });
  }

  if (user.role === "SUPER_ADMIN") {
    const uid = user.userId ?? user.id;
    if (!uid || !(await userIsLiveSuperAdminByDb(pool, uid))) {
      return sendSuperAdminJwtStale(res);
    }
  }

  req.user = user;
  if (enforceSuperAdminWriteAccess(req, res)) {
    return;
  }

  try {
    await assertLeadBelongsToOrganization(leadId, user.organizationId);
  } catch (e) {
    const code = e.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 403;
    return res.status(code).json({ error: e.message || "Accès refusé" });
  }

  const existing = await findExistingLeadDpDocumentByPiece(user.organizationId, leadId, pieceKey);

  if (existing && !forceReplace) {
    return res.status(200).json({
      alreadyExists: true,
      existingDocumentId: existing.id,
      fileName: existing.file_name,
    });
  }

  if (existing && forceReplace) {
    try {
      await deleteDocument(existing.id, user.organizationId);
    } catch (e) {
      logger.error("DP_PDF_REPLACE_DELETE_ERROR", { error: e, documentId: existing.id, leadId });
      const code = e.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 500;
      return res.status(code).json({ error: e.message || "Impossible de remplacer le document existant" });
    }
  }

  let pdfBuffer;
  try {
    pdfBuffer = await meta.generate();
  } catch (e) {
    logger.error("DP_PDF_GENERATE_ERROR", { error: e, piece: pieceKey, leadId });
    return res.status(500).json({ error: e.message || "Erreur génération PDF" });
  }

  const uid = user.userId ?? user.id ?? null;

  try {
    const doc = await saveLeadDpGeneratedPdfDocument(pdfBuffer, user.organizationId, leadId, uid, {
      dpPiece: pieceKey,
    });
    return res.json({
      downloadUrl: `/api/documents/${doc.id}/download`,
      documentId: doc.id,
      fileName: doc.file_name,
    });
  } catch (e) {
    logger.error("DP_PDF_PERSIST_ERROR", { error: e, piece: pieceKey, leadId });
    return res.status(500).json({ error: e.message || "Erreur enregistrement document" });
  }
}
