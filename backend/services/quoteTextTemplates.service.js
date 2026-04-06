/**
 * Modèles de texte devis (org-scoped).
 */

import { pool } from "../config/db.js";

export const TEMPLATE_KINDS = ["commercial_notes", "technical_details", "payment_terms"];

/**
 * @param {string} kind
 */
export function assertKind(kind) {
  if (!TEMPLATE_KINDS.includes(String(kind))) {
    const err = new Error(`template_kind invalide (${TEMPLATE_KINDS.join(", ")})`);
    err.statusCode = 400;
    throw err;
  }
}

/**
 * @param {string} organizationId
 * @param {{ kind?: string }} [query]
 */
export async function listTemplates(organizationId, query = {}) {
  const kind = query.kind;
  if (kind) assertKind(kind);
  let sql = `SELECT id, organization_id, template_kind, name, content, created_at
             FROM quote_text_templates WHERE organization_id = $1`;
  const params = [organizationId];
  if (kind) {
    sql += ` AND template_kind = $2`;
    params.push(kind);
  }
  sql += ` ORDER BY template_kind, name ASC`;
  const r = await pool.query(sql, params);
  return r.rows;
}

/**
 * @param {string} organizationId
 * @param {{ template_kind: string, name: string, content: string }} body
 */
export async function createTemplate(organizationId, body) {
  assertKind(body.template_kind);
  const name = String(body.name || "").trim();
  const content = String(body.content ?? "");
  if (name.length < 2 || name.length > 200) {
    const err = new Error("name doit faire entre 2 et 200 caractères");
    err.statusCode = 400;
    throw err;
  }
  if (content.length > 50000) {
    const err = new Error("content trop long (max 50000 caractères)");
    err.statusCode = 400;
    throw err;
  }
  const r = await pool.query(
    `INSERT INTO quote_text_templates (organization_id, template_kind, name, content)
     VALUES ($1, $2::quote_text_template_kind, $3, $4)
     RETURNING id, organization_id, template_kind, name, content, created_at`,
    [organizationId, body.template_kind, name, content]
  );
  return r.rows[0];
}

/**
 * @param {string} id
 * @param {string} organizationId
 * @param {{ name?: string, content?: string }} patch
 */
export async function updateTemplate(id, organizationId, patch) {
  const cur = await pool.query(
    `SELECT id FROM quote_text_templates WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (cur.rows.length === 0) return null;
  const updates = [];
  const params = [];
  let p = 1;
  if (patch.name !== undefined) {
    const name = String(patch.name || "").trim();
    if (name.length < 2 || name.length > 200) {
      const err = new Error("name doit faire entre 2 et 200 caractères");
      err.statusCode = 400;
      throw err;
    }
    updates.push(`name = $${p++}`);
    params.push(name);
  }
  if (patch.content !== undefined) {
    const content = String(patch.content ?? "");
    if (content.length > 50000) {
      const err = new Error("content trop long (max 50000 caractères)");
      err.statusCode = 400;
      throw err;
    }
    updates.push(`content = $${p++}`);
    params.push(content);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      `SELECT id, organization_id, template_kind, name, content, created_at FROM quote_text_templates WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    return r.rows[0];
  }
  params.push(id, organizationId);
  const r = await pool.query(
    `UPDATE quote_text_templates SET ${updates.join(", ")}
     WHERE id = $${p++} AND organization_id = $${p}
     RETURNING id, organization_id, template_kind, name, content, created_at`,
    params
  );
  return r.rows[0];
}

/**
 * @param {string} id
 * @param {string} organizationId
 */
export async function deleteTemplate(id, organizationId) {
  const r = await pool.query(
    `DELETE FROM quote_text_templates WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [id, organizationId]
  );
  return r.rows.length > 0;
}
