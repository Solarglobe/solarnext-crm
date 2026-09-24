/**
 * Paiements facture — V1 sans allocation multi-factures.
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { readInvoiceFinancialBalance, refreshInvoiceFinancialBalance, validatePaymentInput } from "./finance/invoiceBalance.js";
import { MONEY_EPSILON, roundMoney2, toFiniteNumber } from "./finance/moneyRounding.js";

function httpError(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

const STATUTS_PAIEMENT_AUTORISES = new Set(["ISSUED", "PARTIALLY_PAID"]);

/**
 * Paiement réel uniquement sur facture émise ou partiellement payée.
 * @param {{ status?: unknown }} inv
 */
function assertInvoiceEligibleForPayment(inv) {
  const st = String(inv?.status || "").toUpperCase();
  if (st === "DRAFT") {
    throw httpError("Impossible d'enregistrer un paiement sur une facture brouillon.");
  }
  if (st === "CANCELLED") {
    throw httpError("Impossible d'enregistrer un paiement sur une facture annulée.");
  }
  if (st === "PAID") {
    throw httpError("Impossible d'enregistrer un paiement : la facture est déjà soldée.");
  }
  if (!STATUTS_PAIEMENT_AUTORISES.has(st)) {
    throw httpError("Impossible d'enregistrer un paiement sur cette facture (statut incompatible).");
  }
}

async function loadInvoiceForPayment(invoiceId, organizationId) {
  const r = await pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {object} body
 * @param {string|null} userId
 */
export async function recordPayment(organizationId, invoiceId, body) {
  const { amount, payment_date, payment_method, reference, notes } = body || {};

  const v = validatePaymentInput({ invoice_id: invoiceId, amount, status: "RECORDED" });
  if (!v.ok) throw httpError(v.error);

  const amt = roundMoney2(toFiniteNumber(amount));
  if (amt <= 0) throw httpError("Le montant doit être strictement positif après arrondi au centime");
  if (!payment_date) throw httpError("payment_date requis");

  return withTx(pool, async (client) => {
    // All payment/credit mutations take the invoice lock first. The subsequent
    // aggregate query gets a fresh snapshot after any competing writer commits.
    const locked = await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [invoiceId, organizationId]
    );
    if (!locked.rows[0]) throw httpError("Facture non trouvée", 404);
    const inv = await readInvoiceFinancialBalance(client, { invoiceId, organizationId });
    assertInvoiceEligibleForPayment(inv);
    if (amt > inv.amount_due + MONEY_EPSILON) {
      throw httpError("Le paiement dépasse le reste à payer de la facture après avoirs et paiements enregistrés");
    }
    const ins = await client.query(
      `INSERT INTO payments (
        organization_id, invoice_id, amount, payment_date, payment_method, reference, notes, status, created_at
      ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,'RECORDED', now())
      RETURNING *`,
      [organizationId, invoiceId, amt, payment_date, payment_method ?? null, reference ?? null, notes ?? null]
    );
    await refreshInvoiceFinancialBalance(client, { invoiceId, organizationId });
    return ins.rows[0];
  });
}

/**
 * @param {string} organizationId
 * @param {string} paymentId
 * @param {string|null} userId
 */
export async function cancelPayment(organizationId, paymentId, userId = null) {
  return withTx(pool, async (client) => {
    const initial = await client.query(
      `SELECT invoice_id FROM payments WHERE id = $1 AND organization_id = $2`,
      [paymentId, organizationId]
    );
    const invoiceId = initial.rows[0]?.invoice_id;
    if (!invoiceId) throw httpError("Paiement non trouvé", 404);
    const locked = await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [invoiceId, organizationId]
    );
    if (!locked.rows[0]) throw httpError("Facture non trouvée", 404);
    const r = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [paymentId, organizationId]
    );
    const p = r.rows[0];
    if (!p || p.invoice_id !== invoiceId) throw httpError("Paiement non trouvé", 404);
    if (String(p.status).toUpperCase() !== "RECORDED") {
      throw httpError("Seul un paiement enregistré peut être annulé");
    }
    const result = await client.query(
      `UPDATE payments SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, updated_at = now()
       WHERE id = $1 AND organization_id = $3 RETURNING *`,
      [paymentId, userId ?? null, organizationId]
    );
    await refreshInvoiceFinancialBalance(client, { invoiceId, organizationId });
    return result.rows[0];
  });
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 */
export async function listPaymentsForInvoice(organizationId, invoiceId) {
  const inv = await loadInvoiceForPayment(invoiceId, organizationId);
  if (!inv) return null;

  const r = await pool.query(
    `SELECT payment_date, amount, payment_method, reference, status, id, created_at, cancelled_at
     FROM payments WHERE invoice_id = $1 AND organization_id = $2
     ORDER BY payment_date ASC, created_at ASC`,
    [invoiceId, organizationId]
  );
  return r.rows;
}
