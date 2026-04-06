/**
 * CP-030 — Routes Activités CRM
 * GET/POST /api/leads/:id/activities
 * PATCH/DELETE /api/activities/:activityId
 */

import express from "express";
import { verifyJWT } from "../../middleware/auth.middleware.js";
import { requireAnyPermission } from "../../rbac/rbac.middleware.js";
import * as controller from "./activity.controller.js";

const router = express.Router();

// Routes sous /api/leads/:id/activities — montées par leads.routes
export const leadActivitiesRouter = express.Router({ mergeParams: true });
leadActivitiesRouter.get(
  "/",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self"]),
  controller.getActivities
);
leadActivitiesRouter.post(
  "/",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.postActivity
);

// Routes /api/activities/:activityId — montées à la racine
router.patch(
  "/:activityId",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.patchActivity
);
router.delete(
  "/:activityId",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  controller.deleteActivity
);

export default router;
