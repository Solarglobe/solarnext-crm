/**
 * CP-QUOTE-004 — Moteur devis (snapshot catalogue, totaux en cents/bps)
 * Calculs en entiers (cents, bps). Arrondi TVA : Math.round.
 */

import { pool } from "../config/db.js";

const PRICING_MODE_FIXED = "FIXED";
const PRICING_MODE_UNIT = "UNIT";
const PRICING_MODE_PERCENT_TOTAL = "PERCENT_TOTAL";

/**
 * Item normalisé pour computeQuoteTotals
 * @typedef {{ qty: number, unit_price_ht_cents: number, vat_rate_bps: number, pricing_mode: string, is_active?: boolean }} QuoteItemForTotals
 */

/**
 * Construit le snapshot JSON à partir d'une ligne catalogue (pour stockage dans quote_lines).
 * @param {object} catalogItemRow - ligne quote_catalog_items
 * @returns {object} snapshot_json
 */
export function buildQuoteItemSnapshotFromCatalogItem(catalogItemRow) {
  return {
    name: catalogItemRow.name ?? "",
    description: catalogItemRow.description ?? "",
    category: catalogItemRow.category ?? "OTHER",
    pricing_mode: catalogItemRow.pricing_mode ?? "FIXED",
    source: {
      catalogItemId: catalogItemRow.id ?? null
    }
  };
}

/**
 * Calcule les totaux d'un devis à partir des lignes (logique pure, entiers).
 * FIXED: line_ht = unit_price_ht_cents (qty ignoré, équivalent qty=1).
 * UNIT: line_ht = unit_price_ht_cents * qty.
 * PERCENT_TOTAL: exclu du calcul (option a: interdire en amont).
 * TVA: line_vat = Math.round(line_ht * vat_rate_bps / 10000), line_ttc = line_ht + line_vat.
 *
 * @param {QuoteItemForTotals[]} items
 * @returns {{ total_ht_cents: number, total_vat_cents: number, total_ttc_cents: number, breakdown?: object }}
 */
export function computeQuoteTotals(items) {
  let totalHtCents = 0;
  let totalVatCents = 0;

  const byVatRate = /** @type {Record<number, { ht: number, vat: number }>} */ ({});

  for (const it of items) {
    const active = it.is_active !== false;
    if (!active) continue;

    const qty = Math.max(0, Number(it.qty) || 0);
    const unitCents = Math.max(0, Number(it.unit_price_ht_cents) || 0);
    const vatBps = Math.max(0, Number(it.vat_rate_bps) || 0);
    const mode = (it.pricing_mode || PRICING_MODE_FIXED).toUpperCase();

    if (mode === PRICING_MODE_PERCENT_TOTAL) {
      continue;
    }

    let lineHtCents;
    if (mode === PRICING_MODE_FIXED) {
      lineHtCents = unitCents;
    } else {
      lineHtCents = unitCents * qty;
    }

    const lineVatCents = Math.round((lineHtCents * vatBps) / 10000);
    totalHtCents += lineHtCents;
    totalVatCents += lineVatCents;

    if (!byVatRate[vatBps]) {
      byVatRate[vatBps] = { ht: 0, vat: 0 };
    }
    byVatRate[vatBps].ht += lineHtCents;
    byVatRate[vatBps].vat += lineVatCents;
  }

  const totalTtcCents = totalHtCents + totalVatCents;

  return {
    total_ht_cents: totalHtCents,
    total_vat_cents: totalVatCents,
    total_ttc_cents: totalTtcCents,
    breakdown: { byVatRate }
  };
}

/**
 * Charge les lignes actives du devis, calcule les totaux, persiste dans quotes.
 * CP-QUOTE-005: Ne jamais joindre quote_catalog_items — source de vérité = quote_lines uniquement.
 *
 * @param {{ quoteId: string, orgId: string }} params
 * @returns {Promise<{ total_ht_cents: number, total_vat_cents: number, total_ttc_cents: number }>}
 */
export async function recomputeAndPersistQuoteTotals({ quoteId, orgId }) {
  const res = await pool.query(
    `SELECT id, quantity, unit_price_ht, vat_rate, vat_rate_bps, pricing_mode, is_active
     FROM quote_lines
     WHERE quote_id = $1 AND organization_id = $2
     ORDER BY position`,
    [quoteId, orgId]
  );

  const items = res.rows.map((row) => {
    const qty = Math.max(0, Number(row.quantity) ?? 0);
    const unitCents = Math.round(Number(row.unit_price_ht ?? 0) * 100);
    const vatBps =
      row.vat_rate_bps != null
        ? Number(row.vat_rate_bps)
        : Math.round(Number(row.vat_rate ?? 0) * 100);
    const pricingMode = row.pricing_mode || "FIXED";
    return {
      qty,
      unit_price_ht_cents: unitCents,
      vat_rate_bps: vatBps,
      pricing_mode: pricingMode,
      is_active: row.is_active !== false
    };
  });

  const totals = computeQuoteTotals(items);

  await pool.query(
    `UPDATE quotes
     SET total_ht = $1, total_vat = $2, total_ttc = $3, updated_at = now()
     WHERE id = $4 AND organization_id = $5`,
    [
      totals.total_ht_cents / 100,
      totals.total_vat_cents / 100,
      totals.total_ttc_cents / 100,
      quoteId,
      orgId
    ]
  );

  return totals;
}

export { PRICING_MODE_FIXED, PRICING_MODE_UNIT, PRICING_MODE_PERCENT_TOTAL };
