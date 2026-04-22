/**
 * CP-026 — Routes Clients avec requirePermission
 * CP-032A — Archive / Restore
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission, requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/clients.controller.js";
import clientsMissionsRouter from "./clients.missions.routes.js";
import { exportClientsCsv } from "../controllers/crmExport.controller.js";

const router = express.Router();

const EXPORT_CLIENTS_PERMS = ["org.settings.manage", "client.read.all"];

router.get("/", verifyJWT, requirePermission("client.read.all"), controller.getAll);
router.get("/quick-search", verifyJWT, requirePermission("client.read.all"), controller.quickSearch);
router.get("/export", verifyJWT, requireAnyPermission(EXPORT_CLIENTS_PERMS), exportClientsCsv);
router.get(
  "/me",
  verifyJWT,
  requireAnyPermission(["client.read.all", "client.read.self"]),
  controller.getSelf
);
router.use("/:id/missions", clientsMissionsRouter);
router.get("/:id", verifyJWT, requireAnyPermission(["client.read.all", "client.read.self"]), controller.getById);
router.patch(
  "/:id/archive",
  verifyJWT,
  requireAnyPermission(["client.update.all", "client.update.self"]),
  controller.patchArchive
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requireAnyPermission(["client.update.all", "client.update.self"]),
  controller.patchRestore
);
router.put("/:id", verifyJWT, requireAnyPermission(["client.update.all", "client.update.self"]), controller.update);
router.patch("/:id", verifyJWT, requireAnyPermission(["client.update.all", "client.update.self"]), controller.update);

export default router;
