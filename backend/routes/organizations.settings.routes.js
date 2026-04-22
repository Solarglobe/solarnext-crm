/**
 * CP-001 / CP-080 — API Paramètres Organisation
 * GET  /api/organizations/settings — economics, quote (numérotation devis), finance (TVA défaut)
 * PUT  /api/organizations/settings — merge par section
 * Auth : org.settings.manage
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/organizations.settings.controller.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();

/** CP-078 — Liste des organisations accessibles (JWT ; pas de RBAC module ici). */
router.get("/", verifyJWT, controller.listOrganizations);

/** SUPER_ADMIN — audit entrée/sortie mode support (exempt enforceSuperAdminWriteAccess). */
router.post(
  "/super-admin/org-switch-audit",
  verifyJWT,
  controller.postSuperAdminOrgSwitchAudit
);

router.get("/settings", verifyJWT, requirePermission("org.settings.manage"), controller.get);
router.put(
  "/settings",
  verifyJWT,
  requirePermission("org.settings.manage"),
  sensitiveUserRateLimiter,
  controller.put
);

export default router;
