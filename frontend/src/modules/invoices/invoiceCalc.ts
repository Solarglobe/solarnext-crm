/**
 * Calculs facture — même convention que le devis (remise ligne en %, HT source).
 */

import type { InvoiceLine } from "./invoice.types";
import type { QuoteLine } from "../quotes/quote.types";
import { computeLineAmounts as quoteComputeLineAmounts } from "../quotes/quoteCalc";

export function computeLineAmounts(line: Pick<InvoiceLine, "quantity" | "unit_price_ht" | "line_discount_percent" | "tva_percent">) {
  return quoteComputeLineAmounts(line as unknown as QuoteLine);
}

export function computeInvoiceTotalsFromLines(lines: InvoiceLine[]): {
  total_ht: number;
  total_tva: number;
  total_ttc: number;
} {
  let total_ht = 0;
  let total_tva = 0;
  let total_ttc = 0;
  for (const ln of lines) {
    const a = computeLineAmounts(ln);
    total_ht += a.net_ht;
    total_tva += a.total_tva;
    total_ttc += a.total_ttc;
  }
  return {
    total_ht: Math.round(total_ht * 100) / 100,
    total_tva: Math.round(total_tva * 100) / 100,
    total_ttc: Math.round(total_ttc * 100) / 100,
  };
}
