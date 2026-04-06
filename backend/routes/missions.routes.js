/**
 * Mission Engine V1 — Routes missions
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import { canAccessMissionRead, canAccessMissionUpdate } from "../middleware/mission.middleware.js";
import * as controller from "../controllers/missions.controller.js";

const router = express.Router();

// Meta pour filtres (types, users, teams, agencies)
router.get(
  "/types",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all"]),
  async (req, res) => {
    try {
      const org = req.user?.organizationId ?? req.user?.organization_id;
      const { pool } = await import("../config/db.js");
      const r = await pool.query(
        "SELECT id, name, color, default_duration_minutes FROM mission_types WHERE organization_id = $1 ORDER BY name",
        [org]
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.get(
  "/meta",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all"]),
  async (req, res) => {
    try {
      const org = req.user?.organizationId ?? req.user?.organization_id;
      const { pool } = await import("../config/db.js");
      const [usersRes, teamsRes, agenciesRes] = await Promise.all([
        pool.query("SELECT id, email FROM users WHERE organization_id = $1 AND status = 'active' ORDER BY email", [org]),
        pool.query("SELECT id, name FROM teams WHERE organization_id = $1 ORDER BY name", [org]).catch(() => ({ rows: [] })),
        pool.query("SELECT id, name FROM agencies WHERE organization_id = $1 ORDER BY name", [org]).catch(() => ({ rows: [] })),
      ]);
      res.json({
        users: usersRes.rows,
        teams: teamsRes.rows,
        agencies: agenciesRes.rows,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// CRUD missions
router.get(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all"]),
  controller.list
);

router.get(
  "/:id",
  verifyJWT,
  requireAnyPermission(["mission.read.self", "mission.read.all"]),
  canAccessMissionRead,
  controller.getById
);

router.post(
  "/",
  verifyJWT,
  requireAnyPermission(["mission.create"]),
  controller.create
);

router.patch(
  "/:id",
  verifyJWT,
  requireAnyPermission(["mission.update.self", "mission.update.all"]),
  canAccessMissionUpdate,
  controller.update
);

router.patch(
  "/:id/time",
  verifyJWT,
  requireAnyPermission(["mission.update.self", "mission.update.all"]),
  canAccessMissionUpdate,
  controller.updateTime
);

router.delete(
  "/:id",
  verifyJWT,
  requireAnyPermission(["mission.update.self", "mission.update.all"]),
  canAccessMissionUpdate,
  controller.remove
);

export default router;
