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
import { buildStudyPdfFileName, extractPdfNameFactsFromSnapshot } from "../services/studyPdfFileName.util.js";
import { mergeOrganizationCgvPdfAppend } from "../services/legalCgvPdfMerge.service.js";
import { FINANCIAL_DOCUMENT_PDF_KIND } from "../constants/financialDocumentPdfKind.js";
import { isPdfBlockedByConfidence } from "../services/calculationConfidence.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id ?? null;

export function getEconomicSnapshotBlockingWarnings(snapshot) {
  const economicSnapshot =
    snapshot && typeof snapshot === "object" && snapshot.economic_snapshot && typeof snapshot.economic_snapshot === "object"
      ? snapshot.economic_snapshot
      : null;
  if (!economicSnapshot) return ["ECONOMIC_SNAPSHOT_MISSING"];
  const warnings = Array.isArray(economicSnapshot.blocking_warnings)
    ? economicSnapshot.blocking_warnings.filter((w) => typeof w === "string")
    : [];
  const blocking = warnings.filter((w) => /^ECONOMIC_ASSUMPTION_NOT_TRACEABLE:/.test(w));
  for (const field of [
    "price_eur_kwh",
    "elec_growth_pct",
    "horizon_years",
    "oa_rate_eur_kwh",
    "prime_eur",
    "capex_ttc",
    "reste_a_charge_eur",
  ]) {
    const n = Number(economicSnapshot[field]);
    if (!Number.isFinite(n)) blocking.push(`ECONOMIC_ASSUMPTION_MISSING:${field}`);
  }
  return [...new Set(blocking)];
}

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

  console.log("STEP 1c BEFORE: getVersionById (full row for PDF pipeline)");
  const version = await studiesService.getVersionById(versionId, organizationId);
  if (!version || version.study_id !== studyId) {
    const e = new Error("VERSION_NOT_FOUND");
    e.code = "VERSION_NOT_FOUND";
    throw e;
  }
  console.log("STEP 1c OK: version row loaded for PDF");

  const dataJsonPdf = version.data && typeof version.data === "object" ? version.data : {};
  const ccPdf = dataJsonPdf.calculation_confidence;
  console.log("PDF_CONFIDENCE_CHECK", JSON.stringify({
    versionId,
    has_cc: !!ccPdf,
    level: ccPdf?.level ?? null,
    blocking_warnings: ccPdf?.blocking_warnings ?? [],
    blocked: isPdfBlockedByConfidence(ccPdf),
  }));
  if (isPdfBlockedByConfidence(ccPdf)) {
    const e = new Error("PDF_BLOCKED_CALCULATION_CONFIDENCE");
    e.code = "PDF_BLOCKED_CALCULATION_CONFIDENCE";
    e.calculation_confidence = ccPdf;
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
    const economicBlockingWarnings = getEconomicSnapshotBlockingWarnings(ephemeralSnapshot);
    if (economicBlockingWarnings.length > 0) {
      const e = new Error("PDF_BLOCKED_ECONOMIC_SNAPSHOT");
      e.code = "PDF_BLOCKED_ECONOMIC_SNAPSHOT";
      e.blocking_warnings = economicBlockingWarnings;
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
    const economicBlockingWarnings = getEconomicSnapshotBlockingWarnings(snapshot);
    if (economicBlockingWarnings.length > 0) {
      const e = new Error("PDF_BLOCKED_ECONOMIC_SNAPSHOT");
      e.code = "PDF_BLOCKED_ECONOMIC_SNAPSHOT";
      e.blocking_warnings = economicBlockingWarnings;
      throw e;
    }
    renderToken = createPdfRenderToken(studyId, versionId, organizationId);
  }

  console.log("STEP 5 BEFORE: build renderer URL (pdf-render.html / Playwright)");
  const rendererUrl = getRendererUrl(studyId, versionId, renderToken);
  console.log("STEP 5 OK: renderer URL ready");
  logger.info("PDF generation started", { rendererUrl, studyId, versionId, ephemeral: !!ephemeralSnapshot });

  console.log("STEP 6 BEFORE: Playwright generatePdfFromRendererUrl (PDF buffer)");
  let pdfBuffer = await generatePdfFromRendererUrl(rendererUrl);
  console.log("STEP 6 OK: PDF buffer generated", {
    byteLength: pdfBuffer?.length,
  });
  if (documentPdfKind === FINANCIAL_DOCUMENT_PDF_KIND.QUOTE) {
    pdfBuffer = await mergeOrganizationCgvPdfAppend(pdfBuffer, organizationId);
  }

  // Nommage : Etude-Scenario[-XkWc][-NBatterie(s)].pdf — sans nom client
  // (téléchargement depuis la fiche lead ; le portail est déjà propre au client).
  // Les faits (kWc, nb batteries) viennent du snapshot utilisé pour CE PDF.
  const snapshotForName =
    ephemeralSnapshot != null && typeof ephemeralSnapshot === "object"
      ? ephemeralSnapshot
      : version.selected_scenario_snapshot;
  const pdfDisplayName = buildStudyPdfFileName(
    scenarioIdForPdf ?? version.selected_scenario_id,
    extractPdfNameFactsFromSnapshot(snapshotForName)
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
    if (e.code === "PDF_BLOCKED_CALCULATION_CONFIDENCE") {
      return res.status(409).json({
        error: "PDF_BLOCKED_CALCULATION_CONFIDENCE",
        calculation_confidence: e.calculation_confidence ?? null,
      });
    }
    if (e.code === "PDF_BLOCKED_ECONOMIC_SNAPSHOT") {
      return res.status(409).json({
        error: "PDF_BLOCKED_ECONOMIC_SNAPSHOT",
        message: "PDF impossible : hypothèses économiques non traçables. Relancez le calcul puis figez à nouveau le scénario.",
        blocking_warnings: e.blocking_warnings ?? [],
      });
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
