/**
 * CP-081 — Templates mail : liste, rendu variables, CRUD.
 */

import { pool } from "../../config/db.js";

/** @param {string} html */
export function sanitizeTemplateHtml(html) {
  if (html == null || typeof html !== "string") return "";
  let s = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  s = s.replace(/\s(on\w+|javascript:)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s.trim();
}

/**
 * Remplace {{a.b}} par valeurs du contexte ; clé absente → chaîne vide.
 * @param {string | null | undefined} template
 * @param {Record<string, unknown>} context
 */
export function replaceTemplateVariables(template, context) {
  if (template == null || template === "") return "";
  const ctx = context && typeof context === "object" ? context : {};
  return String(template).replace(/\{\{([\s\S]*?)\}\}/g, (_, raw) => {
    const path = String(raw).trim();
    if (!path) return "";
    const v = getByPath(ctx, path);
    if (v == null || v === undefined) return "";
    return String(v);
  });
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} path — ex. client.name, date
 */
function getByPath(obj, path) {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return "";
    cur = /** @type {Record<string, unknown>} */ (cur)[p];
  }
  return cur;
}

/**
 * @param {{ subject_template?: string | null, body_html_template: string, context?: Record<string, unknown> }} p
 */
export function renderTemplate(p) {
  const ctx = p.context && typeof p.context === "object" ? p.context : {};
  return {
    subject: replaceTemplateVariables(p.subject_template ?? "", ctx),
    bodyHtml: replaceTemplateVariables(p.body_html_template ?? "", ctx),
  };
}

/**
 * @param {{ userId: string, organizationId: string }} p
 */
export async function getAvailableTemplates(p) {
  const { userId, organizationId } = p;
  const r = await pool.query(
    `SELECT *
     FROM mail_templates
     WHERE organization_id = $1 AND is_active = true
       AND (user_id IS NULL OR user_id = $2)
     ORDER BY CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END,
              category NULLS LAST,
              name ASC`,
    [organizationId, userId]
  );
  return r.rows.map((row) => ({
    ...row,
    scope: row.user_id ? "user" : "organization",
  }));
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} q
 */
export async function getTemplateById(q, id, organizationId) {
  const r = await q.query(`SELECT * FROM mail_templates WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
  return r.rows[0] || null;
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   kind: 'organization' | 'user',
 *   name: string,
 *   subjectTemplate?: string | null,
 *   bodyHtmlTemplate: string,
 *   category?: string | null,
 * }} p
 */
export async function createTemplate(p) {
  const {
    organizationId,
    userId,
    kind,
    name,
    subjectTemplate = null,
    bodyHtmlTemplate,
    category = null,
  } = p;
  const body = sanitizeTemplateHtml(bodyHtmlTemplate);
  if (!name?.trim()) {
    const err = new Error("name requis");
    err.code = "VALIDATION";
    throw err;
  }
  if (!body) {
    const err = new Error("body_html_template requis");
    err.code = "VALIDATION";
    throw err;
  }
  const rowUserId = kind === "user" ? userId : null;
  const subj = subjectTemplate != null ? String(subjectTemplate) : null;

  const ins = await pool.query(
    `INSERT INTO mail_templates (
       organization_id, user_id, name, subject_template, body_html_template, category, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [organizationId, rowUserId, name.trim(), subj, body, category?.trim() || null]
  );
  const row = ins.rows[0];
  return { ...row, scope: row.user_id ? "user" : "organization" };
}

/**
 * @param {{
 *   templateId: string,
 *   organizationId: string,
 *   name?: string,
 *   subjectTemplate?: string | null,
 *   bodyHtmlTemplate?: string,
 *   category?: string | null,
 *   isActive?: boolean,
 * }} p
 */
export async function updateTemplate(p) {
  const { templateId, organizationId, name, subjectTemplate, bodyHtmlTemplate, category, isActive } = p;
  const row = await getTemplateById(pool, templateId, organizationId);
  if (!row) {
    const err = new Error("Template introuvable");
    err.code = "NOT_FOUND";
    throw err;
  }
  const patches = [];
  const vals = [];
  let n = 1;
  if (name !== undefined) {
    patches.push(`name = $${n++}`);
    vals.push(String(name).trim());
  }
  if (subjectTemplate !== undefined) {
    patches.push(`subject_template = $${n++}`);
    vals.push(subjectTemplate == null ? null : String(subjectTemplate));
  }
  if (bodyHtmlTemplate !== undefined) {
    const h = sanitizeTemplateHtml(bodyHtmlTemplate);
    if (!h) {
      const err = new Error("body_html_template invalide");
      err.code = "VALIDATION";
      throw err;
    }
    patches.push(`body_html_template = $${n++}`);
    vals.push(h);
  }
  if (category !== undefined) {
    patches.push(`category = $${n++}`);
    vals.push(category?.trim() || null);
  }
  if (isActive !== undefined) {
    patches.push(`is_active = $${n++}`);
    vals.push(!!isActive);
  }
  if (patches.length === 0) {
    return { ...row, scope: row.user_id ? "user" : "organization" };
  }
  patches.push(`updated_at = now()`);
  vals.push(templateId, organizationId);
  const q = `UPDATE mail_templates SET ${patches.join(", ")} WHERE id = $${n++} AND organization_id = $${n} RETURNING *`;
  const r = await pool.query(q, vals);
  const out = r.rows[0];
  return { ...out, scope: out.user_id ? "user" : "organization" };
}

/**
 * @param {{ templateId: string, organizationId: string }} p
 */
export async function deleteTemplate(p) {
  return updateTemplate({ ...p, templateId: p.templateId, isActive: false });
}

/**
 * @param {{ templateRow: object, context: Record<string, unknown> }} p
 */
export function renderStoredTemplate(p) {
  const row = p.templateRow;
  return renderTemplate({
    subject_template: row.subject_template,
    body_html_template: row.body_html_template,
    context: p.context,
  });
}
