/**
 * CP-027 — Admin Roles Controller
 * RBAC : rôles et permissions.
 * Impossible de modifier un rôle système global (organization_id NULL).
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/**
 * GET /api/admin/roles
 * Liste les rôles de l'organisation courante + rôles système (organization_id NULL).
 */
export async function list(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      `SELECT id, organization_id, code, name, is_system, created_at
       FROM rbac_roles
       WHERE organization_id = $1 OR organization_id IS NULL
       ORDER BY organization_id NULLS LAST, code`,
      [org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/admin/roles/:id/permissions
 * Liste les permissions d'un rôle.
 */
export async function getPermissions(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const role = await pool.query(
      "SELECT id, organization_id, code FROM rbac_roles WHERE id = $1",
      [id]
    );
    if (role.rows.length === 0) {
      return res.status(404).json({ error: "Rôle non trouvé" });
    }
    const r = role.rows[0];
    if (r.organization_id !== org && r.organization_id !== null) {
      return res.status(404).json({ error: "Rôle non trouvé ou hors organisation" });
    }

    const perms = await pool.query(
      `SELECT p.id, p.code, p.module, p.description
       FROM rbac_permissions p
       JOIN rbac_role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1
       ORDER BY p.code`,
      [id]
    );
    res.json(perms.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/roles/:id/permissions
 * Met à jour les permissions d'un rôle.
 * Impossible de modifier un rôle système (organization_id NULL).
 */
export async function updatePermissions(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { permissionIds } = req.body;

    const role = await pool.query(
      "SELECT id, organization_id FROM rbac_roles WHERE id = $1",
      [id]
    );
    if (role.rows.length === 0) {
      return res.status(404).json({ error: "Rôle non trouvé" });
    }
    const r = role.rows[0];
    if (r.organization_id === null) {
      return res.status(403).json({ error: "Impossible de modifier un rôle système global" });
    }
    if (r.organization_id !== org) {
      return res.status(404).json({ error: "Rôle non trouvé ou hors organisation" });
    }

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: "permissionIds doit être un tableau" });
    }

    const client = await pool.connect();
    try {
      await client.query("DELETE FROM rbac_role_permissions WHERE role_id = $1", [id]);
      for (const permId of permissionIds) {
        await client.query(
          "INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING",
          [id, permId]
        );
      }
    } finally {
      client.release();
    }

    const perms = await pool.query(
      `SELECT p.id, p.code, p.module, p.description
       FROM rbac_permissions p
       JOIN rbac_role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1
       ORDER BY p.code`,
      [id]
    );
    res.json(perms.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
