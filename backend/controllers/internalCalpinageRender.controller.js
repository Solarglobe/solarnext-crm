/**
 * CP-SNAPSHOT — Route interne pour le rendu Playwright du calpinage.
 * GET /api/internal/calpinage-render-data/:studyId/:versionId?renderToken=...
 * Retourne geometry_json (même format que GET calpinage) pour la page de rendu.
 */

import { pool } from "../config/db.js";
import * as studiesService from "../routes/studies/service.js";
import { verifyPdfRenderToken } from "../services/pdfRenderToken.service.js";

/**
 * GET /api/internal/calpinage-render-data/:studyId/:versionId?renderToken=...
 * versionId = study_versions.id (UUID)
 */
export async function getCalpinageRenderData(req, res) {
  const studyId = req.params.studyId;
  const versionId = req.params.versionId;
  const renderToken = req.query.renderToken;

  if (!studyId || !versionId || !renderToken) {
    return res.status(400).json({ error: "studyId, versionId et renderToken requis" });
  }

  try {
    const { organizationId } = verifyPdfRenderToken(renderToken, studyId, versionId);
    const version = await studiesService.getVersionById(versionId, organizationId);

    if (!version || version.study_id !== studyId) {
      return res.status(404).json({ error: "Version non trouvée" });
    }

    const r = await pool.query(
      `SELECT geometry_json FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2`,
      [versionId, organizationId]
    );

    if (r.rows.length === 0 || !r.rows[0].geometry_json) {
      return res.status(404).json({ error: "Calpinage non trouvé" });
    }

    const geometryJson = r.rows[0].geometry_json;
    res.json({
      ok: true,
      calpinageData: {
        geometry_json: geometryJson,
      },
    });
  } catch (e) {
    if (e.code === "RENDER_TOKEN_INVALID" || e.code === "RENDER_TOKEN_EXPIRED") {
      return res.status(403).json({ error: e.message });
    }
    console.error("[internalCalpinageRender]", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
}
