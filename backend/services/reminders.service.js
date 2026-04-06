/**
 * Relances facture — journal simple (pas de statut sur la relance).
 */

import { pool } from "../config/db.js";

const CHANNELS = new Set(["PHONE", "EMAIL", "LETTER", "OTHER"]);

function httpError(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

async function assertInvoiceExists(invoiceId, organizationId) {
  const r = await pool.query(
    `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) return null;
  return true;
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {object} body
 * @param {string|null} userId
 */
export async function createReminder(organizationId, invoiceId, body, userId = null) {
  const ok = await assertInvoiceExists(invoiceId, organizationId);
  if (!ok) throw httpError("Facture non trouvée", 404);

  let { reminded_at, channel = "OTHER", note, next_action_at } = body || {};
  const ch = String(channel || "OTHER").toUpperCase();
  if (!CHANNELS.has(ch)) {
    throw httpError("channel invalide (PHONE | EMAIL | LETTER | OTHER)");
  }

  if (!reminded_at) reminded_at = new Date().toISOString();

  const ins = await pool.query(
    `INSERT INTO invoice_reminders (
      organization_id, invoice_id, reminded_at, channel, note, next_action_at, created_by
    ) VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7)
    RETURNING *`,
    [organizationId, invoiceId, reminded_at, ch, note ?? null, next_action_at ?? null, userId ?? null]
  );
  return ins.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 */
export async function listRemindersForInvoice(organizationId, invoiceId) {
  const ok = await assertInvoiceExists(invoiceId, organizationId);
  if (!ok) return null;

  const r = await pool.query(
    `SELECT id, reminded_at, channel, note, next_action_at, created_by, created_at
     FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2
     ORDER BY reminded_at DESC`,
    [invoiceId, organizationId]
  );
  return r.rows;
}
