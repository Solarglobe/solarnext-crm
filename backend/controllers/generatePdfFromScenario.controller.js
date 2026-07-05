/**
 * POST /api/studies/:studyId/versions/:versionId/generate-pdf-from-scenario
 * PDF à partir d'un scénario scenarios_v2 — snapshot en mémoire uniquement (pas de lock, pas d'UPDATE study_versions).
 * Body optionnel : add_to_documents (bool) — copie volontaire sur le lead (Documents > Propositions commerciales).
 */

import fs from "fs/promises";
import { pool } from "../config/db.js";
import { buildSelectedScenarioSnapshot } from "../services/selectedScenarioSnapshot.service.js";
import { generatePdfForVersion } from "./pdfGeneration.controller.js";
import { getAbsolutePath } from "../services/localStorage.service.js";
import { ensureLeadCommercialProposalFromScenarioPdf } from "../services/documents.service.js";
import { resolveQuotePdfClientSlug } from "../services/quotePdfStorageName.js";
import { buildStudyPdfFileName, extractPdfNameFactsFromSnapshot } from "../services/studyPdfFileName.util.js";
import { CALC_ENGINE_VERSION } from "../services/calc/calc.constants.js";
import { evaluateScenarioSelectable, SCENARIO_SELECTABLE_MESSAGES } from "../services/scenarioSelectable.js";

const VALID_SCENARIO_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL", "BATTERY_HYBRID"];
const SCENARIO_LABELS_FR = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
  BATTERY_HYBRID: "Hybride : physique + virtuelle",
};
const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id ?? null;

export async function generatePdfFromScenario(req, res) {
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

    // STEP 1 — charger la ligne study_versions (version + data_json)
    const versionRes = await pool.query(
      `SELECT id, study_id, data_json, selected_scenario_snapshot FROM study_versions
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

    const dataJson = row.data_json && typeof row.data_json === "object" ? row.data_json : {};

    // STEP 2 — valider scenarios_v2
    const scenariosV2 = dataJson.scenarios_v2;
    if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) {
      return res.status(400).json({
        error: "scenarios_v2 absent ou vide. Lancez le calcul (run-study) avant de générer un PDF.",
      });
    }

    // STEP 2a — GARDE SÉLECTIONNABILITÉ : absent / _skipped / incomplet (données manquantes).
    // Ne bloque JAMAIS sur une économie faible/nulle/négative ni un ROI non rentable calculé.
    const selectedV2 = (scenariosV2 || []).find((s) => (s.id || s.name) === scenarioId) || null;
    const selectable = evaluateScenarioSelectable(selectedV2, scenarioId);
    if (!selectable.selectable) {
      const status = selectable.reason === "SCENARIO_ABSENT" ? 400 : 409;
      return res.status(status).json({
        error: "SCENARIO_NOT_SELECTABLE",
        reason: selectable.reason,
        scenario_id: scenarioId,
        message: SCENARIO_SELECTABLE_MESSAGES[selectable.reason] ?? "Ce scénario ne peut pas être exporté en PDF.",
      });
    }

    // STEP 2b — GARDE SNAPSHOT PERIME / BLOQUE : jamais de PDF sur une base non a jour.
    const snapshotEngineVersion = dataJson.scenarios_engine_version ?? selectedV2.scenarios_engine_version ?? null;
    const staleSnapshot = snapshotEngineVersion !== CALC_ENGINE_VERSION;
    if (selectedV2.display_blocked === true || selectedV2.needs_recompute === true || staleSnapshot) {
      return res.status(409).json({
        error: "PDF_BLOCKED_STALE_SNAPSHOT",
        message: "PDF impossible : snapshot périmé — recalcul requis.",
        blocked_reason: selectedV2.blocked_reason ?? (staleSnapshot ? "STALE_SNAPSHOT_ENGINE_VERSION" : null),
        snapshot_engine_version: snapshotEngineVersion,
        current_engine_version: CALC_ENGINE_VERSION,
      });
    }

    // STEP 3 — construire le snapshot éphémère (buildSelectedScenarioSnapshot charge lui-même le calpinage)
    const snapshot = await buildSelectedScenarioSnapshot({
      studyId,
      versionId,
      scenarioId,
      organizationId: org,
      dataJson,
    });

    const doc = await generatePdfForVersion(
      {
        studyId,
        versionId,
        organizationId: org,
        userId: userId(req),
        ephemeralSnapshot: snapshot,
        scenarioIdForPdf: scenarioId,
      },
      {}
    );

    const payload = {
      success: true,
      documentId: doc.id,
      fileName: doc.file_name,
      downloadUrl: `/api/documents/${doc.id}/download`,
    };

    const rawAdd = req.body?.add_to_documents ?? req.body?.addToDocuments;
    const addToDocuments =
      rawAdd === true || rawAdd === "true" || rawAdd === 1 || rawAdd === "1";

    if (addToDocuments) {
      try {
        const studyRow = await pool.query(
          `SELECT s.lead_id, s.study_number, l.last_name AS lead_last_name, l.full_name AS lead_full_name
           FROM studies s
           LEFT JOIN leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id
           WHERE s.id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL)`,
          [studyId, org]
        );
        const leadId = studyRow.rows[0]?.lead_id ?? null;
        const studyNumber =
          (studyRow.rows[0]?.study_number != null &&
            String(studyRow.rows[0].study_number).trim()) ||
          studyId;
        const clientSlug = resolveQuotePdfClientSlug(
          studyRow.rows[0]?.lead_last_name ?? null,
          studyRow.rows[0]?.lead_full_name ?? null
        );

        if (!leadId) {
          payload.leadDocument = { status: "skipped", reason: "NO_LEAD" };
        } else {
          const skRes = await pool.query(
            `SELECT storage_key FROM entity_documents WHERE id = $1 AND organization_id = $2`,
            [doc.id, org]
          );
          const storageKey = skRes.rows[0]?.storage_key;
          if (!storageKey) {
            payload.leadDocument = { status: "error", reason: "STORAGE_KEY_MISSING" };
          } else {
            const pdfBuffer = await fs.readFile(getAbsolutePath(storageKey));
            // Nom identique au document d'étude affiché sur le portail client :
            // Etude-Scenario[-XkWc][-NBatterie(s)].pdf (mêmes faits, même snapshot).
            const proposalFileName = buildStudyPdfFileName(
              scenarioId,
              extractPdfNameFactsFromSnapshot(snapshot)
            );
            const leadResult = await ensureLeadCommercialProposalFromScenarioPdf({
              pdfBuffer,
              organizationId: org,
              studyId,
              studyVersionId: versionId,
              scenarioKey: scenarioId,
              userId: userId(req),
              leadId,
              studyNumber,
              scenarioLabelFr: SCENARIO_LABELS_FR[scenarioId] || scenarioId,
              clientSlug,
              sourceStudyVersionDocumentId: doc.id,
              fileName: proposalFileName,
              displayName: proposalFileName.replace(/\.pdf$/i, ""),
            });
            if (leadResult.status === "skipped") {
              payload.leadDocument = { status: "skipped", reason: leadResult.reason };
            } else if (leadResult.status === "existing") {
              payload.leadDocument = { status: "existing", id: leadResult.document.id };
            } else {
              payload.leadDocument = { status: "created", id: leadResult.document.id };
            }
          }
        }
      } catch (leadDocErr) {
        console.error("[generatePdfFromScenario.controller][leadDocumentCopy]", {
          message: leadDocErr?.message || String(leadDocErr),
          studyId,
          versionId,
          scenario_id: scenarioId,
        });
        payload.leadDocument = {
          status: "error",
          reason: "LEAD_DOCUMENT_COPY_FAILED",
          message: leadDocErr?.message || "LEAD_DOCUMENT_COPY_FAILED",
        };
      }
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("PDF_ERROR_FULL:", err);
    console.error("STACK:", err.stack);
    const e = err;
    if (e.code === "VERSION_NOT_FOUND") {
      return res.status(404).json({ error: "VERSION_NOT_FOUND" });
    }
    if (e.code === "PDF_RENDER_TIMEOUT") {
      return res.status(500).json({ error: "PDF_RENDER_TIMEOUT" });
    }
    if (e.code === "PDF_RENDER_FAILED") {
      return res.status(500).json({ error: "PDF_RENDER_FAILED", message: e.message });
    }
    if (e.code === "PDF_BLOCKED_CALCULATION_CONFIDENCE") {
      // 409 (pas 500) — données de calcul bloquantes ; le frontend affiche un message actionnable
      return res.status(409).json({
        error: "PDF_BLOCKED_CALCULATION_CONFIDENCE",
        calculation_confidence: e.calculation_confidence ?? null,
      });
    }
    if (e.code === "SCENARIO_SNAPSHOT_REQUIRED") {
      return res.status(400).json({ error: "SCENARIO_SNAPSHOT_REQUIRED" });
    }
    if (e.message && e.message.includes("scenarios_v2")) {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({
      error: "PDF_FROM_SCENARIO_FAILED",
      message: e.message || "Génération PDF impossible",
    });
  }
}
