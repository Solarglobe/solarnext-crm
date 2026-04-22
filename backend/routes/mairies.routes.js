/**
 * CP-MAIRIES-002 — Routes Mairies / portails DP
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/mairies.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("mairie.read"), controller.getList);
router.get("/:id", verifyJWT, requirePermission("mairie.read"), controller.getOne);
router.post("/", verifyJWT, requirePermission("mairie.manage"), controller.create);
router.patch("/:id", verifyJWT, requirePermission("mairie.manage"), controller.patch);
router.delete("/:id", verifyJWT, requirePermission("mairie.manage"), controller.remove);

export default router;
