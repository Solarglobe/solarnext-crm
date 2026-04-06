/**
 * Modèles de texte devis — CRUD org-scoped.
 * RBAC: QUOTE_CATALOG:READ (list), QUOTE_CATALOG:WRITE (create/update/delete)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.quoteTextTemplates.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("QUOTE_CATALOG:READ"), controller.list);
router.post("/", verifyJWT, requirePermission("QUOTE_CATALOG:WRITE"), controller.create);
router.patch("/:id", verifyJWT, requirePermission("QUOTE_CATALOG:WRITE"), controller.patch);
router.delete("/:id", verifyJWT, requirePermission("QUOTE_CATALOG:WRITE"), controller.remove);

export default router;
