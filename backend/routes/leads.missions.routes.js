/**
 * Mission Engine V1 — Routes missions/RDV depuis fiche lead (non converti)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/missions.controller.js";

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all", "lead.read.self", "lead.read.all"]),
  controller.listByLead
);

router.post(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.create"]),
  controller.createFromLead
);

export default router;
