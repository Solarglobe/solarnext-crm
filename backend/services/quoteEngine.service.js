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
    const unitCents = Math.round(Number(it.unit_price_ht_cents) || 0);
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
 * Source de vérité unique : Σ quote_lines (lignes actives) → quotes.total_* ; remise document = ligne négative, pas discount_ht en-tête.
 *
 * @param {{ quoteId: string, orgId: string, client?: import("pg").PoolClient }} params
 * @returns {Promise<{ total_ht_cents: number, total_vat_cents: number, total_ttc_cents: number }>}
 */
export async function computeQuoteTotalsFromLines({ quoteId, orgId, client = null }) {
  const q = client || pool;
  const res = await q.query(
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

  await q.query(
    `UPDATE quotes
     SET total_ht = $1, total_vat = $2, total_ttc = $3, discount_ht = 0, updated_at = now()
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

/** @deprecated Utiliser computeQuoteTotalsFromLines — alias conservé pour imports existants. */
export async function recomputeAndPersistQuoteTotals(params) {
  return computeQuoteTotalsFromLines(params);
}

const QUOTE_HEADER_LINE_TOLERANCE = 0.02;

/**
 * Après computeQuoteTotalsFromLines : vérifie cohérence Σ lignes (montants persistés) vs en-tête.
 * @param {import("pg").PoolClient} client
 */
export async function assertQuoteLinesMatchHeaderOrThrow(client, quoteId, orgId) {
  const r = await client.query(
    `SELECT
       q.total_ht::float8 AS th,
       q.total_vat::float8 AS tv,
       q.total_ttc::float8 AS ttc,
       COALESCE(SUM(ql.total_line_ht) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sht,
       COALESCE(SUM(ql.total_line_vat) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sv,
       COALESCE(SUM(ql.total_line_ttc) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sttc
     FROM quotes q
     LEFT JOIN quote_lines ql ON ql.quote_id = q.id AND ql.organization_id = q.organization_id
     WHERE q.id = $1 AND q.organization_id = $2
     GROUP BY q.id, q.total_ht, q.total_vat, q.total_ttc`,
    [quoteId, orgId]
  );
  const row = r.rows[0];
  if (!row) return;
  const dHt = Math.abs(Number(row.th) - Number(row.sht));
  const dVat = Math.abs(Number(row.tv) - Number(row.sv));
  const dTtc = Math.abs(Number(row.ttc) - Number(row.sttc));
  if (dHt > QUOTE_HEADER_LINE_TOLERANCE || dVat > QUOTE_HEADER_LINE_TOLERANCE || dTtc > QUOTE_HEADER_LINE_TOLERANCE) {
    const err = new Error(
      `Incohérence financière devis : totaux en-tête ≠ somme des lignes (HT Δ=${dHt.toFixed(4)}, TVA Δ=${dVat.toFixed(4)}, TTC Δ=${dTtc.toFixed(4)}). Corrigez les lignes avant acceptation.`
    );
    err.statusCode = 400;
    throw err;
  }
}

export { PRICING_MODE_FIXED, PRICING_MODE_UNIT, PRICING_MODE_PERCENT_TOTAL };
