/**
 * admin.trash.routes.js — Corbeille admin (soft delete + restauration + purge)
 *
 * GET    /api/admin/trash              — liste les éléments en corbeille
 * GET    /api/admin/trash/lead/:id/linked  — nb éléments liés (pour DeleteConfirmModal)
 * POST   /api/admin/trash/:table/:id/restore — restaure un élément (dans période de grâce)
 * POST   /api/admin/trash/purge        — SUPER_ADMIN : purge définitive éléments expirés
 *
 * Permissions :
 *   - Lecture + restauration : org.settings.manage (admin)
 *   - Purge définitive       : SUPER_ADMIN uniquement
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import { effectiveSuperAdminRequestBypass } from "../middleware/superAdminBypass.middleware.js";
import {
  listTrash,
  restoreDeletedEntity,
  purgeExpiredDeletes,
  countLinkedItems,
} from "../services/softDelete.service.js";

const router = express.Router();
const orgId  = (req) => req.user.organizationId ?? req.user.organization_id;

/* ── GET /api/admin/trash ────────────────────────────────────────────────── */
router.get(
  "/",
  verifyJWT,
  requirePermission("org.settings.manage"),
  async (req, res) => {
    try {
      const isSuperAdmin = effectiveSuperAdminRequestBypass(req);
      const org = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : orgId(req);
      if (!org) return res.status(400).json({ error: "organization_id requis" });

      const result = await listTrash(org, {
        tableName:      req.query.table   || undefined,
        includeExpired: req.query.expired !== "false",
        limit:          req.query.limit   ? Number(req.query.limit)  : 50,
        offset:         req.query.offset  ? Number(req.query.offset) : 0,
        isSuperAdmin:   isSuperAdmin && !req.query.org_id,
      });

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ── GET /api/admin/trash/lead/:id/linked ────────────────────────────────── */
router.get(
  "/lead/:id/linked",
  verifyJWT,
  requirePermission("org.settings.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      if (!org) return res.status(400).json({ error: "organization_id requis" });
      const counts = await countLinkedItems(req.params.id, org);
      res.json(counts);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ── POST /api/admin/trash/:table/:id/restore ────────────────────────────── */
router.post(
  "/:table/:id/restore",
  verifyJWT,
  requirePermission("org.settings.manage"),
  async (req, res) => {
    try {
      const org    = orgId(req);
      const table  = req.params.table;
      const id     = req.params.id;
      if (!org) return res.status(400).json({ error: "organization_id requis" });

      const restored = await restoreDeletedEntity(table, id, org);
      if (!restored) {
        return res.status(404).json({
          error: "Élément introuvable en corbeille ou période de grâce expirée",
        });
      }
      res.json({ restored: true, id: restored.id });
    } catch (e) {
      const code = e.statusCode === 400 ? 400 : 500;
      res.status(code).json({ error: e.message });
    }
  }
);

/* ── POST /api/admin/trash/purge — SUPER_ADMIN seulement ────────────────── */
router.post(
  "/purge",
  verifyJWT,
  async (req, res) => {
    const isSuperAdmin = effectiveSuperAdminRequestBypass(req);
    if (!isSuperAdmin) {
      return res.status(403).json({ error: "Réservé au SUPER_ADMIN" });
    }
    try {
      const dryRun = req.query.dry_run === "true" || req.body?.dry_run === true;
      const result = await purgeExpiredDeletes({ dryRun });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default router;
