/**
 * CP-QUOTE-002 — Routes API Catalogue devis
 * GET list, POST create, PATCH :id, POST :id/deactivate, POST :id/activate
 * RBAC: QUOTE_CATALOG:READ (list), QUOTE_CATALOG:WRITE (create/update/activate/deactivate)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.quoteCatalog.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("QUOTE_CATALOG:READ"), controller.list);
router.post("/", verifyJWT, requirePermission("QUOTE_CATALOG:WRITE"), controller.create);

router.post(
  "/:id/deactivate",
  verifyJWT,
  requirePermission("QUOTE_CATALOG:WRITE"),
  controller.deactivate
);
router.post(
  "/:id/activate",
  verifyJWT,
  requirePermission("QUOTE_CATALOG:WRITE"),
  controller.activate
);

router.patch("/:id", verifyJWT, requirePermission("QUOTE_CATALOG:WRITE"), controller.patch);

export default router;
