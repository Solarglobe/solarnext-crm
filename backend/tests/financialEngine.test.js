/**
 * Moteur comptable simplifié (services/finance) — tests unitaires.
 * Usage: node tests/financialEngine.test.js
 */

import {
  computeFinancialLineAmounts,
  computeDocumentFinancialTotals,
  sumLineAmounts,
  applyDocumentDiscountHt,
} from "../services/finance/financialLine.js";
import {
  computeInvoiceBalance,
  computeInvoiceAmountDue,
  summarizeInvoicePayments,
  summarizeInvoiceCredits,
  suggestInvoiceStatusFromAmounts,
  validatePaymentInput,
  previewPaymentImpact,
} from "../services/finance/invoiceBalance.js";
import {
  isQuoteEditable,
  isInvoiceEditable,
  isCreditNoteEditable,
} from "../services/finance/financialImmutability.js";
import { computeCreditNoteTotalsFromLines } from "../services/finance/creditNoteComputation.js";
import { roundMoney2, MONEY_EPSILON } from "../services/finance/moneyRounding.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 0.01) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function main() {
  console.log("=== Tests financialEngine (PROMPT 6) ===\n");

  // --- Lignes ---
  test("1) ligne simple sans remise", () => {
    const a = computeFinancialLineAmounts({ quantity: 2, unit_price_ht: 50, vat_rate: 20 });
    assertApprox(a.net_ht, 100, "HT");
    assertApprox(a.total_line_vat, 20, "TVA");
    assertApprox(a.total_line_ttc, 120, "TTC");
  });

  test("2) ligne avec remise ligne", () => {
    const a = computeFinancialLineAmounts({
      quantity: 1,
      unit_price_ht: 100,
      discount_ht: 10,
      vat_rate: 20,
    });
    assertApprox(a.net_ht, 90, "HT net");
    assertApprox(a.total_line_vat, 18, "TVA");
    assertApprox(a.total_line_ttc, 108, "TTC");
  });

  test("3) TVA 0", () => {
    const a = computeFinancialLineAmounts({ quantity: 3, unit_price_ht: 10, vat_rate: 0 });
    assertApprox(a.total_line_vat, 0, "TVA");
    assertApprox(a.total_line_ttc, a.net_ht, "TTC=HT");
  });

  test("4) quantité négative / invalide → 0", () => {
    const a = computeFinancialLineAmounts({ quantity: -5, unit_price_ht: 100, vat_rate: 20 });
    assertApprox(a.net_ht, 0, "HT");
  });

  test("5) discount > base HT → plafonné", () => {
    const a = computeFinancialLineAmounts({
      quantity: 1,
      unit_price_ht: 50,
      discount_ht: 999,
      vat_rate: 20,
    });
    assertApprox(a.line_discount_ht, 50, "remise plafonnée");
    assertApprox(a.net_ht, 0, "HT net");
    assertApprox(a.total_line_ttc, 0, "TTC");
  });

  // --- Documents ---
  test("6) somme de plusieurs lignes", () => {
    const lines = [
      { quantity: 1, unit_price_ht: 100, vat_rate: 20 },
      { quantity: 2, unit_price_ht: 25, vat_rate: 10 },
    ];
    const t = computeDocumentFinancialTotals(lines);
    assertApprox(t.total_ht, 150, "HT"); // 100 + 50
    assertApprox(t.total_vat, 25, "TVA"); // 20 + 5
    assertApprox(t.total_ttc, 175, "TTC");
  });

  test("7) lignes inactives ignorées (devis)", () => {
    const lines = [
      { quantity: 1, unit_price_ht: 100, vat_rate: 20, is_active: true },
      { quantity: 1, unit_price_ht: 100, vat_rate: 20, is_active: false },
    ];
    const s = sumLineAmounts(lines, { ignoreInactive: true });
    assertApprox(s.total_ht, 100, "une ligne");
  });

  test("8) remise document + cohérence totaux", () => {
    const lines = [
      { quantity: 1, unit_price_ht: 100, vat_rate: 20 },
      { quantity: 1, unit_price_ht: 100, vat_rate: 20 },
    ];
    const t = computeDocumentFinancialTotals(lines, { documentDiscountHt: 40 });
    assert(t.applied_document_discount_ht === 40, "remise appliquée");
    assertApprox(t.total_ht, 160, "HT après remise globale");
    assertApprox(t.total_ttc, t.total_ht + t.total_vat, "TTC cohérent");
  });

  // --- Factures / soldes ---
  test("9) facture sans paiement ni avoir", () => {
    const b = computeInvoiceBalance({ total_ttc: 120, total_paid: 0, total_credited: 0 });
    assertApprox(b.amount_due, 120, "due");
  });

  test("10) paiement partiel", () => {
    const b = computeInvoiceBalance({ total_ttc: 100, total_paid: 30, total_credited: 0 });
    assertApprox(b.amount_due, 70, "due");
    assert(suggestInvoiceStatusFromAmounts({ status: "ISSUED", ...b }) === "PARTIALLY_PAID", "statut");
  });

  test("11) facture soldée (paiement total)", () => {
    const b = computeInvoiceBalance({ total_ttc: 200, total_paid: 200, total_credited: 0 });
    assert(b.amount_due <= MONEY_EPSILON, "due 0");
    assert(suggestInvoiceStatusFromAmounts({ status: "ISSUED", ...b }) === "PAID", "PAID");
  });

  test("12) soldée via paiement + avoir", () => {
    const b = computeInvoiceBalance({ total_ttc: 300, total_paid: 100, total_credited: 200 });
    assertApprox(b.amount_due, 0, "due");
    assert(suggestInvoiceStatusFromAmounts({ status: "PARTIALLY_PAID", ...b }) === "PAID", "PAID");
  });

  test("13) avoir total sans paiement", () => {
    const b = computeInvoiceBalance({ total_ttc: 100, total_paid: 0, total_credited: 100 });
    assertApprox(b.amount_due, 0, "due");
    assert(suggestInvoiceStatusFromAmounts({ status: "ISSUED", ...b }) === "PAID", "PAID");
  });

  test("14) amount_due jamais négatif", () => {
    const due = computeInvoiceAmountDue({ total_ttc: 50, total_paid: 80, total_credited: 0 });
    assert(due >= 0, ">=0");
    assertApprox(due, 0, "clamp");
  });

  test("résumé paiements (RECORDED uniquement)", () => {
    const s = summarizeInvoicePayments([
      { amount: 10, status: "RECORDED" },
      { amount: 5, status: "CANCELLED" },
    ]);
    assertApprox(s.total_paid, 10, "sum");
  });

  test("résumé avoirs ISSUED non archivés", () => {
    const s = summarizeInvoiceCredits([
      { total_ttc: 50, status: "ISSUED", archived_at: null },
      { total_ttc: 20, status: "DRAFT", archived_at: null },
    ]);
    assertApprox(s.total_credited, 50, "cn");
  });

  test("validation paiement", () => {
    assert(validatePaymentInput({ invoice_id: "x", amount: 1 }).ok, "ok");
    assert(!validatePaymentInput({ amount: 1 }).ok, "sans facture");
    assert(!validatePaymentInput({ invoice_id: "x", amount: 0 }).ok, "montant 0");
  });

  test("prévisualisation impact paiement", () => {
    const p = previewPaymentImpact(
      { total_ttc: 100, total_paid: 0, total_credited: 0 },
      { amount: 40 }
    );
    assertApprox(p.after.amount_due, 60, "after");
  });

  test("computeCreditNoteTotalsFromLines alias", () => {
    const t = computeCreditNoteTotalsFromLines([{ quantity: 1, unit_price_ht: 50, vat_rate: 20 }]);
    assertApprox(t.total_ttc, 60, "ttc");
  });

  // --- Éditabilité ---
  test("15) devis DRAFT éditable / SENT non", () => {
    assert(isQuoteEditable("DRAFT"), "draft");
    assert(isQuoteEditable("READY_TO_SEND"), "ready");
    assert(!isQuoteEditable("SENT"), "sent");
  });

  test("16) facture DRAFT éditable / ISSUED non", () => {
    assert(isInvoiceEditable("DRAFT"), "draft");
    assert(!isInvoiceEditable("ISSUED"), "issued");
  });

  test("17) avoir DRAFT éditable / ISSUED non", () => {
    assert(isCreditNoteEditable("DRAFT"), "draft");
    assert(!isCreditNoteEditable("ISSUED"), "issued");
  });

  test("arrondi stable 2 décimales (exemple 10,33)", () => {
    const a = computeFinancialLineAmounts({ quantity: 3, unit_price_ht: 10.33, vat_rate: 20 });
    assertApprox(a.net_ht, roundMoney2(30.99), "HT", 0.001);
  });

  console.log("\n============================================================");
  console.log(`Résumé: ${passed} réussis, ${failed} échoués`);
  console.log("============================================================");
  if (failed > 0) process.exit(1);
}

main();
