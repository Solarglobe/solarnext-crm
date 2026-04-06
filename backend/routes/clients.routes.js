/**
 * CP-026 — Routes Clients avec requirePermission
 * CP-032A — Archive / Restore
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission, requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/clients.controller.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";
import clientsMissionsRouter from "./clients.missions.routes.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

router.get("/", verifyJWT, requirePermission("client.read.all"), controller.getAll);
router.get("/me", verifyJWT, requirePermission("client.read.self"), controller.getSelf);
router.use("/:id/missions", clientsMissionsRouter);
router.get("/:id", verifyJWT, requireAnyPermission(["client.read.all", "client.read.self"]), controller.getById);
router.patch(
  "/:id/archive",
  verifyJWT,
  requireAnyPermission(["client.update.all", "client.update.self"]),
  async (req, res) => {
    try {
      const data = await archiveEntity("clients", req.params.id, orgId(req), userId(req));
      if (!data) return res.status(404).json({ error: "Client non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requireAnyPermission(["client.update.all", "client.update.self"]),
  async (req, res) => {
    try {
      const data = await restoreEntity("clients", req.params.id, orgId(req));
      if (!data) return res.status(404).json({ error: "Client non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);
router.put("/:id", verifyJWT, requireAnyPermission(["client.update.all", "client.update.self"]), controller.update);

export default router;
