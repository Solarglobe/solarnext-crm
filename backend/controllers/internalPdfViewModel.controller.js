/**
 * CP-PDF-V2-019 — Route interne pdf-view-model avec renderToken
 * Permet au renderer Playwright d'obtenir le ViewModel sans JWT utilisateur.
 * GET /api/internal/pdf-view-model/:studyId/:versionId?renderToken=...
 */

import logger from "../app/core/logger.js";
import { verifyPdfRenderToken } from "../services/pdfRenderToken.service.js";
import { getEphemeralSnapshot } from "../services/pdfEphemeralSnapshot.service.js";
import { getPdfViewModelForVersion } from "../services/pdf/pdfViewModel.service.js";

/**
 * GET /api/internal/pdf-view-model/:studyId/:versionId
 * Query: renderToken (requis)
 * Réponse: { ok: true, viewModel } — identique à l'endpoint CRM pdf-view-model
 */
export async function getInternalPdfViewModel(req, res) {
  try {
    const { studyId, versionId } = req.params;
    const renderToken = req.query.renderToken;

    if (!studyId || !versionId) {
      return res.status(400).json({ ok: false, error: "studyId et versionId requis" });
    }

    let decoded;
    try {
      decoded = verifyPdfRenderToken(renderToken, studyId, versionId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ ok: false, error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ ok: false, error: "RENDER_TOKEN_INVALID" });
    }

    let previewOptions = null;
    if (decoded.snapshotPreviewKey) {
      const ep = getEphemeralSnapshot(decoded.snapshotPreviewKey);
      if (!ep) {
        return res.status(404).json({ ok: false, error: "SNAPSHOT_PREVIEW_EXPIRED" });
      }
      previewOptions = { snapshot: ep.snapshot, scenarioId: ep.scenarioId };
    }

    const result = await getPdfViewModelForVersion(
      studyId,
      versionId,
      decoded.organizationId,
      previewOptions
    );

    if (result.error === "STUDY_VERSION_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "STUDY_VERSION_NOT_FOUND" });
    }

    if (result.error === "FORBIDDEN_CROSS_ORG") {
      return res.status(403).json({ ok: false, error: "FORBIDDEN_CROSS_ORG" });
    }

    if (result.error === "SNAPSHOT_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "SNAPSHOT_NOT_FOUND" });
    }

    logger.info("PDF_RENDER_INTERNAL_VIEWMODEL_OK", {
      studyId,
      versionId,
      organizationId: decoded.organizationId,
    });

    return res.status(200).json({ ok: true, viewModel: result.viewModel });
  } catch (e) {
    logger.error("PDF_RENDER_INTERNAL_VIEWMODEL_FAIL", {
      message: e.message,
      studyId: req.params?.studyId,
      versionId: req.params?.versionId,
    });
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
