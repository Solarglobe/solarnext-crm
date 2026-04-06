/**
 * CP-027 — Routes Admin Organization
 * CP-ADMIN-ORG-04 — Logo upload
 * Paramètres spécifiques PV — GET/POST /settings
 * verifyJWT → requirePermission(org.settings.manage) → controller
 */

import express from "express";
import multer from "multer";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.org.controller.js";
import * as settingsController from "../controllers/admin.org.settings.controller.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.get("/", verifyJWT, requirePermission("org.settings.manage"), controller.get);
router.put("/", verifyJWT, requirePermission("org.settings.manage"), controller.update);

router.get("/settings", verifyJWT, requirePermission("org.settings.manage"), settingsController.get);
router.post("/settings", verifyJWT, requirePermission("org.settings.manage"), settingsController.post);
router.get("/logo", verifyJWT, requirePermission("org.settings.manage"), controller.getLogo);
router.post("/logo", verifyJWT, requirePermission("org.settings.manage"), upload.single("file"), controller.uploadLogo);
router.delete("/logo", verifyJWT, requirePermission("org.settings.manage"), controller.deleteLogo);

router.get("/pdf-cover", verifyJWT, requirePermission("org.settings.manage"), controller.getPdfCover);
router.delete("/pdf-cover", verifyJWT, requirePermission("org.settings.manage"), controller.deletePdfCover);

export default router;
