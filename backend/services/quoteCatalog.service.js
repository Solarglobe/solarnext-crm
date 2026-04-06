/**
 * CP-QUOTE-002 — Service Catalogue devis (quote_catalog_items)
 * Toutes les requêtes sont scopées par organizationId.
 */

import { pool } from "../config/db.js";

const CATEGORIES = [
  "PANEL",
  "INVERTER",
  "MOUNTING",
  "CABLE",
  "PROTECTION_BOX",
  "INSTALL",
  "SERVICE",
  "BATTERY_PHYSICAL",
  "BATTERY_VIRTUAL",
  "PACK",
  "DISCOUNT",
  "OTHER"
];
const PRICING_MODES = ["FIXED", "UNIT", "PERCENT_TOTAL"];

const COLS =
  "id, organization_id, name, description, category, pricing_mode, sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps, is_active, created_at, updated_at";

/**
 * @param {{ orgId: string, includeInactive?: boolean, q?: string, category?: string }}
 */
export async function listQuoteCatalogItems({ orgId, includeInactive = false, q, category }) {
  let sql = `SELECT ${COLS} FROM quote_catalog_items WHERE organization_id = $1`;
  const params = [orgId];

  if (!includeInactive) {
    sql += " AND is_active = true";
  }
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    sql += ` AND name ILIKE $${params.length}`;
  }
  if (category && CATEGORIES.includes(category)) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  sql += " ORDER BY name";

  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * @param {{ orgId: string, id: string }}
 */
export async function getQuoteCatalogItemById({ orgId, id }) {
  const result = await pool.query(
    `SELECT ${COLS} FROM quote_catalog_items WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );
  return result.rows[0] || null;
}

/**
 * @param {{ orgId: string, payload: object }}
 */
export async function createQuoteCatalogItem({ orgId, payload }) {
  const {
    name,
    description = null,
    category,
    pricing_mode = "FIXED",
    sale_price_ht_cents = 0,
    purchase_price_ht_cents = 0,
    default_vat_rate_bps = 2000
  } = payload;

  const result = await pool.query(
    `INSERT INTO quote_catalog_items (
      organization_id, name, description, category, pricing_mode,
      sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING ${COLS}`,
    [
      orgId,
      name,
      description || null,
      category,
      pricing_mode,
      sale_price_ht_cents,
      purchase_price_ht_cents,
      default_vat_rate_bps
    ]
  );
  return result.rows[0];
}

/**
 * @param {{ orgId: string, id: string, patch: object }}
 */
export async function patchQuoteCatalogItem({ orgId, id, patch }) {
  const allowed = [
    "name",
    "description",
    "category",
    "pricing_mode",
    "sale_price_ht_cents",
    "purchase_price_ht_cents",
    "default_vat_rate_bps"
  ];
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (!(key in patch)) continue;
    const val = patch[key];
    if (key === "description") {
      setClauses.push(`description = $${idx}`);
      values.push(val === "" ? null : val);
    } else if (key === "name" || key === "category" || key === "pricing_mode") {
      setClauses.push(`${key} = $${idx}`);
      values.push(val);
    } else {
      setClauses.push(`${key} = $${idx}`);
      values.push(val);
    }
    idx += 1;
  }

  if (setClauses.length === 0) {
    const existing = await pool.query(
      `SELECT ${COLS} FROM quote_catalog_items WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );
    return existing.rows[0] || null;
  }

  setClauses.push("updated_at = now()");
  values.push(id, orgId);
  const idParam = idx;
  const orgParam = idx + 1;

  const result = await pool.query(
    `UPDATE quote_catalog_items SET ${setClauses.join(", ")}
     WHERE id = $${idParam} AND organization_id = $${orgParam}
     RETURNING ${COLS}`,
    values
  );
  return result.rows[0] || null;
}

/**
 * @param {{ orgId: string, id: string, isActive: boolean }}
 */
export async function setQuoteCatalogItemActive({ orgId, id, isActive }) {
  const result = await pool.query(
    `UPDATE quote_catalog_items SET is_active = $1, updated_at = now()
     WHERE id = $2 AND organization_id = $3
     RETURNING ${COLS}`,
    [isActive, id, orgId]
  );
  return result.rows[0] || null;
}

export { CATEGORIES, PRICING_MODES };
