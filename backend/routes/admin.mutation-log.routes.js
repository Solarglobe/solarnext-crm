/**
 * admin.mutation-log.routes.js
 *
 * GET /api/admin/mutation-log
 *   Paramètres (query) :
 *     - table_name  : filtre par table (quotes, invoices, leads, ...)
 *     - record_id   : UUID de l'enregistrement
 *     - field_name  : filtre par champ (total_ht, status, ...)
 *     - user_id     : filtre par auteur
 *     - limit       : max 200, défaut 50
 *     - offset      : défaut 0
 *
 * Accès : ADMIN (organisation propre) — SUPER_ADMIN (toutes organisations).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import { getMutationLog } from "../services/mutationLog.service.js";
import { effectiveSuperAdminRequestBypass } from "../middleware/superAdminBypass.middleware.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/**
 * GET /api/admin/mutation-log
 * Retourne le journal des mutations pour l'organisation courante.
 * Le SUPER_ADMIN peut passer ?org_id= pour consulter une org tierce.
 */
router.get(
  "/",
  verifyJWT,
  requirePermission("org.settings.manage"),
  async (req, res) => {
    try {
      const isSuperAdmin = effectiveSuperAdminRequestBypass(req);
      const org = isSuperAdmin && req.query.org_id
        ? String(req.query.org_id)
        : orgId(req);

      if (!org) return res.status(400).json({ error: "organization_id requis" });

      const { table_name, record_id, field_name, user_id, limit, offset } = req.query;

      const result = await getMutationLog(org, {
        tableName:    table_name  || undefined,
        recordId:     record_id   || undefined,
        fieldName:    field_name  || undefined,
        userId:       user_id     || undefined,
        limit:        limit       ? Number(limit)  : 50,
        offset:       offset      ? Number(offset) : 0,
        isSuperAdmin: isSuperAdmin && !req.query.org_id,
      });

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default router;
