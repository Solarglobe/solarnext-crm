/**
 * Facturation flexible : acompte libre, multi-DEPOSIT, solde auto, plafond.
 * cd backend && node --env-file=../.env.dev --test tests/invoice-flexible-payments.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../config/register-local-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const PREFIX = `IFLEXPAY-${Date.now()}`;
let orgId;
let clientId;
const invoiceIds = [];

before(async () => {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length === 0) {
    const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${PREFIX}-org`]);
    orgId = ins.rows[0].id;
  } else {
    orgId = r.rows[0].id;
  }
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'IflexPay', 'Client', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  clientId = cr.rows[0].id;
});

after(async () => {
  for (const id of invoiceIds) {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
    await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  }
  await pool.end();
});

test("CAS 1 — devis 10k TTC : acompte 3k puis solde 7k", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const inv1 = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 3000,
      preparedTotalTtc: 10000,
      preparedTotalHt: 10000,
      preparedTotalVat: 0,
    });
    invoiceIds.push(inv1.id);
    assert.equal(Number(inv1.total_ttc), 3000);

    const inv2 = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "BALANCE" });
    invoiceIds.push(inv2.id);
    assert.equal(Number(inv2.total_ttc), 7000);

    const ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
    assert.ok(ctx);
    assert.ok(Math.abs(Number(ctx.remaining_ttc)) <= 0.05, `reste ${ctx.remaining_ttc}`);
  } finally {
    for (const id of [...invoiceIds]) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
      const idx = invoiceIds.indexOf(id);
      if (idx >= 0) invoiceIds.splice(idx, 1);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("CAS 2 — devis 10k : trois acomptes 3000 + 3000 + 4000 (sans acompte structuré sur devis)", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const prep10 = { preparedTotalTtc: 10000, preparedTotalHt: 10000, preparedTotalVat: 0 };
    const a = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 3000,
      ...prep10,
    });
    invoiceIds.push(a.id);
    const b = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 3000,
      ...prep10,
    });
    invoiceIds.push(b.id);
    const c = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 4000,
      ...prep10,
    });
    invoiceIds.push(c.id);

    assert.equal(Number(a.total_ttc) + Number(b.total_ttc) + Number(c.total_ttc), 10000);
    const ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
    assert.ok(ctx && Math.abs(Number(ctx.remaining_ttc)) <= 0.05);
  } finally {
    for (const id of [...invoiceIds]) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
      const idx = invoiceIds.indexOf(id);
      if (idx >= 0) invoiceIds.splice(idx, 1);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("CAS 3 — facture STANDARD complète 10k (aucune facture préalable)", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
      preparedLines: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 10000, discount_ht: 0, vat_rate: 0 }],
    });
    invId = inv.id;
    invoiceIds.push(invId);
    assert.equal(Number(inv.total_ttc), 10000);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
      const idx = invoiceIds.indexOf(invId);
      if (idx >= 0) invoiceIds.splice(idx, 1);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("CAS 4 — DEPOSIT sans montant ni structuration → erreur claire", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 500, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    await assert.rejects(
      () => invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "DEPOSIT" }),
      /Veuillez saisir un montant d'acompte/i
    );
  } finally {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("CAS 4b — facturer au-delà du reste impossible (devis couvert)", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 1000,
      preparedTotalTtc: 1000,
      preparedTotalHt: 1000,
      preparedTotalVat: 0,
    });
    invId = inv.id;
    invoiceIds.push(invId);

    await assert.rejects(
      () =>
        invoiceService.createInvoiceFromQuote(qid, orgId, {
          billingRole: "DEPOSIT",
          billingAmountTtc: 100,
          preparedTotalTtc: 1000,
          preparedTotalHt: 1000,
          preparedTotalVat: 0,
        }),
      /Rien à facturer|déjà couvert/i
    );
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
      const idx = invoiceIds.indexOf(invId);
      if (idx >= 0) invoiceIds.splice(idx, 1);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});
