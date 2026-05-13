/**
 * PROMPT 8 — Sélection et gel du scénario (BASE | BATTERY_PHYSICAL | BATTERY_VIRTUAL).
 * PDF V2 — Intégration génération PDF automatique après snapshot.
 * POST /api/studies/:studyId/versions/:versionId/select-scenario
 * Stocke selected_scenario_id + snapshot complet + is_locked.
 * Pipeline : snapshot → generatePdf → document stocké → retour enrichi.
 */

import { pool } from "../config/db.js";
import { buildSelectedScenarioSnapshot } from "../services/selectedScenarioSnapshot.service.js";
import { generatePdfForVersion } from "./pdfGeneration.controller.js";
import { isPdfBlockedByConfidence } from "../services/calculationConfidence.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const VALID_SCENARIO_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL", "BATTERY_HYBRID"];
const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id ?? null;

/**
 * POST /api/studies/:studyId/versions/:versionId/select-scenario
 * Body: { scenario_id: "BASE" | "BATTERY_PHYSICAL" | "BATTERY_VIRTUAL" }
 * Réponse: { success, scenarioId, pdfGenerated, documentId?, downloadUrl? }
 */
export async function selectScenario(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    const scenarioId = req.body?.scenario_id;
    if (!scenarioId || !VALID_SCENARIO_IDS.includes(scenarioId)) {
      return res.status(400).json({
        error: "scenario_id requis et doit être BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL ou BATTERY_HYBRID",
      });
    }

    const versionRes = await pool.query(
      `SELECT id, study_id, data_json, is_locked FROM study_versions
       WHERE id = $1 AND organization_id = $2`,
      [versionId, org]
    );
    if (versionRes.rows.length === 0) {
      return res.status(404).json({ error: "Version non trouvée" });
    }
    const row = versionRes.rows[0];
    if (row.study_id !== studyId) {
      return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    }
    if (row.is_locked === true) {
      return res.status(400).json({ error: "LOCKED_VERSION" });
    }

    const dataJson = row.data_json && typeof row.data_json === "object" ? row.data_json : {};
    const scenariosV2 = dataJson.scenarios_v2;
    if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) {
      return res.status(400).json({
        error: "scenarios_v2 absent ou vide. Lancez le calcul (run-study) avant de sélectionner un scénario.",
      });
    }

    const cc = dataJson.calculation_confidence;
    if (isPdfBlockedByConfidence(cc)) {
      return res.status(409).json({
        error:
          "Impossible de figer le scénario : le calcul comporte des avertissements bloquants (données incomplètes, production en mode fallback, ou batterie virtuelle sans coût configuré). Corrigez l’étude puis relancez le calcul.",
        code: "SNAPSHOT_BLOCKED_CALCULATION_CONFIDENCE",
        calculation_confidence: cc ?? null,
      });
    }

    const snapshot = await buildSelectedScenarioSnapshot({
      studyId,
      versionId,
      scenarioId,
      organizationId: org,
      dataJson,
    });

    await pool.query(
      `UPDATE study_versions
       SET selected_scenario_id = $1, selected_scenario_snapshot = $2::jsonb, is_locked = true, locked_at = NOW()
       WHERE id = $3 AND organization_id = $4`,
      [scenarioId, JSON.stringify(snapshot), versionId, org]
    );

    void logAuditEvent({
      action: AuditActions.STUDY_SCENARIO_SELECTED,
      entityType: "study_version",
      entityId: versionId,
      organizationId: org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: {
        study_id: studyId,
        scenario_id: scenarioId,
      },
    });

    // Génération PDF automatique (try/catch séparé : snapshot reste valide si PDF échoue)
    // SKIP_PDF_IN_SELECT_SCENARIO=1 pour tests sans Playwright
    let pdfGenerated = false;
    let documentId = null;
    let downloadUrl = null;
    let pdfError = null;

    if (process.env.SKIP_PDF_IN_SELECT_SCENARIO === "1") {
      return res.status(200).json({
        success: true,
        status: "SCENARIO_SELECTED_AND_LOCKED",
        scenarioId,
        pdfGenerated: false,
      });
    }

    let doc = null;
    try {
      doc = await generatePdfForVersion(
        { studyId, versionId, organizationId: org, userId: userId(req) },
        {}
      );
      pdfGenerated = true;
      documentId = doc.id;
      downloadUrl = `/api/documents/${doc.id}/download`;
    } catch (e) {
      pdfError = e;
      if (e.code === "PDF_RENDER_TIMEOUT") {
        return res.status(200).json({
          success: true,
          status: "SCENARIO_SELECTED_AND_LOCKED",
          scenarioId,
          pdfGenerated: false,
          error: "PDF_RENDER_TIMEOUT",
          message: "Scénario validé mais génération PDF échouée (timeout)",
        });
      }
      if (e.code === "PDF_RENDER_FAILED") {
        return res.status(200).json({
          success: true,
          status: "SCENARIO_SELECTED_AND_LOCKED",
          scenarioId,
          pdfGenerated: false,
          error: "PDF_RENDER_FAILED",
          message: "Scénario validé mais génération PDF échouée",
        });
      }
      return res.status(200).json({
        success: true,
        status: "SCENARIO_SELECTED_AND_LOCKED",
        scenarioId,
        pdfGenerated: false,
        error: pdfError?.code || "PDF_GENERATION_FAILED",
        message: pdfError?.message || "Scénario validé mais génération PDF échouée",
      });
    }

    return res.status(200).json({
      success: true,
      status: "SCENARIO_SELECTED_AND_LOCKED",
      scenarioId,
      pdfGenerated: true,
      documentId,
      downloadUrl,
      fileName: doc?.file_name,
    });
  } catch (e) {
    console.error("[selectScenario.controller] selectScenario:", e);
    if (e.message && e.message.includes("scenarios_v2")) {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({
      error: "SCENARIO_SNAPSHOT_FAILED",
      message: e.message || "Impossible de figer le scénario",
    });
  }
}
