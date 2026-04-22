/**
 * CP-075 — Routes RGPD
 */

import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/rgpd.controller.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = Router();

router.get(
  "/export/:entityType/:id",
  verifyJWT,
  requirePermission("org.settings.manage"),
  sensitiveUserRateLimiter,
  controller.exportRgpd
);

router.delete(
  "/delete/:entityType/:id",
  verifyJWT,
  requirePermission("org.settings.manage"),
  sensitiveUserRateLimiter,
  controller.anonymizeRgpd
);

export default router;
