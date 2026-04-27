/**
 * Migration lecture seule par défaut : devis où total en-tête ≠ Σ lignes.
 * Ajoute une ligne « Remise migrée » (PU HT négatif) pour réaligner, puis recalcule via computeQuoteTotalsFromLines.
 *
 * NE traite PAS les devis ayant au moins une facture non annulée.
 *
 * Usage (depuis la racine du repo) :
 *   node backend/scripts/migrate-discount-to-lines.mjs
 *   node backend/scripts/migrate-discount-to-lines.mjs --apply
 *
 * Variables d’environnement : DATABASE_URL (ou .env.dev / backend/.env via dotenv).
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { computeQuoteTotalsFromLines } from "../services/quoteEngine.service.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
  dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
}

const APPLY = process.argv.includes("--apply");
const TOL = 0.02;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function quoteHasNonCancelledInvoices(client, quoteId, orgId) {
  const r = await client.query(
    `SELECT 1 FROM invoices
     WHERE quote_id = $1 AND organization_id = $2
       AND UPPER(COALESCE(status, '')) != 'CANCELLED'
     LIMIT 1`,
    [quoteId, orgId]
  );
  return r.rows.length > 0;
}

async function listMismatchedQuotes() {
  const r = await pool.query(`
    SELECT
      q.id AS quote_id,
      q.organization_id,
      q.total_ht::float8 AS total_ht,
      q.total_vat::float8 AS total_vat,
      q.total_ttc::float8 AS total_ttc,
      COALESCE(SUM(ql.total_line_ht) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sum_ht,
      COALESCE(SUM(ql.total_line_vat) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sum_vat,
      COALESCE(SUM(ql.total_line_ttc) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sum_ttc,
      COALESCE(MAX(ql.position), 0)::int AS max_pos
    FROM quotes q
    LEFT JOIN quote_lines ql ON ql.quote_id = q.id AND ql.organization_id = q.organization_id
    WHERE q.archived_at IS NULL
    GROUP BY q.id, q.organization_id, q.total_ht, q.total_vat, q.total_ttc
    HAVING ABS(COALESCE(q.total_ttc, 0)::float8 - COALESCE(SUM(ql.total_line_ttc) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8) > $1
    ORDER BY q.organization_id, q.id
  `, [TOL]);
  return r.rows;
}

async function main() {
  console.log(`[migrate-discount-to-lines] mode=${APPLY ? "APPLY" : "DRY_RUN"} tolérance_TTC=${TOL}`);
  const rows = await listMismatchedQuotes();
  console.log(`[migrate-discount-to-lines] devis incohérents (TTC) : ${rows.length}`);

  for (const row of rows) {
    const { quote_id: quoteId, organization_id: orgId, total_ht, sum_ht, sum_vat, max_pos } = row;
    const deltaHt = round2(Number(sum_ht) - Number(total_ht));

    const client = await pool.connect();
    try {
      if (await quoteHasNonCancelledInvoices(client, quoteId, orgId)) {
        console.log(`SKIP (factures liées) quote=${quoteId} org=${orgId}`);
        continue;
      }

      if (deltaHt <= 0.01) {
        console.log(`SKIP (écart HT non positif — revue manuelle) quote=${quoteId} deltaHt=${deltaHt}`);
        continue;
      }

      const rate =
        Number(sum_ht) > 0.00001 ? round2((Number(sum_vat) / Number(sum_ht)) * 100) : 20;
      const unitHt = round2(-deltaHt);
      const { total_line_ht: th, total_line_vat: tv, total_line_ttc: tt } = computeFinancialLineDbFields({
        quantity: 1,
        unit_price_ht: unitHt,
        discount_ht: 0,
        vat_rate: Math.max(0, Math.min(100, rate)),
      });
      const pos = Math.max(1, Number(max_pos) + 1);
      const snap = JSON.stringify({
        name: "Remise migrée",
        description: "",
        category: "OTHER",
        line_source: "manual",
        line_kind: "DOCUMENT_DISCOUNT",
        source: {},
      });

      if (!APPLY) {
        console.log(
          `DRY_RUN quote=${quoteId} org=${orgId} deltaHt=${deltaHt} pu_ht=${unitHt} tva%=${rate} position=${pos}`
        );
        continue;
      }

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO quote_lines (
          organization_id, quote_id, catalog_item_id, label, description, quantity, unit_price_ht, discount_ht,
          vat_rate, total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json
        ) VALUES ($1,$2,NULL,$3,'',1,$4,0,$5,$6,$7,$8,$9,$10::jsonb)`,
        [orgId, quoteId, "Remise migrée", unitHt, rate, th, tv, tt, pos, snap]
      );
      await client.query(
        `UPDATE quotes SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) - 'global_discount_percent' - 'global_discount_amount_ht', updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [quoteId, orgId]
      );
      await computeQuoteTotalsFromLines({ quoteId, orgId, client });
      await client.query("COMMIT");
      console.log(`APPLIED quote=${quoteId} org=${orgId} ligne_remise_ht=${unitHt}`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`FAIL quote=${quoteId}`, e?.message || e);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
