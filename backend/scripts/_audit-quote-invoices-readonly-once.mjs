/**
 * Lecture seule — A/B/C/D pour un quote_number.
 * Usage : depuis backend/ avec DATABASE_URL (ex. railway run --service solarnext-crm node scripts/_audit-quote-invoices-readonly-once.mjs)
 */
import pg from "pg";

const QUOTE_NUMBER = process.argv[2] || "SG-2026-0028";
const u = process.env.DATABASE_URL || "";
if (!u) {
  console.error("DATABASE_URL absent (utiliser: railway run --service solarnext-crm node scripts/_audit-quote-invoices-readonly-once.mjs)");
  process.exit(1);
}
const railwayLike = /railway|rlwy\.net|railway\.internal/i.test(u);
const pool = new pg.Pool({
  connectionString: u,
  ...(railwayLike ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  const qa = await pool.query(
    `SELECT id::text AS quote_id,
            organization_id::text AS organization_id,
            quote_number,
            status,
            total_ht::text,
            total_vat::text,
            total_ttc::text,
            client_id::text,
            lead_id::text,
            created_at,
            updated_at
     FROM quotes
     WHERE quote_number = $1
       AND archived_at IS NULL
     LIMIT 5`,
    [QUOTE_NUMBER]
  );

  if (qa.rows.length === 0) {
    console.log(JSON.stringify({ error: "Aucun devis non archivé pour ce numéro", quote_number: QUOTE_NUMBER }, null, 2));
    process.exit(2);
  }
  if (qa.rows.length > 1) {
    console.log(JSON.stringify({ warning: "Plusieurs lignes quotes pour ce numéro", rows: qa.rows }, null, 2));
  }

  const q0 = qa.rows[0];
  const quoteId = q0.quote_id;
  const orgId = q0.organization_id;

  const qb = await pool.query(
    `SELECT i.id::text,
            i.invoice_number,
            i.status,
            i.total_ht::text,
            i.total_vat::text,
            i.total_ttc::text,
            i.archived_at,
            i.created_at,
            COALESCE(i.metadata_json->>'quote_billing_role', '') AS quote_billing_role
     FROM invoices i
     WHERE i.quote_id = $1::uuid
       AND i.organization_id = $2::uuid
     ORDER BY i.created_at`,
    [quoteId, orgId]
  );

  const qc = await pool.query(
    `SELECT COALESCE(SUM(i.total_ttc), 0)::numeric AS sum_ttc_backend_rule
     FROM invoices i
     WHERE i.quote_id = $1::uuid
       AND i.organization_id = $2::uuid
       AND UPPER(COALESCE(i.status, '')) != 'CANCELLED'`,
    [quoteId, orgId]
  );

  const qd = await pool.query(
    `SELECT il.invoice_id::text,
            SUM(il.total_line_ht)::numeric  AS sum_lines_ht,
            SUM(il.total_line_vat)::numeric AS sum_lines_vat,
            SUM(il.total_line_ttc)::numeric AS sum_lines_ttc,
            i.total_ht::numeric,
            i.total_vat::numeric,
            i.total_ttc::numeric,
            i.invoice_number,
            i.status
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = il.organization_id
     WHERE i.quote_id = $1::uuid
       AND i.organization_id = $2::uuid
       AND UPPER(COALESCE(i.status, '')) != 'CANCELLED'
     GROUP BY il.invoice_id, i.total_ht, i.total_vat, i.total_ttc, i.invoice_number, i.status
     ORDER BY i.invoice_number`,
    [quoteId, orgId]
  );

  const qMismatch = await pool.query(
    `SELECT i.id::text AS invoice_id,
            i.invoice_number,
            ABS(COALESCE(i.total_ttc, 0) - COALESCE(s.sum_ttc, 0))::numeric AS abs_diff_ttc
     FROM invoices i
     LEFT JOIN (
       SELECT invoice_id, organization_id, SUM(total_line_ttc)::numeric AS sum_ttc
       FROM invoice_lines
       GROUP BY invoice_id, organization_id
     ) s ON s.invoice_id = i.id AND s.organization_id = i.organization_id
     WHERE i.quote_id = $1::uuid
       AND i.organization_id = $2::uuid
       AND UPPER(COALESCE(i.status, '')) != 'CANCELLED'
       AND (s.sum_ttc IS NULL OR ABS(COALESCE(i.total_ttc, 0) - s.sum_ttc) > 0.02)`,
    [quoteId, orgId]
  );

  const out = {
    quote_number: QUOTE_NUMBER,
    quote: q0,
    invoices_all_statuses_linked: qb.rows,
    sum_ttc_backend_cap_rule: String(qc.rows[0]?.sum_ttc_backend_rule ?? ""),
    line_totals_vs_invoice_stored: qd.rows,
    invoices_where_stored_ttc_differs_from_sum_lines_over_2c: qMismatch.rows,
  };
  console.log(JSON.stringify(out, null, 2));
} finally {
  await pool.end();
}
