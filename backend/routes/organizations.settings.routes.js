/**
 * CP-001 — API Paramètres Organisation (SmartPitch Economics)
 * GET  /api/organizations/settings
 * PUT  /api/organizations/settings
 * Auth obligatoire, scope = organizationId du JWT, RBAC : SUPER_ADMIN + ADMIN (org.settings.manage)
 * Structure JSON cible : economics uniquement
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/organizations.settings.controller.js";

const router = express.Router();

router.get("/settings", verifyJWT, requirePermission("org.settings.manage"), controller.get);
router.put("/settings", verifyJWT, requirePermission("org.settings.manage"), controller.put);

export default router;
