/**
 * Migration : devis où total TTC en-tête ≠ Σ lignes TTC.
 * Répartition « Remise migrée » par tranche TVA (HT en centimes, somme exacte), puis computeQuoteTotalsFromLines.
 *
 * SKIP (log MIGRATION_SKIPPED_PROTECTED_QUOTE) si :
 * - facture liée non annulée (TYPE C)
 * - PDF devis ou PDF signé présent (TYPE B — montants figés)
 *
 * Aligné classification audit MISSION 5 : TYPE A (sans facture, sans PDF) est migré même si ACCEPTED.
 *
 * Usage :
 *   node backend/scripts/migrate-discount-to-lines.mjs
 *   node backend/scripts/migrate-discount-to-lines.mjs --apply
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { computeQuoteTotalsFromLines } from "../services/quoteEngine.service.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";
import { QUOTE_DOC_PDF_SIGNED } from "../constants/entityDocumentsRowTypes.js";

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

function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function mergeHtCentsByVatRate(contributions) {
  const m = new Map();
  for (const { vatRatePercent, lineHtCents } of contributions) {
    const r = roundMoney2(Number(vatRatePercent) || 0);
    const k = String(r);
    const c = Math.max(0, Math.round(Number(lineHtCents) || 0));
    if (c <= 0) continue;
    m.set(k, (m.get(k) || 0) + c);
  }
  return [...m.entries()].map(([k, cents]) => ({ vatRatePercent: Number(k), lineHtCents: cents }));
}

function allocateDiscountHtCentsByVatGroups(groups, discountHtTotalEuro) {
  const targetCents = Math.max(0, Math.round(roundMoney2(Number(discountHtTotalEuro) || 0) * 100));
  if (targetCents === 0 || groups.length === 0) return [];
  const totalHtCents = groups.reduce((s, g) => s + g.lineHtCents, 0);
  if (totalHtCents <= 0) return [];

  const raw = groups.map((g) => ({
    vatRatePercent: g.vatRatePercent,
    lineHtCents: g.lineHtCents,
    rawShare: (targetCents * g.lineHtCents) / totalHtCents,
  }));
  const floors = raw.map((x) => Math.floor(x.rawShare));
  const add = new Array(raw.length).fill(0);
  let allocated = floors.reduce((s, v) => s + v, 0);
  const rem = targetCents - allocated;
  const order = raw
    .map((x, i) => ({ i, frac: x.rawShare - Math.floor(x.rawShare) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) add[order[k].i]++;

  const out = [];
  for (let i = 0; i < raw.length; i++) {
    out.push({ vatRatePercent: raw[i].vatRatePercent, discountHtCents: floors[i] + add[i] });
  }
  let sumOut = out.reduce((s, x) => s + x.discountHtCents, 0);
  const diff = targetCents - sumOut;
  if (diff !== 0 && out.length > 0) out[out.length - 1].discountHtCents += diff;
  const filtered = out.filter((x) => x.discountHtCents > 0);
  let s = filtered.reduce((acc, x) => acc + x.discountHtCents, 0);
  if (s !== targetCents && filtered.length > 0) {
    filtered[filtered.length - 1].discountHtCents += targetCents - s;
  }
  return filtered;
}

async function getSkipReason(client, quoteId, orgId) {
  const q = await client.query(
    `SELECT
      EXISTS (
        SELECT 1 FROM entity_documents ed
        WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
          AND ed.document_type = 'quote_pdf' AND ed.archived_at IS NULL
      ) AS has_pdf,
      EXISTS (
        SELECT 1 FROM entity_documents ed
        WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
          AND ed.document_type = $3 AND ed.archived_at IS NULL
      ) AS has_signed_pdf
     FROM quotes q WHERE q.id = $1 AND q.organization_id = $2 AND q.archived_at IS NULL`,
    [quoteId, orgId, QUOTE_DOC_PDF_SIGNED]
  );
  const row = q.rows[0];
  if (!row) return "NOT_FOUND";
  const inv = await client.query(
    `SELECT 1 FROM invoices WHERE quote_id = $1 AND organization_id = $2
     AND UPPER(COALESCE(status, '')) != 'CANCELLED' LIMIT 1`,
    [quoteId, orgId]
  );
  if (inv.rows.length > 0) return "HAS_INVOICE";
  if (row.has_signed_pdf) return "HAS_SIGNED_PDF";
  if (row.has_pdf) return "HAS_PDF";
  return null;
}

async function listMismatchedQuotes() {
  const r = await pool.query(
    `
    SELECT
      q.id AS quote_id,
      q.organization_id,
      q.total_ht::float8 AS total_ht,
      q.total_ttc::float8 AS total_ttc,
      COALESCE(SUM(ql.total_line_ht) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sum_ht,
      COALESCE(SUM(ql.total_line_ttc) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8 AS sum_ttc,
      COALESCE(MAX(ql.position), 0)::int AS max_pos
    FROM quotes q
    LEFT JOIN quote_lines ql ON ql.quote_id = q.id AND ql.organization_id = q.organization_id
    WHERE q.archived_at IS NULL
    GROUP BY q.id, q.organization_id, q.total_ht, q.total_ttc
    HAVING ABS(COALESCE(q.total_ttc, 0)::float8 - COALESCE(SUM(ql.total_line_ttc) FILTER (WHERE ql.is_active IS DISTINCT FROM false), 0)::float8) > $1
    ORDER BY q.organization_id, q.id
  `,
    [TOL]
  );
  return r.rows;
}

function isPositiveProductLine(row) {
  const ht = Number(row.total_line_ht) || 0;
  if (ht <= 0.00001) return false;
  let snap = row.snapshot_json;
  if (snap == null) return true;
  if (typeof snap === "string") {
    try {
      snap = JSON.parse(snap);
    } catch {
      return true;
    }
  }
  if (snap?.line_kind === "DOCUMENT_DISCOUNT" || snap?.document_discount_line === true) return false;
  return true;
}

async function main() {
  console.log(`[migrate-discount-to-lines] mode=${APPLY ? "APPLY" : "DRY_RUN"} tolérance_TTC=${TOL}`);
  const rows = await listMismatchedQuotes();
  console.log(`[migrate-discount-to-lines] devis TTC incohérents : ${rows.length}`);

  for (const row of rows) {
    const { quote_id: quoteId, organization_id: orgId, total_ht, sum_ht, max_pos } = row;
    const deltaHt = round2(Number(sum_ht) - Number(total_ht));

    const client = await pool.connect();
    try {
      const skip = await getSkipReason(client, quoteId, orgId);
      if (skip) {
        console.log(`MIGRATION_SKIPPED_PROTECTED_QUOTE quote=${quoteId} org=${orgId} reason=${skip}`);
        continue;
      }

      if (deltaHt <= 0.01) {
        console.log(`SKIP (écart HT non positif) quote=${quoteId} deltaHt=${deltaHt}`);
        continue;
      }

      const linesRes = await client.query(
        `SELECT total_line_ht, vat_rate, snapshot_json, position
         FROM quote_lines WHERE quote_id = $1 AND organization_id = $2 AND is_active IS DISTINCT FROM false
         ORDER BY position`,
        [quoteId, orgId]
      );
      const contributions = [];
      for (const lr of linesRes.rows) {
        if (!isPositiveProductLine(lr)) continue;
        const rate = Number(lr.vat_rate) || 0;
        const c = Math.round(Number(lr.total_line_ht) * 100);
        if (c > 0) contributions.push({ vatRatePercent: rate, lineHtCents: c });
      }
      const groups = mergeHtCentsByVatRate(contributions);
      const alloc = allocateDiscountHtCentsByVatGroups(groups, deltaHt);
      if (alloc.length === 0) {
        console.log(`SKIP (aucune base HT positive) quote=${quoteId}`);
        continue;
      }

      let pos = Math.max(1, Number(max_pos) + 1);
      if (!APPLY) {
        console.log(
          `DRY_RUN quote=${quoteId} org=${orgId} deltaHt=${deltaHt} remise_lignes=${alloc.map((a) => `${a.discountHtCents / 100}€@${a.vatRatePercent}%`).join(" | ")}`
        );
        continue;
      }

      await client.query("BEGIN");
      for (const { vatRatePercent, discountHtCents } of alloc) {
        const unitHt = round2(-(discountHtCents / 100));
        const rate = Math.max(0, Math.min(100, vatRatePercent));
        const { total_line_ht: th, total_line_vat: tv, total_line_ttc: tt } = computeFinancialLineDbFields({
          quantity: 1,
          unit_price_ht: unitHt,
          discount_ht: 0,
          vat_rate: rate,
        });
        const snap = JSON.stringify({
          name: "Remise migrée",
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
          [orgId, quoteId, "Remise migrée", unitHt, rate, th, tv, tt, pos++, snap]
        );
      }
      await client.query(
        `UPDATE quotes SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) - 'global_discount_percent' - 'global_discount_amount_ht', updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [quoteId, orgId]
      );
      await computeQuoteTotalsFromLines({ quoteId, orgId, client });
      await client.query("COMMIT");
      console.log(`APPLIED quote=${quoteId} org=${orgId} lignes_remise=${alloc.length}`);
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
