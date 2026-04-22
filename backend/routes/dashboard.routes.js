import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import * as dashboardController from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get(
  "/overview",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self", "quote.manage", "invoice.manage"]),
  dashboardController.getOverview
);

export default router;
