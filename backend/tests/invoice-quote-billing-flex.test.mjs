/**
 * Facturation flexible depuis devis : plusieurs acomptes, solde, plafond TTC.
 * cd backend && node --env-file=../.env.dev --test tests/invoice-quote-billing-flex.test.mjs
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

const PREFIX = `IFLEX-${Date.now()}`;
let orgId;
let clientId;
const invoiceIds = [];
let quoteId;

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
  const inv1 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "DEPOSIT" });
  invoiceIds.push(inv1.id);
  const inv2 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "DEPOSIT" });
  invoiceIds.push(inv2.id);
  const inv3 = await invoiceService.createInvoiceFromQuote(quoteId, orgId, { billingRole: "BALANCE" });
  invoiceIds.push(inv3.id);
  assert.ok(inv1.id !== inv2.id);
  const meta = typeof inv3.metadata_json === "string" ? JSON.parse(inv3.metadata_json) : inv3.metadata_json;
  assert.ok(meta?.billing_mode === "BALANCE" || meta?.quote_billing_role === "BALANCE");
});

test("createInvoiceFromQuote STANDARD : plafond TTC aligné devis (lignes = en-tête)", async () => {
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
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(inv.id);
    assert.equal(Number(inv.total_ttc), 120);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot valide prioritaire", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      notes: "Notes figees snapshot",
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap 1",
          reference: "REF-SNAP-1",
          quantity: 1,
          unit_price_ht: 300,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 360,
          position: 1,
        },
      ],
      totals: {
        total_ht: 300,
        total_vat: 60,
        total_ttc: 360,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(inv.id);
    assert.ok(Math.abs(Number(inv.total_ttc) - 360) <= 0.01);
    assert.equal(inv.notes, "Notes figees snapshot");
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot valide + live divergent => snapshot gagne", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      notes: "Snapshot prioritaire",
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap",
          reference: "REF-SNAP-2",
          quantity: 1,
          unit_price_ht: 400,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 480,
          position: 1,
        },
      ],
      totals: {
        total_ht: 400,
        total_vat: 80,
        total_ttc: 480,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await pool.query(
      `UPDATE quote_lines
       SET unit_price_ht = 900, total_line_ht = 900, total_line_vat = 180, total_line_ttc = 1080
       WHERE quote_id = $1`,
      [qid]
    );
    await pool.query(`UPDATE quotes SET total_ht = 900, total_vat = 180, total_ttc = 1080 WHERE id = $1`, [qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ttc) - 480) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot coherent => total facture strictement snapshot", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 120, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      lines: [
        {
          label: "Snap-L1",
          description: "Desc",
          reference: "REF-SNAP-C1",
          quantity: 1,
          unit_price_ht: 300,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 360,
          position: 1,
        },
      ],
      totals: {
        total_ht: 300,
        total_vat: 60,
        total_ttc: 360,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ht) - 300) <= 0.01);
    assert.ok(Math.abs(Number(inv.total_vat) - 60) <= 0.01);
    assert.ok(Math.abs(Number(inv.total_ttc) - 360) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : divergence ligne legere => total snapshot prioritaire", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      lines: [
        {
          label: "Snap-L1",
          description: "Desc",
          reference: "REF-SNAP-LIGHT",
          quantity: 1,
          unit_price_ht: 300,
          discount_ht: 0.02,
          vat_rate: 20,
          total_line_ttc: 360,
          position: 1,
        },
      ],
      totals: {
        total_ht: 300,
        total_vat: 60,
        total_ttc: 360,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ttc) - 360) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : divergence forte => warning + total snapshot conserve", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  const originalWarn = console.warn;
  const warnCalls = [];
  console.warn = (...args) => {
    warnCalls.push(args);
  };
  try {
    const snapshot = {
      lines: [
        {
          label: "Snap-L1",
          description: "Desc",
          reference: "REF-SNAP-STRONG",
          quantity: 1,
          unit_price_ht: 250,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 360,
          position: 1,
        },
      ],
      totals: {
        total_ht: 250,
        total_vat: 50,
        total_ttc: 360,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ttc) - 360) <= 0.01);
    assert.ok(
      warnCalls.some(
        (args) => String(args?.[0] || "").includes("snapshot_total_mismatch")
      )
    );
  } finally {
    console.warn = originalWarn;
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot incoherent + live disponible => fallback live non bloquant", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      notes: "Snapshot incoherent",
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap",
          reference: "REF-SNAP-3",
          quantity: 1,
          unit_price_ht: 100,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 120,
          position: 1,
        },
      ],
      totals: {
        total_ht: 200,
        total_vat: 40,
        total_ttc: 240,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(inv.id);
    // Fallback live attendu (ligne live initiale 100 HT / 20 TVA).
    assert.ok(Math.abs(Number(inv.total_ttc) - 120) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE quote_id = $1)", [qid]);
    await pool.query("DELETE FROM invoices WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : sans snapshot => fallback live", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 250, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ttc) - 300) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot sans total_line_ttc => fallback calcul validation", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      notes: "Snapshot legacy sans total_line_ttc",
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap legacy",
          reference: "REF-SNAP-LEGACY",
          quantity: 2,
          unit_price_ht: 100,
          discount_ht: 20,
          vat_rate: 20,
          position: 1,
        },
      ],
      totals: {
        total_ht: 180,
        total_vat: 36,
        total_ttc: 216,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
    assert.ok(Math.abs(Number(inv.total_ttc) - 216) <= 0.01);
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : mapping snapshot vers colonnes invoice_lines", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  let invId;
  try {
    const snapshot = {
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap colonne",
          reference: "REF-COL-1",
          quantity: 3,
          unit_price_ht: 50,
          discount_ht: 10,
          vat_rate: 20,
          total_line_ttc: 168,
          position: 1,
        },
      ],
      totals: {
        total_ht: 140,
        total_vat: 28,
        total_ttc: 168,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;

    const lineRes = await pool.query(
      `SELECT label, quantity, unit_price_ht, discount_ht, vat_rate, snapshot_json
       FROM invoice_lines WHERE invoice_id = $1 ORDER BY position LIMIT 1`,
      [invId]
    );
    assert.equal(lineRes.rows.length, 1);
    const l = lineRes.rows[0];
    assert.equal(String(l.label), "Snap-L1");
    assert.equal(Number(l.quantity), 3);
    assert.equal(Number(l.unit_price_ht), 50);
    assert.equal(Number(l.discount_ht), 10);
    assert.equal(Number(l.vat_rate), 20);
    assert.equal(l.snapshot_json?.reference, "REF-COL-1");
  } finally {
    if (invId) {
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invId]);
      await pool.query("DELETE FROM invoices WHERE id = $1", [invId]);
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("createInvoiceFromQuote STANDARD : snapshot incoherent + live indisponible => erreur SNAPSHOT_INCONSISTENT", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "Live-L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  try {
    const snapshot = {
      lines: [
        {
          label: "Snap-L1",
          description: "Desc snap",
          reference: "REF-ERR-1",
          quantity: 1,
          unit_price_ht: 100,
          discount_ht: 0,
          vat_rate: 20,
          total_line_ttc: 120,
          position: 1,
        },
      ],
      totals: {
        total_ht: 200,
        total_vat: 40,
        total_ttc: 240,
      },
    };
    await pool.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb WHERE id = $2`, [JSON.stringify(snapshot), qid]);
    // Simule ancien devis sans lignes live exploitables.
    await pool.query(`DELETE FROM quote_lines WHERE quote_id = $1`, [qid]);
    await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
    await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

    await assert.rejects(
      () => invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" }),
      (err) => {
        assert.equal(err?.code, "SNAPSHOT_INCONSISTENT");
        assert.equal(err?.quote_id, qid);
        assert.ok(typeof err?.message === "string" && err.message.includes("SNAPSHOT_INCONSISTENT"));
        assert.ok(typeof err?.delta === "number");
        return true;
      }
    );
  } finally {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE quote_id = $1)", [qid]);
    await pool.query("DELETE FROM invoices WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});

test("updateInvoice : refuse si total des factures liées > devis + tolérance", async () => {
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

    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    invId = inv.id;
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
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
});
