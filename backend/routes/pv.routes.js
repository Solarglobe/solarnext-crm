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
router.post("/panels/import", ...guard, (req, res) => ctrl.importCatalogRows({ ...req, params: { ...req.params, type: "panels" } }, res));
router.put("/panels/:id", ...guard, ctrl.updatePanel);
router.delete("/panels/:id", ...guard, ctrl.deletePanel);

router.get("/inverters", ...guard, ctrl.listInverters);
router.post("/inverters", ...guard, ctrl.createInverter);
router.post("/inverters/import", ...guard, (req, res) => ctrl.importCatalogRows({ ...req, params: { ...req.params, type: "inverters" } }, res));
router.put("/inverters/:id", ...guard, ctrl.updateInverter);
router.delete("/inverters/:id", ...guard, ctrl.deleteInverter);

router.get("/batteries", ...guard, ctrl.listBatteries);
router.post("/batteries", ...guard, ctrl.createBattery);
router.post("/batteries/import", ...guard, (req, res) => ctrl.importCatalogRows({ ...req, params: { ...req.params, type: "batteries" } }, res));
router.put("/batteries/:id", ...guard, ctrl.updateBattery);
router.delete("/batteries/:id", ...guard, ctrl.deleteBattery);

router.get("/mounting-systems", ...guard, ctrl.listMountingSystems);
router.post("/mounting-systems", ...guard, ctrl.createMountingSystem);
router.post("/mounting-systems/import", ...guard, (req, res) => ctrl.importCatalogRows({ ...req, params: { ...req.params, type: "mounting-systems" } }, res));
router.put("/mounting-systems/:id", ...guard, ctrl.updateMountingSystem);
router.delete("/mounting-systems/:id", ...guard, ctrl.deleteMountingSystem);

export default router;
