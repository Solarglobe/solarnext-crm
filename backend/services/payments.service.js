/**
 * Paiements facture — V1 sans allocation multi-factures.
 */

import { pool } from "../config/db.js";
import { validatePaymentInput } from "./finance/invoiceBalance.js";
import { MONEY_EPSILON, roundMoney2, toFiniteNumber } from "./finance/moneyRounding.js";
import { recalculateInvoiceStatusFromAmounts } from "./invoices.service.js";

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
 * Somme des paiements RECORDED pour une facture (alignée trigger).
 */
async function sumRecordedPayments(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM payments
     WHERE invoice_id = $1 AND (status IS NULL OR status = 'RECORDED')`,
    [invoiceId]
  );
  return roundMoney2(toFiniteNumber(r.rows[0]?.s));
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {object} body
 * @param {string|null} userId
 */
export async function recordPayment(organizationId, invoiceId, body) {
  const { amount, payment_date, payment_method, reference, notes } = body || {};

  const inv = await loadInvoiceForPayment(invoiceId, organizationId);
  if (!inv) throw httpError("Facture non trouvée", 404);
  assertInvoiceEligibleForPayment(inv);

  const v = validatePaymentInput({ invoice_id: invoiceId, amount, status: "RECORDED" });
  if (!v.ok) throw httpError(v.error);

  const amt = roundMoney2(toFiniteNumber(amount));
  const totalTtc = roundMoney2(toFiniteNumber(inv.total_ttc));
  const currentPaid = await sumRecordedPayments(pool, invoiceId);
  const projected = roundMoney2(currentPaid + amt);
  if (projected > totalTtc + MONEY_EPSILON) {
    throw httpError("Le paiement dépasse le montant TTC de la facture");
  }

  if (!payment_date) throw httpError("payment_date requis");

  const ins = await pool.query(
    `INSERT INTO payments (
      organization_id, invoice_id, amount, payment_date, payment_method, reference, notes, status, created_at
    ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,'RECORDED', now())
    RETURNING *`,
    [organizationId, invoiceId, amt, payment_date, payment_method ?? null, reference ?? null, notes ?? null]
  );

  await recalculateInvoiceStatusFromAmounts(invoiceId, organizationId);

  return ins.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} paymentId
 * @param {string|null} userId
 */
export async function cancelPayment(organizationId, paymentId, userId = null) {
  const r = await pool.query(
    `SELECT * FROM payments WHERE id = $1 AND organization_id = $2`,
    [paymentId, organizationId]
  );
  if (r.rows.length === 0) throw httpError("Paiement non trouvé", 404);
  const p = r.rows[0];
  if (String(p.status).toUpperCase() !== "RECORDED") {
    throw httpError("Seul un paiement enregistré peut être annulé");
  }

  await pool.query(
    `UPDATE payments SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, updated_at = now()
     WHERE id = $1`,
    [paymentId, userId ?? null]
  );

  await recalculateInvoiceStatusFromAmounts(p.invoice_id, organizationId);

  const u = await pool.query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
  return u.rows[0];
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
