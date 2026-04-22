/**
 * PDF V2 — POST /api/studies/:studyId/versions/:versionId/generate-pdf
 * Génération server-side du PDF SolarNext via Playwright + persistance dans documents CRM.
 * CP-PDF-V2-019 : renderToken pour auth Playwright (sans JWT utilisateur).
 */

import logger from "../app/core/logger.js";
import * as studiesService from "../routes/studies/service.js";
import * as pdfGenService from "../services/pdfGeneration.service.js";
import { createPdfRenderToken } from "../services/pdfRenderToken.service.js";
import { putEphemeralSnapshot } from "../services/pdfEphemeralSnapshot.service.js";
import { saveStudyPdfDocument } from "../services/documents.service.js";
import { buildStudyPdfFileName } from "../services/studyPdfFileName.util.js";
import { mergeOrganizationCgvPdfAppend } from "../services/legalCgvPdfMerge.service.js";
import { FINANCIAL_DOCUMENT_PDF_KIND } from "../constants/financialDocumentPdfKind.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id ?? null;

/**
 * Génère le PDF pour une version (logique interne). Utilisé par generatePdf, selectScenario, generatePdfFromScenario.
 * @param {object} params - { studyId, versionId, organizationId, userId, ephemeralSnapshot?, scenarioIdForPdf?, documentPdfKind? }
 *   documentPdfKind : défaut `PROPOSAL` (PDF étude sans CGV). `QUOTE` ajouterait la fusion CGV (non utilisé par ce flux devis).
 * @param {object} [options] - { generatePdfFromRendererUrl, getRendererUrl } pour tests
 * @returns {Promise<{ id: string, file_name: string }>} document créé
 * @throws {Error} code PDF_RENDER_TIMEOUT | PDF_RENDER_FAILED | SCENARIO_SNAPSHOT_REQUIRED | VERSION_NOT_FOUND
 */
export async function generatePdfForVersion(params, options = {}) {
  const {
    studyId,
    versionId,
    organizationId,
    userId: uid,
    ephemeralSnapshot,
    scenarioIdForPdf,
    documentPdfKind = FINANCIAL_DOCUMENT_PDF_KIND.PROPOSAL,
  } = params;
  const generatePdfFromRendererUrl =
    options.generatePdfFromRendererUrl ?? pdfGenService.generatePdfFromRendererUrl;
  const getRendererUrl = options.getRendererUrl ?? pdfGenService.getRendererUrl;

  const version = await studiesService.getVersionById(versionId, organizationId);
  if (!version || version.study_id !== studyId) {
    const e = new Error("VERSION_NOT_FOUND");
    e.code = "VERSION_NOT_FOUND";
    throw e;
  }

  let renderToken;
  if (ephemeralSnapshot != null && typeof ephemeralSnapshot === "object") {
    const sid = scenarioIdForPdf ?? version.selected_scenario_id;
    if (!sid) {
      const e = new Error("SCENARIO_SNAPSHOT_REQUIRED");
      e.code = "SCENARIO_SNAPSHOT_REQUIRED";
      throw e;
    }
    const previewKey = putEphemeralSnapshot(ephemeralSnapshot, sid);
    renderToken = createPdfRenderToken(studyId, versionId, organizationId, {
      snapshotPreviewKey: previewKey,
    });
  } else {
    const snapshot = version.selected_scenario_snapshot;
    if (snapshot == null || typeof snapshot !== "object") {
      logger.warn("generate-pdf: snapshot absent", { studyId, versionId });
      const e = new Error("SCENARIO_SNAPSHOT_REQUIRED");
      e.code = "SCENARIO_SNAPSHOT_REQUIRED";
      throw e;
    }
    renderToken = createPdfRenderToken(studyId, versionId, organizationId);
  }

  const rendererUrl = getRendererUrl(studyId, versionId, renderToken);
  logger.info("PDF generation started", { rendererUrl, studyId, versionId, ephemeral: !!ephemeralSnapshot });

  let pdfBuffer = await generatePdfFromRendererUrl(rendererUrl);
  if (documentPdfKind === FINANCIAL_DOCUMENT_PDF_KIND.QUOTE) {
    pdfBuffer = await mergeOrganizationCgvPdfAppend(pdfBuffer, organizationId);
  }

  const { clientName, studyName } = await studiesService.getStudyPdfDisplayNameParts(studyId, organizationId);
  const pdfDisplayName = buildStudyPdfFileName(
    clientName,
    studyName,
    scenarioIdForPdf ?? version.selected_scenario_id
  );

  const doc = await saveStudyPdfDocument(
    pdfBuffer,
    organizationId,
    studyId,
    versionId,
    uid,
    { fileName: pdfDisplayName }
  );

  logger.info("generate-pdf: document saved", {
    documentId: doc.id,
    studyId,
    versionId,
  });

  return doc;
}

/**
 * POST /api/studies/:studyId/versions/:versionId/generate-pdf
 * Pipeline : auth → study+version → snapshot → URL → Playwright → PDF buffer
 * @param {object} req
 * @param {object} res
 * @param {object} [options] - optional { generatePdfFromRendererUrl, getRendererUrl } for tests (si 3e arg et non fonction)
 */
export async function generatePdf(req, res, nextOrOptions) {
  const options = nextOrOptions && typeof nextOrOptions !== "function" ? nextOrOptions : {};

  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ error: "studyId et versionId requis" });
    }

    const doc = await generatePdfForVersion(
      { studyId, versionId, organizationId: org, userId: userId(req) },
      options
    );

    const downloadUrl = `/api/documents/${doc.id}/download`;
    return res.status(200).json({
      success: true,
      documentId: doc.id,
      fileName: doc.file_name,
      downloadUrl,
    });
  } catch (e) {
    if (e.code === "VERSION_NOT_FOUND") {
      return res.status(404).json({ error: "VERSION_NOT_FOUND" });
    }
    if (e.code === "SCENARIO_SNAPSHOT_REQUIRED") {
      return res.status(400).json({ error: "SCENARIO_SNAPSHOT_REQUIRED" });
    }
    if (e.code === "PDF_RENDER_TIMEOUT") {
      logger.error("generate-pdf: timeout", { studyId: req.params.studyId, versionId: req.params.versionId });
      return res.status(500).json({ error: "PDF_RENDER_TIMEOUT" });
    }
    if (e.code === "PDF_RENDER_FAILED") {
      logger.error("generate-pdf: failed", { message: e.message });
      return res.status(500).json({ error: "PDF_RENDER_FAILED" });
    }
    logger.error("generate-pdf: error", { message: e.message });
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
