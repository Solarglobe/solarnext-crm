/**
 * Agrégats contacts pour la facturation (listes typées).
 */
import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as billing from "../controllers/billingContacts.controller.js";

const router = express.Router();

router.get(
  "/select",
  verifyJWT,
  requirePermission("client.read.all"),
  billing.getContactsSelect
);

export default router;
