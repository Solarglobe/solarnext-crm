/**
 * CP-026 — Routes Leads avec requirePermission
 * CP-028 Phase 2 — GET /:id détail (lead+stage+history), PATCH /:id/stage
 * CP-029 — view=leads|clients, kanban, consumption, status LEAD/CLIENT
 * Ordre : routes spécifiques avant /:id
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission, requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/leads.controller.js";
import { patchConsumption } from "../controllers/leads.consumption.controller.js";
import { getDetail, patchStage, deleteEnergyProfile } from "./leads/detail.js";
import { convertLead } from "./leads/convert.js";
import { leadActivitiesRouter } from "../modules/activities/activity.routes.js";
import * as leadMetersController from "../controllers/leadMeters.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getAll);
router.get("/kanban", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getKanban);
router.get("/me", verifyJWT, requirePermission("lead.read.self"), controller.getSelf);
router.get("/meta", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getMeta);

/** Multi-compteurs — avant GET /:id (segment unique) */
router.get(
  "/:leadId/meters",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  leadMetersController.listMeters
);
router.post(
  "/:leadId/meters",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  leadMetersController.createMeter
);
router.get(
  "/:leadId/meters/:meterId",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  leadMetersController.getMeterDetail
);
router.post(
  "/:leadId/meters/:meterId/set-default",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  leadMetersController.postSetDefault
);
router.patch(
  "/:leadId/meters/:meterId",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  leadMetersController.patchMeter
);
router.delete(
  "/:leadId/meters/:meterId",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  leadMetersController.removeMeter
);

router.get("/:id", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), getDetail);
router.delete(
  "/:id/energy-profile",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  deleteEnergyProfile
);
router.use("/:id/activities", leadActivitiesRouter);
router.patch(
  "/:id/archive",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.patchArchive
);
router.patch(
  "/:id/unarchive",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.patchUnarchive
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.patchUnarchive
);
router.delete(
  "/:id",
  verifyJWT,
  requirePermission("lead.delete"),
  controller.deleteLeadHard
);
router.patch(
  "/:id/stage",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  patchStage
);
router.post(
  "/:id/convert",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  convertLead
);
router.post("/", verifyJWT, requirePermission("lead.create"), controller.create);
router.put("/:id", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), controller.update);
router.patch("/:id", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), controller.update);
router.patch("/:id/consumption", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), patchConsumption);

export default router;
