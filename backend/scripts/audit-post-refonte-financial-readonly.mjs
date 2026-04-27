/**
 * AUDIT POST-REFONTE — lecture seule (aucun UPDATE / DELETE / apply migration).
 * À lancer sur la base PROD, ex. :
 *   railway run --service solarnext-crm node backend/scripts/audit-post-refonte-financial-readonly.mjs
 *
 * Variables : DATABASE_URL (injectée par Railway ou .env.dev local).
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { QUOTE_DOC_PDF_SIGNED } from "../constants/entityDocumentsRowTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
  dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
}

const EPS = 0.02;

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function fmtEur(x) {
  return n(x).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ecartHeaderMinusLines(th, tv, ttc, sh, sv, st) {
  return {
    dht: n(th) - n(sh),
    dvat: n(tv) - n(sv),
    dttc: n(ttc) - n(st),
  };
}

function okM1(dttc) {
  return Math.abs(dttc) <= EPS ? "OK" : "NOK";
}

async function mission1Last20() {
  console.log("\n=== MISSION 1 — 20 derniers devis (header vs Σ lignes) ===\n");
  const r = await pool.query(`
    WITH last20 AS (
      SELECT id, organization_id, quote_number, created_at, status,
             total_ht::numeric, total_vat::numeric, total_ttc::numeric
      FROM quotes
      WHERE archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    ),
    sums AS (
      SELECT l.quote_id, l.organization_id,
        COALESCE(SUM(l.total_line_ht) FILTER (WHERE l.is_active IS DISTINCT FROM false), 0)::numeric AS s_ht,
        COALESCE(SUM(l.total_line_vat) FILTER (WHERE l.is_active IS DISTINCT FROM false), 0)::numeric AS s_vat,
        COALESCE(SUM(l.total_line_ttc) FILTER (WHERE l.is_active IS DISTINCT FROM false), 0)::numeric AS s_ttc
      FROM quote_lines l
      INNER JOIN last20 q ON q.id = l.quote_id AND q.organization_id = l.organization_id
      GROUP BY l.quote_id, l.organization_id
    )
    SELECT q.quote_number, q.created_at, q.status,
           q.total_ht, q.total_vat, q.total_ttc,
           COALESCE(s.s_ht, 0) AS sum_ht, COALESCE(s.s_vat, 0) AS sum_vat, COALESCE(s.s_ttc, 0) AS sum_ttc
    FROM last20 q
    LEFT JOIN sums s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    ORDER BY q.created_at DESC
  `);
  console.log("quote_number | created_at | total_ttc | sum_lines_ttc | écart_TTC | statut");
  console.log("-".repeat(100));
  let allOk = true;
  for (const row of r.rows) {
    const { dttc } = ecartHeaderMinusLines(row.total_ht, row.total_vat, row.total_ttc, row.sum_ht, row.sum_vat, row.sum_ttc);
    const st = okM1(dttc);
    if (st === "NOK") allOk = false;
    const cn = row.quote_number ?? row.created_at;
    console.log(
      `${cn} | ${row.created_at?.toISOString?.() ?? row.created_at} | ${fmtEur(row.total_ttc)} | ${fmtEur(row.sum_ttc)} | ${fmtEur(dttc)} | ${st}`
    );
  }
  return { allOk, count: r.rows.length };
}

async function mission2MultiVatDiscount() {
  console.log("\n=== MISSION 2 — Multi-TVA + lignes DOCUMENT_DISCOUNT ===\n");
  const r = await pool.query(`
    WITH pos_lines AS (
      SELECT q.id AS quote_id, q.organization_id, q.quote_number, ql.vat_rate
      FROM quotes q
      INNER JOIN quote_lines ql ON ql.quote_id = q.id AND ql.organization_id = q.organization_id
      WHERE q.archived_at IS NULL
        AND ql.is_active IS DISTINCT FROM false
        AND ql.total_line_ht::numeric > 0.0001
        AND COALESCE(ql.snapshot_json::jsonb->>'line_kind', '') <> 'DOCUMENT_DISCOUNT'
    ),
    by_quote AS (
      SELECT quote_id, organization_id, quote_number,
        COUNT(DISTINCT vat_rate)::int AS nb_tva_pos
      FROM pos_lines
      GROUP BY quote_id, organization_id, quote_number
      HAVING COUNT(DISTINCT vat_rate) > 1
    ),
    disc AS (
      SELECT ql.quote_id, ql.organization_id,
        COUNT(*)::int AS nb_remise
      FROM quote_lines ql
      INNER JOIN by_quote b ON b.quote_id = ql.quote_id AND b.organization_id = ql.organization_id
      WHERE ql.is_active IS DISTINCT FROM false
        AND ql.snapshot_json::jsonb->>'line_kind' = 'DOCUMENT_DISCOUNT'
      GROUP BY ql.quote_id, ql.organization_id
    )
    SELECT b.quote_number, b.nb_tva_pos, COALESCE(d.nb_remise, 0) AS nb_remise,
      CASE
        WHEN COALESCE(d.nb_remise, 0) = b.nb_tva_pos THEN 'oui'
        WHEN COALESCE(d.nb_remise, 0) = 1 AND b.nb_tva_pos > 1 THEN 'non (1 remise / plusieurs TVA)'
        ELSE 'non'
      END AS coherent
    FROM by_quote b
    LEFT JOIN disc d ON d.quote_id = b.quote_id AND d.organization_id = b.organization_id
    ORDER BY b.quote_number NULLS LAST
    LIMIT 200
  `);
  console.log("quote_number | nb_tva | nb_lignes_remise | cohérent");
  console.log("-".repeat(70));
  for (const row of r.rows) {
    console.log(`${row.quote_number ?? "—"} | ${row.nb_tva_pos} | ${row.nb_remise} | ${row.coherent}`);
  }
  return r.rows.length;
}

async function mission3FiveUninvoiced() {
  console.log("\n=== MISSION 3 — 5 devis récents sans facture (Σ lignes vs en-tête) ===\n");
  const r = await pool.query(`
    WITH no_inv AS (
      SELECT q.id, q.organization_id, q.quote_number, q.created_at,
             q.total_ht::numeric, q.total_vat::numeric, q.total_ttc::numeric
      FROM quotes q
      WHERE q.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.quote_id = q.id AND i.organization_id = q.organization_id
            AND UPPER(COALESCE(i.status,'')) <> 'CANCELLED'
        )
      ORDER BY q.created_at DESC
      LIMIT 5
    ),
    sums AS (
      SELECT l.quote_id, l.organization_id,
        COALESCE(SUM(l.total_line_ttc) FILTER (WHERE l.is_active IS DISTINCT FROM false), 0)::numeric AS s_ttc
      FROM quote_lines l
      INNER JOIN no_inv q ON q.id = l.quote_id AND q.organization_id = l.organization_id
      GROUP BY l.quote_id, l.organization_id
    )
    SELECT q.quote_number, q.total_ttc, COALESCE(s.s_ttc, 0) AS sum_lines_ttc,
           (q.total_ttc - COALESCE(s.s_ttc, 0))::numeric AS ecart_ttc
    FROM no_inv q
    LEFT JOIN sums s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    ORDER BY q.created_at DESC
  `);
  console.log("quote_number | total_ttc_devis | sum_lines_ttc | écart | note");
  console.log("-".repeat(85));
  for (const row of r.rows) {
    const e = n(row.ecart_ttc);
    const note = Math.abs(e) <= EPS ? "Facture STANDARD ≈ Σ lignes = cohérent" : "Incohérence — vérifier";
    console.log(`${row.quote_number ?? "—"} | ${fmtEur(row.total_ttc)} | ${fmtEur(row.sum_lines_ttc)} | ${fmtEur(e)} | ${note}`);
  }
}

async function mission4DebtAcceptedPdf() {
  console.log("\n=== MISSION 4 — Dette : ACCEPTED + (PDF ou signé) + écart lignes/en-tête ===\n");
  const r = await pool.query(
    `
    WITH s AS (
      SELECT quote_id, organization_id,
        COALESCE(SUM(total_line_ht) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS s_ht,
        COALESCE(SUM(total_line_ttc) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS s_ttc
      FROM quote_lines
      GROUP BY quote_id, organization_id
    )
    SELECT q.quote_number, q.total_ttc, COALESCE(s.s_ttc, 0) AS sum_lines_ttc,
           (q.total_ttc - COALESCE(s.s_ttc, 0))::numeric AS ecart_ttc,
           q.status::text,
           EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = 'quote_pdf' AND ed.archived_at IS NULL
           ) AS has_pdf,
           EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = $1 AND ed.archived_at IS NULL
           ) AS has_signed_pdf
    FROM quotes q
    LEFT JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    WHERE q.archived_at IS NULL
      AND UPPER(COALESCE(q.status,'')) = 'ACCEPTED'
      AND (
        EXISTS (
          SELECT 1 FROM entity_documents ed
          WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
            AND ed.document_type = 'quote_pdf' AND ed.archived_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM entity_documents ed
          WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
            AND ed.document_type = $1 AND ed.archived_at IS NULL
        )
      )
      AND ABS(COALESCE(q.total_ttc, 0) - COALESCE(s.s_ttc, 0)) > $2
    ORDER BY q.updated_at DESC NULLS LAST
    LIMIT 500
  `,
    [QUOTE_DOC_PDF_SIGNED, EPS]
  );
  console.log("quote_number | total_ttc | sum_lines_ttc | écart_TTC | status | has_pdf | has_signed_pdf");
  console.log("-".repeat(100));
  for (const row of r.rows) {
    console.log(
      `${row.quote_number ?? "—"} | ${fmtEur(row.total_ttc)} | ${fmtEur(row.sum_lines_ttc)} | ${fmtEur(row.ecart_ttc)} | ${row.status} | ${row.has_pdf} | ${row.has_signed_pdf}`
    );
  }
  return r.rows;
}

async function mission5AllInconsistent() {
  console.log("\n=== MISSION 5 — Tous devis incohérents (TTC) : classification A / B / C ===\n");
  const r = await pool.query(
    `
    WITH s AS (
      SELECT quote_id, organization_id,
        COALESCE(SUM(total_line_ttc) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS s_ttc
      FROM quote_lines
      GROUP BY quote_id, organization_id
    )
    SELECT q.quote_number,
           (q.total_ttc - COALESCE(s.s_ttc, 0))::numeric AS ecart_ttc,
           UPPER(COALESCE(q.status,'')) AS status,
           EXISTS (
             SELECT 1 FROM invoices i
             WHERE i.quote_id = q.id AND i.organization_id = q.organization_id
               AND UPPER(COALESCE(i.status,'')) <> 'CANCELLED'
           ) AS has_invoice,
           EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = 'quote_pdf' AND ed.archived_at IS NULL
           ) AS has_pdf,
           EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = $1 AND ed.archived_at IS NULL
           ) AS has_signed_pdf,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM invoices i
               WHERE i.quote_id = q.id AND i.organization_id = q.organization_id
                 AND UPPER(COALESCE(i.status,'')) <> 'CANCELLED'
             ) THEN 'C'
             WHEN EXISTS (
               SELECT 1 FROM entity_documents ed
               WHERE ed.organization_id = q.organization_id AND ed.entity_type = 'quote' AND ed.entity_id = q.id
                 AND ed.document_type IN ('quote_pdf', $1) AND ed.archived_at IS NULL
             ) THEN 'B'
             ELSE 'A'
           END AS dette_type
    FROM quotes q
    LEFT JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    WHERE q.archived_at IS NULL
      AND ABS(COALESCE(q.total_ttc, 0) - COALESCE(s.s_ttc, 0)) > $2
    ORDER BY dette_type, q.updated_at DESC NULLS LAST
    LIMIT 300
  `,
    [QUOTE_DOC_PDF_SIGNED, EPS]
  );
  console.log("quote_number | écart_TTC | status | TYPE | has_invoice | has_pdf | signed");
  console.log("-".repeat(95));
  for (const row of r.rows) {
    console.log(
      `${row.quote_number ?? "—"} | ${fmtEur(row.ecart_ttc)} | ${row.status} | ${row.dette_type} | ${row.has_invoice} | ${row.has_pdf} | ${row.has_signed_pdf}`
    );
  }
  const counts = { A: 0, B: 0, C: 0 };
  for (const row of r.rows) {
    const t = String(row.dette_type || "").charAt(0);
    if (counts[t] !== undefined) counts[t]++;
  }
  console.log(`\nRépartition (max 300 lignes) : TYPE A=${counts.A} TYPE B=${counts.B} TYPE C=${counts.C}`);
}

async function mission7Global() {
  console.log("\n=== MISSION 7 — Synthèse globale (tous devis non archivés) ===\n");
  const r = await pool.query(`
    WITH s AS (
      SELECT quote_id, organization_id,
        COALESCE(SUM(total_line_ttc) FILTER (WHERE is_active IS DISTINCT FROM false), 0)::numeric AS s_ttc
      FROM quote_lines
      GROUP BY quote_id, organization_id
    ),
    j AS (
      SELECT q.id,
        ABS(COALESCE(q.total_ttc, 0) - COALESCE(s.s_ttc, 0)) <= $1 AS ok_lines
      FROM quotes q
      LEFT JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
      WHERE q.archived_at IS NULL
    )
    SELECT
      COUNT(*)::int AS total_quotes,
      COUNT(*) FILTER (WHERE ok_lines)::int AS quotes_ok,
      COUNT(*) FILTER (WHERE NOT ok_lines)::int AS quotes_nok
    FROM j
  `, [EPS]);
  const row = r.rows[0];
  const total = n(row.total_quotes);
  const ok = n(row.quotes_ok);
  const nok = n(row.quotes_nok);
  const pctOk = total ? ((ok / total) * 100).toFixed(2) : "0";
  const pctDebt = total ? ((nok / total) * 100).toFixed(2) : "0";
  console.log(`Total devis (non archivés) : ${total}`);
  console.log(`Cohérents (|ΔTTC| ≤ ${EPS} €) : ${ok} (${pctOk} %)`);
  console.log(`Dette restante (écart TTC) : ${nok} (${pctDebt} %)`);
  return { total, ok, nok, pctOk, pctDebt };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL absent — impossible d’auditer la base.");
    process.exit(1);
  }
  console.log("audit-post-refonte-financial-readonly — PROD / lecture seule — EPS_TTC =", EPS);
  try {
    const m1 = await mission1Last20();
    await mission2MultiVatDiscount();
    await mission3FiveUninvoiced();
    await mission4DebtAcceptedPdf();
    await mission5AllInconsistent();
    const m7 = await mission7Global();

    console.log("\n=== MISSION 6 & 7 — Recommandation / conclusion ===\n");
    console.log("TYPE A (sans facture, sans PDF) : migration --apply possible après validation métier.");
    console.log("TYPE B (PDF / signé) : ne pas modifier les montants figés ; avertissement commercial si écart.");
    console.log("TYPE C (facturé) : ne jamais modifier l’historique ; avenant / note si besoin.");
    console.log(`\nMoteur (20 derniers) : ${m1.allOk ? "OK" : "NOK (au moins un écart)"}`);
    console.log(`Go/No-Go (indicatif) : ${n(m7.pctDebt) === 0 ? "Go" : "Go avec dette résiduelle à traiter hors PDF/facturé"}`);

    console.log("\n=== MISSION 8 — Contrôle code (à faire dans le dépôt, pas en SQL) ===");
    console.log("Vérifier manuellement : plus de applyDocumentDiscountHt sur quotes.service ; plus de INVOICE_CAP_BYPASS ;");
    console.log("remise = lignes DOCUMENT_DISCOUNT multi-TVA (allocateDiscountHtCentsByVatGroups).");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
