/**
 * Consolidation avoir (même moteur de lignes que facture / devis).
 */

import { computeDocumentFinancialTotals } from "./financialLine.js";

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
