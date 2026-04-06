/**
 * Warning modification calpinage si étude active.
 * GET /api/studies/:studyId/has-active-study
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * GET /api/studies/:studyId/has-active-study
 * Retourne { hasActiveStudy: true | false } si l'étude a un statut ACTIVE ou CALCULATED.
 */
export async function hasActiveStudy(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const studyId = req.params.studyId;

    const r = await pool.query(
      `SELECT 1 FROM studies
       WHERE id = $1 AND organization_id = $2 AND status IN ('ACTIVE', 'CALCULATED')
       LIMIT 1`,
      [studyId, org]
    );

    return res.json({
      hasActiveStudy: r.rows.length > 0,
    });
  } catch (e) {
    console.error("[studyHasActive.controller] hasActiveStudy:", e);
    return res.status(500).json({ error: e.message });
  }
}
