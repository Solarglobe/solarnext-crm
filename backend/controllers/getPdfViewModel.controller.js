/**
 * PDF V2 — GET /api/studies/:studyId/versions/:versionId/pdf-view-model
 * Lit le snapshot figé, appelle le mapper, renvoie le ViewModel JSON.
 */

import logger from "../app/core/logger.js";
import { getPdfViewModelForVersion } from "../services/pdf/pdfViewModel.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * GET /api/studies/:studyId/versions/:versionId/pdf-view-model
 * Réponse succès : { ok: true, viewModel }
 * Erreurs : 404 STUDY_VERSION_NOT_FOUND | 404 SNAPSHOT_NOT_FOUND | 403 FORBIDDEN_CROSS_ORG
 */
export async function getPdfViewModel(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ ok: false, error: "Non authentifié" });
    }

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ ok: false, error: "studyId et versionId requis" });
    }

    const result = await getPdfViewModelForVersion(studyId, versionId, org);

    if (result.error === "STUDY_VERSION_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "STUDY_VERSION_NOT_FOUND" });
    }

    if (result.error === "FORBIDDEN_CROSS_ORG") {
      logger.warn("LOG_PDF_VIEWMODEL_FORBIDDEN", {
        studyId,
        versionId,
        orgRequested: org,
        orgActual: result.orgActual,
      });
      return res.status(403).json({ ok: false, error: "FORBIDDEN_CROSS_ORG" });
    }

    if (result.error === "SNAPSHOT_NOT_FOUND") {
      logger.warn("LOG_PDF_VIEWMODEL_SNAPSHOT_MISSING", {
        studyId,
        versionId,
      });
      return res.status(404).json({ ok: false, error: "SNAPSHOT_NOT_FOUND" });
    }

    logger.info("LOG_PDF_VIEWMODEL_OK", {
      studyId,
      versionId,
      organizationId: org,
    });

    return res.status(200).json({ ok: true, viewModel: result.viewModel });
  } catch (e) {
    console.error("[getPdfViewModel.controller] getPdfViewModel:", e);
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
