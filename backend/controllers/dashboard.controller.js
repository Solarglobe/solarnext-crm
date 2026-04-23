/**
 * GET /api/dashboard/overview — pilotage CRM (agrégats serveur).
 */

import { buildDashboardOverview } from "../services/dashboardOverview.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function getOverview(req, res) {
  try {
    const q = req.query || {};
    const data = await buildDashboardOverview({
      organizationId: orgId(req),
      userId: userId(req),
      superAdminContext: effectiveSuperAdminRequestBypass(req),
      range: q.range,
      date_from: q.date_from,
      date_to: q.date_to,
      assigned_user_id: q.assigned_user_id || null,
      source_id: q.source_id || null,
    });
    res.json(data);
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message || "Erreur dashboard" });
  }
}
