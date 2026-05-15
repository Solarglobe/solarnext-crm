/**
 * mutationLog.service.js
 *
 * Audit trail champ-par-champ des mutations de données métier.
 * Répond à : "Qui a modifié le prix de ce devis, de combien, et quand ?"
 *
 * Principes :
 * - Non-bloquant : toutes les fonctions d'écriture catchent silencieusement.
 * - Granularité champ : 1 mutation = 1 ligne dans mutation_log.
 * - Appelé explicitement dans les services métier (jamais via trigger Postgres
 *   afin d'avoir accès à user_id et ip_address).
 *
 * Usage :
 *   import { logMutationDiff } from '../services/mutationLog.service.js';
 *
 *   const before = await readQuoteFields(quoteId);
 *   // ... do update ...
 *   const after = await readQuoteFields(quoteId);
 *   await logMutationDiff({
 *     organizationId, userId, tableName: 'quotes', recordId: quoteId,
 *     operation: 'UPDATE', before, after,
 *     fields: TRACKED_QUOTE_FIELDS, ipAddress,
 *   });
 */

import { pool } from "../config/db.js";

/* ── Champs suivis par table ─────────────────────────────────────────────── */

export const TRACKED_QUOTE_FIELDS = [
  "status",
  "total_ht",
  "total_vat",
  "total_ttc",
  "discount_ht",
  "global_discount_percent",
  "global_discount_amount_ht",
  "deposit_percent",
  "deposit",
  "valid_until",
  "payment_terms",
  "notes",
  "client_id",
  "lead_id",
];

export const TRACKED_QUOTE_LINE_FIELDS = [
  "label",
  "quantity",
  "unit_price_ht",
  "discount_ht",
  "vat_rate",
  "total_line_ht",
  "total_line_ttc",
];

export const TRACKED_INVOICE_FIELDS = [
  "status",
  "total_ht",
  "total_vat",
  "total_ttc",
  "notes",
  "payment_terms",
  "client_id",
  "lead_id",
];

export const TRACKED_LEAD_FIELDS = [
  "status",
  "stage_id",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "phone_mobile",
  "phone_landline",
  "address",
  "company_name",
  "contact_first_name",
  "contact_last_name",
  "assigned_user_id",
  "project_status",
  "marketing_opt_in",
];

/* ── Utilitaires ─────────────────────────────────────────────────────────── */

/**
 * Normalise une valeur pour comparaison stable (évite faux positifs number vs string).
 * @param {*} v
 * @returns {string}
 */
function normalize(v) {
  if (v === null || v === undefined) return "__null__";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Retourne la liste des champs qui ont changé entre before et after.
 * @param {Record<string,*>} before
 * @param {Record<string,*>} after
 * @param {string[]} fields   Champs à surveiller
 * @returns {{ field_name: string, old_value: *, new_value: * }[]}
 */
function diffFields(before, after, fields) {
  const diffs = [];
  for (const field of fields) {
    const oldVal = before?.[field] ?? null;
    const newVal = after?.[field] ?? null;
    if (normalize(oldVal) !== normalize(newVal)) {
      diffs.push({ field_name: field, old_value: oldVal, new_value: newVal });
    }
  }
  return diffs;
}

/* ── Écriture (non-bloquante) ────────────────────────────────────────────── */

/**
 * Insère N lignes dans mutation_log (1 par champ modifié).
 * Non-bloquant : ne lève jamais d'exception.
 *
 * @param {{
 *   organizationId: string,
 *   userId: string|null,
 *   tableName: string,
 *   recordId: string,
 *   operation?: 'INSERT'|'UPDATE'|'DELETE',
 *   fields: { field_name: string, old_value: *, new_value: * }[],
 *   ipAddress?: string|null,
 * }} opts
 */
export async function logMutation({
  organizationId,
  userId = null,
  tableName,
  recordId,
  operation = "UPDATE",
  fields,
  ipAddress = null,
}) {
  if (!fields?.length) return;
  try {
    const rows = fields.map((f) => [
      organizationId,
      userId ?? null,
      tableName,
      recordId,
      operation,
      f.field_name,
      f.old_value !== null && f.old_value !== undefined
        ? JSON.stringify(f.old_value)
        : null,
      f.new_value !== null && f.new_value !== undefined
        ? JSON.stringify(f.new_value)
        : null,
      ipAddress ?? null,
    ]);

    const placeholders = rows
      .map((_, i) => {
        const b = i * 9;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb, $${b + 8}::jsonb, $${b + 9})`;
      })
      .join(", ");

    await pool.query(
      `INSERT INTO mutation_log
        (organization_id, user_id, table_name, record_id, operation, field_name, old_value, new_value, ip_address)
       VALUES ${placeholders}`,
      rows.flat()
    );
  } catch (e) {
    console.error("[mutation_log] insert failed (non-blocking):", e?.message || e);
  }
}

/**
 * Compare before/after sur les champs suivis et insère uniquement les diffs.
 * Non-bloquant.
 *
 * @param {{
 *   organizationId: string,
 *   userId: string|null,
 *   tableName: string,
 *   recordId: string,
 *   operation?: 'INSERT'|'UPDATE'|'DELETE',
 *   before: Record<string,*>|null,
 *   after: Record<string,*>|null,
 *   fields: string[],
 *   ipAddress?: string|null,
 * }} opts
 */
export async function logMutationDiff({
  organizationId,
  userId = null,
  tableName,
  recordId,
  operation = "UPDATE",
  before,
  after,
  fields,
  ipAddress = null,
}) {
  const diffs = diffFields(before ?? {}, after ?? {}, fields);
  if (!diffs.length) return;
  await logMutation({ organizationId, userId, tableName, recordId, operation, fields: diffs, ipAddress });
}

/* ── Lecture (API admin) ─────────────────────────────────────────────────── */

/**
 * Retourne les mutations d'un enregistrement ou d'une table, paginées.
 *
 * @param {string} organizationId
 * @param {{
 *   tableName?: string,
 *   recordId?: string,
 *   fieldName?: string,
 *   userId?: string,
 *   limit?: number,
 *   offset?: number,
 *   isSuperAdmin?: boolean,
 * }} opts
 */
export async function getMutationLog(organizationId, opts = {}) {
  const {
    tableName,
    recordId,
    fieldName,
    userId: filterUserId,
    limit = 50,
    offset = 0,
    isSuperAdmin = false,
  } = opts;

  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const conditions = [];
  const values = [];
  let idx = 1;

  if (!isSuperAdmin) {
    conditions.push(`ml.organization_id = $${idx++}`);
    values.push(organizationId);
  }

  if (tableName) {
    conditions.push(`ml.table_name = $${idx++}`);
    values.push(tableName);
  }

  if (recordId) {
    conditions.push(`ml.record_id = $${idx++}`);
    values.push(recordId);
  }

  if (fieldName) {
    conditions.push(`ml.field_name = $${idx++}`);
    values.push(fieldName);
  }

  if (filterUserId) {
    conditions.push(`ml.user_id = $${idx++}`);
    values.push(filterUserId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM mutation_log ml ${where}`,
    values
  );
  const total = countRes.rows[0]?.total ?? 0;

  values.push(safeLimit);
  values.push(safeOffset);

  const dataRes = await pool.query(
    `SELECT
       ml.id,
       ml.organization_id,
       ml.user_id,
       u.email       AS user_email,
       u.first_name  AS user_first_name,
       u.last_name   AS user_last_name,
       ml.table_name,
       ml.record_id,
       ml.operation,
       ml.field_name,
       ml.old_value,
       ml.new_value,
       ml.ip_address,
       ml.created_at
     FROM mutation_log ml
     LEFT JOIN users u ON u.id = ml.user_id
     ${where}
     ORDER BY ml.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    values
  );

  return { total, rows: dataRes.rows };
}

/**
 * Lit les champs ciblés d'une ligne (helper pour lire before/after).
 * Retourne null si la ligne n'existe pas.
 *
 * @param {string} tableName  Nom de la table (quotes | invoices | leads | quote_lines)
 * @param {string} recordId
 * @param {string} organizationId
 * @param {string[]} fields
 */
export async function readTrackedFields(tableName, recordId, organizationId, fields) {
  if (!fields?.length) return null;
  const cols = fields.map((f) => `"${f}"`).join(", ");
  const res = await pool.query(
    `SELECT ${cols} FROM ${tableName} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [recordId, organizationId]
  );
  return res.rows[0] ?? null;
}
