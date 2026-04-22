/**
 * Envoi email groupé (segment leads)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import * as controller from "../controllers/mailBulkSend.controller.js";

const router = express.Router();

router.post(
  "/bulk-send",
  verifyJWT,
  requirePermission("org.settings.manage"),
  requireMailUseStrict(),
  controller.postBulkSend
);

export default router;
