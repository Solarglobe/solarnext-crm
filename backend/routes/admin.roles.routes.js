/**
 * CP-027 — Routes Admin Roles
 * verifyJWT → requirePermission(rbac.manage) → controller
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.roles.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("rbac.manage"), controller.list);
router.get("/:id/permissions", verifyJWT, requirePermission("rbac.manage"), controller.getPermissions);
router.put("/:id/permissions", verifyJWT, requirePermission("rbac.manage"), controller.updatePermissions);

export default router;
