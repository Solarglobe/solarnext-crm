/**
 * CP-002 — Routes publiques catalogue PV (sans auth, pour calpinage embed)
 */

import express from "express";
import * as ctrl from "../controllers/public.pv.controller.js";

const router = express.Router();

router.get("/panels", ctrl.listPanelsPublic);
router.get("/inverters", ctrl.listInvertersPublic);
router.get("/batteries", ctrl.listBatteriesPublic);

export default router;
