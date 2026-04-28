/**
 * Corrige les devis corrompus:
 * - snapshot.discount_ht > 0
 * - aucune ligne DOCUMENT_DISCOUNT en base
 *
 * Par défaut: DRY-RUN (aucune écriture).
 * Exécution réelle: --apply
 *
 * Usage:
 *   node backend/scripts/fix-missing-document-discount-lines.mjs
 *   node backend/scripts/fix-missing-document-discount-lines.mjs --apply
 */

import "../config/register-local-env.js";
import { pool } from "../config/db.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";

const APPLY = process.argv.includes("--apply");

function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parseSnapshot(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function listImpactedQuotes() {
  const r = await pool.query(
    `SELECT q.id AS quote_id, q.organization_id, q.quote_number, q.document_snapshot_json
     FROM quotes q
     WHERE q.archived_at IS NULL
       AND q.document_snapshot_json IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM quote_lines ql
         WHERE ql.quote_id = q.id
           AND ql.organization_id = q.organization_id
           AND ql.is_active IS DISTINCT FROM false
           AND (ql.snapshot_json::jsonb->>'line_kind') = 'DOCUMENT_DISCOUNT'
       )
     ORDER BY q.created_at ASC`
  );

  const impacted = [];
  for (const row of r.rows) {
    const snapshot = parseSnapshot(row.document_snapshot_json);
    const discountHt = roundMoney2(Number(snapshot?.discount_ht) || 0);
    if (discountHt > 0) {
      impacted.push({
        quote_id: row.quote_id,
        organization_id: row.organization_id,
        quote_number: row.quote_number,
        discount_ht: discountHt,
      });
    }
  }
  return impacted;
}

async function detectDominantVatRate(client, quoteId, orgId) {
  const r = await client.query(
    `SELECT
       vat_rate::numeric AS vat_rate,
       COALESCE(SUM(ABS(total_line_ht)) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS weight_ht
     FROM quote_lines
     WHERE quote_id = $1
       AND organization_id = $2
       AND COALESCE(snapshot_json::jsonb->>'line_kind', '') <> 'DOCUMENT_DISCOUNT'
     GROUP BY vat_rate
     ORDER BY weight_ht DESC, vat_rate DESC`,
    [quoteId, orgId]
  );
  if (r.rows.length < 1) return 20;
  return roundMoney2(Number(r.rows[0].vat_rate) || 20);
}

async function hasDocumentDiscountLine(client, quoteId, orgId) {
  const r = await client.query(
    `SELECT 1
     FROM quote_lines
     WHERE quote_id = $1
       AND organization_id = $2
       AND is_active IS DISTINCT FROM false
       AND (snapshot_json::jsonb->>'line_kind') = 'DOCUMENT_DISCOUNT'
     LIMIT 1`,
    [quoteId, orgId]
  );
  return r.rows.length > 0;
}

async function nextPosition(client, quoteId, orgId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(position), 0)::int AS max_pos
     FROM quote_lines
     WHERE quote_id = $1 AND organization_id = $2`,
    [quoteId, orgId]
  );
  return Number(r.rows[0]?.max_pos || 0) + 1;
}

async function insertDiscountLine(client, quoteId, orgId, discountHt, vatRate, position) {
  const unitPriceHt = roundMoney2(-Math.abs(discountHt));
  const { total_line_ht, total_line_vat, total_line_ttc } = computeFinancialLineDbFields({
    quantity: 1,
    unit_price_ht: unitPriceHt,
    discount_ht: 0,
    vat_rate: vatRate,
  });
  const snapshotJson = JSON.stringify({
    name: "Remise commerciale",
    description: "",
    category: "OTHER",
    line_source: "manual",
    line_kind: "DOCUMENT_DISCOUNT",
    source: {},
  });

  await client.query(
    `INSERT INTO quote_lines (
       organization_id, quote_id, catalog_item_id, label, description, quantity, unit_price_ht, discount_ht,
       vat_rate, total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json
     ) VALUES ($1,$2,NULL,$3,'',1,$4,0,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      orgId,
      quoteId,
      "Remise commerciale",
      unitPriceHt,
      vatRate,
      total_line_ht,
      total_line_vat,
      total_line_ttc,
      position,
      snapshotJson,
    ]
  );
}

async function processQuote(row) {
  const client = await pool.connect();
  try {
    if (!APPLY) {
      console.log(
        `[DRY_RUN] quote_id=${row.quote_id} quote_number=${row.quote_number ?? "—"} discount_ht=${row.discount_ht} status=SUCCESS`
      );
      return "success";
    }

    await client.query("BEGIN");
    const alreadyFixed = await hasDocumentDiscountLine(client, row.quote_id, row.organization_id);
    if (alreadyFixed) {
      await client.query("ROLLBACK");
      console.log(
        `[APPLY] quote_id=${row.quote_id} quote_number=${row.quote_number ?? "—"} discount_ht=${row.discount_ht} status=SUCCESS_ALREADY_FIXED`
      );
      return "already_fixed";
    }

    const vatRate = await detectDominantVatRate(client, row.quote_id, row.organization_id);
    const position = await nextPosition(client, row.quote_id, row.organization_id);
    await insertDiscountLine(
      client,
      row.quote_id,
      row.organization_id,
      row.discount_ht,
      vatRate,
      position
    );

    await client.query("COMMIT");
    console.log(
      `[APPLY] quote_id=${row.quote_id} quote_number=${row.quote_number ?? "—"} discount_ht=${row.discount_ht} status=SUCCESS`
    );
    return "success";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(
      `[${APPLY ? "APPLY" : "DRY_RUN"}] quote_id=${row.quote_id} quote_number=${row.quote_number ?? "—"} discount_ht=${row.discount_ht} status=ERROR error=${e?.message || e}`
    );
    return "error";
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL absent.");
  }
  console.log(`[fix-missing-document-discount-lines] mode=${APPLY ? "APPLY" : "DRY_RUN"}`);
  const impacted = await listImpactedQuotes();
  console.log(`[fix-missing-document-discount-lines] impacted_quotes=${impacted.length}`);
  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of impacted) {
    // quote_id + montant remise + statut SUCCESS/ERROR
    const status = await processQuote(row);
    if (status === "success") fixedCount++;
    else if (status === "already_fixed") skippedCount++;
    else if (status === "error") errorCount++;
  }

  console.log(
    `[fix-missing-document-discount-lines] summary fixed=${fixedCount} skipped=${skippedCount} errors=${errorCount}`
  );

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});

