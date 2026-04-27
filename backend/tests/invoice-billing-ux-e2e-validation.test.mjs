/**
 * Validation facturation devis (backend aligné UX) — données taguées TEST, nettoyage CANCELLED + is_test.
 *
 * Prérequis : base dev (.env.dev) — aucune prod.
 *
 *   cd backend && node --env-file=../.env.dev --test tests/invoice-billing-ux-e2e-validation.test.mjs
 *
 * Nettoyage : annulation + metadata_json.is_test (comme cleanup prod), puis suppression des lignes
 * pour ne pas accumuler en CI (les factures sont déjà CANCELLED).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../config/register-local-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const PREFIX = `BILLUX-${Date.now()}`;
const META_TEST = JSON.stringify({ is_test: true, note: "FACTURE TEST — suite invoice-billing-ux-e2e-validation" });

/** @type {string[]} */
const trackedInvoiceIds = [];
/** @type {string[]} */
const trackedQuoteIds = [];
/** @type {string | null} */
let orgId = null;
/** @type {string | null} */
let clientId = null;

const report = {
  cas: /** @type {Record<string, "OK" | "NOK">} */ {},
  ux: /** @type {string[]} */ [],
  backend: /** @type {string[]} */ [],
};

function markCas(name, ok, uxNote, backendNote) {
  report.cas[name] = ok ? "OK" : "NOK";
  if (uxNote) report.ux.push(`${name}: ${uxNote}`);
  if (backendNote) report.backend.push(`${name}: ${backendNote}`);
}

async function acceptQuote(qid) {
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);
}

function trackInvoice(inv) {
  if (inv?.id) trackedInvoiceIds.push(inv.id);
}

function trackQuote(qid) {
  if (qid) trackedQuoteIds.push(qid);
}

/**
 * Nettoyage « propre » : CANCELLED + is_test (pas de DELETE tant que non annulé si besoin FK).
 * Puis suppression physique pour la base de dev.
 */
async function cancelAndTagTestInvoices(ids) {
  for (const id of ids) {
    const r = await pool.query(
      `SELECT status, total_paid, total_credited FROM invoices WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );
    const row = r.rows[0];
    if (!row) continue;
    const st = String(row.status || "").toUpperCase();
    const paid = Number(row.total_paid) || 0;
    const cred = Number(row.total_credited) || 0;
    if (paid > 0.02 || cred > 0.02) {
      report.backend.push(`cleanup_skip_invoice=${id} (paiements/avoirs)`);
      continue;
    }
    if (st === "DRAFT" || st === "ISSUED" || st === "PARTIALLY_PAID") {
      try {
        await invoiceService.patchInvoiceStatus(id, orgId, "CANCELLED", null);
      } catch (e) {
        report.backend.push(`cleanup_patch ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await pool.query(
      `UPDATE invoices SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $1::jsonb, updated_at = now()
       WHERE id = $2 AND organization_id = $3`,
      [META_TEST, id, orgId]
    );
  }
}

async function purgeTestArtifacts() {
  for (const id of trackedInvoiceIds) {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
    await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  }
  for (const qid of trackedQuoteIds) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
  if (clientId) {
    await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
    clientId = null;
  }
}

after(async () => {
  try {
    await cancelAndTagTestInvoices([...trackedInvoiceIds]);
    await purgeTestArtifacts();
  } catch (e) {
    console.error("[after] nettoyage:", e instanceof Error ? e.message : String(e));
  }
  try {
    await pool.end();
  } catch {
    /* pool jamais connecté */
  }

  if (Object.keys(report.cas).length > 0) {
    console.log("\n========== RAPPORT FACTURATION TEST ==========");
    for (const [k, v] of Object.entries(report.cas)) {
      console.log(`  ${k}: ${v}`);
    }
    if (report.ux.length) {
      console.log("\n--- Anomalies / notes UX ---");
      for (const x of report.ux) console.log(`  - ${x}`);
    } else {
      console.log("\n--- Anomalies UX : aucune signalée par la suite ---");
    }
    if (report.backend.length) {
      console.log("\n--- Anomalies / notes backend ---");
      for (const x of report.backend) console.log(`  - ${x}`);
    } else {
      console.log("\n--- Anomalies backend : aucune ---");
    }
    console.log("===============================================\n");
  }
});

test("FACTURATION DEVIS — validation complète (TEST FACTURATION)", async (t) => {
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
    t.skip(`PostgreSQL indisponible (${code || "connexion"}). Configurer DATABASE_URL / .env.dev puis relancer.`);
    return;
  }

  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  assert.ok(orgRes.rows[0], "organization requise");
  orgId = orgRes.rows[0].id;

  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, company_name, first_name, last_name, email)
     VALUES ($1, $2, $3, 'ZZZ', 'TEST', $4) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, "TEST FACTURATION", `${PREFIX}@test-facturation.local`]
  );
  clientId = cr.rows[0].id;

  await t.test("CAS 1 — facture complète 10 000 € TTC", async () => {
    const q = await quoteService.createQuote(orgId, {
      client_id: clientId,
      items: [{ label: "Kit TEST", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
    });
    const qid = q.quote.id;
    trackQuote(qid);
    await acceptQuote(qid);
    const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
    trackInvoice(inv);
    try {
      assert.equal(Number(inv.total_ttc), 10000);
      const ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
      assert.ok(ctx);
      assert.ok(Math.abs(Number(ctx.invoiced_ttc) - 10000) <= 0.05);
      assert.ok(Math.abs(Number(ctx.remaining_ttc)) <= 0.05);
      markCas("CAS_1_FACTURE_COMPLETE", true);
    } catch (e) {
      markCas("CAS_1_FACTURE_COMPLETE", false, "", e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  await t.test("CAS 2 à 4 — acomptes 3k + 2k + 2k puis solde 3k", async () => {
    const q = await quoteService.createQuote(orgId, {
      client_id: clientId,
      items: [{ label: "Lot TEST", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
    });
    const qid = q.quote.id;
    trackQuote(qid);
    await acceptQuote(qid);

    const inv1 = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 3000,
    });
    trackInvoice(inv1);
    assert.equal(Number(inv1.total_ttc), 3000);
    let ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
    assert.ok(Math.abs(Number(ctx.remaining_ttc) - 7000) <= 0.05, `reste après 3k: ${ctx.remaining_ttc}`);

    const inv2 = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 2000,
    });
    trackInvoice(inv2);
    assert.equal(Number(inv2.total_ttc), 2000);

    const inv3 = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 2000,
    });
    trackInvoice(inv3);
    assert.equal(Number(inv3.total_ttc), 2000);

    ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
    assert.ok(Math.abs(Number(ctx.invoiced_ttc) - 7000) <= 0.1, `facturé cumulé ${ctx.invoiced_ttc}`);
    assert.ok(Math.abs(Number(ctx.remaining_ttc) - 3000) <= 0.1, `reste ${ctx.remaining_ttc}`);

    const invBal = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "BALANCE" });
    trackInvoice(invBal);
    assert.equal(Number(invBal.total_ttc), 3000);
    ctx = await invoiceService.getQuoteInvoiceBillingContext(qid, orgId);
    assert.ok(Math.abs(Number(ctx.remaining_ttc)) <= 0.15, `reste final ${ctx.remaining_ttc}`);
    markCas("CAS_2_3_4_ACOMPTE_MULTI_SOLDE", true);
  });

  await t.test("CAS 5 — sécurité (STANDARD après acompte, plafond)", async () => {
    const q = await quoteService.createQuote(orgId, {
      client_id: clientId,
      items: [{ label: "Séc TEST", description: "", quantity: 1, unit_price_ht: 10000, tva_rate: 0 }],
    });
    const qid = q.quote.id;
    trackQuote(qid);
    await acceptQuote(qid);

    const dep = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 1000,
    });
    trackInvoice(dep);

    await assert.rejects(
      () => invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" }),
      /Une facture ou un brouillon existe déjà|acompte|solde/i,
      "STANDARD doit être refusé après réservation TTC"
    );

    const invOverAsk = await invoiceService.createInvoiceFromQuote(qid, orgId, {
      billingRole: "DEPOSIT",
      billingAmountTtc: 50_000,
    });
    trackInvoice(invOverAsk);
    const remAfter = 10_000 - 1000 - Number(invOverAsk.total_ttc);
    if (Math.abs(Number(invOverAsk.total_ttc) - 9000) > 0.15) {
      markCas("CAS_5_SECURITE", false, "", `acompte > reste: attendu plafond 9000 TTC, obtenu ${invOverAsk.total_ttc}`);
      assert.fail(`plafond acompte: ${invOverAsk.total_ttc}`);
    }
    markCas(
      "CAS_5_SECURITE",
      true,
      "Le backend plafonne l'acompte au reste TTC (pas d'erreur HTTP) — si l'UI affiche une erreur stricte, aligner message ou bloquer côté client.",
      ""
    );
    assert.ok(Math.abs(remAfter) <= 0.2);

    await assert.rejects(
      () => invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "BALANCE" }),
      /Rien à facturer|déjà couvert/i,
      "deuxième solde impossible quand reste = 0"
    );
  });
});
