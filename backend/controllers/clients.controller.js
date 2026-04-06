/**
 * CP-026 — Clients controller
 * Logique métier : isolation org
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

export async function getAll(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      "SELECT * FROM clients WHERE organization_id = $1 AND (archived_at IS NULL) ORDER BY updated_at DESC",
      [org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** GET self : clients accessibles par l'utilisateur (même logique que all pour l'instant, isolation org) */
export async function getSelf(req, res) {
  return getAll(req, res);
}

export async function getById(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [id, org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const body = req.body;

    const allowed = [
      "company_name", "first_name", "last_name", "email", "phone", "mobile",
      "address_line_1", "address_line_2", "postal_code", "city", "country",
      "installation_address_line_1", "installation_postal_code", "installation_city",
      "notes"
    ];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        updates.push(`${k} = $${idx++}`);
        values.push(body[k]);
      }
    }
    if (updates.length === 0) {
      const r = await pool.query("SELECT * FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)", [id, org]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
      return res.json(r.rows[0]);
    }
    values.push(id, org);
    const query = `UPDATE clients SET updated_at = now(), ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++} AND (archived_at IS NULL) RETURNING *`;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
