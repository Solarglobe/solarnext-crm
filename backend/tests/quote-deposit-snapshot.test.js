/**
 * Acompte structuré dans le snapshot devis officiel (gel SENT).
 * Usage: cd backend && node tests/quote-deposit-snapshot.test.js
 */

import {
  buildOfficialQuoteDocumentSnapshot,
  buildQuoteDepositFreeze,
} from "../services/financialDocumentSnapshot.service.js";
import { buildQuotePdfPayloadFromSnapshot } from "../services/financialDocumentPdfPayload.service.js";

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

function run() {
  console.log("\n=== Quote deposit snapshot (Phase 5) ===\n");

  try {
    const r1 = buildQuoteDepositFreeze({ deposit: { type: "PERCENT", value: 25 } }, 1000);
    if (r1.deposit_display?.mode !== "PERCENT" || r1.deposit_display.amount_ttc !== 250) {
      fail("PERCENT 25% sur 1000 TTC", new Error(JSON.stringify(r1.deposit_display)));
    } else ok("PERCENT : montant TTC dérivé = 250");

    const r2 = buildQuoteDepositFreeze({ deposit: { type: "AMOUNT", value: 300 } }, 1000);
    if (r2.deposit_display?.mode !== "AMOUNT" || r2.deposit_display.amount_ttc !== 300) {
      fail("AMOUNT 300", new Error(JSON.stringify(r2.deposit_display)));
    } else ok("AMOUNT : plafonné / valeur");

    const r3 = buildQuoteDepositFreeze({ deposit_percent: 10 }, 500);
    if (r3.deposit?.type !== "PERCENT" || r3.deposit_display?.percent !== 10 || r3.deposit_display?.amount_ttc !== 50) {
      fail("legacy deposit_percent", new Error(JSON.stringify(r3)));
    } else ok("fallback legacy deposit_percent");

    const r4 = buildQuoteDepositFreeze({}, 100);
    if (r4.deposit != null || r4.deposit_display != null) fail("sans acompte", new Error("devrait être null"));
    else ok("sans acompte structuré → pas de bloc");

    const rZero = buildQuoteDepositFreeze({ deposit: { type: "PERCENT", value: 30 } }, 0);
    if (rZero.deposit != null || rZero.deposit_display != null) {
      fail("TTC nul + acompte %", new Error(JSON.stringify(rZero)));
    } else ok("TTC nul → aucun acompte structuré (gel)");

    const snap = buildOfficialQuoteDocumentSnapshot({
      quoteRow: {
        id: "q-test",
        quote_number: "D-TEST",
        status: "SENT",
        sent_at: "2026-01-01T12:00:00.000Z",
        currency: "EUR",
        valid_until: null,
        notes: null,
        discount_ht: 0,
        issuer_snapshot: {},
        recipient_snapshot: {},
        metadata_json: { deposit: { type: "PERCENT", value: 30, note: "À la commande" }, pdf_show_line_pricing: false },
        total_ht: 833.33,
        total_vat: 166.67,
        total_ttc: 1000,
        lead_id: null,
        client_id: "c1",
        study_id: null,
        study_version_id: null,
        created_at: "2026-01-01T10:00:00.000Z",
      },
      lineRows: [],
      organizationId: "org1",
      frozenAtIso: "2026-01-01T12:00:00.000Z",
      frozenBy: null,
      generatedFrom: "unit_test",
    });

    if (!snap.deposit_display || snap.deposit_display.mode !== "PERCENT" || snap.deposit_display.amount_ttc !== 300) {
      fail("snapshot contient deposit_display", new Error(JSON.stringify(snap.deposit_display)));
    } else ok("buildOfficialQuoteDocumentSnapshot inclut deposit_display");

    if (!snap.pdf_display || snap.pdf_display.show_line_pricing !== false) {
      fail("snapshot pdf_display.show_line_pricing", new Error(JSON.stringify(snap.pdf_display)));
    } else ok("buildOfficialQuoteDocumentSnapshot inclut pdf_display (metadata)");

    const payload = buildQuotePdfPayloadFromSnapshot(snap);
    if (!payload.deposit_display || payload.deposit_display.percent !== 30) {
      fail("payload PDF inclut deposit_display", new Error(JSON.stringify(payload.deposit_display)));
    } else ok("buildQuotePdfPayloadFromSnapshot propage deposit_display");
    if (!payload.pdf_display || payload.pdf_display.show_line_pricing !== false) {
      fail("payload PDF inclut pdf_display", new Error(JSON.stringify(payload.pdf_display)));
    } else ok("buildQuotePdfPayloadFromSnapshot propage pdf_display");
  } catch (e) {
    fail("exception", e);
  }

  console.log(`\n--- Résumé : ${passed} ok, ${failed} échecs ---\n`);
  if (failed > 0) process.exit(1);
}

run();
