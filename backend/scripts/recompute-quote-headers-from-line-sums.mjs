/**
 * Recalcule quotes.total_* = Σ quote_lines (montants persistés).
 * Utile après correctif computeQuoteTotalsFromLines ou données historiques.
 *
 *   railway run --service solarnext-crm node backend/scripts/recompute-quote-headers-from-line-sums.mjs
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { computeQuoteTotalsFromLines } from "../services/quoteEngine.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const r = await pool.query(
  `SELECT id, organization_id FROM quotes WHERE archived_at IS NULL ORDER BY organization_id, id`
);
let n = 0;
for (const row of r.rows) {
  await computeQuoteTotalsFromLines({ quoteId: row.id, orgId: row.organization_id });
  n++;
}
console.log(`[recompute-quote-headers-from-line-sums] mis à jour : ${n} devis`);
await pool.end();
