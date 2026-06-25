/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Lecture scenarios_v2 : retourne le snapshot, avec réparation d'affichage pour anciens KPI BV.
 */

import { getVersionById } from "../routes/studies/service.js";
import { repairScenarioV2DisplayKpis } from "../services/scenarioV2DisplayRepair.service.js";
import { CALC_ENGINE_VERSION } from "../services/calc/calc.constants.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Retourne scenarios_v2. 404 si version inexistante ou scenarios_v2 absent.
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

    const scenariosForDisplay = repairScenarioV2DisplayKpis(scenarios_v2);

    // GARDE COHERENCE MOTEUR (lecture) : invalide les snapshots anciens et detecte
    // tout melange 8760/mensuel (cas FAVER batterie 95,5% / 244 cycles). On ne fabrique
    // aucun chiffre : on signale au front qu un recalcul est requis.
    const snapshotEngineVersion = dataJson.scenarios_engine_version ?? null;
    const staleSnapshot = snapshotEngineVersion !== CALC_ENGINE_VERSION;
    const baseBasis = scenariosForDisplay.find((s) => s && s.id === "BASE")?.energy_basis ?? null;
    let engineCoherent = true;
    for (const sc of scenariosForDisplay) {
      if (!sc) continue;
      const basis = sc.energy_basis ?? null;
      const mixed = basis === "monthly_fallback" || (baseBasis === "hourly_8760" && basis !== "hourly_8760" && sc.id !== "BASE" && sc._skipped !== true);
      if (mixed || (staleSnapshot && basis == null)) {
        sc._engine_stale = true;
        engineCoherent = false;
      }
    }

    return res.json({
      ok: true,
      scenarios: scenariosForDisplay,
      is_locked: studyVersion.is_locked === true,
      selected_scenario_id: studyVersion.selected_scenario_id ?? null,
      engine_coherent: engineCoherent,
      stale_snapshot: staleSnapshot,
      snapshot_engine_version: snapshotEngineVersion,
      current_engine_version: CALC_ENGINE_VERSION,
      needs_recompute: staleSnapshot || !engineCoherent,
    });
  } catch (e) {
    console.error("[studyScenarios.controller] getStudyScenarios:", e);
    return res.status(500).json({ error: e.message || "Erreur lors de la lecture des scénarios." });
  }
}
