/**
 * Facturation flexible depuis devis : plusieurs acomptes, solde, plafond TTC.
 * cd backend && node --env-file=../.env.dev --test tests/invoice-quote-billing-flex.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "../config/register-local-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const PREFIX = `IFLEX-${Date.now()}`;
let orgId;
let clientId;
const invoiceIds = [];
let quoteId;

/** Base préparation alignée sur le devis seed : 1000 HT + 200 TVA = 1200 TTC */
const PREP_1200 = { preparedTotalTtc: 1200, preparedTotalHt: 1000, preparedTotalVat: 200 };

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
     VALUES ($1, $2, 'Iflex', 'Client', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  clientId = cr.rows[0].id;

  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
  });
  quoteId = q.quote.id;
  await quoteService.updateQuote(quoteId, orgId, {
    deposit: { type: "PERCENT", value: 25 },
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
  });
  await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "ACCEPTED", null);
});

after(async () => {
  for (const id of invoiceIds) {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
    await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  }
  if (quoteId) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
  }
  if (clientId) await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  await pool.end();
});

test("deux acomptes DEPOSIT successifs puis solde BALANCE", async () => {
  const inv1 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "DEPOSIT", ...PREP_1200 });
  invoiceIds.push(inv1.id);
  const inv2 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "DEPOSIT", ...PREP_1200 });
  invoiceIds.push(inv2.id);
  const inv3 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "BALANCE" });
  invoiceIds.push(inv3.id);
  assert.ok(inv1.id !== inv2.id);
  const meta = typeof inv3.metadata_json === "string" ? JSON.parse(inv3.metadata_json) : inv3.metadata_json;
  assert.ok(meta?.billing_mode === "BALANCE" || meta?.quote_billing_role === "BALANCE");
});

test("createInvoiceFromQuote STANDARD refusé", async () => {
  await assert.rejects(
    () => invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "STANDARD" }),
    /prepared-standard|préparation validée/i
  );
});

test("createInvoiceFromQuote sans billingRole (défaut STANDARD) refusé", async () => {
  await assert.rejects(
    () => invoiceService.createInvoiceFromQuote(quoteId, orgId, {}),
    /prepared-standard|préparation validée/i
  );
});

test("createPreparedStandardInvoiceFromQuote : totaux depuis lignes préparées + refs metadata", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
      preparedLines: [
        { label: "L1", description: "", quantity: 1, unit_price_ht: 100, discount_ht: 0, vat_rate: 20 },
      ],
    });
    invId = inv.id;
    invoiceIds.push(invId);
    assert.equal(Number(inv.total_ttc), 120);
    const meta = typeof inv.metadata_json === "string" ? JSON.parse(inv.metadata_json) : inv.metadata_json || {};
    assert.equal(Number(meta.prepared_total_ttc_reference), 120);
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

test("BALANCE sans base figée ni prepared_total -> erreur", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "X", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    await assert.rejects(
      () => invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "BALANCE" }),
      /Préparation obligatoire pour le solde/i
    );
  } finally {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("updateInvoice : refuse si total des factures liées > préparation + tolérance", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Cap", description: "", quantity: 1, unit_price_ht: 200, tva_rate: 0 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
      preparedLines: [{ label: "Cap", description: "", quantity: 1, unit_price_ht: 200, discount_ht: 0, vat_rate: 0 }],
    });
    invId = inv.id;
    invoiceIds.push(invId);
    const linesPayload = (inv.lines || []).map((row) => ({
      label: row.label,
      description: row.description || row.label || "",
      quantity: 2,
      unit_price_ht: row.unit_price_ht,
      discount_ht: row.discount_ht ?? 0,
      vat_rate: row.vat_rate,
      snapshot_json: row.snapshot_json,
    }));
    await assert.rejects(
      () => invoiceService.updateInvoice(invId, orgId, { lines: linesPayload }),
      /Montant total des factures|dépasser|tolérance/i
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

test("updateInvoice lié à un devis : même client_id normalisé => pas de faux positif", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Norm", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
      preparedLines: [{ label: "Norm", description: "", quantity: 1, unit_price_ht: 100, discount_ht: 0, vat_rate: 20 }],
    });
    invId = inv.id;
    invoiceIds.push(invId);
    const updated = await invoiceService.updateInvoice(invId, orgId, { client_id: ` ${clientId} ` });
    assert.equal(String(updated.client_id), String(clientId));
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

test("updateInvoice lié à un devis : vraie modification client_id reste bloquée", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Norm2", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  let otherClientId;
  try {
    const cr = await pool.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
       VALUES ($1, $2, 'Iflex', 'Other', $3) RETURNING id`,
      [orgId, `CLI-${PREFIX}-B`, `${PREFIX}-b@test.local`]
    );
    otherClientId = cr.rows[0].id;
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
      preparedLines: [{ label: "Norm2", description: "", quantity: 1, unit_price_ht: 100, discount_ht: 0, vat_rate: 20 }],
    });
    invId = inv.id;
    invoiceIds.push(invId);
    await assert.rejects(
      () => invoiceService.updateInvoice(invId, orgId, { client_id: otherClientId }),
      /rattachement client ne peut pas être modifié/i
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
    if (otherClientId) await pool.query("DELETE FROM clients WHERE id = $1", [otherClientId]);
  }
});
