/**
 * CP-ADMIN-UI-03 — Liste toutes les permissions RBAC
 * GET /api/admin/permissions — pour le modal permissions des rôles
 */

import { pool } from "../config/db.js";

/**
 * GET /api/admin/permissions
 * Liste toutes les permissions (groupées par module côté front).
 */
export async function list(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, code, module, description
       FROM rbac_permissions
       ORDER BY module, code`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
