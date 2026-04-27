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
  generatePdfFromFinancialInvoiceUrl,
} from "./pdfGeneration.service.js";
import { removeInvoicePdfDocuments, saveInvoicePdfDocument } from "./documents.service.js";
import { ensureClientForQuote } from "./ensureClientForQuote.service.js";

/** Tolérance TTC (€) : somme des factures liées au devis (hors annulées, brouillons inclus) ne doit pas dépasser total devis + cette marge. */
const QUOTE_INVOICE_SUM_TOLERANCE_TTC = 5;

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
            ld.first_name AS lead_first_name, ld.last_name AS lead_last_name, ld.email AS lead_email
     FROM invoices i
     LEFT JOIN clients c ON c.id = i.client_id
     LEFT JOIN leads ld ON ld.id = i.lead_id AND ld.organization_id = i.organization_id AND (ld.archived_at IS NULL)
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
    const q = await pool.query(`SELECT id, quote_number, status, total_ht, total_vat, total_ttc, valid_until, currency FROM quotes WHERE id = $1 AND organization_id = $2`, [
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
        due_date,
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

/**
 * @param {string} invoiceId
 * @param {string} organizationId
 * @param {object} body
 */
export async function updateInvoice(invoiceId, organizationId, body) {
  return withTx(pool, async (client) => {
    const row = await assertOrgEntity(client, "invoices", invoiceId, organizationId);
    if (!isInvoiceEditable(row.status)) {
      throw new Error("Modification interdite : facture déjà émise ou soldée");
    }

    const { lines, client_id, lead_id, quote_id, due_date, notes, payment_terms, issue_date, metadata_json, currency } = body;

    if (row.quote_id) {
      const norm = (v) => (v != null && String(v).trim() !== "" ? String(v) : null);
      if (client_id !== undefined && norm(client_id) !== norm(row.client_id)) {
        throw new Error("Le rattachement client ne peut pas être modifié pour une facture liée à un devis.");
      }
      if (lead_id !== undefined && norm(lead_id) !== norm(row.lead_id)) {
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

    const qRow = await client.query(`SELECT quote_id FROM invoices WHERE id = $1`, [invoiceId]);
    const qid = qRow.rows[0]?.quote_id;
    if (qid) await assertQuoteLinkedInvoicesWithinCap(client, qid, organizationId);
  });
  return getInvoiceDetail(invoiceId, organizationId);
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
export async function patchInvoiceStatus(invoiceId, organizationId, newStatusRaw, userId = null) {
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
      if (paid > 0 || cred > 0) {
        throw new Error("Annulation impossible : paiements ou avoirs enregistrés");
      }
      await client.query(`UPDATE invoices SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [invoiceId]);
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
    `SELECT COALESCE(total_ttc, 0)::numeric AS ttc FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (q.rows.length === 0) return;
  const quoteTtc = roundMoney2(Number(q.rows[0]?.ttc) || 0);

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
  if (ttc <= 0.0001) throw new Error("Total TTC du devis invalide ou nul");
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

/**
 * Contexte facturation pour un devis (acompte / solde / complète).
 * @param {string} quoteId
 * @param {string} organizationId
 */
export async function getQuoteInvoiceBillingContext(quoteId, organizationId) {
  const qres = await pool.query(
    `SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (qres.rows.length === 0) return null;
  const quote = qres.rows[0];
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
  const quoteTtc = roundMoney2(Number(quote.total_ttc) || 0);
  const remaining = roundMoney2(quoteTtc - invoicedCommitted);
  const quoteZeroTotal = quoteTtc <= 0.0001;

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
    quote_zero_total: quoteZeroTotal,
    /** TTC engagé sur le devis (brouillons inclus, hors annulées) — pour « déjà facturé / réservé ». */
    invoiced_ttc: invoicedCommitted,
    /** TTC factures émises (hors brouillon / annulée). */
    invoiced_issued_ttc: invoicedIssuedOnly,
    remaining_ttc: remaining,
    has_structured_deposit: !!deposit_display,
    deposit_ttc: deposit_display ? roundMoney2(Number(deposit_display.amount_ttc) || 0) : null,
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
 *   DEPOSIT : priorité à `billingAmountTtc` (acompte libre) ; sinon acompte structuré sur le devis ; sinon erreur « Veuillez saisir un montant d'acompte ».
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
    const quoteTtc = roundMoney2(Number(quote.total_ttc) || 0);
    const remainingBefore = roundMoney2(quoteTtc - reservedTtc);

    const rawAmt = options.billingAmountTtc ?? options.billing_amount_ttc;
    const requestedOpt =
      rawAmt != null && rawAmt !== "" ? roundMoney2(Number(rawAmt)) : null;
    if (requestedOpt != null && !Number.isFinite(requestedOpt)) {
      throw new Error("Montant (billing_amount_ttc) invalide.");
    }

    if (quoteTtc <= 0.0001 && (billingRole === "DEPOSIT" || billingRole === "BALANCE")) {
      throw new Error(
        "Facturation d'acompte ou de solde impossible : le total TTC du devis est nul ou non significatif."
      );
    }

    let lines = [];
    let metaJson = {};

    if (billingRole === "STANDARD") {
      if (reservedTtc > 0.02) {
        throw new Error(
          "Une facture ou un brouillon existe déjà pour ce devis. Utilisez acompte / solde ou supprimez les brouillons inutiles."
        );
      }
      const linesRes = await client.query(
        `SELECT label, description, quantity, unit_price_ht, discount_ht, vat_rate, snapshot_json
         FROM quote_lines WHERE quote_id = $1 AND organization_id = $2 AND (is_active IS DISTINCT FROM false)
         ORDER BY position`,
        [quoteId, organizationId]
      );
      lines = linesRes.rows.map((row) => ({
        label: row.label,
        description: row.description || row.label || "",
        quantity: row.quantity,
        unit_price_ht: row.unit_price_ht,
        discount_ht: row.discount_ht ?? 0,
        vat_rate: row.vat_rate,
        snapshot_json: row.snapshot_json,
      }));
      if (lines.length < 1) throw new Error("Le devis n'a pas de lignes à facturer");
      metaJson = buildMetadataQuoteBilling("STANDARD", quote);
    } else if (billingRole === "DEPOSIT") {
      if (remainingBefore <= 0.02) {
        throw new Error(
          "Rien à facturer : le devis est déjà couvert par les factures existantes (y compris brouillons)."
        );
      }
      let sliceTtc;
      if (requestedOpt != null && requestedOpt >= 0.01) {
        sliceTtc = roundMoney2(Math.min(requestedOpt, remainingBefore));
      } else if (deposit_display) {
        const depTtc = roundMoney2(Number(deposit_display.amount_ttc) || 0);
        sliceTtc = roundMoney2(Math.min(Math.max(0, depTtc), remainingBefore));
      } else {
        throw new Error("Veuillez saisir un montant d'acompte");
      }
      if (sliceTtc < 0.01) {
        throw new Error("Montant d'acompte nul ou supérieur au reste à facturer.");
      }
      if (reservedTtc + sliceTtc > quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Impossible : cette facture ferait dépasser le total devis (plafond ${quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC} € TTC avec tolérance).`
        );
      }
      const label = `Acompte sur devis ${quote.quote_number || String(quoteId).slice(0, 8)}`;
      lines = [proportionalSliceLineFromQuote(quote, label, sliceTtc)];
      metaJson = buildMetadataQuoteBilling("DEPOSIT", quote, {
        deposit_ttc_planned: deposit_display ? roundMoney2(Number(deposit_display.amount_ttc) || 0) : sliceTtc,
        deposit_mode: deposit_display?.mode ?? (requestedOpt != null ? "FREE" : "CUSTOM"),
        billing_amount_requested_ttc: requestedOpt,
      });
    } else if (billingRole === "BALANCE") {
      if (remainingBefore <= 0.02) {
        throw new Error("Rien à facturer : le devis est déjà couvert par les factures existantes.");
      }
      const sliceTtc = roundMoney2(Math.max(0, remainingBefore));
      if (sliceTtc < 0.01) {
        throw new Error("Montant de solde nul ou non utilisable.");
      }
      if (reservedTtc + sliceTtc > quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC) {
        throw new Error(
          `Impossible : cette facture ferait dépasser le total devis (plafond ${quoteTtc + QUOTE_INVOICE_SUM_TOLERANCE_TTC} € TTC avec tolérance).`
        );
      }
      const label = `Solde sur devis ${quote.quote_number || String(quoteId).slice(0, 8)}`;
      lines = [proportionalSliceLineFromQuote(quote, label, sliceTtc)];
      metaJson = buildMetadataQuoteBilling("BALANCE", quote, {
        balance_ttc: sliceTtc,
        invoiced_before_ttc: reservedTtc,
      });
    }

    const draftNum = `DRAFT-INV-${Date.now()}`;
    const ins = await client.query(
      `INSERT INTO invoices (
        organization_id, client_id, lead_id, quote_id, invoice_number, status,
        total_ht, total_vat, total_ttc, total_paid, total_credited, amount_due,
        due_date, notes, payment_terms, issue_date, metadata_json, currency
      ) VALUES ($1,$2,$3,$4,$5,'DRAFT',0,0,0,0,0,0,NULL,$6,NULL,CURRENT_DATE, COALESCE($7::jsonb, '{}'::jsonb), COALESCE($8, 'EUR'))
      RETURNING id`,
      [
        organizationId,
        invoiceClientId,
        invoiceLeadId,
        quoteId,
        draftNum,
        quote.notes ?? null,
        JSON.stringify(metaJson),
        quote.currency || "EUR",
      ]
    );
    const invoiceId = ins.rows[0].id;

    await replaceInvoiceLines(client, organizationId, invoiceId, lines);
    await recalcInvoiceTotals(client, organizationId, invoiceId);
    await assertQuoteLinkedInvoicesWithinCap(client, quoteId, organizationId, invoiceId);

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
    "SELECT invoice_number, document_snapshot_json, status FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
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

  const renderToken = createFinancialInvoiceRenderToken(invoiceId, organizationId);
  const rendererUrl = buildFinancialInvoiceRendererUrl(invoiceId, renderToken);
  const pdfBuffer = await generatePdfFromFinancialInvoiceUrl(rendererUrl);

  await removeInvoicePdfDocuments(organizationId, invoiceId);
  const doc = await saveInvoicePdfDocument(pdfBuffer, organizationId, invoiceId, userId, {
    fileName: `facture-${num}.pdf`,
    invoiceNumber: row.invoice_number ?? null,
    metadata: {
      source: "document_snapshot_json",
      snapshot_checksum: pdfPayload.snapshot_checksum,
      business_document_type: "INVOICE_PDF",
    },
  });

  return {
    document: doc,
    pdf_payload: pdfPayload,
    downloadUrl: `/api/documents/${doc.id}/download`,
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
