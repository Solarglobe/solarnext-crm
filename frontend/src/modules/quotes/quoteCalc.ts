/**
 * Calculs devis — alignés backend (computeFinancialLineDbFields + applyDocumentDiscountHt).
 */

import type { QuoteDeposit, QuoteLine, QuoteTotals } from "./quote.types";

export const VAT_OPTIONS = [0, 5.5, 10, 20] as const;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLineAmounts(line: Pick<QuoteLine, "quantity" | "unit_price_ht" | "line_discount_percent" | "tva_percent">) {
  const qty = Math.max(0, round2(Number(line.quantity) || 0));
  const up = Math.max(0, round2(Number(line.unit_price_ht) || 0));
  const grossHt = round2(qty * up);
  const pct = Math.max(0, Math.min(100, Number(line.line_discount_percent) || 0));
  const lineDiscountHt = Math.min(round2(grossHt * (pct / 100)), grossHt);
  const netHt = round2(grossHt - lineDiscountHt);
  const vatRate = Math.max(0, Math.min(100, Number(line.tva_percent) || 0));
  const totalTva = round2((netHt * vatRate) / 100);
  const totalTtc = round2(netHt + totalTva);
  return {
    gross_ht: grossHt,
    line_discount_ht: lineDiscountHt,
    net_ht: netHt,
    total_tva: totalTva,
    total_ttc: totalTtc,
  };
}

/** Équivalent applyDocumentDiscountHt (financialLine.js) */
export function applyGlobalDiscountHt(
  subtotalHt: number,
  subtotalVat: number,
  subtotalTtc: number,
  discountHt: number
): { total_ht: number; total_vat: number; total_ttc: number; applied_document_discount_ht: number } {
  const th = round2(subtotalHt);
  const tv = round2(subtotalVat);
  const ttc0 = round2(subtotalTtc);
  const disc = Math.max(0, round2(discountHt));
  if (th <= 0 || disc <= 0) {
    return { total_ht: th, total_vat: tv, total_ttc: ttc0, applied_document_discount_ht: 0 };
  }
  const applied = Math.min(disc, th);
  const ratio = (th - applied) / th;
  const newHt = round2(th * ratio);
  const newVat = round2(tv * ratio);
  const newTtc = round2(newHt + newVat);
  return {
    total_ht: newHt,
    total_vat: newVat,
    total_ttc: newTtc,
    applied_document_discount_ht: applied,
  };
}

/** Montant TTC attendu pour l’acompte (plafonné au total TTC du devis). */
export function computeExpectedDepositTtc(deposit: QuoteDeposit, totalTtc: number): number {
  const ttc = Math.max(0, round2(totalTtc));
  const v = Number(deposit.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (deposit.type === "PERCENT") {
    const pct = Math.min(100, Math.max(0, v));
    return round2((ttc * pct) / 100);
  }
  return round2(Math.min(ttc, Math.max(0, v)));
}

export function computeQuoteTotals(
  lines: QuoteLine[],
  globalDiscountPercent: number,
  globalDiscountAmountHt: number = 0
): QuoteTotals {
  let subHt = 0;
  let subVat = 0;
  let subTtc = 0;
  for (const ln of lines) {
    const a = computeLineAmounts(ln);
    subHt = round2(subHt + a.net_ht);
    subVat = round2(subVat + a.total_tva);
    subTtc = round2(subTtc + a.total_ttc);
  }
  const pct = Math.max(0, Math.min(100, globalDiscountPercent));
  const amtHt = Math.max(0, round2(globalDiscountAmountHt));
  const docDiscHt = round2(subHt * (pct / 100) + amtHt);
  const fin = applyGlobalDiscountHt(subHt, subVat, subTtc, docDiscHt);
  return {
    subtotal_ht: subHt,
    subtotal_tva: subVat,
    subtotal_ttc: subTtc,
    total_ht: fin.total_ht,
    total_tva: fin.total_vat,
    total_ttc: fin.total_ttc,
    applied_global_discount_ht: fin.applied_document_discount_ht,
  };
}

export function grossHtFromLine(line: Pick<QuoteLine, "quantity" | "unit_price_ht">): number {
  const qty = Math.max(0, round2(Number(line.quantity) || 0));
  const up = Math.max(0, round2(Number(line.unit_price_ht) || 0));
  return round2(qty * up);
}

export function discountPercentFromHt(grossHt: number, discountHt: number): number {
  if (grossHt <= 0) return 0;
  return round2(Math.min(100, (Math.max(0, discountHt) / grossHt) * 100));
}

/** Ligne éligible « matériel » : prix d'achat unitaire HT en centimes strictement > 0. */
export type MaterialMarginLineInput = {
  quantity: number;
  unit_price_ht: number;
  purchase_price_ht_cents?: number | null;
};

/**
 * Marge matériel HT — uniquement lignes avec coût d'achat renseigné (> 0 côté centimes).
 * Vente HT = Σ(qty × PU HT) ; achat HT = Σ((centimes/100) × qty) ; marge = vente − achat ;
 * taux marge commerciale (%) = marge / prix de vente matériel HT = marge / vente (si vente > 0).
 */
export function computeMaterialMarginFromLines(lines: MaterialMarginLineInput[]): {
  venteMaterialHt: number;
  achatMaterialHt: number;
  margeHt: number;
  tauxMargeSurAchatPct: number | null;
} {
  let vente = 0;
  let achat = 0;
  for (const l of lines) {
    const c = l.purchase_price_ht_cents;
    if (c == null || !Number.isFinite(Number(c)) || Number(c) <= 0) continue;
    const qty = Math.max(0, round2(Number(l.quantity) || 0));
    const up = Math.max(0, round2(Number(l.unit_price_ht) || 0));
    vente = round2(vente + round2(qty * up));
    achat = round2(achat + round2((Number(c) / 100) * qty));
  }
  const marge = round2(vente - achat);
  const taux = vente > 0 ? round2((marge / vente) * 100) : null;
  return { venteMaterialHt: vente, achatMaterialHt: achat, margeHt: marge, tauxMargeSurAchatPct: taux };
}
