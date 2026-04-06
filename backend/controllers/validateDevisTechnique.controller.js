/**
 * POST /api/studies/:studyId/versions/:versionId/validate-devis-technique
 * 100 % version-based : vérifie calpinage_data + economic_snapshot pour cette version, lance le calcul, retourne success.
 */

import { pool } from "../config/db.js";
import { getVersionById } from "../routes/studies/service.js";
import {
  getEconomicSnapshotForVersion,
  createEconomicSnapshotForVersion,
} from "../services/economic/economicSnapshot.service.js";
import { runStudyCalc } from "./studyCalc.controller.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

/**
 * POST /api/studies/:studyId/versions/:versionId/validate-devis-technique
 */
export async function validateDevisTechnique(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ error: "studyId et versionId requis" });
    }

    const version = await getVersionById(versionId, org);
    if (!version) return res.status(404).json({ error: "Version non trouvée" });
    if (version.study_id !== studyId) {
      return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    }
    if (version.is_locked) {
      return res.status(400).json({ error: "LOCKED_VERSION" });
    }

    // Vérifier que le calpinage existe pour cette version (calpinage_data)
    const calpinage = await pool.query(
      `SELECT id FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2
       LIMIT 1`,
      [versionId, org]
    );
    if (calpinage.rowCount === 0) {
      return res.status(400).json({ error: "CALPINAGE_REQUIRED" });
    }

    // Economic snapshot pour cette version : en créer un si absent
    let economic = await getEconomicSnapshotForVersion(versionId, org);
    if (!economic) {
      await createEconomicSnapshotForVersion({
        studyId,
        studyVersionId: versionId,
        organizationId: org,
        userId: userId(req),
        config: {},
      });
    }

    // Lancer le calcul (runStudyCalc attend versionId = version_number en string dans params)
    const calcReq = {
      ...req,
      params: { ...req.params, versionId: String(version.version_number) },
      _validateDevisTechnique: true,
    };

    const captured = { statusCode: 200, data: null };
    const mockRes = {
      status(code) {
        captured.statusCode = code;
        return mockRes;
      },
      json(data) {
        captured.data = data;
        return mockRes;
      },
    };

    await runStudyCalc(calcReq, mockRes);

    if (captured.statusCode !== 200) {
      return res
        .status(captured.statusCode)
        .json(captured.data || { error: "Erreur lors du calcul" });
    }

    return res.json(captured.data ?? { success: true });
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND") {
      return res.status(400).json({ error: e.message || code });
    }
    console.error("[validateDevisTechnique.controller]", e);
    return res.status(500).json({ error: e.message || "Erreur lors de la validation du devis technique." });
  }
}
