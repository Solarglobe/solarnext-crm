/**
 * PDF V2 — GET /api/studies/:studyId/versions/:versionId/selected-scenario-snapshot
 * Retourne uniquement le snapshot figé (study_versions.selected_scenario_snapshot).
 * Aucun fallback vers scenarios_v2, data_json ou calcul.
 */

import logger from "../app/core/logger.js";
import { getSelectedScenarioSnapshotRow } from "../routes/studies/service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * GET /api/studies/:studyId/versions/:versionId/selected-scenario-snapshot
 * Réponse succès : { ok: true, snapshot }
 * Erreurs : 404 STUDY_VERSION_NOT_FOUND | 404 SNAPSHOT_NOT_FOUND | 403 FORBIDDEN_CROSS_ORG
 */
export async function getSelectedScenarioSnapshot(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ ok: false, error: "Non authentifié" });
    }

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ ok: false, error: "studyId et versionId requis" });
    }

    const row = await getSelectedScenarioSnapshotRow(versionId);

    if (!row) {
      return res.status(404).json({ ok: false, error: "STUDY_VERSION_NOT_FOUND" });
    }

    if (row.organization_id !== org) {
      logger.warn("LOG_SELECTED_SCENARIO_SNAPSHOT_FORBIDDEN", {
        studyId,
        versionId,
        orgRequested: org,
        orgActual: row.organization_id,
      });
      return res.status(403).json({ ok: false, error: "FORBIDDEN_CROSS_ORG" });
    }

    if (row.study_id !== studyId) {
      return res.status(404).json({ ok: false, error: "STUDY_VERSION_NOT_FOUND" });
    }

    const snapshot = row.selected_scenario_snapshot;
    if (snapshot == null || typeof snapshot !== "object") {
      logger.warn("LOG_SELECTED_SCENARIO_SNAPSHOT_MISSING", {
        studyId,
        versionId,
      });
      return res.status(404).json({ ok: false, error: "SNAPSHOT_NOT_FOUND" });
    }

    logger.info("LOG_SELECTED_SCENARIO_SNAPSHOT_OK", {
      studyId,
      versionId,
      organizationId: org,
    });

    return res.status(200).json({ ok: true, snapshot });
  } catch (e) {
    console.error("[getSelectedScenarioSnapshot.controller] getSelectedScenarioSnapshot:", e);
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
