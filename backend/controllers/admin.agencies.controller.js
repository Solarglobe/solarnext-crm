/**
 * CP-ADMIN-STRUCT-02 — Admin Agencies Controller
 * CRUD agencies filtré par organization_id du JWT.
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/**
 * GET /api/admin/agencies
 */
export async function list(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      `SELECT id, organization_id, name, created_at, updated_at
       FROM agencies
       WHERE organization_id = $1
       ORDER BY name`,
      [org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/agencies
 * Body: { name }
 */
export async function create(req, res) {
  try {
    const org = orgId(req);
    const { name } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name requis" });
    }

    const result = await pool.query(
      `INSERT INTO agencies (organization_id, name)
       VALUES ($1, $2)
       RETURNING id, organization_id, name, created_at, updated_at`,
      [org, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/agencies/:id
 * Body: { name }
 */
export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { name } = req.body;

    const existing = await pool.query(
      "SELECT id FROM agencies WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Agence non trouvée ou hors organisation" });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name requis" });
    }

    const result = await pool.query(
      `UPDATE agencies SET name = $1, updated_at = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING id, organization_id, name, created_at, updated_at`,
      [name.trim(), id, org]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/admin/agencies/:id
 */
export async function remove(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM agencies WHERE id = $1 AND organization_id = $2 RETURNING id",
      [id, org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Agence non trouvée ou hors organisation" });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
