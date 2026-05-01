/**
 * API factures — logique applicative (liste, détail, création, émission, depuis devis).
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { assertOrgEntity } from "../services/guards.service.js";
import {
  isInvoiceEditable,
} from "../services/finance/financialImmutability.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";
import {
  computeInvoiceBalance,
  suggestInvoiceStatusFromAmounts,
} from "../services/finance/invoiceBalance.js";
import { MONEY_EPSILON } from "../services/finance/moneyRounding.js";
import { normalizeInvoiceStatusInput } from "../utils/financialDocumentStatus.js";
import { allocateNextDocumentNumber } from "./documentSequence.service.js";
import {
  buildInvoiceIssuerRecipientSnapshots,
  buildSourceQuoteSnapshot,
} from "./documentSnapshot.service.js";
import { listFinancialDocumentsForEntity } from "./financialPdfDocument.service.js";
import {
  persistInvoiceOfficialDocumentSnapshot,
  buildQuoteDepositFreeze,
} from "./financialDocumentSnapshot.service.js";
import { buildInvoicePdfPayloadFromSnapshot } from "./financialDocumentPdfPayload.service.js";
import { createFinancialInvoiceRenderToken } from "./pdfRenderToken.service.js";
import {
  buildFinancialInvoiceRendererUrl,
  generatePdfFromFinancialInvoiceUrlWithFooter,
} from "./pdfGeneration.service.js";
import {
  findExistingInvoicePdfForInvoiceEntity,
  removeInvoicePdfDocuments,
  saveInvoicePdfDocument,
  saveInvoicePdfOnOwnerDocument,
} from "./documents.service.js";
import { ensureClientForQuote } from "./ensureClientForQuote.service.js";

/** Tolérance TTC (€) : somme des factures liées au devis (hors annulées, brouillons inclus) ne doit pas dépasser total devis + cette marge. */
const QUOTE_INVOICE_SUM_TOLERANCE_TTC = 5;
const DEFAULT_INVOICE_DUE_DAYS = 30;
const SAFE_ISSUED_EDIT_WINDOW_HOURS = 24;

function parseDateOnly(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysToDateOnlyIso(baseDateIso, days) {
  const base = parseDateOnly(baseDateIso);
  if (!base) return null;
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDueDays(rawValue) {
  const n = Number(rawValue);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_INVOICE_DUE_DAYS;
}

async function getOrganizationDefaultInvoiceDueDays(client, organizationId) {
  const r = await client.query(`SELECT default_invoice_due_days FROM organizations WHERE id = $1`, [organizationId]);
  return parseDueDays(r.rows[0]?.default_invoice_due_days);
}

function resolveInvoiceDueDate({ explicitDueDate, issueDate, defaultDueDays }) {
  if (explicitDueDate != null && String(explicitDueDate).trim() !== "") return String(explicitDueDate).slice(0, 10);
  return addDaysToDateOnlyIso(issueDate, defaultDueDays) ?? null;
}

function isActivePayment(row) {
  if (!row) return false;
  const st = String(row.status ?? "").toUpperCase();
  return !row.cancelled_at && st !== "CANCELLED";
}

function canSafelyEditIssuedInvoice(invoice, payments = []) {
  const st = String(invoice?.status ?? "").toUpperCase();
  if (st !== "ISSUED") return false;
  if (payments.some(isActivePayment)) return false;
  const createdAt = invoice?.created_at ? new Date(invoice.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  return Date.now() - createdAt.getTime() < SAFE_ISSUED_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
}

/**
 * @param {string} organizationId
 * @param {Record<string, string>} query
 */
export async function listInvoices(organizationId, query = {}) {
  const client_id = query.client_id;
  const lead_id = query.lead_id;
  const quote_id = query.quote_id;
  const status = query.status;
  const overdue = query.overdue;
  const limit = Math.min(500, Math.max(1, parseInt(String(query.limit || "100"), 10) || 100));
  const offset = Math.max(0, parseInt(String(query.offset || "0"), 10) || 0);

  let sql = `
    SELECT i.*, c.company_name, c.first_name, c.last_name,
           (EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = i.organization_id
               AND ed.entity_type = 'invoice' AND ed.entity_id = i.id
               AND ed.document_type = 'invoice_pdf'
               AND (ed.archived_at IS NULL)
           )) AS has_pdf
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.organization_id = $1 AND (i.archived_at IS NULL)`;
  const params = [organizationId];
  let p = 2;

  if (client_id) {
    sql += ` AND i.client_id = $${p++}`;
    params.push(client_id);
  }
  if (lead_id) {
    sql += ` AND i.lead_id = $${p++}`;
    params.push(lead_id);
  }
  if (quote_id) {
    sql += ` AND i.quote_id = $${p++}`;
    params.push(quote_id);
  }
  if (status) {
    sql += ` AND i.status = $${p++}`;
    params.push(String(status).toUpperCase());
  }
  if (overdue === "true" || overdue === "1") {
    sql += ` AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.amount_due > 0 AND i.status NOT IN ('PAID','CANCELLED','DRAFT')`;
  } else if (overdue === "false" || overdue === "0") {
    sql += ` AND (i.due_date IS NULL OR i.due_date >= CURRENT_DATE OR i.amount_due <= 0 OR i.status IN ('PAID','CANCELLED','DRAFT'))`;
  }

  sql += ` ORDER BY i.created_at DESC LIMIT $${p++} OFFSET $${p++}`;
  params.push(limit, offset);

  const r = await pool.query(sql, params);
  return r.rows;
}

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 */
export async function getInvoiceDetail(invoiceId, organizationId) {
  const invRes = await pool.query(
    `SELECT i.*, c.company_name, c.first_name, c.last_name, c.email, c.siret, c.phone,
            ld.first_name AS lead_first_name, ld.last_name AS lead_last_name, ld.email AS lead_email,
            o.default_invoice_due_days AS org_default_invoice_due_days
     FROM invoices i
     LEFT JOIN clients c ON c.id = i.client_id
     LEFT JOIN leads ld ON ld.id = i.lead_id AND ld.organization_id = i.organization_id AND (ld.archived_at IS NULL)
     LEFT JOIN organizations o ON o.id = i.organization_id
     WHERE i.id = $1 AND i.organization_id = $2 AND (i.archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (invRes.rows.length === 0) return null;
  const invoice = invRes.rows[0];

  const lines = (
    await pool.query(
      `SELECT * FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2 ORDER BY position`,
      [invoiceId, organizationId]
    )
  ).rows;

  let quote = null;
  if (invoice.quote_id) {
    const q = await pool.query(`SELECT id, quote_number, status,
      COALESCE(NULLIF(document_snapshot_json->'totals'->>'total_ht', '')::numeric, total_ht) AS total_ht,
      COALESCE(NULLIF(document_snapshot_json->'totals'->>'total_vat', '')::numeric, total_vat) AS total_vat,
      COALESCE(NULLIF(document_snapshot_json->'totals'->>'total_ttc', '')::numeric, total_ttc) AS total_ttc,
      valid_until, currency FROM quotes WHERE id = $1 AND organization_id = $2`, [
      invoice.quote_id,
      organizationId,
    ]);
    quote = q.rows[0] ?? null;
  }

  const payments = (
    await pool.query(
      `SELECT id, amount, payment_date, payment_method, reference, notes, status, created_at, cancelled_at
       FROM payments WHERE invoice_id = $1 AND organization_id = $2 ORDER BY payment_date ASC, created_at ASC`,
      [invoiceId, organizationId]
    )
  ).rows;
  const can_edit_safely = canSafelyEditIssuedInvoice(invoice, payments);

  const credit_notes = (
    await pool.query(
      `SELECT cn.id, cn.credit_note_number, cn.status, cn.total_ht, cn.total_ttc, cn.issue_date, cn.created_at, cn.archived_at,
              cn.reason_text, cn.reason_code,
              (EXISTS (
                SELECT 1 FROM entity_documents ed
                WHERE ed.organization_id = cn.organization_id
                  AND ed.entity_type = 'credit_note' AND ed.entity_id = cn.id
                  AND ed.document_type = 'credit_note_pdf'
                  AND (ed.archived_at IS NULL)
              )) AS has_pdf
       FROM credit_notes cn
       WHERE cn.invoice_id = $1 AND cn.organization_id = $2 ORDER BY cn.created_at`,
      [invoiceId, organizationId]
    )
  ).rows;

  const reminders = (
    await pool.query(
      `SELECT id, reminded_at, channel, note, next_action_at, created_by, created_at
       FROM invoice_reminders WHERE invoice_id = $1 AND organization_id = $2 ORDER BY reminded_at DESC`,
      [invoiceId, organizationId]
    )
  ).rows;

  const documents = await listFinancialDocumentsForEntity(organizationId, "invoice", invoiceId);

  const balance = computeInvoiceBalance(invoice);
  const suggested_status = suggestInvoiceStatusFromAmounts({ ...invoice, ...balance });

  const last_reminder_at = reminders.length > 0 ? reminders[0].reminded_at : null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const dueStr = invoice.due_date ? String(invoice.due_date).slice(0, 10) : null;
  const invSt = String(invoice.status || "").toUpperCase();
  const amtDue = Number(balance.amount_due) || 0;
  const is_overdue =
    amtDue > MONEY_EPSILON &&
    dueStr != null &&
    dueStr < todayStr &&
    !["PAID", "CANCELLED", "DRAFT"].includes(invSt);

  const followupCutoff = new Date();
  followupCutoff.setDate(followupCutoff.getDate() - 7);
  const lastRemDt = last_reminder_at ? new Date(last_reminder_at) : null;
  const needs_followup =
    is_overdue && (!lastRemDt || lastRemDt < followupCutoff);

  /* Objet plat + clés imbriquées pour le futur drawer (évite de casser les champs racine attendus). */
  return {
    ...invoice,
    lines,
    quote,
    payments,
    credit_notes,
    reminders,
    invoice_reminders: reminders,
    documents,
    balance,
    suggested_status,
    last_reminder_at,
    is_overdue,
    needs_followup,
    can_edit_safely,
  };
}

async function assertClientInOrg(clientId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [clientId, organizationId]
  );
  if (r.rows.length === 0) throw new Error("Client non trouvé ou hors organisation");
}

async function assertLeadInOrg(leadId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [leadId, organizationId]
  );
  if (r.rows.length === 0) throw new Error("Lead non trouvé ou hors organisation");
}

/**
 * @param {string} organizationId
 * @param {object} body
 */
export async function createInvoice(organizationId, body) {
  const {
    client_id = null,
    lead_id = null,
    quote_id = null,
    due_date = null,
    notes = null,
    payment_terms = null,
    issue_date = null,
    metadata_json,
    lines = [],
    currency = "EUR",
  } = body || {};

  if (!client_id && !lead_id) throw new Error("client_id ou lead_id obligatoire pour une facture");
  if (client_id && lead_id) throw new Error("Invoice cannot have both client and lead");
  if (client_id) await assertClientInOrg(client_id, organizationId);
  if (lead_id) await assertLeadInOrg(lead_id, organizationId);

  if (quote_id) {
    const q = await pool.query(
      "SELECT id FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [quote_id, organizationId]
    );
    if (q.rows.length === 0) throw new Error("Devis source introuvable");
  }

  const draftNum = `DRAFT-INV-${Date.now()}`;
  const issueDateVal = issue_date != null && String(issue_date).trim() !== "" ? issue_date : new Date().toISOString().slice(0, 10);

  const newId = await withTx(pool, async (client) => {
    const defaultDueDays = await getOrganizationDefaultInvoiceDueDays(client, organizationId);
    const dueDateVal = resolveInvoiceDueDate({
      explicitDueDate: due_date,
      issueDate: issueDateVal,
      defaultDueDays,
    });
    const ins = await client.query(
      `INSERT INTO invoices (
        organization_id, client_id, lead_id, quote_id, invoice_number, status,
        total_ht, total_vat, total_ttc, total_paid, total_credited, amount_due,
        due_date, notes, payment_terms, issue_date, metadata_json, currency
      ) VALUES ($1,$2,$3,$4,$5,'DRAFT',0,0,0,0,0,0,$6,$7,$8,$9, COALESCE($10::jsonb, '{}'::jsonb), $11)
      RETURNING id`,
      [
        organizationId,
        client_id,
        lead_id,
        quote_id,
        draftNum,
        dueDateVal,
        notes,
        payment_terms,
        issueDateVal,
        metadata_json != null ? JSON.stringify(metadata_json) : null,
        currency,
      ]
    );
    const id = ins.rows[0].id;

    await replaceInvoiceLines(client, organizationId, id, lines);

    await recalcInvoiceTotals(client, organizationId, id);
    if (quote_id) await assertQuoteLinkedInvoicesWithinCap(client, quote_id, organizationId, id);
    return id;
  });
  return getInvoiceDetail(newId, organizationId);
}

/**
 * @param {import("pg").PoolClient} client
 */
async function replaceInvoiceLines(client, organizationId, invoiceId, lines) {
  await client.query("DELETE FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2", [invoiceId, organizationId]);
  const defaultSnap = "{}";
  for (let i = 0; i < lines.length; i++) {
    const it = lines[i];
    const desc = it.description ?? it.label ?? "";
    const label = it.label ?? null;
    const qty = Number(it.quantity) || 0;
    const up = Number(it.unit_price_ht) || 0;
    const dr = Number(it.discount_ht) || 0;
    const vr = Number(it.vat_rate ?? it.tva_percent) || 0;
    const db = computeFinancialLineDbFields({
      quantity: qty,
      unit_price_ht: up,
      discount_ht: dr,
      vat_rate: vr,
    });
    await client.query(
      `INSERT INTO invoice_lines (
        organization_id, invoice_id, description, label, quantity, unit_price_ht, discount_ht, vat_rate,
        total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::jsonb, '{}'::jsonb))`,
      [
        organizationId,
        invoiceId,
        desc,
        label,
        qty,
        up,
        dr,
        vr,
        db.total_line_ht,
        db.total_line_vat,
        db.total_line_ttc,
        i + 1,
        it.snapshot_json != null ? JSON.stringify(it.snapshot_json) : defaultSnap,
      ]
    );
  }
}

/**
 * @param {import("pg").PoolClient} client
 */
async function recalcInvoiceTotals(client, organizationId, invoiceId) {
  const lr = await client.query(
    "SELECT quantity, unit_price_ht, discount_ht, vat_rate FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2 ORDER BY position",
    [invoiceId, organizationId]
  );
  let th = 0;
  let tv = 0;
  let tt = 0;
  for (const row of lr.rows) {
    const db = computeFinancialLineDbFields({
      quantity: row.quantity,
      unit_price_ht: row.unit_price_ht,
      discount_ht: row.discount_ht ?? 0,
      vat_rate: row.vat_rate,
    });
    th += db.total_line_ht;
    tv += db.total_line_vat;
    tt += db.total_line_ttc;
  }
  th = Math.round(th * 100) / 100;
  tv = Math.round(tv * 100) / 100;
  tt = Math.round(tt * 100) / 100;

  await client.query(
    `UPDATE invoices SET total_ht = $1, total_vat = $2, total_ttc = $3, amount_due = GREATEST(0, round(($3::numeric - COALESCE(total_paid,0) - COALESCE(total_credited,0))::numeric, 2)), updated_at = now()
     WHERE id = $4 AND organization_id = $5`,
    [th, tv, tt, invoiceId, organizationId]
  );
}

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 * @param {object} body
 */
export async function updateInvoice(invoiceId, organizationId, body) {
  console.info({
    event: "invoice_update_attempt",
    invoice_id: invoiceId,
    organization_id: organizationId,
  });
  await withTx(pool, async (client) => {
    const row = await assertOrgEntity(client, "invoices", invoiceId, organizationId);
    const paymentRes = await client.query(
      `SELECT status, cancelled_at FROM payments WHERE invoice_id = $1 AND organization_id = $2`,
      [invoiceId, organizationId]
    );
    const canSafeEditIssued = canSafelyEditIssuedInvoice(row, paymentRes.rows);
    if (!isInvoiceEditable(row.status) && !canSafeEditIssued) {
      throw new Error("Modification interdite : utilisez un avoir + nouvelle facture.");
    }

    const { lines, client_id, lead_id, quote_id, due_date, notes, payment_terms, issue_date, metadata_json, currency } = body;

    if (row.quote_id) {
      if (client_id !== undefined && normalizeId(client_id) !== normalizeId(row.client_id)) {
        throw new Error("Le rattachement client ne peut pas être modifié pour une facture liée à un devis.");
      }
      if (lead_id !== undefined && normalizeId(lead_id) !== normalizeId(row.lead_id)) {
        throw new Error("Le rattachement lead ne peut pas être modifié pour une facture liée à un devis.");
      }
    }

    if (client_id !== undefined) {
      if (client_id) await assertClientInOrg(client_id, organizationId);
      await client.query(`UPDATE invoices SET client_id = $1, updated_at = now() WHERE id = $2`, [client_id || null, invoiceId]);
    }
    if (lead_id !== undefined) {
      if (lead_id) await assertLeadInOrg(lead_id, organizationId);
      await client.query(`UPDATE invoices SET lead_id = $1, updated_at = now() WHERE id = $2`, [lead_id || null, invoiceId]);
    }
    if (quote_id !== undefined) {
      if (quote_id) {
        const q = await client.query(
          "SELECT id FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
          [quote_id, organizationId]
        );
        if (q.rows.length === 0) throw new Error("Devis source introuvable");
      }
      await client.query(`UPDATE invoices SET quote_id = $1, updated_at = now() WHERE id = $2`, [quote_id || null, invoiceId]);
    }
    if (due_date !== undefined) {
      await client.query(`UPDATE invoices SET due_date = $1, updated_at = now() WHERE id = $2`, [due_date, invoiceId]);
    }
    if (notes !== undefined) {
      await client.query(`UPDATE invoices SET notes = $1, updated_at = now() WHERE id = $2`, [notes, invoiceId]);
    }
    if (payment_terms !== undefined) {
      await client.query(`UPDATE invoices SET payment_terms = $1, updated_at = now() WHERE id = $2`, [payment_terms, invoiceId]);
    }
    if (issue_date !== undefined) {
      await client.query(`UPDATE invoices SET issue_date = $1, updated_at = now() WHERE id = $2`, [issue_date, invoiceId]);
    }
    if (metadata_json !== undefined) {
      await client.query(`UPDATE invoices SET metadata_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(metadata_json),
        invoiceId,
      ]);
    }
    if (currency !== undefined) {
      await client.query(`UPDATE invoices SET currency = $1, updated_at = now() WHERE id = $2`, [currency, invoiceId]);
    }

    const linkChk = await client.query(`SELECT client_id, lead_id FROM invoices WHERE id = $1`, [invoiceId]);
    if (!linkChk.rows[0]?.client_id && !linkChk.rows[0]?.lead_id) {
      throw new Error("La facture doit être liée à un client ou un lead");
    }

    if (Array.isArray(lines)) {
      await replaceInvoiceLines(client, organizationId, invoiceId, lines);
      await recalcInvoiceTotals(client, organizationId, invoiceId);
    }
    if (canSafeEditIssued) {
      await persistInvoiceOfficialDocumentSnapshot(client, invoiceId, organizationId, {
        frozenBy: null,
        generatedFrom: "PATCH_INVOICE_SAFE_EDIT_LT_24H_NO_PAYMENT",
      });
    }

    const qRow = await client.query(`SELECT quote_id FROM invoices WHERE id = $1`, [invoiceId]);
    const qid = qRow.rows[0]?.quote_id;
    if (qid) await assertQuoteLinkedInvoicesWithinCap(client, qid, organizationId);
  });
  const detail = await getInvoiceDetail(invoiceId, organizationId);
  console.info({
    event: "invoice_lookup_after_update",
    found: !!detail,
    invoice_id: invoiceId,
    organization_id: organizationId,
    archived_at: detail?.archived_at ?? null,
  });
  return detail;
}

const INVOICE_TRANSITIONS = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["CANCELLED"],
  PARTIALLY_PAID: ["CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 * @param {string} newStatusRaw
 * @param {string|null} userId
 */
export async function patchInvoiceStatus(invoiceId, organizationId, newStatusRaw, userId = null, options = {}) {
  const normalized = normalizeInvoiceStatusInput(newStatusRaw);
  if (!normalized) throw new Error("Statut invalide");

  await withTx(pool, async (client) => {
    const row = await assertOrgEntity(client, "invoices", invoiceId, organizationId);
    const cur = String(row.status).toUpperCase();
    const allowed = INVOICE_TRANSITIONS[cur] || [];
    if (!allowed.includes(normalized)) {
      throw new Error(`Transition interdite : ${cur} → ${normalized}`);
    }

    if (normalized === "ISSUED") {
      if (!row.client_id && !row.lead_id) throw new Error("Client ou lead requis pour émettre la facture");
      const lc = await client.query(
        "SELECT COUNT(*)::int AS n FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2",
        [invoiceId, organizationId]
      );
      if (lc.rows[0].n < 1) throw new Error("Au moins une ligne est requise pour émettre la facture");

      if (row.quote_id) await assertQuoteLinkedInvoicesWithinCap(client, row.quote_id, organizationId, invoiceId);

      const { fullNumber } = await allocateNextDocumentNumber(client, organizationId, "INVOICE");

      const quoteRow = row.quote_id
        ? (await client.query("SELECT * FROM quotes WHERE id = $1", [row.quote_id])).rows[0]
        : null;

      const fullRow = (await client.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
      const { issuer_snapshot, recipient_snapshot } = await buildInvoiceIssuerRecipientSnapshots(fullRow, organizationId);
      const source_quote_snapshot = quoteRow ? buildSourceQuoteSnapshot(quoteRow) : {};

      await client.query(
        `UPDATE invoices SET
          status = 'ISSUED',
          invoice_number = $1,
          issue_date = COALESCE(issue_date, CURRENT_DATE),
          issuer_snapshot = $2::jsonb,
          recipient_snapshot = $3::jsonb,
          source_quote_snapshot = $4::jsonb,
          updated_at = now()
        WHERE id = $5 AND organization_id = $6`,
        [fullNumber, JSON.stringify(issuer_snapshot), JSON.stringify(recipient_snapshot), JSON.stringify(source_quote_snapshot), invoiceId, organizationId]
      );

      await client.query(`SELECT sg_recompute_invoice_total_paid($1)`, [invoiceId]);

      await persistInvoiceOfficialDocumentSnapshot(client, invoiceId, organizationId, {
        frozenBy: userId,
        generatedFrom: "PATCH_INVOICE_STATUS_ISSUED",
      });
    } else if (normalized === "CANCELLED") {
      const paid = Number(row.total_paid) || 0;
      const cred = Number(row.total_credited) || 0;
      if (paid > 0) {
        throw new Error("Impossible d'annuler une facture avec paiement. Utilisez un avoir.");
      }
      if (cred > 0) {
        throw new Error("Annulation impossible : des avoirs sont déjà imputés.");
      }
      const cancelledReason =
        options?.cancelled_reason != null && String(options.cancelled_reason).trim() !== ""
          ? String(options.cancelled_reason).trim()
          : null;
      const metadata =
        row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
          ? { ...row.metadata_json }
          : {};
      if (cancelledReason) metadata.cancelled_reason = cancelledReason;
      metadata.cancelled_by = userId ?? null;
      metadata.cancelled_via = "status_transition";
      if (!metadata.cancelled_reason && cancelledReason == null) {
        delete metadata.cancelled_reason;
      }
      await client.query(
        `UPDATE invoices
         SET status = 'CANCELLED',
             cancelled_at = COALESCE(cancelled_at, now()),
             metadata_json = $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [invoiceId, JSON.stringify(metadata)]
      );
    }
  });
  return getInvoiceDetail(invoiceId, organizationId);
}

/**
 * Recalcule le statut depuis les montants (après paiements / triggers).
 */
export async function recalculateInvoiceStatusFromAmounts(invoiceId, organizationId) {
  const r = await pool.query(
    "SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) return null;
  const inv = r.rows[0];
  const cur = String(inv.status).toUpperCase();
  if (cur === "DRAFT" || cur === "CANCELLED") return inv;

  const next = suggestInvoiceStatusFromAmounts(inv);
  if (next === cur) return inv;

  if (next === "PAID") {
    await pool.query(
      `UPDATE invoices SET status = $1, paid_at = COALESCE(paid_at, now()), updated_at = now() WHERE id = $2`,
      [next, invoiceId]
    );
  } else {
    await pool.query(`UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2`, [next, invoiceId]);
  }
  const u = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  return u.rows[0];
}

function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function readLockedBillingTotals(quote) {
  const ttc = Number(quote?.billing_total_ttc);
  if (!Number.isFinite(ttc) || ttc <= 0) return null;
  const ht = Number(quote?.billing_total_ht);
  const vat = Number(quote?.billing_total_vat);
  return {
    total_ttc: roundMoney2(ttc),
    total_ht: Number.isFinite(ht) ? roundMoney2(ht) : null,
    total_vat: Number.isFinite(vat) ? roundMoney2(vat) : null,
    locked_at: quote?.billing_locked_at ?? null,
  };
}

/**
 * Fige la base globale de facturation au premier acte (STANDARD/DEPOSIT).
 * Si déjà verrouillée, renvoie la base existante et ignore toute nouvelle préparation.
 * @param {import("pg").PoolClient} client
 */
async function resolveOrLockQuoteBillingTotals(client, quote, preparedTotals = null) {
  const existing = readLockedBillingTotals(quote);
  if (existing) return { ...existing, was_locked_before: true };

  const preparedTtc = Number(preparedTotals?.total_ttc);
  const liveTtc = roundMoney2(Number(quote.total_ttc) || 0);
  const total_ttc = Number.isFinite(preparedTtc) && preparedTtc > 0 ? roundMoney2(preparedTtc) : liveTtc;
  if (!Number.isFinite(total_ttc) || total_ttc <= 0) {
    throw new Error("Base de facturation invalide (billing_total_ttc).");
  }

  const preparedHt = Number(preparedTotals?.total_ht);
  const preparedVat = Number(preparedTotals?.total_vat);
  const total_ht = Number.isFinite(preparedHt) ? roundMoney2(preparedHt) : roundMoney2(Number(quote.total_ht) || 0);
  const total_vat = Number.isFinite(preparedVat)
    ? roundMoney2(preparedVat)
    : roundMoney2(Number(quote.total_vat) || Math.max(0, total_ttc - total_ht));

  await client.query(
    `UPDATE quotes
     SET billing_total_ht = $1,
         billing_total_vat = $2,
         billing_total_ttc = $3,
         billing_locked_at = COALESCE(billing_locked_at, now()),
         updated_at = now()
     WHERE id = $4 AND organization_id = $5`,
    [total_ht, total_vat, total_ttc, quote.id, quote.organization_id]
  );

  return {
    total_ht,
    total_vat,
    total_ttc,
    locked_at: new Date().toISOString(),
    was_locked_before: false,
  };
}

/**
 * Calcule les totaux à partir d'un payload de lignes préparées.
 * @param {Array<{ quantity: number, unit_price_ht: number, discount_ht?: number, vat_rate: number }>} lines
 */
function computeTotalsFromPreparedLines(lines) {
  let total_ht = 0;
  let total_vat = 0;
  let total_ttc = 0;
  for (const row of lines || []) {
    const db = computeFinancialLineDbFields({
      quantity: Number(row.quantity) || 0,
      unit_price_ht: Number(row.unit_price_ht) || 0,
      discount_ht: Number(row.discount_ht) || 0,
      vat_rate: Number(row.vat_rate) || 0,
    });
    total_ht = roundMoney2(total_ht + db.total_line_ht);
    total_vat = roundMoney2(total_vat + db.total_line_vat);
    total_ttc = roundMoney2(total_ttc + db.total_line_ttc);
  }
  return { total_ht, total_vat, total_ttc };
}

/**
 * Somme TTC des factures liées au devis (hors annulées), **brouillons inclus** — pour « reste à facturer » et plafond global.
 */
async function sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(total_ttc), 0)::numeric AS s
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) != 'CANCELLED'`,
    [quoteId, organizationId]
  );
  return roundMoney2(Number(r.rows[0]?.s) || 0);
}

async function sumQuoteDepositTtcIssued(client, quoteId, organizationId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(total_ttc), 0)::numeric AS s
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) NOT IN ('DRAFT', 'CANCELLED')
       AND UPPER(COALESCE(metadata_json->>'quote_billing_role', '')) = 'DEPOSIT'`,
    [quoteId, organizationId]
  );
  return roundMoney2(Number(r.rows[0]?.s) || 0);
}

/**
 * Source de vérité devis : somme des lignes actives quote_lines (inclut lignes de remise négatives).
 * Resynchronise quotes.total_* pour éviter les écarts entre en-tête et lignes.
 */
async function recomputeQuoteTotalsFromLines(client, quoteId, organizationId) {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(total_line_ht) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS total_ht,
       COALESCE(SUM(total_line_vat) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS total_vat,
       COALESCE(SUM(total_line_ttc) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS total_ttc
     FROM quote_lines
     WHERE quote_id = $1 AND organization_id = $2`,
    [quoteId, organizationId]
  );
  const total_ht = roundMoney2(Number(r.rows[0]?.total_ht) || 0);
  const total_vat = roundMoney2(Number(r.rows[0]?.total_vat) || 0);
  const total_ttc = roundMoney2(Number(r.rows[0]?.total_ttc) || 0);

  await client.query(
    `UPDATE quotes
     SET total_ht = $1, total_vat = $2, total_ttc = $3, updated_at = now()
     WHERE id = $4 AND organization_id = $5`,
    [total_ht, total_vat, total_ttc, quoteId, organizationId]
  );

  return { total_ht, total_vat, total_ttc };
}

function parseOfficialQuoteTotals(quote) {
  const raw = quote?.document_snapshot_json;
  if (raw == null) return null;
  let snapshot = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "{}") return null;
    try {
      snapshot = JSON.parse(t);
    } catch {
      return null;
    }
  }
  const totals = snapshot?.totals;
  if (!totals || typeof totals !== "object") return null;
  const rawHt = Number(totals.total_ht);
  const rawVat = Number(totals.total_vat);
  const rawTtc = Number(totals.total_ttc);
  if (!Number.isFinite(rawHt) || !Number.isFinite(rawVat) || !Number.isFinite(rawTtc)) {
    return null;
  }
  const total_ht = roundMoney2(rawHt);
  const total_vat = roundMoney2(rawVat);
  const total_ttc = roundMoney2(rawTtc);
  return { total_ht, total_vat, total_ttc };
}

function applyOfficialQuoteTotals(quote) {
  const totals = parseOfficialQuoteTotals(quote);
  if (!totals) return false;
  quote.total_ht = totals.total_ht;
  quote.total_vat = totals.total_vat;
  quote.total_ttc = totals.total_ttc;
  return true;
}

/**
 * Plafond TTC des factures liées au devis (hors annulées, brouillons inclus).
 * @param {import("pg").PoolClient} client
 * @param {string|null} [excludeInvoiceId] — réservé (cohérence API) ; le plafond compare la somme TTC des factures actives au total TTC du devis.
 */
async function assertQuoteLinkedInvoicesWithinCap(client, quoteId, organizationId, excludeInvoiceId = null) {
  if (!quoteId) return;
  void excludeInvoiceId;
  const agg = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(status, '')) != 'CANCELLED' THEN total_ttc ELSE 0 END), 0)::numeric AS full_sum
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2`,
    [quoteId, organizationId]
  );
  const fullSum = roundMoney2(Number(agg.rows[0]?.full_sum) || 0);

  const q = await client.query(
    `SELECT id FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (q.rows.length === 0) return;
  const recomputed = await recomputeQuoteTotalsFromLines(client, quoteId, organizationId);
  const quoteTtc = recomputed.total_ttc;

  if (fullSum > quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
    throw new Error(
      `Montant total des factures liées au devis (${fullSum} € TTC) dépasse le total du devis (${quoteTtc} €) au-delà de la tolérance autorisée (${QUOTE_INVOICE_SUM_TOLERANCE_TTC} €).`
    );
  }
}

function quoteRoleToBillingMode(role) {
  const r = String(role || "").toUpperCase();
  if (r === "STANDARD") return "FREE";
  if (r === "DEPOSIT" || r === "BALANCE") return r;
  return "FREE";
}

function buildMetadataQuoteBilling(role, quote, extra = {}) {
  return {
    billing_mode: quoteRoleToBillingMode(role),
    created_from_quote_id: quote.id,
    quote_billing_role: role,
    quote_billing: {
      source_quote_id: quote.id,
      quote_number: quote.quote_number ?? null,
      quote_total_ttc_snapshot: roundMoney2(Number(quote.total_ttc) || 0),
      ...extra,
    },
  };
}

/**
 * Ligne unique : répartition HT/TVA proportionnelle au devis (même logique que l’acompte PDF).
 * @param {object} quote
 * @param {string} label
 * @param {number} sliceTtc
 */
function proportionalSliceLineFromQuote(quote, label, sliceTtc) {
  const ttc = Number(quote.total_ttc) || 0;
  const th = Number(quote.total_ht) || 0;
  const tv = Number(quote.total_vat) || 0;
  if (ttc <= 0.0001) throw new Error("Base TTC de facturation invalide ou nulle");
  const target = roundMoney2(Math.min(Math.max(0, sliceTtc), ttc));
  const lineHt = roundMoney2(target * (th / ttc));
  const lineVat = roundMoney2(target - lineHt);
  const vatRate = lineHt > 0.0001 ? roundMoney2((lineVat / lineHt) * 100) : 20;
  return {
    label,
    description: label,
    quantity: 1,
    unit_price_ht: lineHt,
    discount_ht: 0,
    vat_rate: vatRate,
    snapshot_json: { quote_billing_slice: true, target_ttc: target },
  };
}

function asObjectJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeLineTtcFallback(quantity, unitPriceHt, discountHt, vatRate) {
  const baseHt = Number(quantity) * Number(unitPriceHt) - Number(discountHt);
  const ttc = baseHt * (1 + Number(vatRate) / 100);
  return roundMoney2(ttc);
}

function buildSnapshotInconsistentError({ quoteId, reason, delta = null }) {
  const err = new Error(`SNAPSHOT_INCONSISTENT: snapshot devis incoherent (${reason})`);
  err.code = "SNAPSHOT_INCONSISTENT";
  err.quote_id = quoteId;
  err.delta = delta;
  return err;
}

function buildStandardSnapshotLines(snapshotLines) {
  return snapshotLines.map((line, index) => ({
    label: line?.label ?? null,
    description: line?.description ?? line?.label ?? "",
    quantity: Number(line.quantity),
    unit_price_ht: Number(line.unit_price_ht),
    discount_ht: Number(line.discount_ht ?? 0),
    vat_rate: Number(line.vat_rate),
    snapshot_json: {
      ...(line?.reference != null ? { reference: line.reference } : {}),
      source_position: line?.position != null ? Number(line.position) : index + 1,
      source: "quote_document_snapshot",
      line_kind: line?.line_kind ?? null,
    },
  }));
}

function validateStandardSnapshotOrThrow(snapshot, quoteId) {
  const linesRaw = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  if (linesRaw.length < 1) return { usable: false };

  const totalTtc = parseFiniteNumber(snapshot?.totals?.total_ttc);
  if (totalTtc == null) {
    console.warn("[invoices] snapshot_inconsistent", {
      quote_id: quoteId,
      reason: "missing_or_invalid_totals_total_ttc",
    });
    throw buildSnapshotInconsistentError({
      quoteId,
      reason: "missing_or_invalid_totals_total_ttc",
      delta: null,
    });
  }

  let sumTtc = 0;
  for (let i = 0; i < linesRaw.length; i++) {
    const line = linesRaw[i];
    const qty = parseFiniteNumber(line?.quantity);
    const up = parseFiniteNumber(line?.unit_price_ht);
    const vat = parseFiniteNumber(line?.vat_rate);
    const lineTtcRaw = parseFiniteNumber(line?.total_line_ttc);
    const discount = parseFiniteNumber(line?.discount_ht ?? 0);
    if (qty == null || up == null || vat == null || discount == null) {
      console.warn("[invoices] snapshot_inconsistent", {
        quote_id: quoteId,
        reason: "invalid_line_numeric_fields",
        line_index: i,
      });
      throw buildSnapshotInconsistentError({
        quoteId,
        reason: "invalid_line_numeric_fields",
        delta: null,
      });
    }
    const lineTtc =
      lineTtcRaw != null ? roundMoney2(lineTtcRaw) : computeLineTtcFallback(qty, up, discount, vat);
    sumTtc += lineTtc;
  }

  const roundedSum = roundMoney2(sumTtc);
  const roundedTotal = roundMoney2(totalTtc);
  if (Math.abs(roundedSum - roundedTotal) > 0.01) {
    const delta = roundMoney2(roundedSum - roundedTotal);
    console.warn("[invoices] snapshot_inconsistent", {
      quote_id: quoteId,
      reason: "line_sum_ttc_mismatch",
      lines_total_ttc: roundedSum,
      snapshot_total_ttc: roundedTotal,
      delta,
    });
    throw buildSnapshotInconsistentError({
      quoteId,
      reason: "line_sum_ttc_mismatch",
      delta,
    });
  }

  return {
    usable: true,
    lines: buildStandardSnapshotLines(linesRaw),
    totals: {
      total_ht: parseFiniteNumber(snapshot?.totals?.total_ht),
      total_vat: parseFiniteNumber(snapshot?.totals?.total_vat),
      total_ttc: roundedTotal,
    },
    notes: snapshot?.notes ?? null,
  };
}

/**
 * Contexte facturation pour un devis (acompte / solde / complète).
 * @param {string} quoteId
 * @param {string} organizationId
 */
export async function getQuoteInvoiceBillingContext(quoteId, organizationId) {
  let qres = await pool.query(
    `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (qres.rows.length === 0) return null;
  let quote = qres.rows[0];
  const hasOfficialTotals = applyOfficialQuoteTotals(quote);
  if (!hasOfficialTotals) {
    const recomputed = await recomputeQuoteTotalsFromLines(pool, quoteId, organizationId);
    quote.total_ht = recomputed.total_ht;
    quote.total_vat = recomputed.total_vat;
    quote.total_ttc = recomputed.total_ttc;
  }
  const quoteStatus = String(quote.status || "").toUpperCase();
  if (!quote.client_id && quote.lead_id && quoteStatus === "ACCEPTED") {
    try {
      await withTx(pool, async (client) => {
        const locked = await client.query(
          `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
          [quoteId, organizationId]
        );
        const row = locked.rows[0];
        if (!row || row.client_id || !row.lead_id || String(row.status || "").toUpperCase() !== "ACCEPTED") return;
        await ensureClientForQuote(client, row, organizationId);
      });
      qres = await pool.query(
        `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [quoteId, organizationId]
      );
      quote = qres.rows[0] ?? quote;
      applyOfficialQuoteTotals(quote);
    } catch (e) {
      console.warn("[invoices] billing context client resolution failed", {
        quote_id: quoteId,
        organization_id: organizationId,
        error: e?.message || String(e),
      });
    }
  }
  const meta = quote.metadata_json && typeof quote.metadata_json === "object" ? quote.metadata_json : {};
  const { deposit_display } = buildQuoteDepositFreeze(meta, quote.total_ttc);

  const sumCommittedRes = await pool.query(
    `SELECT COALESCE(SUM(total_ttc), 0)::numeric AS s FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) != 'CANCELLED'`,
    [quoteId, organizationId]
  );
  const invoicedCommitted = roundMoney2(Number(sumCommittedRes.rows[0]?.s) || 0);
  const sumIssuedRes = await pool.query(
    `SELECT COALESCE(SUM(total_ttc), 0)::numeric AS s FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) NOT IN ('DRAFT', 'CANCELLED')`,
    [quoteId, organizationId]
  );
  const invoicedIssuedOnly = roundMoney2(Number(sumIssuedRes.rows[0]?.s) || 0);
  const locked = readLockedBillingTotals(quote);
  const quoteTtc = roundMoney2(Number(quote.total_ttc) || 0);
  const billingTotalTtc = locked ? locked.total_ttc : quoteTtc;
  const remaining = roundMoney2(billingTotalTtc - invoicedCommitted);
  const quoteZeroTotal = billingTotalTtc <= 0.0001;

  const rolesRes = await pool.query(
    `SELECT metadata_json->>'quote_billing_role' AS role
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2 AND UPPER(COALESCE(status, '')) != 'CANCELLED'`,
    [quoteId, organizationId]
  );
  const hasDepositInvoice = rolesRes.rows.some((r) => r.role === "DEPOSIT");
  const hasBalanceInvoice = rolesRes.rows.some((r) => r.role === "BALANCE");

  const issuedRes = await pool.query(
    `SELECT metadata_json->>'quote_billing_role' AS role
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) NOT IN ('CANCELLED', 'DRAFT')`,
    [quoteId, organizationId]
  );
  const hasDepositIssued = issuedRes.rows.some((r) => r.role === "DEPOSIT");
  const hasBalanceIssued = issuedRes.rows.some((r) => r.role === "BALANCE");

  const accepted = String(quote.status).toUpperCase() === "ACCEPTED";
  const hasClient = !!quote.client_id;

  const quoteHt = roundMoney2(Number(quote.total_ht) || 0);
  const quoteVat = roundMoney2(Number(quote.total_vat) || 0);
  const billingTotalHt = locked?.total_ht ?? quoteHt;
  const billingTotalVat = locked?.total_vat ?? quoteVat;

  const invListRes = await pool.query(
    `SELECT id, invoice_number, total_ttc, total_ht, status,
            COALESCE(metadata_json->>'quote_billing_role', '') AS quote_billing_role
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) != 'CANCELLED'
     ORDER BY created_at ASC`,
    [quoteId, organizationId]
  );
  const linked_invoices = invListRes.rows.map((row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    total_ttc: roundMoney2(Number(row.total_ttc) || 0),
    total_ht: roundMoney2(Number(row.total_ht) || 0),
    status: String(row.status || ""),
    quote_billing_role: String(row.quote_billing_role || "STANDARD").toUpperCase(),
  }));

  return {
    quote_id: quoteId,
    quote_total_ttc: quoteTtc,
    quote_total_ht: quoteHt,
    quote_total_vat: quoteVat,
    billing_total_ttc: billingTotalTtc,
    billing_total_ht: billingTotalHt,
    billing_total_vat: billingTotalVat,
    billing_locked_at: locked?.locked_at ?? null,
    billing_is_locked: Boolean(locked),
    quote_zero_total: quoteZeroTotal,
    /** TTC engagé sur le devis (brouillons inclus, hors annulées) — pour « déjà facturé / réservé ». */
    invoiced_ttc: invoicedCommitted,
    /** TTC factures émises (hors brouillon / annulée). */
    invoiced_issued_ttc: invoicedIssuedOnly,
    remaining_ttc: remaining,
    has_structured_deposit: !!deposit_display,
    deposit_ttc: deposit_display ? roundMoney2(Number(deposit_display.amount_ttc) || 0) : null,
    /** Pour calcul UI préparation uniquement : % ou montant structurés du dossier (sans lien avec le total devis pour le flux acompte). */
    deposit_structure: deposit_display
      ? {
          mode: String(deposit_display.mode || ""),
          ...(deposit_display.percent != null ? { percent: Number(deposit_display.percent) } : {}),
          ...(deposit_display.amount_ttc != null ? { amount_ttc: roundMoney2(Number(deposit_display.amount_ttc) || 0) } : {}),
        }
      : null,
    has_deposit_invoice: hasDepositInvoice,
    has_balance_invoice: hasBalanceInvoice,
    has_deposit_issued: hasDepositIssued,
    has_balance_issued: hasBalanceIssued,
    can_create_deposit: accepted && hasClient && !quoteZeroTotal && remaining > 0.02,
    can_create_balance: accepted && hasClient && !quoteZeroTotal && remaining > 0.02,
    can_create_standard_full: accepted && hasClient && !quoteZeroTotal && invoicedCommitted <= 0.02,
    linked_invoices,
  };
}

/**
 * @param {string} quoteId
 * @param {string} organizationId
 * @param {{ billingRole?: string, billingAmountTtc?: number }} [options] — STANDARD (défaut) | DEPOSIT | BALANCE.
 *   DEPOSIT : base contractuelle = préparation (`preparedTotalTtc/Ht/Vat`, obligatoires) ; priorité à `billingAmountTtc` ;
 *     sinon acompte structuré (pourcentage ou montant du devis appliqués sur la préparation uniquement).
 *   BALANCE : toujours le **reste à facturer** (TTC), le montant passé est ignoré.
 */
export async function createInvoiceFromQuote(quoteId, organizationId, options = {}) {
  const billingRoleRaw = options.billingRole ?? options.billing_role ?? "STANDARD";
  const billingRole = String(billingRoleRaw).toUpperCase();
  if (!["STANDARD", "DEPOSIT", "BALANCE"].includes(billingRole)) {
    throw new Error("billingRole invalide (STANDARD, DEPOSIT ou BALANCE)");
  }

  const newInvoiceId = await withTx(pool, async (client) => {
    const qres = await client.query(
      `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
      [quoteId, organizationId]
    );
    if (qres.rows.length === 0) throw new Error("Devis non trouvé");
    const quote = qres.rows[0];
    const hasOfficialTotals = applyOfficialQuoteTotals(quote);
    if (!hasOfficialTotals) {
      const recomputed = await recomputeQuoteTotalsFromLines(client, quoteId, organizationId);
      quote.total_ht = recomputed.total_ht;
      quote.total_vat = recomputed.total_vat;
      quote.total_ttc = recomputed.total_ttc;
    }
    if (String(quote.status).toUpperCase() !== "ACCEPTED") {
      throw new Error("Le devis doit être accepté pour générer une facture");
    }
    const resolvedClientId = await ensureClientForQuote(client, quote, organizationId);
    quote.client_id = resolvedClientId;
    const invoiceClientId = String(resolvedClientId);
    const invoiceLeadId =
      quote.lead_id != null && String(quote.lead_id).trim() !== "" ? String(quote.lead_id) : null;

    const meta = quote.metadata_json && typeof quote.metadata_json === "object" ? quote.metadata_json : {};
    const { deposit_display } = buildQuoteDepositFreeze(meta, quote.total_ttc);
    const reservedTtc = await sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId);
    const quoteTtcLive = roundMoney2(Number(quote.total_ttc) || 0);
    const preparedTotalOptRaw = options.preparedTotalTtc ?? options.prepared_total_ttc;
    const preparedTotalOpt =
      preparedTotalOptRaw != null && preparedTotalOptRaw !== ""
        ? roundMoney2(Number(preparedTotalOptRaw))
        : null;
    if (preparedTotalOpt != null && (!Number.isFinite(preparedTotalOpt) || preparedTotalOpt < 0.01)) {
      throw new Error("Montant préparé (prepared_total_ttc) invalide.");
    }
    const preparedHtRaw = options.preparedTotalHt ?? options.prepared_total_ht;
    const preparedVatRaw = options.preparedTotalVat ?? options.prepared_total_vat;
    const preparedHt = preparedHtRaw != null && preparedHtRaw !== "" ? roundMoney2(Number(preparedHtRaw)) : null;
    const preparedVat = preparedVatRaw != null && preparedVatRaw !== "" ? roundMoney2(Number(preparedVatRaw)) : null;
    if (preparedHt != null && (!Number.isFinite(preparedHt) || preparedHt < 0)) {
      throw new Error("Montant préparé (prepared_total_ht) invalide.");
    }
    if (preparedVat != null && (!Number.isFinite(preparedVat) || preparedVat < 0)) {
      throw new Error("Montant préparé (prepared_total_vat) invalide.");
    }

    if (billingRole === "DEPOSIT") {
      if (preparedTotalOpt == null || !Number.isFinite(preparedTotalOpt) || preparedTotalOpt <= 0.0001) {
        throw new Error("Préparation obligatoire : prepared_total_ttc doit être strictement positif pour une facture d'acompte.");
      }
      if (preparedHt == null || !Number.isFinite(preparedHt) || preparedHt < 0) {
        throw new Error("Préparation obligatoire : prepared_total_ht requis pour une facture d'acompte.");
      }
      if (preparedVat == null || !Number.isFinite(preparedVat) || preparedVat < 0) {
        throw new Error("Préparation obligatoire : prepared_total_vat requis pour une facture d'acompte.");
      }
    }

    const officialTotals = parseOfficialQuoteTotals(quote);
    const totalsForBillingLock = officialTotals || {
      total_ht: roundMoney2(Number(quote.total_ht) || 0),
      total_vat: roundMoney2(Number(quote.total_vat) || 0),
      total_ttc: quoteTtcLive,
    };
    const hasAnyInvoiceOnQuote = reservedTtc > 0.02;

    let billingTotals;
    let quoteTtc;
    let remainingBefore;
    /** @type {{ total_ht: number, total_vat: number, total_ttc: number } | null} */
    let prepBillingSliceBase = null;
    /** @type {number|null} */
    let depositPrepRefTtcAssert = null;

    if (billingRole === "STANDARD") {
      if (!readLockedBillingTotals(quote) && !hasAnyInvoiceOnQuote && !officialTotals) {
        throw new Error("Devis non figé: impossible de facturer sans snapshot officiel cohérent.");
      }
      billingTotals = await resolveOrLockQuoteBillingTotals(client, quote, totalsForBillingLock);
      quoteTtc = roundMoney2(Number(billingTotals.total_ttc) || 0);
      remainingBefore = roundMoney2(quoteTtc - reservedTtc);
    } else if (billingRole === "DEPOSIT") {
      const prepRefTtc = roundMoney2(Number(preparedTotalOpt));
      const prepRefHt = roundMoney2(Number(preparedHt));
      const prepRefVat = roundMoney2(Number(preparedVat));
      billingTotals = await resolveOrLockQuoteBillingTotals(client, quote, {
        total_ht: prepRefHt,
        total_vat: prepRefVat,
        total_ttc: prepRefTtc,
      });
      prepBillingSliceBase = {
        total_ht: roundMoney2(Number(billingTotals.total_ht) || 0),
        total_vat: roundMoney2(Number(billingTotals.total_vat) || 0),
        total_ttc: roundMoney2(Number(billingTotals.total_ttc) || 0),
      };
      depositPrepRefTtcAssert = prepBillingSliceBase.total_ttc;
      quoteTtc = prepBillingSliceBase.total_ttc;
      remainingBefore = roundMoney2(quoteTtc - reservedTtc);
    } else if (billingRole === "BALANCE") {
      if (preparedTotalOpt != null) {
        if (!Number.isFinite(preparedTotalOpt) || preparedTotalOpt <= 0.0001) {
          throw new Error("Préparation obligatoire : prepared_total_ttc doit être strictement positif pour une facture de solde.");
        }
        if (preparedHt == null || !Number.isFinite(preparedHt) || preparedHt < 0) {
          throw new Error("Préparation obligatoire : prepared_total_ht requis pour une facture de solde.");
        }
        if (preparedVat == null || !Number.isFinite(preparedVat) || preparedVat < 0) {
          throw new Error("Préparation obligatoire : prepared_total_vat requis pour une facture de solde.");
        }
      }
      const lockedBefore = readLockedBillingTotals(quote);
      billingTotals =
        lockedBefore ||
        (preparedTotalOpt != null
          ? await resolveOrLockQuoteBillingTotals(client, quote, {
              total_ht: roundMoney2(Number(preparedHt)),
              total_vat: roundMoney2(Number(preparedVat)),
              total_ttc: roundMoney2(Number(preparedTotalOpt)),
            })
          : {
              total_ht: roundMoney2(Number(quote.total_ht) || 0),
              total_vat: roundMoney2(Number(quote.total_vat) || 0),
              total_ttc: quoteTtcLive,
              locked_at: null,
              was_locked_before: false,
            });
      quoteTtc = roundMoney2(Number(billingTotals.total_ttc) || 0);
      remainingBefore = roundMoney2(quoteTtc - reservedTtc);
    }

    const billingBase =
      billingRole === "DEPOSIT" && prepBillingSliceBase
        ? {
            ...quote,
            total_ttc: prepBillingSliceBase.total_ttc,
            total_ht: prepBillingSliceBase.total_ht,
            total_vat: prepBillingSliceBase.total_vat,
          }
        : {
            ...quote,
            total_ttc: quoteTtc,
            total_ht: billingTotals.total_ht != null ? billingTotals.total_ht : quote.total_ht,
            total_vat: billingTotals.total_vat != null ? billingTotals.total_vat : quote.total_vat,
          };

    const rawAmt = options.billingAmountTtc ?? options.billing_amount_ttc;
    const requestedOpt =
      rawAmt != null && rawAmt !== "" ? roundMoney2(Number(rawAmt)) : null;
    if (requestedOpt != null && !Number.isFinite(requestedOpt)) {
      throw new Error("Montant (billing_amount_ttc) invalide.");
    }

    if (billingRole === "BALANCE" && quoteTtc <= 0.0001) {
      throw new Error("Facturation de solde impossible : la base TTC de facturation est nulle ou non significative.");
    }

    let lines = [];
    let metaJson = {};
    let notesForInvoice = quote.notes ?? null;
    let standardCapTtc = quoteTtc;
    let standardSource = "live";
    let standardSnapshotTotals = null;

    if (billingRole === "STANDARD") {
      if (reservedTtc > 0.02) {
        throw new Error(
          "Une facture ou un brouillon existe déjà pour ce devis. Utilisez acompte / solde ou supprimez les brouillons inutiles."
        );
      }
      const quoteSnapshot = asObjectJson(quote.document_snapshot_json);
      const validatedSnapshot = validateStandardSnapshotOrThrow(quoteSnapshot, quoteId);
      if (!validatedSnapshot.usable) {
        throw new Error("Devis non figé: snapshot officiel indisponible pour facture STANDARD.");
      }
      standardSource = "snapshot";
      lines = validatedSnapshot.lines;
      notesForInvoice = validatedSnapshot.notes ?? quote.notes ?? null;
      standardCapTtc = validatedSnapshot.totals.total_ttc;
      standardSnapshotTotals = validatedSnapshot.totals;
      metaJson = buildMetadataQuoteBilling("STANDARD", billingBase, {
        prepared_total_ttc: preparedTotalOpt,
        billing_total_locked_at: billingTotals.locked_at ?? null,
        billing_total_was_locked_before: Boolean(billingTotals.was_locked_before),
      });
    } else if (billingRole === "DEPOSIT") {
      if (!prepBillingSliceBase) {
        throw new Error("État interne invalide : base de préparation d'acompte manquante.");
      }
      const prepRefTtc = prepBillingSliceBase.total_ttc;
      const prepRefHt = prepBillingSliceBase.total_ht;
      const prepRefVat = prepBillingSliceBase.total_vat;
      if (prepRefTtc <= 0.0001) {
        throw new Error("La base de préparation TTC doit être strictement positive pour une facture d'acompte.");
      }
      if (remainingBefore <= 0.02) {
        throw new Error(
          "Rien à facturer sur cette préparation : montant déjà couvert par les factures existantes (y compris brouillons)."
        );
      }
      let sliceTtc;
      if (requestedOpt != null && requestedOpt >= 0.01) {
        sliceTtc = roundMoney2(Math.min(requestedOpt, remainingBefore, prepRefTtc));
      } else if (deposit_display && String(deposit_display.mode || "").toUpperCase() === "PERCENT") {
        const p = Number(deposit_display.percent);
        if (!Number.isFinite(p) || p <= 0) {
          throw new Error("Structure d'acompte sur le dossier invalide : pourcentage non exploitable.");
        }
        sliceTtc = roundMoney2(
          Math.min((prepRefTtc * Math.min(100, p)) / 100, remainingBefore, prepRefTtc)
        );
      } else if (deposit_display && String(deposit_display.mode || "").toUpperCase() === "AMOUNT") {
        const depTtc = roundMoney2(Number(deposit_display.amount_ttc) || 0);
        sliceTtc = roundMoney2(Math.min(Math.max(0, depTtc), remainingBefore, prepRefTtc));
      } else {
        throw new Error("Veuillez saisir un montant d'acompte");
      }
      if (sliceTtc < 0.01) {
        throw new Error("Montant d'acompte nul ou supérieur au reste à facturer.");
      }
      if (sliceTtc > prepRefTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(`Impossible : le montant d'acompte dépasse la base de préparation (${prepRefTtc} € TTC).`);
      }
      if (reservedTtc + sliceTtc > prepRefTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Impossible : cette facture ferait dépasser la base de préparation (${prepRefTtc} € TTC).`
        );
      }
      const pct = roundMoney2((sliceTtc / prepRefTtc) * 100);
      const label = `Acompte ${pct.toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })} % du montant total des prestations${quote.quote_number ? ` — réf. devis ${quote.quote_number}` : ""}`;
      lines = [proportionalSliceLineFromQuote(prepBillingSliceBase, label, sliceTtc)];
      metaJson = {
        ...buildMetadataQuoteBilling("DEPOSIT", billingBase, {
          deposit_ttc_planned:
            deposit_display && String(deposit_display.mode || "").toUpperCase() === "PERCENT"
              ? roundMoney2((prepRefTtc * Math.min(100, Number(deposit_display.percent || 0))) / 100)
              : deposit_display && String(deposit_display.mode || "").toUpperCase() === "AMOUNT"
                ? roundMoney2(Number(deposit_display.amount_ttc) || 0)
                : sliceTtc,
          deposit_mode: deposit_display?.mode ?? (requestedOpt != null ? "FREE" : "CUSTOM"),
          billing_amount_requested_ttc: requestedOpt,
          billing_total_locked_at: billingTotals.locked_at ?? null,
          billing_total_was_locked_before: Boolean(billingTotals.was_locked_before),
        }),
        prepared_total_ttc_reference: prepRefTtc,
        prepared_total_ht_reference: prepRefHt,
        prepared_total_vat_reference: prepRefVat,
      };
    } else if (billingRole === "BALANCE") {
      const depositsIssued = await sumQuoteDepositTtcIssued(client, quoteId, organizationId);
      const balanceDue = roundMoney2(Math.max(0, quoteTtc - depositsIssued));
      if (balanceDue <= 0.02) {
        throw new Error("Rien à facturer : le devis est déjà couvert par les factures existantes.");
      }
      const sliceTtc = balanceDue;
      if (sliceTtc < 0.01) {
        throw new Error("Montant de solde nul ou non utilisable.");
      }
      if (reservedTtc + sliceTtc > quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Impossible : cette facture ferait dépasser le total devis (plafond ${quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC} € TTC avec tolérance).`
        );
      }
      const label = `Solde du montant préparé${quote.quote_number ? ` — réf. devis ${quote.quote_number}` : ""}`;
      lines = [proportionalSliceLineFromQuote(billingBase, label, sliceTtc)];
      metaJson = buildMetadataQuoteBilling("BALANCE", billingBase, {
        balance_ttc: sliceTtc,
        deposits_issued_ttc: depositsIssued,
        prepared_total_ttc: preparedTotalOpt,
        billing_total_locked_at: billingTotals.locked_at ?? null,
        billing_total_was_locked_before: Boolean(billingTotals.was_locked_before),
      });
    }

    const draftNum = `DRAFT-INV-${Date.now()}`;
    const issueDate = new Date().toISOString().slice(0, 10);
    const defaultDueDays = await getOrganizationDefaultInvoiceDueDays(client, organizationId);
    const dueDate = resolveInvoiceDueDate({
      explicitDueDate: null,
      issueDate,
      defaultDueDays,
    });
    const ins = await client.query(
      `INSERT INTO invoices (
        organization_id, client_id, lead_id, quote_id, invoice_number, status,
        total_ht, total_vat, total_ttc, total_paid, total_credited, amount_due,
        due_date, notes, payment_terms, issue_date, metadata_json, currency
      ) VALUES ($1,$2,$3,$4,$5,'DRAFT',0,0,0,0,0,0,$6,$7,NULL,$8, COALESCE($9::jsonb, '{}'::jsonb), COALESCE($10, 'EUR'))
      RETURNING id`,
      [
        organizationId,
        invoiceClientId,
        invoiceLeadId,
        quoteId,
        draftNum,
        dueDate,
        notesForInvoice,
        issueDate,
        JSON.stringify(metaJson),
        quote.currency || "EUR",
      ]
    );
    const invoiceId = ins.rows[0].id;

    await replaceInvoiceLines(client, organizationId, invoiceId, lines);
    await recalcInvoiceTotals(client, organizationId, invoiceId);
    if (billingRole === "DEPOSIT" && depositPrepRefTtcAssert != null) {
      const tr = await client.query(
        `SELECT total_ttc FROM invoices WHERE id = $1 AND organization_id = $2`,
        [invoiceId, organizationId]
      );
      const invTtc = roundMoney2(Number(tr.rows[0]?.total_ttc) || 0);
      if (invTtc > depositPrepRefTtcAssert + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error("Incohérence : le total TTC de la facture dépasse la base de préparation.");
      }
    }
    if (billingRole === "STANDARD" && standardSource === "snapshot" && standardSnapshotTotals) {
      const totalsCheck = await client.query(
        `SELECT
           COALESCE(SUM(total_line_ht), 0)::numeric AS recomputed_total_ht,
           COALESCE(SUM(total_line_vat), 0)::numeric AS recomputed_total_vat,
           COALESCE(SUM(total_line_ttc), 0)::numeric AS recomputed_total_ttc
         FROM invoice_lines
         WHERE invoice_id = $1 AND organization_id = $2`,
        [invoiceId, organizationId]
      );
      const recomputedTotals = {
        total_ht: roundMoney2(Number(totalsCheck.rows[0]?.recomputed_total_ht) || 0),
        total_vat: roundMoney2(Number(totalsCheck.rows[0]?.recomputed_total_vat) || 0),
        total_ttc: roundMoney2(Number(totalsCheck.rows[0]?.recomputed_total_ttc) || 0),
      };
      const snapshotTotals = {
        total_ht: roundMoney2(Number(standardSnapshotTotals.total_ht) || 0),
        total_vat: roundMoney2(Number(standardSnapshotTotals.total_vat) || 0),
        total_ttc: roundMoney2(Number(standardSnapshotTotals.total_ttc) || 0),
      };
      const snapshotMatchesRecomputed =
        Math.abs(recomputedTotals.total_ht - snapshotTotals.total_ht) <= 0.01 &&
        Math.abs(recomputedTotals.total_vat - snapshotTotals.total_vat) <= 0.01 &&
        Math.abs(recomputedTotals.total_ttc - snapshotTotals.total_ttc) <= 0.01;
      if (!snapshotMatchesRecomputed) {
        console.warn("[invoices] invoice_snapshot_mismatch", {
          event: "invoice_snapshot_mismatch",
          quote_id: quoteId,
          snapshot_totals: snapshotTotals,
          recomputed_totals: recomputedTotals,
        });
      }
      if (!snapshotMatchesRecomputed) {
        // Snapshot non aligné: on garde les totaux recalculés depuis les lignes.
      } else {
      const forcedHt = roundMoney2(Number(standardSnapshotTotals.total_ht) || 0);
      const forcedVat = roundMoney2(Number(standardSnapshotTotals.total_vat) || 0);
      const forcedTtc = snapshotTotals.total_ttc;
      await client.query(
        `UPDATE invoices
         SET total_ht = $1,
             total_vat = $2,
             total_ttc = $3,
             amount_due = GREATEST(
               0,
               round(($3::numeric - COALESCE(total_paid, 0) - COALESCE(total_credited, 0))::numeric, 2)
             ),
             updated_at = now()
         WHERE id = $4 AND organization_id = $5`,
        [forcedHt, forcedVat, forcedTtc, invoiceId, organizationId]
      );
      }
    }
    if (billingRole === "STANDARD") {
      const fullSum = await sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId);
      if (fullSum > standardCapTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Montant total des factures liées au devis (${fullSum} € TTC) dépasse le total du devis (${standardCapTtc} €) au-delà de la tolérance autorisée (${QUOTE_INVOICE_SUM_TOLERANCE_TTC} €).`
        );
      }
    } else {
      const capTtc =
        billingRole === "DEPOSIT" && prepBillingSliceBase
          ? prepBillingSliceBase.total_ttc
          : quoteTtc;
      const linkedSum = await sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId);
      if (linkedSum > capTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Montant total des factures liées au devis (${linkedSum} € TTC) dépasse la préparation validée (${capTtc} €).`
        );
      }
    }

    return invoiceId;
  });
  return getInvoiceDetail(newInvoiceId, organizationId);
}

/**
 * Flux transactionnel unique pour STANDARD préparé:
 * préparation validée -> lock billing_total si absent -> création facture DRAFT.
 * @param {string} quoteId
 * @param {string} organizationId
 * @param {{ preparedLines: Array<object>, preparedTotals?: { total_ht?: number, total_vat?: number, total_ttc?: number } }} options
 */
export async function createPreparedStandardInvoiceFromQuote(quoteId, organizationId, options = {}) {
  const preparedLinesRaw = Array.isArray(options.preparedLines ?? options.prepared_lines)
    ? options.preparedLines ?? options.prepared_lines
    : [];
  if (preparedLinesRaw.length < 1) {
    throw new Error("Préparation invalide : au moins une ligne est requise.");
  }

  const preparedLines = preparedLinesRaw.map((line, idx) => {
    const label = String(line?.label ?? line?.description ?? `Ligne ${idx + 1}`).trim();
    const description = String(line?.description ?? line?.label ?? label).trim();
    const quantity = Number(line?.quantity);
    const unitPriceHt = Number(line?.unit_price_ht);
    const discountHt = Number(line?.discount_ht ?? 0);
    const vatRate = Number(line?.vat_rate ?? line?.tva_percent ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceHt) || !Number.isFinite(discountHt) || !Number.isFinite(vatRate)) {
      throw new Error("Préparation invalide : une ligne contient des montants non numériques.");
    }
    return {
      label: label || description || `Ligne ${idx + 1}`,
      description: description || label || `Ligne ${idx + 1}`,
      quantity,
      unit_price_ht: unitPriceHt,
      discount_ht: discountHt,
      vat_rate: vatRate,
      snapshot_json: {
        ...(line?.snapshot_json && typeof line.snapshot_json === "object" && !Array.isArray(line.snapshot_json)
          ? line.snapshot_json
          : {}),
        invoice_preparation_source: "prepared_standard",
      },
    };
  });

  const preparedTotals = preparedLines.reduce(
    (acc, line) => {
      const db = computeFinancialLineDbFields({
        quantity: line.quantity,
        unit_price_ht: line.unit_price_ht,
        discount_ht: line.discount_ht,
        vat_rate: line.vat_rate,
      });
      acc.total_ht = roundMoney2(acc.total_ht + db.total_line_ht);
      acc.total_vat = roundMoney2(acc.total_vat + db.total_line_vat);
      acc.total_ttc = roundMoney2(acc.total_ttc + db.total_line_ttc);
      return acc;
    },
    { total_ht: 0, total_vat: 0, total_ttc: 0 }
  );
  if (!Number.isFinite(preparedTotals.total_ttc) || preparedTotals.total_ttc <= 0.0001) {
    throw new Error("Préparation invalide : total TTC strictement positif requis.");
  }

  const newInvoiceId = await withTx(pool, async (client) => {
    const qres = await client.query(
      `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
      [quoteId, organizationId]
    );
    if (qres.rows.length === 0) throw new Error("Devis non trouvé");
    const quote = qres.rows[0];
    if (String(quote.status).toUpperCase() !== "ACCEPTED") {
      throw new Error("Le devis doit être accepté pour générer une facture");
    }

    const reservedTtc = await sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId);
    if (reservedTtc > 0.02) {
      throw new Error(
        "Une facture ou un brouillon existe déjà pour ce devis. Utilisez acompte / solde ou supprimez les brouillons inutiles."
      );
    }

    const resolvedClientId = await ensureClientForQuote(client, quote, organizationId);
    quote.client_id = resolvedClientId;
    const invoiceLeadId =
      quote.lead_id != null && String(quote.lead_id).trim() !== "" ? String(quote.lead_id) : null;
    const billingTotals = await resolveOrLockQuoteBillingTotals(client, quote, preparedTotals);
    const billingBase = {
      ...quote,
      total_ht: billingTotals.total_ht,
      total_vat: billingTotals.total_vat,
      total_ttc: billingTotals.total_ttc,
    };
    const metaJson = buildMetadataQuoteBilling("STANDARD", billingBase, {
      prepared_total_ht: preparedTotals.total_ht,
      prepared_total_vat: preparedTotals.total_vat,
      prepared_total_ttc: preparedTotals.total_ttc,
      billing_total_locked_at: billingTotals.locked_at ?? null,
      billing_total_was_locked_before: Boolean(billingTotals.was_locked_before),
      invoice_preparation_source: "prepared_lines",
    });

    const draftNum = `DRAFT-INV-${Date.now()}`;
    const issueDate = new Date().toISOString().slice(0, 10);
    const defaultDueDays = await getOrganizationDefaultInvoiceDueDays(client, organizationId);
    const dueDate = resolveInvoiceDueDate({
      explicitDueDate: null,
      issueDate,
      defaultDueDays,
    });
    const ins = await client.query(
      `INSERT INTO invoices (
        organization_id, client_id, lead_id, quote_id, invoice_number, status,
        total_ht, total_vat, total_ttc, total_paid, total_credited, amount_due,
        due_date, notes, payment_terms, issue_date, metadata_json, currency
      ) VALUES ($1,$2,$3,$4,$5,'DRAFT',0,0,0,0,0,0,$6,$7,NULL,$8, COALESCE($9::jsonb, '{}'::jsonb), COALESCE($10, 'EUR'))
      RETURNING id`,
      [
        organizationId,
        String(resolvedClientId),
        invoiceLeadId,
        quoteId,
        draftNum,
        dueDate,
        quote.notes ?? null,
        issueDate,
        JSON.stringify(metaJson),
        quote.currency || "EUR",
      ]
    );
    const invoiceId = ins.rows[0].id;
    await replaceInvoiceLines(client, organizationId, invoiceId, preparedLines);
    await recalcInvoiceTotals(client, organizationId, invoiceId);

    const fullSum = await sumQuoteInvoiceTtcNonCancelled(client, quoteId, organizationId);
    if (fullSum > billingTotals.total_ttc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
      throw new Error(
        `Montant total des factures liées au devis (${fullSum} € TTC) dépasse la préparation validée (${billingTotals.total_ttc} €).`
      );
    }
    return invoiceId;
  });

  return getInvoiceDetail(newInvoiceId, organizationId);
}

/**
 * Duplique une facture (brouillon indépendant, sans lien devis).
 * @param {string} invoiceId
 * @param {string} organizationId
 */
export async function duplicateInvoice(invoiceId, organizationId) {
  const inv = await getInvoiceDetail(invoiceId, organizationId);
  if (!inv) {
    const err = new Error("Facture non trouvée");
    err.statusCode = 404;
    throw err;
  }
  const lines = (inv.lines || []).map((row) => ({
    label: row.label ?? row.description,
    description: row.description ?? row.label ?? "",
    quantity: row.quantity,
    unit_price_ht: row.unit_price_ht,
    discount_ht: row.discount_ht ?? 0,
    vat_rate: row.vat_rate,
    snapshot_json: row.snapshot_json,
  }));
  const rawMeta = inv.metadata_json;
  const meta =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? { ...rawMeta } : {};
  meta.duplicated_from_invoice_id = inv.id;
  let dupClient = inv.client_id || null;
  let dupLead = inv.lead_id || null;
  if (dupClient && dupLead) dupLead = null;
  return createInvoice(organizationId, {
    client_id: dupClient,
    lead_id: dupLead,
    quote_id: null,
    due_date: inv.due_date,
    notes: inv.notes,
    payment_terms: inv.payment_terms ?? null,
    issue_date: new Date().toISOString().slice(0, 10),
    lines,
    currency: inv.currency || "EUR",
    metadata_json: meta,
  });
}

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 * @param {string|null} userId
 */
export async function generateInvoicePdfRecord(invoiceId, organizationId, userId) {
  const r = await pool.query(
    "SELECT invoice_number, document_snapshot_json, status, client_id, lead_id FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Facture non trouvée");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  const snapRaw = row.document_snapshot_json;
  if (snapRaw == null || (typeof snapRaw === "object" && snapRaw !== null && Object.keys(snapRaw).length === 0)) {
    const err = new Error(
      "PDF impossible : le document doit être émis (statut ISSUED) avant génération — aucun snapshot documentaire figé."
    );
    err.statusCode = 400;
    throw err;
  }
  const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
  const pdfPayload = buildInvoicePdfPayloadFromSnapshot(snapshot);
  const num = row.invoice_number || invoiceId;
  const fileName = `${String(num).trim()}.pdf`;

  const renderToken = createFinancialInvoiceRenderToken(invoiceId, organizationId);
  const rendererUrl = buildFinancialInvoiceRendererUrl(invoiceId, renderToken);
  const pdfBuffer = await generatePdfFromFinancialInvoiceUrlWithFooter(rendererUrl, num);

  const existingMain = await findExistingInvoicePdfForInvoiceEntity(organizationId, invoiceId);
  const replacedMain = Boolean(existingMain);
  await removeInvoicePdfDocuments(organizationId, invoiceId);
  const doc = await saveInvoicePdfDocument(pdfBuffer, organizationId, invoiceId, userId, {
    fileName,
    invoiceNumber: row.invoice_number ?? null,
    metadata: {
      source: "document_snapshot_json",
      snapshot_checksum: pdfPayload.snapshot_checksum,
      business_document_type: "INVOICE_PDF",
      linked_entity_type: "invoice",
      linked_entity_id: String(invoiceId),
    },
  });

  const ownerEntityType = row.client_id ? "client" : row.lead_id ? "lead" : null;
  const ownerEntityId = row.client_id || row.lead_id || null;
  let ownerMirrorReplaced = false;
  let ownerDocId = null;
  let ownerDocFileName = null;
  if (ownerEntityType && ownerEntityId) {
    const ownerDoc = await saveInvoicePdfOnOwnerDocument(
      pdfBuffer,
      organizationId,
      ownerEntityType,
      ownerEntityId,
      invoiceId,
      userId,
      {
        fileName,
        invoiceNumber: row.invoice_number ?? null,
        metadata: {
          source: "invoice_pdf_mirror",
          linked_entity_type: "invoice",
          linked_entity_id: String(invoiceId),
        },
      }
    );
    ownerMirrorReplaced = ownerDoc?.replaced === true;
    ownerDocId = ownerDoc?.id || null;
    ownerDocFileName = ownerDoc?.file_name || null;
  }

  return {
    document: doc,
    fileName,
    pdf_payload: pdfPayload,
    downloadUrl: `/api/documents/${doc.id}/download`,
    replaced: replacedMain || ownerMirrorReplaced,
    observability: {
      invoice_id: String(invoiceId),
      invoice_number: row.invoice_number ?? null,
      main_document: {
        id: doc?.id ?? null,
        file_name: doc?.file_name ?? null,
        replaced: replacedMain,
      },
      mirror: {
        entity_type: ownerEntityType,
        entity_id: ownerEntityId,
        document_id: ownerDocId,
        file_name: ownerDocFileName,
        replaced: ownerMirrorReplaced,
      },
    },
    message: "PDF facture généré et enregistré (rendu client depuis le snapshot figé, paiements à jour).",
  };
}

/**
 * Snapshot documentaire officiel (lecture seule).
 */
export async function getInvoiceDocumentSnapshot(invoiceId, organizationId) {
  const r = await pool.query(
    `SELECT document_snapshot_json FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) return null;
  const s = r.rows[0].document_snapshot_json;
  if (s == null) return null;
  return typeof s === "string" ? JSON.parse(s) : s;
}

/**
 * Suppression physique — refusée pour factures d'acompte / solde liées au workflow devis.
 * @param {string} invoiceId
 * @param {string} organizationId
 */
export async function deleteInvoiceHard(invoiceId, organizationId) {
  const r = await pool.query(
    `SELECT id, quote_id, metadata_json FROM invoices
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Facture non trouvée");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  const meta = row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {};
  const role = String(meta.quote_billing_role ?? "").toUpperCase();
  if (row.quote_id && (role === "DEPOSIT" || role === "BALANCE")) {
    const err = new Error(
      "Suppression interdite : les factures d'acompte et de solde liées au devis ne peuvent pas être supprimées (traçabilité du workflow). Annulez la facture ou utilisez un avoir si applicable."
    );
    err.statusCode = 403;
    throw err;
  }
  await pool.query(`DELETE FROM invoices WHERE id = $1 AND organization_id = $2`, [invoiceId, organizationId]);
}
