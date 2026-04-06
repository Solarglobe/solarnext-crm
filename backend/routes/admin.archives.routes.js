/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Routes Admin Archives
 * GET /api/admin/archives — liste leads archivés
 * POST /api/admin/archives/:id/restore — restaure un lead
 *
 * Permissions : user.manage ou structure.manage
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.archives.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requireAnyPermission(["user.manage", "structure.manage"]), controller.list);
router.get("/export", verifyJWT, requireAnyPermission(["user.manage", "structure.manage"]), controller.exportCsv);
router.post("/:id/restore", verifyJWT, requireAnyPermission(["user.manage", "structure.manage"]), controller.restore);

export default router;
