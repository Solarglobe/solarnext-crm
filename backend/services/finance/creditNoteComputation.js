/**
 * Consolidation avoir (même moteur de lignes que facture / devis).
 */

import { computeDocumentFinancialTotals } from "./financialLine.js";
import { roundMoney2, toFiniteNumber } from "./moneyRounding.js";

/**
 * Recalcule les totaux d'un avoir à partir des lignes saisies (brouillon).
 * @param {import("./financialLine.js").DocumentLineInput[]} lines
 * @param {{ documentDiscountHt?: unknown }} [options]
 */
export function computeCreditNoteTotalsFromLines(lines, options = {}) {
  return computeDocumentFinancialTotals(lines, {
    documentDiscountHt: options.documentDiscountHt ?? 0,
    ignoreInactiveLines: false,
  });
}

/**
 * Plafond comptable d'un avoir : une facture peut être créditée jusqu'à son total TTC,
 * même si elle est déjà soldée par un paiement.
 * @param {{ total_ttc?: unknown, total_credited?: unknown } | null | undefined} invoice
 */
export function computeInvoiceCreditableAmount(invoice) {
  const totalTtc = roundMoney2(toFiniteNumber(invoice?.total_ttc));
  const totalCredited = roundMoney2(toFiniteNumber(invoice?.total_credited));
  return roundMoney2(Math.max(0, totalTtc - totalCredited));
}
