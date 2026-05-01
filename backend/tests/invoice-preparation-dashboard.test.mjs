import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import "../config/register-local-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";
import { buildDashboardOverview } from "../services/dashboardOverview.service.js";

const PREFIX = `IPREP-${Date.now()}`;
let orgId;
let userId;
let clientId;
const quoteIds = [];
const invoiceIds = [];

before(async () => {
  const org = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  orgId = org.rows[0]?.id;
  assert.ok(orgId, "organization requise pour les tests");

  const user = await pool.query(
    "SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1",
    [orgId]
  );
  userId = user.rows[0]?.id;
  assert.ok(userId, "user requis pour les tests dashboard");

  const client = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Prep', 'Client', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  clientId = client.rows[0].id;
});

after(async () => {
  for (const invId of invoiceIds) {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
    await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
  }
  for (const qid of quoteIds) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
  if (clientId) await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  await pool.end();
});

async function createAcceptedQuoteWithTotals() {
  const quote = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [
      { label: "Matériel", description: "", quantity: 1, unit_price_ht: 11250, tva_rate: 0 },
      { label: "Installation", description: "", quantity: 1, unit_price_ht: 2700, tva_rate: 0 },
    ],
  });
  const quoteId = quote.quote.id;
  quoteIds.push(quoteId);
  await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "ACCEPTED", null);
  return quoteId;
}

async function createAcceptedQuoteWithPayload(payload) {
  const quote = await quoteService.createQuote(orgId, payload);
  const quoteId = quote.quote.id;
  quoteIds.push(quoteId);
  await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "ACCEPTED", null);
  return quoteId;
}

test("STANDARD préparé 13 950 -> 11 250 : draft + billing_total verrouillé", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(quoteId, orgId, {
    preparedLines: [
      {
        label: "Matériel",
        description: "Matériel",
        quantity: 1,
        unit_price_ht: 11250,
        discount_ht: 0,
        vat_rate: 0,
      },
    ],
    preparedTotals: {
      total_ht: 11250,
      total_vat: 0,
      total_ttc: 11250,
    },
  });
  invoiceIds.push(inv.id);
  assert.equal(Number(inv.total_ttc), 11250);
  const q = await pool.query(
    `SELECT billing_total_ttc, billing_total_ht, billing_total_vat, billing_locked_at FROM quotes WHERE id = $1`,
    [quoteId]
  );
  assert.equal(Number(q.rows[0]?.billing_total_ttc || 0), 11250);
  assert.equal(Number(q.rows[0]?.billing_total_ht || 0), 11250);
  assert.equal(Number(q.rows[0]?.billing_total_vat || 0), 0);
  assert.ok(q.rows[0]?.billing_locked_at, "billing_locked_at doit etre renseigne");
});

test("createInvoiceFromQuote sans préparation au premier acte -> échec", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  await assert.rejects(
    () => invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "DEPOSIT", billingAmountTtc: 1000 }),
    /Préparation obligatoire/i
  );
});

test("acompte après préparation -> base acompte = 11 250€ (pas 13 950€)", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  const deposit = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 3375,
    preparedTotalTtc: 11250,
    preparedTotalHt: 11250,
    preparedTotalVat: 0,
  });
  invoiceIds.push(deposit.id);
  const meta =
    typeof deposit.metadata_json === "string" ? JSON.parse(deposit.metadata_json) : deposit.metadata_json || {};
  assert.equal(Number(meta?.quote_billing?.quote_total_ttc_snapshot || 0), 11250);
  assert.equal(Number(deposit.total_ttc), 3375);
  const depositLines = await pool.query(`SELECT label, description FROM invoice_lines WHERE invoice_id = $1`, [deposit.id]);
  const depositLineText = `${depositLines.rows[0]?.label || ""} ${depositLines.rows[0]?.description || ""}`;
  assert.match(depositLineText, /Acompte/i);
  assert.doesNotMatch(depositLineText, /devis/i);
  const lockedQuote = await pool.query(
    `SELECT billing_total_ttc, billing_total_ht, billing_total_vat, billing_locked_at
     FROM quotes WHERE id = $1`,
    [quoteId]
  );
  assert.equal(Number(lockedQuote.rows[0]?.billing_total_ttc || 0), 11250);
  assert.equal(Number(lockedQuote.rows[0]?.billing_total_ht || 0), 11250);
  assert.equal(Number(lockedQuote.rows[0]?.billing_total_vat || 0), 0);
  assert.ok(lockedQuote.rows[0]?.billing_locked_at, "billing_locked_at devrait être rempli");
});

test("deuxième facture depuis même devis: total préparé ignoré, base figée conservée", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  const first = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 3000,
    preparedTotalTtc: 11250,
    preparedTotalHt: 11250,
    preparedTotalVat: 0,
  });
  invoiceIds.push(first.id);

  const second = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 1000,
    preparedTotalTtc: 9000,
    preparedTotalHt: 9000,
    preparedTotalVat: 0,
  });
  invoiceIds.push(second.id);

  const quote = await pool.query(`SELECT billing_total_ttc FROM quotes WHERE id = $1`, [quoteId]);
  assert.equal(Number(quote.rows[0]?.billing_total_ttc || 0), 11250);
});

test("trigger DB: update direct billing_total_* après verrou -> interdit", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  const first = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 3000,
    preparedTotalTtc: 11250,
    preparedTotalHt: 11250,
    preparedTotalVat: 0,
  });
  invoiceIds.push(first.id);
  await assert.rejects(
    () =>
      pool.query(
        `UPDATE quotes
         SET billing_total_ttc = 13950, billing_total_ht = 13950, billing_total_vat = 0
         WHERE id = $1`,
        [quoteId]
      ),
    /billing_total est verrouille/i
  );
});

test("ancien devis sans billing_total et sans facturation reste compatible", async () => {
  const quote = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Compat", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 0 }],
  });
  const quoteId = quote.quote.id;
  quoteIds.push(quoteId);
  await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "ACCEPTED", null);
  const q = await pool.query(
    `SELECT billing_total_ttc, billing_total_ht, billing_total_vat, billing_locked_at FROM quotes WHERE id = $1`,
    [quoteId]
  );
  assert.equal(q.rows[0]?.billing_total_ttc, null);
  assert.equal(q.rows[0]?.billing_total_ht, null);
  assert.equal(q.rows[0]?.billing_total_vat, null);
  assert.equal(q.rows[0]?.billing_locked_at, null);
});

test("solde final: total cumulé factures = billing_total", async () => {
  const quoteId = await createAcceptedQuoteWithTotals();
  const dep1 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 3000,
    preparedTotalTtc: 11250,
    preparedTotalHt: 11250,
    preparedTotalVat: 0,
  });
  invoiceIds.push(dep1.id);
  const dep2 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 2250,
    preparedTotalTtc: 9000,
    preparedTotalHt: 9000,
    preparedTotalVat: 0,
  });
  invoiceIds.push(dep2.id);
  const balance = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "BALANCE",
    preparedTotalTtc: 9000,
    preparedTotalHt: 9000,
    preparedTotalVat: 0,
  });
  invoiceIds.push(balance.id);

  const sums = await pool.query(
    `SELECT
       COALESCE(SUM(total_ttc), 0)::numeric AS invoices_total
     FROM invoices
     WHERE quote_id = $1 AND organization_id = $2 AND status != 'CANCELLED'`,
    [quoteId, orgId]
  );
  const quote = await pool.query(`SELECT billing_total_ttc FROM quotes WHERE id = $1`, [quoteId]);
  assert.equal(Number(sums.rows[0]?.invoices_total || 0), Number(quote.rows[0]?.billing_total_ttc || 0));
});

test("dashboard CA facturé exclut DRAFT/CANCELLED et inclut ISSUED/PARTIALLY_PAID/PAID", async () => {
  const draft = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: [{ label: "Draft", description: "Draft", quantity: 1, unit_price_ht: 1000, discount_ht: 0, vat_rate: 0 }],
  });
  invoiceIds.push(draft.id);

  const cancelled = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: [{ label: "Cancelled", description: "Cancelled", quantity: 1, unit_price_ht: 500, discount_ht: 0, vat_rate: 0 }],
  });
  invoiceIds.push(cancelled.id);
  await invoiceService.patchInvoiceStatus(cancelled.id, orgId, "CANCELLED", null);

  const issued = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: [{ label: "Issued", description: "Issued", quantity: 1, unit_price_ht: 2000, discount_ht: 0, vat_rate: 0 }],
  });
  invoiceIds.push(issued.id);
  await invoiceService.patchInvoiceStatus(issued.id, orgId, "ISSUED", null);

  const partial = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: [{ label: "Partial", description: "Partial", quantity: 1, unit_price_ht: 3000, discount_ht: 0, vat_rate: 0 }],
  });
  invoiceIds.push(partial.id);
  await invoiceService.patchInvoiceStatus(partial.id, orgId, "ISSUED", null);
  await pool.query(
    "UPDATE invoices SET status = 'PARTIALLY_PAID', amount_due = 1500, total_paid = 1500, updated_at = now() WHERE id = $1",
    [partial.id]
  );

  const paid = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: [{ label: "Paid", description: "Paid", quantity: 1, unit_price_ht: 4000, discount_ht: 0, vat_rate: 0 }],
  });
  invoiceIds.push(paid.id);
  await invoiceService.patchInvoiceStatus(paid.id, orgId, "ISSUED", null);
  await pool.query(
    "UPDATE invoices SET status = 'PAID', amount_due = 0, total_paid = total_ttc, paid_at = now(), updated_at = now() WHERE id = $1",
    [paid.id]
  );

  const dashboard = await buildDashboardOverview({
    organizationId: orgId,
    userId,
    range: "30d",
    assigned_user_id: null,
    source_id: null,
  });

  assert.equal(Number(dashboard.global_kpis.revenue_invoiced_ttc), 9000);
  assert.equal(Number(dashboard.global_kpis.remaining_to_collect_ttc), 3500);
});

test("devis avec remise ligne % -> facture STANDARD conserve total officiel", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [
      { label: "Ligne %", description: "", quantity: 2, unit_price_ht: 1000, discount_ht: 200, tva_rate: 20 },
    ],
  });
  const q = await pool.query(
    `SELECT document_snapshot_json->'totals'->>'total_ttc' AS total_ttc FROM quotes WHERE id = $1`,
    [quoteId]
  );
  const expectedTtc = Number(q.rows[0]?.total_ttc || 0);
  const inv = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "STANDARD" });
  invoiceIds.push(inv.id);
  assert.equal(Number(inv.total_ttc), expectedTtc);
});

test("devis avec remise ligne montant -> facture STANDARD conserve discount_ht", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [
      { label: "Ligne €", description: "", quantity: 1, unit_price_ht: 1200, discount_ht: 150, tva_rate: 20 },
    ],
  });
  const inv = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "STANDARD" });
  invoiceIds.push(inv.id);
  const line = (inv.lines || [])[0];
  assert.equal(Number(line?.discount_ht || 0), 150);
});

test("remise globale -> ligne DOCUMENT_DISCOUNT reprise en STANDARD", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [{ label: "Base", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
    metadata: { global_discount_percent: 10 },
  });
  const inv = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "STANDARD" });
  invoiceIds.push(inv.id);
  const hasDocDiscountLine = (inv.lines || []).some((l) => l.snapshot_json?.line_kind === "DOCUMENT_DISCOUNT");
  assert.equal(hasDocDiscountLine, true);
});

test("acompte = X% du total TTC remisé officiel du devis", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [{ label: "Base", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
    metadata: { global_discount_percent: 10 },
  });
  const q = await pool.query(
    `SELECT (document_snapshot_json->'totals'->>'total_ttc')::numeric AS total_ttc FROM quotes WHERE id = $1`,
    [quoteId]
  );
  const quoteTtc = Number(q.rows[0]?.total_ttc || 0);
  const expectedDeposit = Math.round(quoteTtc * 0.3 * 100) / 100;
  const inv = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: expectedDeposit,
  });
  invoiceIds.push(inv.id);
  assert.equal(Number(inv.total_ttc), expectedDeposit);
  assert.match(String(inv.lines?.[0]?.label || ""), /Acompte/i);
});

test("solde = total TTC remisé officiel - acomptes émis", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [{ label: "Base", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
    metadata: { global_discount_percent: 10 },
  });
  const q = await pool.query(
    `SELECT (document_snapshot_json->'totals'->>'total_ttc')::numeric AS total_ttc FROM quotes WHERE id = $1`,
    [quoteId]
  );
  const quoteTtc = Number(q.rows[0]?.total_ttc || 0);
  const dep = await invoiceService.createInvoiceFromQuote(quoteId, orgId, {
    billingRole: "DEPOSIT",
    billingAmountTtc: 200,
  });
  invoiceIds.push(dep.id);
  await invoiceService.patchInvoiceStatus(dep.id, orgId, "ISSUED", null);
  const bal = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "BALANCE" });
  invoiceIds.push(bal.id);
  assert.equal(Number(bal.total_ttc), Math.round((quoteTtc - 200) * 100) / 100);
  assert.match(String(bal.lines?.[0]?.label || ""), /Solde du devis/i);
});

test("aucune double remise: STANDARD = total snapshot officiel", async () => {
  const quoteId = await createAcceptedQuoteWithPayload({
    client_id: clientId,
    items: [
      { label: "A", description: "", quantity: 1, unit_price_ht: 1000, discount_ht: 100, tva_rate: 20 },
      { label: "B", description: "", quantity: 1, unit_price_ht: 500, tva_rate: 20 },
    ],
    metadata: { global_discount_percent: 10 },
  });
  const q = await pool.query(
    `SELECT (document_snapshot_json->'totals'->>'total_ttc')::numeric AS total_ttc FROM quotes WHERE id = $1`,
    [quoteId]
  );
  const expected = Number(q.rows[0]?.total_ttc || 0);
  const inv = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "STANDARD" });
  invoiceIds.push(inv.id);
  assert.equal(Number(inv.total_ttc), expected);
});
