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

const VALID_SCENARIO_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];
const SCENARIO_LABELS_FR = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
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
        error: "scenario_id requis et doit être BASE, BATTERY_PHYSICAL ou BATTERY_VIRTUAL",
      });
    }

    console.log("STEP 1 BEFORE: load study_versions row (version + data_json)");
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
    console.log("STEP 1 OK: study_versions row loaded");

    const dataJson = row.data_json && typeof row.data_json === "object" ? row.data_json : {};

    console.log("STEP 3 BEFORE: read scenarios_v2 from version data_json");
    const scenariosV2 = dataJson.scenarios_v2;
    if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) {
      return res.status(400).json({
        error: "scenarios_v2 absent ou vide. Lancez le calcul (run-study) avant de générer un PDF.",
      });
    }

    const hasScenario = (scenariosV2 || []).some((s) => (s.id || s.name) === scenarioId);
    if (!hasScenario) {
      return res.status(400).json({
        error: `Scénario ${scenarioId} introuvable dans scenarios_v2`,
      });
    }
    console.log("STEP 3 OK: scenarios_v2 validated");

    console.log("STEP 2 BEFORE: load calpinage_data (geometry_json)");
    const calpinageRes = await pool.query(
      `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`,
      [versionId, org]
    );
    const calpinage_data = calpinageRes.rows[0]?.geometry_json ?? null;
    console.log("STEP 2 OK: calpinage_data row read");

    console.log("STEP 4 BEFORE: build ephemeral selected_scenario_snapshot");
    const snapshot = await buildSelectedScenarioSnapshot({
      studyId,
      versionId,
      scenarioId,
      organizationId: org,
      dataJson,
    });
    console.log("STEP 4 OK: ephemeral selected_scenario_snapshot built");

    const studyDbg = await pool.query(
      `SELECT id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) AND (deleted_at IS NULL)`,
      [studyId, org]
    );
    const study = studyDbg.rows[0] || null;

    const selected_scenario_snapshot = snapshot;
    console.log("PDF_DEBUG", {
      hasStudy: !!study,
      hasVersion: versionRes.rows.length > 0,
      hasCalpinage: !!calpinage_data,
      panelsCount: calpinage_data?.panels?.length,
      hasScenarios: !!scenariosV2,
      scenarioKeys: Object.keys(scenariosV2 || {}),
      hasSelected: !!selected_scenario_snapshot,
      selectedType: selected_scenario_snapshot?.scenario_type,
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
          `SELECT lead_id, study_number FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
          [studyId, org]
        );
        const leadId = studyRow.rows[0]?.lead_id ?? null;
        const studyNumber = studyRow.rows[0]?.study_number ?? null;

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
              sourceStudyVersionDocumentId: doc.id,
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
    if (e.message && e.message.includes("scenarios_v2")) {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({
      error: "PDF_FROM_SCENARIO_FAILED",
      message: e.message || "Génération PDF impossible",
    });
  }
}
