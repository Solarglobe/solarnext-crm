/**
 * PROMPT 8 — Paiements / avoirs / relances (services).
 * Usage: cd backend && node scripts/test-prompt8-financial-api.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import * as invoiceService from "../services/invoices.service.js";
import * as paymentsService from "../services/payments.service.js";
import * as creditNotesService from "../services/creditNotes.service.js";
import * as remindersService from "../services/reminders.service.js";
import { MONEY_EPSILON } from "../services/finance/moneyRounding.js";

const PREFIX = `P8-${Date.now()}`;
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

async function cleanupInvoiceFull(invoiceId) {
  if (!invoiceId) return;
  await pool.query("DELETE FROM payments WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoice_reminders WHERE invoice_id = $1", [invoiceId]);
  await pool.query(
    "DELETE FROM credit_note_lines WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE invoice_id = $1)",
    [invoiceId]
  );
  await pool.query("DELETE FROM credit_notes WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
}

const line120 = [{ label: "L", description: "x", quantity: 1, unit_price_ht: 100, vat_rate: 20 }];

async function createIssuedInvoice(orgId, clientId, dueDate = null) {
  const inv = await invoiceService.createInvoice(orgId, {
    client_id: clientId,
    lines: line120,
    ...(dueDate ? { due_date: dueDate } : {}),
  });
  await invoiceService.patchInvoiceStatus(inv.id, orgId, "ISSUED", null);
  return inv.id;
}

async function main() {
  console.log("\n=== PROMPT 8 — Paiements / avoirs / relances (services) ===\n");

  let orgId;
  let clientId;
  const invoiceIds = [];

  try {
    orgId = await getOrgId();
    clientId = await createClient(orgId);
    ok(`org + client (${clientId})`);

    // --- Statuts autorisés / refusés (paiement) ---
    const invDraftRes = await invoiceService.createInvoice(orgId, { client_id: clientId, lines: line120 });
    invoiceIds.push(invDraftRes.id);
    try {
      await paymentsService.recordPayment(orgId, invDraftRes.id, {
        amount: 10,
        payment_date: "2025-01-01",
        payment_method: "TRANSFER",
      });
      fail("paiement sur DRAFT", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("brouillon")) ok("refus paiement sur facture DRAFT");
      else fail("paiement sur DRAFT", e);
    }

    const invIssuedOnly = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invIssuedOnly);
    await paymentsService.recordPayment(orgId, invIssuedOnly, {
      amount: 10,
      payment_date: "2025-06-01",
      payment_method: "TRANSFER",
    });
    ok("paiement OK sur facture ISSUED");

    const invPartialFlow = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invPartialFlow);
    await paymentsService.recordPayment(orgId, invPartialFlow, {
      amount: 50,
      payment_date: "2025-06-01",
      payment_method: "TRANSFER",
    });
    await paymentsService.recordPayment(orgId, invPartialFlow, {
      amount: 10,
      payment_date: "2025-06-02",
      payment_method: "TRANSFER",
    });
    ok("paiement OK sur facture PARTIALLY_PAID");

    const invPaidBlock = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invPaidBlock);
    await paymentsService.recordPayment(orgId, invPaidBlock, {
      amount: 120,
      payment_date: "2025-06-01",
      payment_method: "TRANSFER",
    });
    try {
      await paymentsService.recordPayment(orgId, invPaidBlock, {
        amount: 1,
        payment_date: "2025-06-02",
        payment_method: "TRANSFER",
      });
      fail("paiement sur PAID", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("soldée")) ok("refus paiement sur facture PAID");
      else fail("paiement sur PAID", e);
    }

    const invCancelled = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invCancelled);
    await invoiceService.patchInvoiceStatus(invCancelled, orgId, "CANCELLED", null);
    try {
      await paymentsService.recordPayment(orgId, invCancelled, {
        amount: 10,
        payment_date: "2025-06-01",
        payment_method: "TRANSFER",
      });
      fail("paiement sur CANCELLED", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("annulée")) ok("refus paiement sur facture CANCELLED");
      else fail("paiement sur CANCELLED", e);
    }

    // --- Paiements 1–5 ---
    const invPay = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invPay);

    const p1 = await paymentsService.recordPayment(orgId, invPay, {
      amount: 40,
      payment_date: "2025-06-01",
      payment_method: "TRANSFER",
      reference: "REF1",
    });
    if (!p1.id) fail("1) paiement simple", new Error("pas de id"));
    else ok("1) paiement simple");

    let det = await invoiceService.getInvoiceDetail(invPay, orgId);
    if (String(det.status) !== "PARTIALLY_PAID") fail("2) partiel", new Error(det.status));
    else ok("2) paiement partiel → PARTIALLY_PAID");

    await paymentsService.recordPayment(orgId, invPay, {
      amount: 80,
      payment_date: "2025-06-02",
      payment_method: "CARD",
    });
    det = await invoiceService.getInvoiceDetail(invPay, orgId);
    if (String(det.status) !== "PAID" || det.balance.amount_due > MONEY_EPSILON) {
      fail("3) total", new Error(`${det.status} due=${det.balance.amount_due}`));
    } else ok("3) paiement total → PAID / soldée");

    const invCancel = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invCancel);
    const pc = await paymentsService.recordPayment(orgId, invCancel, {
      amount: 50,
      payment_date: "2025-06-03",
      payment_method: "TRANSFER",
    });
    await paymentsService.cancelPayment(orgId, pc.id, null);
    det = await invoiceService.getInvoiceDetail(invCancel, orgId);
    if (String(det.status) !== "ISSUED" || Number(det.total_paid) > MONEY_EPSILON) {
      fail("4) annulation", new Error(`${det.status} paid=${det.total_paid}`));
    } else ok("4) paiement annulé → ISSUED");

    const listP = await paymentsService.listPaymentsForInvoice(orgId, invCancel);
    if (!listP.some((x) => x.status === "CANCELLED")) fail("5) liste statut", new Error("pas CANCELLED"));
    else ok("5) liste paiements inclut annulé");

    // --- Avoirs 6–8 ---
    const invCn = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invCn);
    await paymentsService.recordPayment(orgId, invCn, {
      amount: 100,
      payment_date: "2025-06-04",
      payment_method: "TRANSFER",
    });
    det = await invoiceService.getInvoiceDetail(invCn, orgId);
    if (det.balance.amount_due > 20 + MONEY_EPSILON) fail("6) pré-avoir solde", new Error(String(det.balance.amount_due)));
    else ok("6) solde avant avoir (~20)");

    const cnDraft = await creditNotesService.createDraftCreditNote(orgId, invCn, {
      lines: [{ label: "A", quantity: 1, unit_price_ht: 5, vat_rate: 20 }],
      reason_code: "GOODWILL",
    });
    await creditNotesService.issueCreditNote(orgId, cnDraft.id);
    det = await invoiceService.getInvoiceDetail(invCn, orgId);
    const dueAfter = Number(det.balance.amount_due);
    if (dueAfter > 14 + MONEY_EPSILON || dueAfter < 13 - MONEY_EPSILON) {
      fail("7) avoir partiel", new Error(String(dueAfter)));
    } else ok("7) avoir partiel (TTC 6) → solde réduit");

    const cnFull = await creditNotesService.createDraftCreditNote(orgId, invCn, {
      lines: [{ label: "B", quantity: 1, unit_price_ht: 11.67, vat_rate: 20 }],
      reason_code: "ADJ",
    });
    await creditNotesService.issueCreditNote(orgId, cnFull.id);
    det = await invoiceService.getInvoiceDetail(invCn, orgId);
    if (String(det.status) !== "PAID" || det.balance.amount_due > MONEY_EPSILON) {
      fail("8) avoir total", new Error(`${det.status} ${det.balance.amount_due}`));
    } else ok("8) avoir couvre le reste → PAID");

    try {
      const invSmall = await createIssuedInvoice(orgId, clientId);
      invoiceIds.push(invSmall);
      await creditNotesService.createDraftCreditNote(orgId, invSmall, {
        lines: [{ label: "X", quantity: 1, unit_price_ht: 200, vat_rate: 20 }],
      });
      fail("9) avoir > reste", new Error("accepté"));
    } catch (e) {
      if (e.message?.includes("dépasse")) ok("9) avoir > reste → refus");
      else fail("9)", e);
    }

    // --- Relances 9–10 ---
    const invRm = await createIssuedInvoice(orgId, clientId, "2020-01-01");
    invoiceIds.push(invRm);
    await remindersService.createReminder(orgId, invRm, {
      reminded_at: "2025-01-10T10:00:00Z",
      channel: "EMAIL",
      note: "n1",
    });
    await remindersService.createReminder(orgId, invRm, {
      reminded_at: "2025-02-15T12:00:00Z",
      channel: "PHONE",
    });
    const rlist = await remindersService.listRemindersForInvoice(orgId, invRm);
    if (rlist.length < 2 || new Date(rlist[0].reminded_at) < new Date(rlist[1].reminded_at)) {
      fail("10) ordre relances", new Error("DESC attendu"));
    } else ok("10) relances tri reminded_at DESC");

    // --- Intégration 11–13 ---
    det = await invoiceService.getInvoiceDetail(invRm, orgId);
    if (
      !Array.isArray(det.payments) ||
      !Array.isArray(det.credit_notes) ||
      !Array.isArray(det.reminders) ||
      det.balance == null ||
      det.suggested_status == null
    ) {
      fail("11) GET détail", new Error("structure"));
    } else ok("11) GET facture : payments, credit_notes, reminders, balance, suggested_status");

    if (det.last_reminder_at == null || typeof det.is_overdue !== "boolean" || typeof det.needs_followup !== "boolean") {
      fail("11b) indicateurs relance", new Error(JSON.stringify(det)));
    } else ok("11b) last_reminder_at, is_overdue, needs_followup");

    const invSt = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invSt);
    await paymentsService.recordPayment(orgId, invSt, {
      amount: 60,
      payment_date: "2025-07-01",
      payment_method: "TRANSFER",
    });
    det = await invoiceService.getInvoiceDetail(invSt, orgId);
    if (String(det.status) !== "PARTIALLY_PAID") {
      fail("12) statut après paiement", new Error(det.status));
    } else ok("12) statut cohérent après paiement");

    const invCn2 = await createIssuedInvoice(orgId, clientId);
    invoiceIds.push(invCn2);
    const d2 = await creditNotesService.createDraftCreditNote(orgId, invCn2, {
      lines: [{ label: "Z", quantity: 1, unit_price_ht: 100, vat_rate: 20 }],
    });
    await creditNotesService.issueCreditNote(orgId, d2.id);
    det = await invoiceService.getInvoiceDetail(invCn2, orgId);
    if (String(det.status) !== "PAID") fail("13) statut après avoir", new Error(det.status));
    else ok("13) statut cohérent après avoir total");

    console.log("\n============================================================");
    console.log(`Résumé: ${passed} OK, ${failed} échecs`);
    console.log("============================================================\n");

    for (const id of invoiceIds) {
      await cleanupInvoiceFull(id);
    }
    await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  } catch (e) {
    console.error(e);
    failed++;
    for (const id of invoiceIds) {
      await cleanupInvoiceFull(id);
    }
    if (clientId) await pool.query("DELETE FROM clients WHERE id = $1", [clientId]).catch(() => {});
  }

  if (failed > 0) process.exit(1);
}

main();
