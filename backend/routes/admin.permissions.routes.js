/**
 * CP-ADMIN-UI-03 — Routes Admin Permissions
 * GET /api/admin/permissions — liste toutes les permissions (pour modal rôles)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.permissions.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("rbac.manage"), controller.list);

export default router;
