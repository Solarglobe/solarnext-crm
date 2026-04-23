/**
 * CP-026 RBAC — Routes API
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import {
  SUPER_ADMIN_IMPERSONATION_ROLE_CODE,
  USER_IMPERSONATION_TYPE,
} from "../lib/superAdminUserGuards.js";

const router = express.Router();

/**
 * GET /api/rbac/me
 * Retourne les permissions de l'utilisateur courant.
 * JWT requis.
 * Si RBAC_ENFORCE=1 : exige rbac.manage (ou SUPER_ADMIN bypass).
 */
router.get(
  "/me",
  verifyJWT,
  requirePermission("rbac.manage"),
  async (req, res) => {
    if (req.user.role === "SUPER_ADMIN") {
      return res.json({ permissions: ["*"], superAdmin: true });
    }
    if (req.user.role === SUPER_ADMIN_IMPERSONATION_ROLE_CODE) {
      return res.json({
        permissions: ["*"],
        superAdmin: false,
        impersonation: true,
        impersonationType: "ORG",
      });
    }
    if (String(req.user.impersonationType) === USER_IMPERSONATION_TYPE) {
      const userId = req.user.userId ?? req.user.id;
      const organizationId = req.user.organizationId;
      const perms = await getUserPermissions({ userId, organizationId });
      return res.json({
        permissions: Array.from(perms),
        superAdmin: false,
        impersonation: true,
        impersonationType: "USER",
      });
    }

    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId;

    const perms = await getUserPermissions({
      userId,
      organizationId
    });

    return res.json({ permissions: Array.from(perms) });
  }
);

export default router;
