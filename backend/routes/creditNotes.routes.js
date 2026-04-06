/**
 * GET /api/credit-notes/:id/snapshot
 * POST /api/credit-notes/:id/pdf
 * POST /api/credit-notes/:id/issue
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/creditNotes.controller.js";

const router = express.Router();

router.get("/:id/snapshot", verifyJWT, requirePermission("invoice.manage"), controller.getDocumentSnapshot);
router.post("/:id/pdf", verifyJWT, requirePermission("invoice.manage"), controller.generatePdf);
router.post("/:id/issue", verifyJWT, requirePermission("invoice.manage"), controller.issueCreditNote);

export default router;
