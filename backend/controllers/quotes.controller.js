/**
 * CP-026 — Quotes controller
 * Logique métier : isolation org
 */

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import { normalizeQuoteStatusForDb } from "../utils/financialDocumentStatus.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

export async function getAll(req, res) {
  try {
    const org = orgId(req);
    const rows = await quoteService.listQuotes(org, req.query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getById(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const result = await pool.query(
      `SELECT q.*, c.company_name, c.first_name, c.last_name, c.email FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       WHERE q.id = $1 AND q.organization_id = $2 AND (q.archived_at IS NULL)`,
      [id, org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function create(req, res) {
  try {
    const org = orgId(req);
    const { client_id, study_version_id, quote_number, status, total_ht, total_vat, total_ttc, valid_until, notes } = req.body;
    const qNum = quote_number ?? `DRAFT-${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO quotes (organization_id, client_id, study_version_id, quote_number, status, total_ht, total_vat, total_ttc, valid_until, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [org, client_id, study_version_id ?? null, qNum, normalizeQuoteStatusForDb(status), total_ht ?? 0, total_vat ?? 0, total_ttc ?? 0, valid_until ?? null, notes ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const body = req.body;
    const allowed = ["client_id", "study_version_id", "quote_number", "status", "total_ht", "total_vat", "total_ttc", "valid_until", "notes"];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        updates.push(`${k} = $${idx++}`);
        values.push(k === "status" ? normalizeQuoteStatusForDb(body[k]) : body[k]);
      }
    }
    if (updates.length === 0) {
      const r = await pool.query("SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)", [id, org]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
      return res.json(r.rows[0]);
    }
    values.push(id, org);
    const query = `UPDATE quotes SET ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++} AND (archived_at IS NULL) RETURNING *`;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function remove(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const result = await pool.query("DELETE FROM quotes WHERE id = $1 AND organization_id = $2 RETURNING id", [id, org]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
