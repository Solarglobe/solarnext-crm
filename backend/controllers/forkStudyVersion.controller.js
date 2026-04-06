/**
 * PROMPT 8 — Fork d'une version d'étude (nouvelle version déverrouillée).
 * POST /api/studies/:studyId/versions/:versionId/fork
 * Copie data_json, calpinage_data, economic_snapshots. L'ancienne version reste intacte.
 */

import * as studiesService from "../routes/studies/service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

/**
 * POST /api/studies/:studyId/versions/:versionId/fork
 */
export async function forkStudyVersion(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    const result = await studiesService.forkStudyVersion(
      studyId,
      versionId,
      org,
      userId(req)
    );
    if (!result) {
      return res.status(404).json({ error: "Étude ou version non trouvée" });
    }
    return res.status(201).json({
      id: result.id,
      version_number: result.version_number,
      selected_scenario_id: null,
      is_locked: false,
    });
  } catch (e) {
    console.error("[forkStudyVersion.controller] forkStudyVersion:", e);
    return res.status(500).json({
      error: e.message || "Erreur lors du fork de la version",
    });
  }
}
