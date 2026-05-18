/**
 * PATCH /api/payments/:id/cancel
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireEmailVerified } from "../middleware/emailVerification.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/payments.controller.js";

const router = express.Router();

router.patch("/:id/cancel", verifyJWT, requireEmailVerified, requirePermission("invoice.manage"), controller.cancelPayment);

export default router;
