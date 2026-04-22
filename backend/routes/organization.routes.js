/**
 * CP-026 — Routes Organization Settings avec requirePermission
 * Toute gestion → org.settings.manage
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/organization.controller.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();

router.get("/settings", verifyJWT, requirePermission("org.settings.manage"), controller.getSettings);
router.put(
  "/settings",
  verifyJWT,
  requirePermission("org.settings.manage"),
  sensitiveUserRateLimiter,
  controller.updateSettings
);

export default router;
