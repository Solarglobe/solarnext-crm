/**
 * Mission Engine V1 — Middleware canAccessMission
 * Prospecteur: voir missions équipe, modifier que ses propres
 * Commercial: voir missions agence, modifier que les siennes
 * Admin/Manager: accès global org
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id;

/**
 * Vérifie que l'utilisateur peut accéder à la mission (lecture).
 * Utilisé avant GET /missions/:id
 */
export async function canAccessMissionRead(req, res, next) {
  try {
    if (req.user?.role === "SUPER_ADMIN") return next();

    const org = orgId(req);
    const uid = userId(req);
    const missionId = req.params.id;

    if (!org || !uid) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    if (perms.has("mission.read.all")) return next();

    if (perms.has("mission.read.self")) {
      const r = await pool.query(
        `SELECT 1 FROM mission_assignments ma
         JOIN missions m ON m.id = ma.mission_id
         WHERE m.id = $1 AND m.organization_id = $2 AND ma.user_id = $3`,
        [missionId, org, uid]
      );
      if (r.rows.length > 0) return next();
    }

    return res.status(403).json({ error: "FORBIDDEN", code: "MISSING_PERMISSION" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Vérifie que l'utilisateur peut modifier la mission.
 * Utilisé avant PATCH /missions/:id et PATCH /missions/:id/time
 */
export async function canAccessMissionUpdate(req, res, next) {
  try {
    if (req.user?.role === "SUPER_ADMIN") return next();

    const org = orgId(req);
    const uid = userId(req);
    const missionId = req.params.id;

    if (!org || !uid) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    if (perms.has("mission.update.all")) return next();

    if (perms.has("mission.update.self")) {
      const r = await pool.query(
        `SELECT 1 FROM mission_assignments ma
         JOIN missions m ON m.id = ma.mission_id
         WHERE m.id = $1 AND m.organization_id = $2 AND ma.user_id = $3`,
        [missionId, org, uid]
      );
      if (r.rows.length > 0) return next();
    }

    return res.status(403).json({ error: "FORBIDDEN", code: "MISSING_PERMISSION" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
