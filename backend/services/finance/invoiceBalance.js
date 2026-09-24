/**
 * Soldes facture — aligné sur les triggers PostgreSQL (sg_recompute_invoice_total_paid) :
 * - total_paid : somme des paiements avec status NULL ou 'RECORDED'
 * - total_credited : somme des total_ttc des avoirs ISSUED non archivés
 * - amount_due = max(0, round2(total_ttc - total_paid - total_credited))
 */

import { MONEY_EPSILON, roundMoney2, toFiniteNumber } from "./moneyRounding.js";

/**
 * @typedef {object} InvoiceBalanceInput
 * @property {unknown} total_ttc
 * @property {unknown} total_paid
 * @property {unknown} total_credited
 */

/**
 * @param {InvoiceBalanceInput} inv
 */
export function computeInvoiceAmountDue(inv) {
  return computeInvoiceBalance(inv).amount_due;
}

/**
 * Même formule que la base ; utile pour prévisualisation côté service sans relire la facture.
 * @param {InvoiceBalanceInput} inv
 */
export function computeInvoiceBalance(inv) {
  const totalTtc = roundMoney2(toFiniteNumber(inv?.total_ttc));
  const totalPaid = roundMoney2(toFiniteNumber(inv?.total_paid));
  const totalCredited = roundMoney2(toFiniteNumber(inv?.total_credited));
  const amountDue = roundMoney2(Math.max(0, totalTtc - totalPaid - totalCredited));
  return {
    total_ttc: totalTtc,
    total_paid: totalPaid,
    total_credited: totalCredited,
    amount_due: amountDue,
  };
}

/**
 * Reads the existing financial records, not the invoice's cached movement totals.
 * Caller supplies its transaction client. This read does not acquire a lock: a
 * caller using it to authorize a write must already hold the invoice FOR UPDATE.
 * Returns the invoice row with normalized live balance fields, or null.
 */
export async function readInvoiceFinancialBalance(client, { invoiceId, organizationId }) {
  const result = await client.query(
    `SELECT i.*,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.invoice_id = i.id AND p.organization_id = i.organization_id
          AND (p.status IS NULL OR p.status = 'RECORDED')) AS recorded_payments_total,
       (SELECT COALESCE(SUM(cn.total_ttc), 0) FROM credit_notes cn
        WHERE cn.invoice_id = i.id AND cn.organization_id = i.organization_id
          AND cn.status = 'ISSUED' AND cn.archived_at IS NULL) AS issued_credits_total
     FROM invoices i
     WHERE i.id = $1 AND i.organization_id = $2 AND i.archived_at IS NULL`,
    [invoiceId, organizationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const { recorded_payments_total, issued_credits_total, ...invoice } = row;
  return {
    ...invoice,
    ...computeInvoiceBalance({ ...invoice, total_paid: recorded_payments_total, total_credited: issued_credits_total }),
  };
}

/**
 * Refreshes the existing cached totals and status in the caller's transaction.
 * The lock must be a separate statement before reading aggregates: after waiting
 * for a competing writer, READ COMMITTED must take a fresh statement snapshot.
 * Every payment/credit mutation must hold this same invoice lock until COMMIT.
 */
export async function refreshInvoiceFinancialBalance(client, { invoiceId, organizationId }) {
  const locked = await client.query(
    `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL FOR UPDATE`,
    [invoiceId, organizationId]
  );
  if (!locked.rows[0]) return null;
  const invoice = await readInvoiceFinancialBalance(client, { invoiceId, organizationId });
  if (!invoice) return null;
  const status = suggestInvoiceStatusFromAmounts(invoice);
  const result = await client.query(
    `UPDATE invoices SET total_paid = $3, total_credited = $4, amount_due = $5,
       status = $6, paid_at = CASE WHEN $6 = 'PAID' THEN COALESCE(paid_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL RETURNING *`,
    [invoiceId, organizationId, invoice.total_paid, invoice.total_credited, invoice.amount_due, status]
  );
  const row = result.rows[0];
  return row ? { ...row, ...computeInvoiceBalance(row) } : null;
}

/**
 * Agrège des paiements (lignes DB ou objets { amount, status }).
 * @param {Array<{ amount?: unknown, status?: unknown }>} payments
 */
export function summarizeInvoicePayments(payments) {
  let sum = 0;
  for (const p of payments || []) {
    const st = p?.status;
    if (st != null && st !== "" && String(st).toUpperCase() !== "RECORDED") continue;
    sum = roundMoney2(sum + roundMoney2(toFiniteNumber(p?.amount)));
  }
  return { total_paid: sum };
}

/**
 * Avoirs : uniquement ISSUED et non archivés (archived_at null).
 * @param {Array<{ total_ttc?: unknown, status?: unknown, archived_at?: unknown }>} creditNotes
 */
export function summarizeInvoiceCredits(creditNotes) {
  let sum = 0;
  for (const cn of creditNotes || []) {
    if (String(cn?.status || "").toUpperCase() !== "ISSUED") continue;
    if (cn?.archived_at != null) continue;
    sum = roundMoney2(sum + roundMoney2(toFiniteNumber(cn?.total_ttc)));
  }
  return { total_credited: sum };
}

/**
 * Déduit un statut métier cohérent avec les montants (sans forcer CANCELLED — passer status explicite).
 *
 * Règles :
 * - CANCELLED → reste CANCELLED
 * - DRAFT → DRAFT
 * - Sinon : si amount_due <= epsilon → PAID ; si encaissements/avoirs > 0 et solde > epsilon → PARTIALLY_PAID ;
 *   sinon → ISSUED
 *
 * @param {{ status?: unknown, total_ttc?: unknown, total_paid?: unknown, total_credited?: unknown }} invoiceLike
 * @returns {string}
 */
export function suggestInvoiceStatusFromAmounts(invoiceLike) {
  const st = String(invoiceLike?.status || "").toUpperCase();
  if (st === "CANCELLED") return "CANCELLED";
  if (st === "DRAFT") return "DRAFT";

  const b = computeInvoiceBalance(invoiceLike);
  if (b.amount_due <= MONEY_EPSILON) return "PAID";

  const hasMovement =
    roundMoney2(toFiniteNumber(invoiceLike?.total_paid)) > MONEY_EPSILON ||
    roundMoney2(toFiniteNumber(invoiceLike?.total_credited)) > MONEY_EPSILON;

  if (hasMovement && b.amount_due > MONEY_EPSILON) return "PARTIALLY_PAID";
  return "ISSUED";
}

/**
 * Valide les entrées métier d'un paiement avant persistance.
 * @param {{ amount?: unknown, invoice_id?: unknown, status?: unknown }} input
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePaymentInput(input) {
  if (input?.invoice_id == null || String(input.invoice_id).trim() === "") {
    return { ok: false, error: "invoice_id requis" };
  }
  const amt = toFiniteNumber(input?.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: "Le montant doit être strictement positif" };
  }
  const st = input?.status != null ? String(input.status).toUpperCase() : "RECORDED";
  if (st !== "RECORDED" && st !== "CANCELLED") {
    return { ok: false, error: "Statut de paiement invalide" };
  }
  return { ok: true };
}

/**
 * Prévisualisation de l'impact sur le solde (sans écrire en base).
 * @param {InvoiceBalanceInput} currentInvoice
 * @param {{ amount: number }} newPayment — supposé RECORDED
 */
export function previewPaymentImpact(currentInvoice, newPayment) {
  const before = computeInvoiceBalance(currentInvoice);
  const add = roundMoney2(toFiniteNumber(newPayment?.amount));
  const afterPaid = roundMoney2(before.total_paid + add);
  const after = computeInvoiceBalance({
    ...currentInvoice,
    total_paid: afterPaid,
  });
  return { before, after, payment_recorded: add };
}
