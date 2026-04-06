/**
 * Calcul centralisé des lignes financières (devis / facture / avoir).
 *
 * Convention TVA (alignée sur quote_lines / invoice_lines existantes) :
 * - `vat_rate` est un pourcentage « humain » : 20 signifie 20 %, 5,5 peut être stocké en 5.5.
 * - TVA ligne = arrondi 2 décimales sur (base HT nette × vat_rate / 100).
 *
 * Remise ligne :
 * - `discount_ht` est soustraite de la base HT brute (qty × unit_price_ht), plafonnée à cette base
 *   (remise ne peut pas rendre la base négative).
 */

import { clamp, roundMoney2, toFiniteNumber } from "./moneyRounding.js";

/**
 * @typedef {object} FinancialLineInput
 * @property {unknown} quantity
 * @property {unknown} unit_price_ht
 * @property {unknown} [discount_ht]
 * @property {unknown} vat_rate — pourcentage (ex. 20 pour 20 %)
 */

/**
 * @typedef {object} FinancialLineAmounts
 * @property {number} gross_ht — avant remise ligne
 * @property {number} line_discount_ht — remise effectivement appliquée (≤ gross_ht)
 * @property {number} net_ht — base HT imposable
 * @property {number} total_line_vat
 * @property {number} total_line_ttc
 */

/**
 * Calcule les montants d'une ligne document (HT / TVA / TTC).
 * Quantités et prix négatifs sont traités comme 0 pour la base (robustesse saisie).
 *
 * @param {FinancialLineInput} input
 * @returns {FinancialLineAmounts}
 */
export function computeFinancialLineAmounts(input) {
  const qty = Math.max(0, roundMoney2(toFiniteNumber(input?.quantity)));
  const unitHt = Math.max(0, roundMoney2(toFiniteNumber(input?.unit_price_ht)));
  const discRaw = Math.max(0, roundMoney2(toFiniteNumber(input?.discount_ht)));
  const vatRate = clamp(toFiniteNumber(input?.vat_rate), 0, 100);

  const grossHt = roundMoney2(qty * unitHt);
  const lineDiscountHt = Math.min(discRaw, grossHt);
  const netHt = roundMoney2(grossHt - lineDiscountHt);
  const totalLineVat = roundMoney2((netHt * vatRate) / 100);
  const totalLineTtc = roundMoney2(netHt + totalLineVat);

  return {
    gross_ht: grossHt,
    line_discount_ht: lineDiscountHt,
    net_ht: netHt,
    total_line_vat: totalLineVat,
    total_line_ttc: totalLineTtc,
  };
}

/**
 * Compatibilité avec les champs DB (total_line_ht = net_ht après remise).
 * @param {FinancialLineInput} input
 * @returns {{ total_line_ht: number, total_line_vat: number, total_line_ttc: number, line_discount_ht: number, gross_ht: number }}
 */
export function computeFinancialLineDbFields(input) {
  const a = computeFinancialLineAmounts(input);
  return {
    gross_ht: a.gross_ht,
    line_discount_ht: a.line_discount_ht,
    total_line_ht: a.net_ht,
    total_line_vat: a.total_line_vat,
    total_line_ttc: a.total_line_ttc,
  };
}

/**
 * @typedef {FinancialLineInput & { is_active?: unknown }} DocumentLineInput
 */

/**
 * Totaux document à partir de lignes « métier » (sans remise globale).
 * @param {DocumentLineInput[]} lines
 * @param {{ ignoreInactive?: boolean }} [opts] — si true, ignore les lignes avec is_active === false (devis)
 */
export function sumLineAmounts(lines, opts = {}) {
  const { ignoreInactive = false } = opts;
  let totalHt = 0;
  let totalVat = 0;
  let totalTtc = 0;
  for (const line of lines || []) {
    if (ignoreInactive && line && line.is_active === false) continue;
    const a = computeFinancialLineAmounts(line);
    totalHt = roundMoney2(totalHt + a.net_ht);
    totalVat = roundMoney2(totalVat + a.total_line_vat);
    totalTtc = roundMoney2(totalTtc + a.total_line_ttc);
  }
  return {
    total_ht: totalHt,
    total_vat: totalVat,
    total_ttc: totalTtc,
  };
}

/**
 * Applique une remise globale document (HT) après somme des lignes.
 * Règle PME : réduction proportionnelle du HT et de la TVA des lignes (même ratio),
 * pour conserver une ventilation TVA cohérente lorsque plusieurs taux existent.
 *
 * @param {{ total_ht: number, total_vat: number, total_ttc: number }} subtotals
 * @param {unknown} documentDiscountHt
 */
export function applyDocumentDiscountHt(subtotals, documentDiscountHt) {
  const th = roundMoney2(subtotals.total_ht);
  const tv = roundMoney2(subtotals.total_vat);
  const ttc0 = roundMoney2(subtotals.total_ttc);
  const disc = Math.max(0, roundMoney2(toFiniteNumber(documentDiscountHt)));
  if (th <= 0 || disc <= 0) {
    return {
      total_ht: th,
      total_vat: tv,
      total_ttc: ttc0,
      applied_document_discount_ht: 0,
    };
  }
  const applied = Math.min(disc, th);
  const ratio = (th - applied) / th;
  const newHt = roundMoney2(th * ratio);
  const newVat = roundMoney2(tv * ratio);
  const newTtc = roundMoney2(newHt + newVat);
  return {
    total_ht: newHt,
    total_vat: newVat,
    total_ttc: newTtc,
    applied_document_discount_ht: applied,
  };
}

/**
 * Totaux document : lignes + remise optionnelle sur en-tête (`discount_ht` devis/facture/avoir).
 *
 * @param {DocumentLineInput[]} lines
 * @param {{ documentDiscountHt?: unknown, ignoreInactiveLines?: boolean }} [options]
 */
export function computeDocumentFinancialTotals(lines, options = {}) {
  const sub = sumLineAmounts(lines, { ignoreInactive: !!options.ignoreInactiveLines });
  return applyDocumentDiscountHt(sub, options.documentDiscountHt);
}
