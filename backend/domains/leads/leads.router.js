/**
 * domains/leads/leads.router.js — Router Express du domaine Leads.
 *
 * Migré depuis routes/leads.routes.js (Step #8 — DDD léger).
 * L'ancien chemin routes/leads.routes.js est un stub de réexportation.
 *
 * Dépendances encore hors-domaine (migration progressive) :
 *  - controllers/billingContacts, leadMeters, leadDp, leads.consumption, crmExport
 *    → seront migrés dans leads/ lors de la Phase 2
 */

/**
 * CP-026 — Routes Leads avec requirePermission
 * CP-028 Phase 2 — GET /:id détail (lead+stage+history), PATCH /:id/stage
 * CP-029 — view=leads|clients, kanban, consumption, status LEAD/CLIENT
 * Ordre : routes spécifiques avant /:id
 */

import express from "express";
import { validate } from "../../middleware/validate.middleware.js";
import { CreateLeadSchema, PatchLeadSchema, LeadListQuerySchema, UuidParamsSchema } from "../../lib/schemas/index.js";
import { verifyJWT } from "../../middleware/auth.middleware.js";
import { requirePermission, requireAnyPermission } from "../../rbac/rbac.middleware.js";
import * as controller from "./leads.controller.js";
import * as billingContacts from "../../controllers/billingContacts.controller.js";
import { patchConsumption } from "../../controllers/leads.consumption.controller.js";
import { getDetail, patchStage, deleteEnergyProfile } from "./sub/detail.js";
import { convertLead, convertLeadToClient } from "./sub/convert.js";
import { revertLeadToLead } from "./sub/revertToLead.js";
import { leadActivitiesRouter } from "../../modules/activities/activity.routes.js";
import * as leadMetersController from "../../controllers/leadMeters.controller.js";
import {
  postCreateClientPortalToken,
  getClientPortalTokenForLead,
} from "../../controllers/clientPortal.controller.js";
import { getLeadDp, putLeadDp } from "../../controllers/leadDp.controller.js";
import { exportLeadsCsv } from "../../controllers/crmExport.controller.js";

const router = express.Router();

/** Export CSV marketing — avant routes /:id */
const EXPORT_LEADS_PERMS = ["org.settings.manage", "lead.read.all"];

router.get("/", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getAll);
router.get("/quick-search", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.quickSearch);
router.get("/kanban", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getKanban);
router.get("/me", verifyJWT, requirePermission("lead.read.self"), controller.getSelf);
router.get("/meta", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), controller.getMeta);
router.get("/export", verifyJWT, requireAnyPermission(EXPORT_LEADS_PERMS), exportLeadsCsv);
/** Liste facturation — table `leads` uniquement (id + full_name), avant /:id */
router.get(
  "/select",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  billingContacts.getLeadsSelect
);

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

router.post(
  "/:id/client-portal-token",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  postCreateClientPortalToken
);
router.get(
  "/:id/client-portal-token",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  getClientPortalTokenForLead
);

/** Dossier DP (brouillon) — avant GET /:id */
router.get(
  "/:id/dp",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  getLeadDp
);
router.put(
  "/:id/dp",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  putLeadDp
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
router.patch(
  "/:id/stage",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  patchStage
);
router.post(
  "/:id/convert-to-client",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  convertLeadToClient
);
router.post(
  "/:id/convert",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  convertLead
);
router.post(
  "/:id/revert-to-lead",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  revertLeadToLead
);
router.post("/", verifyJWT, requirePermission("lead.create"), validate({ body: CreateLeadSchema }), controller.create);
router.put("/:id", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), validate({ body: CreateLeadSchema, params: UuidParamsSchema }), controller.update);
router.patch("/:id", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), validate({ body: PatchLeadSchema, params: UuidParamsSchema }), controller.update);
router.patch("/:id/consumption", verifyJWT, requireAnyPermission(["lead.update.all", "lead.update.self"]), patchConsumption);

export default router;
