/**
 * CP-ADMIN-STRUCT-02 — Admin Teams Controller
 * CRUD teams filtré par organization_id du JWT.
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/**
 * GET /api/admin/teams
 */
export async function list(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      `SELECT t.id, t.organization_id, t.agency_id, t.name, t.created_at, t.updated_at,
              a.name as agency_name
       FROM teams t
       LEFT JOIN agencies a ON a.id = t.agency_id
       WHERE t.organization_id = $1
       ORDER BY t.name`,
      [org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/teams
 * Body: { name, agency_id? }
 */
export async function create(req, res) {
  try {
    const org = orgId(req);
    const { name, agency_id } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name requis" });
    }

    if (agency_id) {
      const agencyCheck = await pool.query(
        "SELECT id FROM agencies WHERE id = $1 AND organization_id = $2",
        [agency_id, org]
      );
      if (agencyCheck.rows.length === 0) {
        return res.status(400).json({ error: "agency_id invalide ou hors organisation" });
      }
    }

    const result = await pool.query(
      `INSERT INTO teams (organization_id, agency_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, agency_id, name, created_at, updated_at`,
      [org, agency_id || null, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/teams/:id
 * Body: { name, agency_id? }
 */
export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { name, agency_id } = req.body;

    const existing = await pool.query(
      "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Équipe non trouvée ou hors organisation" });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name requis" });
    }

    if (agency_id !== undefined && agency_id !== null) {
      const agencyCheck = await pool.query(
        "SELECT id FROM agencies WHERE id = $1 AND organization_id = $2",
        [agency_id, org]
      );
      if (agencyCheck.rows.length === 0) {
        return res.status(400).json({ error: "agency_id invalide ou hors organisation" });
      }
    }

    const result = await pool.query(
      `UPDATE teams SET name = $1, agency_id = $2, updated_at = now()
       WHERE id = $3 AND organization_id = $4
       RETURNING id, organization_id, agency_id, name, created_at, updated_at`,
      [name.trim(), agency_id || null, id, org]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/admin/teams/:id
 */
export async function remove(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM teams WHERE id = $1 AND organization_id = $2 RETURNING id",
      [id, org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Équipe non trouvée ou hors organisation" });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
