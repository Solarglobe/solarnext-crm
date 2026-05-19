/**
 * Recherche globale CRM
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/search.controller.js";

const router = express.Router();

router.get(
  "/global",
  verifyJWT,
  requireAnyPermission([
    "lead.read.all",
    "lead.read.self",
    "client.read.all",
    "client.read.self",
    "quote.manage",
    "invoice.manage",
    "study.manage",
    "org.settings.manage",
  ]),
  controller.globalSearch
);

export default router;
