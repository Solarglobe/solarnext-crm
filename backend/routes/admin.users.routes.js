/**
 * CP-027 — Routes Admin Users
 * verifyJWT → requirePermission(user.manage) → controller
 *
 * CP-ADMIN-STRUCT-02 : Routes affectation teams/agencies (avant :id générique)
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/admin.users.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("user.manage"), controller.list);
router.post("/", verifyJWT, requirePermission("user.manage"), controller.create);

// CP-ADMIN-STRUCT-02 : affectation teams/agencies (ordre avant :id)
router.get("/:id/teams", verifyJWT, requirePermission("user.manage"), controller.getUserTeams);
router.put("/:id/teams", verifyJWT, requirePermission("user.manage"), controller.putUserTeams);
router.get("/:id/agencies", verifyJWT, requirePermission("user.manage"), controller.getUserAgencies);
router.put("/:id/agencies", verifyJWT, requirePermission("user.manage"), controller.putUserAgencies);

router.put("/:id", verifyJWT, requirePermission("user.manage"), controller.update);
router.delete("/:id", verifyJWT, requirePermission("user.manage"), controller.remove);

export default router;
