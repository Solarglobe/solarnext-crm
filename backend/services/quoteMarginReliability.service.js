/**
 * Marge matériel (devis) — uniquement les lignes actives avec purchase_unit_price_ht_cents renseigné.
 * - margin_ht : CA HT de ces lignes − coût d’achat (lignes sans prix d’achat ignorées).
 * - is_margin_reliable : true si toutes les lignes actives ont un coût (sinon partiel mais chiffré).
 */

/**
 * @param {Array<Record<string, unknown>>} lines - lignes quote_lines
 * @returns {{
 *   is_margin_reliable: boolean,
 *   active_line_count: number,
 *   lines_missing_purchase_count: number,
 *   margin_ht: number | null,
 *   purchase_cost_ht: number | null
 * }}
 */
export function buildQuoteMarginKpi(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  const active = rows.filter((r) => r && r.is_active !== false);
  const activeLineCount = active.length;

  if (activeLineCount === 0) {
    return {
      is_margin_reliable: false,
      active_line_count: 0,
      lines_missing_purchase_count: 0,
      margin_ht: null,
      purchase_cost_ht: null,
    };
  }

  let missing = 0;
  let purchaseCostHt = 0;
  let saleHtTotal = 0;
  /** CA HT des seules lignes avec prix d'achat (base du calcul « partiel ») */
  let saleCoveredHt = 0;

  for (const line of active) {
    const th = Number(line.total_line_ht);
    const q = Number(line.quantity) || 0;
    const puCents = line.purchase_unit_price_ht_cents;
    const hasPurchase = puCents != null && Number.isFinite(Number(puCents));
    if (!hasPurchase) missing += 1;
    if (Number.isFinite(th)) saleHtTotal += th;
    if (hasPurchase) {
      if (Number.isFinite(th)) saleCoveredHt += th;
      purchaseCostHt += q * (Number(puCents) / 100);
    }
  }

  const reliable = missing === 0;
  const purchaseRounded = Math.round(purchaseCostHt * 100) / 100;

  let marginHt = null;
  let purchaseOut = null;

  if (reliable) {
    marginHt = Math.round((saleHtTotal - purchaseCostHt) * 100) / 100;
    purchaseOut = purchaseRounded;
  } else if (saleCoveredHt > 0) {
    marginHt = Math.round((saleCoveredHt - purchaseCostHt) * 100) / 100;
    purchaseOut = purchaseRounded;
  }

  return {
    is_margin_reliable: reliable,
    active_line_count: activeLineCount,
    lines_missing_purchase_count: missing,
    margin_ht: marginHt,
    purchase_cost_ht: purchaseOut,
  };
}
