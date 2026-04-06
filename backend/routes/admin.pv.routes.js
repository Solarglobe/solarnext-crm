/**
 * Paramètres PV — Routes admin (batteries virtuelles)
 * GET/POST /api/admin/pv/virtual-batteries, PUT/DELETE :id
 * RBAC: org.settings.manage (SUPER_ADMIN, ADMIN_ORG)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as ctrl from "../controllers/admin.pv.virtualBatteries.controller.js";

const router = express.Router();
const guard = [verifyJWT, requirePermission("org.settings.manage")];

router.get("/virtual-batteries", ...guard, ctrl.list);
router.post("/virtual-batteries", ...guard, ctrl.create);
router.put("/virtual-batteries/:id", ...guard, ctrl.update);
router.delete("/virtual-batteries/:id", ...guard, ctrl.remove);

export default router;
