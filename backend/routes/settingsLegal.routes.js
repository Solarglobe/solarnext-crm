/**
 * Routes /api/settings/legal/*
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission, requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as legalCgv from "../controllers/legalCgvSettings.controller.js";
import * as complementaryLegal from "../controllers/complementaryLegalDocs.controller.js";

const router = express.Router();
const guard = [verifyJWT, requirePermission("org.settings.manage")];
const complementaryGuard = [verifyJWT, requireAnyPermission(["quote.manage", "org.settings.manage"])];

router.get("/settings/legal/cgv", ...guard, legalCgv.getLegalCgv);
router.post("/settings/legal/cgv", ...guard, legalCgv.postLegalCgv);
router.get("/settings/legal/complementary-docs", ...complementaryGuard, complementaryLegal.getComplementaryLegalDocs);

export default router;
