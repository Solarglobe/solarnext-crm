/**
 * CP-002 — Routes CRUD catalogue PV (auth, RBAC ADMIN/SUPER_ADMIN)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as ctrl from "../controllers/pv.controller.js";

const router = express.Router();
const guard = [verifyJWT, requirePermission("org.settings.manage")];

router.get("/panels", ...guard, ctrl.listPanels);
router.post("/panels", ...guard, ctrl.createPanel);
router.put("/panels/:id", ...guard, ctrl.updatePanel);
router.delete("/panels/:id", ...guard, ctrl.deletePanel);

router.get("/inverters", ...guard, ctrl.listInverters);
router.post("/inverters", ...guard, ctrl.createInverter);
router.put("/inverters/:id", ...guard, ctrl.updateInverter);
router.delete("/inverters/:id", ...guard, ctrl.deleteInverter);

router.get("/batteries", ...guard, ctrl.listBatteries);
router.post("/batteries", ...guard, ctrl.createBattery);
router.put("/batteries/:id", ...guard, ctrl.updateBattery);
router.delete("/batteries/:id", ...guard, ctrl.deleteBattery);

export default router;
