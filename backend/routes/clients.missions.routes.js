/**
 * Mission Engine V1 — Routes missions depuis fiche client
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/missions.controller.js";

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all", "client.read.self", "client.read.all"]),
  controller.listByClient
);

router.post(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.create"]),
  controller.createFromClient
);

export default router;
