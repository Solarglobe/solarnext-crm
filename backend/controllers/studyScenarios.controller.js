/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Lecture pure : retourne data_json.scenarios_v2 sans calcul ni fallback.
 */

import { getVersionById } from "../routes/studies/service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Retourne scenarios_v2 tel quel. 404 si version inexistante ou scenarios_v2 absent.
 */
export async function getStudyScenarios(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ error: "studyId et versionId requis" });
    }

    const studyVersion = await getVersionById(versionId, org);
    if (!studyVersion) {
      return res.status(404).json({ error: "Version non trouvée" });
    }
    if (studyVersion.study_id !== studyId) {
      return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    }

    const dataJson = studyVersion.data && typeof studyVersion.data === "object" ? studyVersion.data : {};
    const scenarios_v2 = dataJson.scenarios_v2;

    if (!scenarios_v2 || !Array.isArray(scenarios_v2) || scenarios_v2.length === 0) {
      return res.status(404).json({ error: "SCENARIOS_NOT_GENERATED" });
    }

    return res.json({
      ok: true,
      scenarios: scenarios_v2,
      is_locked: studyVersion.is_locked === true,
      selected_scenario_id: studyVersion.selected_scenario_id ?? null,
    });
  } catch (e) {
    console.error("[studyScenarios.controller] getStudyScenarios:", e);
    return res.status(500).json({ error: e.message || "Erreur lors de la lecture des scénarios." });
  }
}
