/**
 * PROMPT 7 — Tests API devis / factures (services, pas HTTP).
 * Usage: cd backend && node scripts/test-prompt7-financial-api.js
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const PREFIX = `P7-${Date.now()}`;
let passed = 0;
let failed = 0;

function ok(m) {
  passed++;
  console.log(`  ✔ ${m}`);
}
function fail(m, e) {
  failed++;
  console.log(`  ✖ ${m}: ${e?.message || e}`);
}

async function getOrgId() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length === 0) {
    const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${PREFIX}-org`]);
    return ins.rows[0].id;
  }
  return r.rows[0].id;
}

async function createClient(orgId) {
  const r = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Test', 'Client', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  return r.rows[0].id;
}

async function cleanupQuote(quoteId) {
  if (!quoteId) return;
  await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
  await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
}

async function cleanupInvoice(invoiceId) {
  if (!invoiceId) return;
  await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
}

async function main() {
  console.log("\n=== PROMPT 7 — API devis / factures (services) ===\n");

  let orgId;
  let clientId;
  let qEmpty;
  let qLines;
  let qSent;
  let inv1;
  let invFromQ;

  try {
    orgId = await getOrgId();
    clientId = await createClient(orgId);
    ok(`org + client (${clientId})`);

    // 1 — devis vide
    const e1 = await quoteService.createQuote(orgId, { client_id: clientId, items: [] });
    qEmpty = e1.quote.id;
    ok("1) création devis vide");

    // 2 — devis avec lignes
    const e2 = await quoteService.createQuote(orgId, {
      client_id: clientId,
      items: [{ label: "A", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
    });
    qLines = e2.quote.id;
    ok("2) création devis avec lignes");

    // 3 — update draft
    await quoteService.updateQuote(qLines, orgId, { items: [] });
    ok("3) update devis DRAFT (lignes vides)");
    await quoteService.updateQuote(qLines, orgId, {
      items: [{ label: "A", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
    });

    // 5 — duplicate
    const dup = await quoteService.duplicateQuote(qLines, orgId);
    await cleanupQuote(dup.quote.id);
    ok("5) duplication devis");

    // 6–8 — transitions vers SENT
    await quoteService.patchQuoteStatus(qLines, orgId, "READY_TO_SEND", null);
    ok("6) DRAFT → READY_TO_SEND");
    await quoteService.patchQuoteStatus(qLines, orgId, "SENT", null);
    const afterSent = await quoteService.getQuoteDetail(qLines, orgId);
    qSent = afterSent.quote;
    if (!qSent.sent_at) fail("7) SENT sans sent_at", new Error("sent_at manquant"));
    else ok("7) READY_TO_SEND → SENT (sent_at)");
    if (!/^[A-Z0-9]+-DEV-\d{4}-\d{4}$/.test(String(qSent.quote_number).trim())) {
      fail("8) numéro officiel *-DEV-AAAA-NNNN", new Error(qSent.quote_number));
    } else ok("8) numéro officiel …-DEV-…");
    if (!qSent.issuer_snapshot || Object.keys(qSent.issuer_snapshot).length === 0) {
      fail("8) issuer_snapshot", new Error("vide"));
    } else ok("8) issuer_snapshot rempli");

    const pdfQ = await quoteService.generateQuotePdfRecord(qLines, orgId, null);
    if (!pdfQ.document?.id) fail("8c) PDF quote snapshot", new Error("no id"));
    else ok("8c) PDF devis basé sur document_snapshot_json");

    // 4 — refus update SENT
    try {
      await quoteService.updateQuote(qLines, orgId, { items: [{ label: "X", quantity: 1, unit_price_ht: 1, tva_rate: 0 }] });
      fail("4) update SENT doit échouer", new Error("pas d'erreur"));
    } catch (e) {
      if (e.message?.includes("interdit")) ok("4) refus update devis SENT");
      else fail("4) refus update", e);
    }

    // ACCEPTED pour facture depuis devis
    await quoteService.patchQuoteStatus(qLines, orgId, "ACCEPTED", null);

    // 9 — facture autonome
    const invA = await invoiceService.createInvoice(orgId, {
      client_id: clientId,
      lines: [{ label: "L1", description: "d", quantity: 1, unit_price_ht: 50, vat_rate: 20 }],
    });
    inv1 = invA.id;
    ok("9) création facture autonome");

    // 10 — sans client
    try {
      await invoiceService.createInvoice(orgId, { client_id: null, lines: [] });
      fail("10) facture sans client", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("obligatoire")) ok("10) refus facture sans client");
      else fail("10)", e);
    }

    // 11–12 — depuis devis
    const fromQ = await invoiceService.createInvoiceFromQuote(qLines, orgId);
    invFromQ = fromQ.id;
    ok("11) facture depuis devis ACCEPTED");

    try {
      await invoiceService.createInvoiceFromQuote(qEmpty, orgId);
      fail("12) devis non accepté", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("accepté")) ok("12) refus depuis devis non accepté");
      else fail("12)", e);
    }

    // 13 — update facture DRAFT
    await invoiceService.updateInvoice(inv1, orgId, { due_date: "2030-01-01" });
    ok("13) update facture DRAFT");

    // 15–16 — émission
    await invoiceService.patchInvoiceStatus(inv1, orgId, "ISSUED", null);
    const issued = await invoiceService.getInvoiceDetail(inv1, orgId);
    if (!issued.issue_date) fail("16) issue_date", new Error("manquant"));
    else ok("16) ISSUED + issue_date");
    if (!/^[A-Z0-9]+-FACT-\d{4}-\d{4}$/.test(String(issued.invoice_number).trim())) {
      fail("16) numéro officiel *-FACT-AAAA-NNNN", new Error(issued.invoice_number));
    } else ok("16) numéro officiel …-FACT-…");

    try {
      await invoiceService.updateInvoice(inv1, orgId, { notes: "x" });
      fail("14) update ISSUED", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("interdite")) ok("14) refus update facture ISSUED");
      else fail("14)", e);
    }

    // 17–18 — détail + PDF stub (facture émise requise pour snapshot)
    const det = await invoiceService.getInvoiceDetail(invFromQ, orgId);
    if (!Array.isArray(det.payments)) fail("17) payments", new Error("no array"));
    else ok("17) détail facture (paiements tableau)");
    await invoiceService.patchInvoiceStatus(invFromQ, orgId, "ISSUED", null);
    const pdf = await invoiceService.generateInvoicePdfRecord(invFromQ, orgId, null);
    if (!pdf.document?.id) fail("18) PDF entity", new Error("no id"));
    else ok("18) entrée entity_documents facture (snapshot figé)");

    console.log("\n============================================================");
    console.log(`Résumé: ${passed} OK, ${failed} échecs`);
    console.log("============================================================\n");

    // Nettoyage
    await cleanupInvoice(invFromQ);
    await cleanupInvoice(inv1);
    await pool.query("DELETE FROM entity_documents WHERE id = ANY($1::uuid[])", [[pdf.document.id, pdfQ.document.id]]);
    await cleanupQuote(qEmpty);
    await cleanupQuote(qLines);
    await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  } catch (e) {
    console.error(e);
    failed++;
  }

  if (failed > 0) process.exit(1);
}

main();
