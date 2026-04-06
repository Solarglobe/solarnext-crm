/**
 * CP-ADMIN-STRUCT-02 — Routes Admin Agencies
 * requireAnyPermission(org.settings.manage | structure.manage)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.agencies.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requireAnyPermission(["org.settings.manage", "structure.manage"]), controller.list);
router.post("/", verifyJWT, requireAnyPermission(["org.settings.manage", "structure.manage"]), controller.create);
router.put("/:id", verifyJWT, requireAnyPermission(["org.settings.manage", "structure.manage"]), controller.update);
router.delete("/:id", verifyJWT, requireAnyPermission(["org.settings.manage", "structure.manage"]), controller.remove);

export default router;
