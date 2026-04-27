/**
 * Audit PROD lecture seule — GET /api/quotes?limit=500 + filtre front ACCEPTED.
 * DATABASE_URL requis (ex. proxy TCP Postgres Railway).
 * Aucun UPDATE / DELETE.
 */

import pg from "pg";

const QUOTE_DOC_PDF_SIGNED = "quote_pdf_signed";
const TOLERANCE = 5;

const u = process.env.DATABASE_URL || "";
if (!u) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: u,
  ssl: { rejectUnauthorized: false },
});

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function clientDisplayName(row) {
  if (!row) return null;
  const co = row.company_name?.trim();
  if (co) return co;
  const fn = row.first_name?.trim() || "";
  const ln = row.last_name?.trim() || "";
  const t = `${fn} ${ln}`.trim();
  return t || null;
}

function sqlListQuotes500() {
  return `
    SELECT q.*, c.company_name, c.first_name, c.last_name,
           l.full_name AS lead_full_name,
           (EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id
               AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = 'quote_pdf'
               AND (ed.archived_at IS NULL)
           )) AS has_pdf,
           (EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id
               AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = '${QUOTE_DOC_PDF_SIGNED}'
               AND (ed.archived_at IS NULL)
           )) AS has_signed_pdf
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id AND (l.archived_at IS NULL)
    WHERE q.organization_id = $1 AND (q.archived_at IS NULL)
    ORDER BY q.created_at DESC
    LIMIT 500 OFFSET 0`;
}

async function simulateResolvedClientId(pool, quote) {
  const org = quote.organization_id;
  if (quote.client_id) {
    const ok = await pool.query(
      `SELECT id::text FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [quote.client_id, org]
    );
    if (ok.rows.length === 0) {
      return { path: "quote.client_id", resolved_client_id: null, note: "client introuvable ou archivé" };
    }
    return { path: "quote.client_id", resolved_client_id: String(ok.rows[0].id), note: null };
  }
  if (!quote.lead_id) {
    return { path: null, resolved_client_id: null, note: "aucun lead — ensureClientForQuote échouerait" };
  }
  const leadRes = await pool.query(
    `SELECT id, client_id, email, phone_mobile, phone FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quote.lead_id, org]
  );
  const lead = leadRes.rows[0];
  if (!lead) {
    return { path: "lead", resolved_client_id: null, note: "lead introuvable ou archivé" };
  }
  if (lead.client_id) {
    const okC = await pool.query(
      `SELECT id::text FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [lead.client_id, org]
    );
    if (okC.rows.length === 0) {
      return { path: "lead.client_id", resolved_client_id: null, note: "client du lead archivé/absent" };
    }
    return { path: "lead.client_id (sync quote en TX)", resolved_client_id: String(lead.client_id), note: null };
  }
  const emailRaw = lead.email != null ? String(lead.email).trim().toLowerCase() : "";
  if (emailRaw) {
    const byEmail = await pool.query(
      `SELECT id::text FROM clients
       WHERE organization_id = $1 AND (archived_at IS NULL)
         AND LOWER(TRIM(email)) = $2
       ORDER BY created_at ASC
       LIMIT 3`,
      [org, emailRaw]
    );
    if (byEmail.rows.length > 1) {
      return { path: "email_match", resolved_client_id: null, note: "plusieurs clients même e-mail — facturation bloquée" };
    }
    if (byEmail.rows.length === 1) {
      return { path: "email_match unique", resolved_client_id: String(byEmail.rows[0].id), note: null };
    }
  }
  const phones = [lead.phone_mobile, lead.phone]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean);
  const uniqPhones = [...new Set(phones)];
  for (const phoneVal of uniqPhones) {
    const byPhone = await pool.query(
      `SELECT id::text FROM clients
       WHERE organization_id = $1 AND (archived_at IS NULL)
         AND (
           (NULLIF(TRIM(phone), '') IS NOT NULL AND TRIM(phone) = $2)
           OR (NULLIF(TRIM(mobile), '') IS NOT NULL AND TRIM(mobile) = $2)
         )
       ORDER BY created_at ASC
       LIMIT 3`,
      [org, phoneVal]
    );
    if (byPhone.rows.length > 1) {
      return { path: "phone_match", resolved_client_id: null, note: "plusieurs clients même téléphone — bloqué" };
    }
    if (byPhone.rows.length === 1) {
      return { path: "phone_match unique", resolved_client_id: String(byPhone.rows[0].id), note: null };
    }
  }
  return {
    path: "would INSERT client (createClientAndLinkLead)",
    resolved_client_id: "(nouveau UUID en TX)",
    note: "lecture seule — pas d’INSERT exécuté",
  };
}

function buildCause(row) {
  const parts = [];
  if (row.would_block_invoice) parts.push("plafond TTC factures liées > devis+5€");
  if (row.missing_client && !row.repairable_by_lead) parts.push("sans client ni lead facturable");
  const n = String(row.simulate_resolve_note || "");
  if (n.includes("plusieurs")) parts.push(n);
  if (n.includes("bloqué")) parts.push(n);
  if (row.standard_new_invoice_ttc_from_quote_lines > 0.02 && row.reserved_ttc_before_create > 0.02) {
    parts.push("brouillon/facture existante — chemin STANDARD refusé (reserved>0.02€)");
  }
  if (row.quote_lines_sum_ttc_differs) parts.push("somme lignes devis ≠ total_ttc devis");
  if (row.would_block_after_standard_insert_sim) {
    parts.push(
      "après création STANDARD, somme factures TTC dépasserait quotes.total_ttc+5€ (souvent: total_ttc devis ≠ somme lignes)"
    );
  }
  if (parts.length === 0) return "—";
  return parts.join(" ; ");
}

try {
  const orgs = (await pool.query(`SELECT id::text FROM organizations ORDER BY created_at ASC NULLS LAST`)).rows;

  let audit8628Logs = { rows: [] };
  try {
    audit8628Logs = await pool.query(
      `SELECT id::text, organization_id::text, action, entity_type, entity_id::text, created_at,
              LEFT(metadata_json::text, 400) AS meta_head
       FROM audit_logs
       WHERE metadata_json::text LIKE '%8628%'
       ORDER BY created_at DESC
       LIMIT 25`
    );
  } catch (e) {
    audit8628Logs = { rows: [{ error: String(e?.message || e) }] };
  }

  const global8628 = {
    invoices_total_ttc_exact: (
      await pool.query(
        `SELECT id::text, organization_id::text, quote_id::text, invoice_number, status, total_ttc::text, archived_at
         FROM invoices WHERE total_ttc::numeric = 8628 ORDER BY created_at DESC LIMIT 50`
      )
    ).rows,
    quotes_total_ttc_exact: (
      await pool.query(
        `SELECT id::text, organization_id::text, quote_number, status, total_ttc::text
         FROM quotes WHERE total_ttc::numeric = 8628 AND archived_at IS NULL LIMIT 50`
      )
    ).rows,
    invoice_metadata_contains: (
      await pool.query(
        `SELECT id::text, organization_id::text, invoice_number, LEFT(metadata_json::text, 300) AS meta_head
         FROM invoices WHERE metadata_json::text LIKE '%8628%' LIMIT 30`
      )
    ).rows,
    quote_metadata_contains: (
      await pool.query(
        `SELECT id::text, organization_id::text, quote_number, LEFT(metadata_json::text, 300) AS meta_head
         FROM quotes WHERE metadata_json::text LIKE '%8628%' AND archived_at IS NULL LIMIT 30`
      )
    ).rows,
    sum_by_quote_eq_8628: (
      await pool.query(
        `SELECT i.quote_id::text, i.organization_id::text, COALESCE(SUM(i.total_ttc),0)::numeric AS s, COUNT(*)::int AS n
         FROM invoices i
         WHERE UPPER(COALESCE(i.status, '')) != 'CANCELLED' AND i.quote_id IS NOT NULL
         GROUP BY i.quote_id, i.organization_id
         HAVING ABS(COALESCE(SUM(i.total_ttc),0) - 8628) < 0.02
         LIMIT 30`
      )
    ).rows,
    audit_logs_metadata: audit8628Logs.rows,
  };

  const orgScopes = [];
  const acceptedQuotesRows = [];

  for (const { id: orgId } of orgs) {
    const listRes = await pool.query(sqlListQuotes500(), [orgId]);
    const acceptedInScope = listRes.rows.filter((r) => String(r.status || "").toUpperCase() === "ACCEPTED");

    const countAcceptedTotal = (
      await pool.query(
        `SELECT COUNT(*)::int AS n FROM quotes
         WHERE organization_id = $1 AND archived_at IS NULL AND UPPER(COALESCE(status,'')) = 'ACCEPTED'`,
        [orgId]
      )
    ).rows[0].n;

    orgScopes.push({
      organization_id: orgId,
      accepted_in_listquotes_500_scope: acceptedInScope.length,
      accepted_total_in_org_all_time: countAcceptedTotal,
      warning_if_accepted_not_in_scope:
        countAcceptedTotal > acceptedInScope.length
          ? "Des devis ACCEPTED existent hors des 500 derniers par created_at — absents du modal."
          : null,
    });

    for (const q of acceptedInScope) {
      const quoteTtc = round2(q.total_ttc);
      const invAgg = await pool.query(
        `SELECT COALESCE(SUM(total_ttc), 0)::numeric AS sum_ttc, COUNT(*)::int AS cnt
         FROM invoices
         WHERE quote_id = $1 AND organization_id = $2
           AND UPPER(COALESCE(status, '')) != 'CANCELLED'`,
        [q.id, orgId]
      );
      const reservedTtc = round2(Number(invAgg.rows[0].sum_ttc) || 0);
      const cnt = Number(invAgg.rows[0].cnt) || 0;

      const invDetail = (
        await pool.query(
          `SELECT id::text, invoice_number, status, total_ttc::text, archived_at,
                  COALESCE(metadata_json->>'quote_billing_role', '') AS quote_billing_role
           FROM invoices
           WHERE quote_id = $1 AND organization_id = $2
           ORDER BY created_at ASC`,
          [q.id, orgId]
        )
      ).rows;

      const linesSum = await pool.query(
        `SELECT COALESCE(SUM(total_line_ttc), 0)::numeric AS s
         FROM quote_lines
         WHERE quote_id = $1 AND organization_id = $2 AND (is_active IS DISTINCT FROM false)`,
        [q.id, orgId]
      );
      const quoteLinesSumTtc = round2(Number(linesSum.rows[0].s) || 0);
      const quoteLinesSumTtcDiffers = Math.abs(quoteLinesSumTtc - quoteTtc) > 0.02;

      const standardNewTtc = quoteLinesSumTtc;
      const cumulativeAfterStandardSim = round2(reservedTtc + standardNewTtc);

      const resolved_sim = await simulateResolvedClientId(pool, q);

      const missing_client = q.client_id == null;
      const repairable_by_lead = q.lead_id != null;
      const would_block_invoice = reservedTtc > quoteTtc + TOLERANCE + 0.0001;
      const would_block_after_standard_insert_sim =
        cumulativeAfterStandardSim > quoteTtc + TOLERANCE + 0.0001;

      const client_name = clientDisplayName(q);

      const row = {
        organization_id: orgId,
        quote_number: q.quote_number,
        quote_id: q.id,
        client_lead: client_name || q.lead_full_name || "—",
        quote_ttc: quoteTtc,
        linked_invoice_sum: reservedTtc,
        linked_invoice_count: cnt,
        would_block_invoice,
        would_block_after_standard_insert_sim,
        missing_client,
        repairable_by_lead,
        api_quote_id_sent_on_click: q.id,
        simulate_resolved_client_id: resolved_sim.resolved_client_id,
        simulate_resolve_path: resolved_sim.path,
        simulate_resolve_note: resolved_sim.note ?? null,
        standard_new_invoice_ttc_from_quote_lines: standardNewTtc,
        reserved_ttc_before_create: reservedTtc,
        cumulative_after_standard_sim: cumulativeAfterStandardSim,
        quote_lines_sum_ttc_differs: quoteLinesSumTtcDiffers,
        quote_lines_sum_ttc: quoteLinesSumTtc,
        created_at: q.created_at,
        updated_at: q.updated_at,
        lead_full_name: q.lead_full_name ?? null,
        client_name,
        linked_invoices: invDetail,
      };
      row.cause = buildCause(row);
      acceptedQuotesRows.push(row);
    }
  }

  const flatMarkdown = acceptedQuotesRows.map(
    (r) =>
      `| ${r.organization_id.slice(0, 8)}… | ${r.quote_number} | ${String(r.client_lead).replace(/\|/g, "/")} | ${r.quote_ttc} | ${r.linked_invoice_sum} | ${r.linked_invoice_count} | ${r.would_block_invoice} | ${r.would_block_after_standard_insert_sim} | ${r.missing_client} | ${r.repairable_by_lead} | ${String(r.cause).replace(/\|/g, "/")} |`
  );

  console.log(
    JSON.stringify(
      {
        meta: {
          source: "listQuotes(organizationId, { limit: 500, offset: 0 }) — même SQL que GET /api/quotes?limit=500 (sans lead_id/study_id/client_id/status)",
          front_filter: "InvoicesPage : norm(status)==='ACCEPTED'",
          tolerance_eur_ttc: TOLERANCE,
          organizations_scanned: orgs.length,
        },
        org_scopes: orgScopes,
        accepted_quotes_rows: acceptedQuotesRows,
        markdown_table_header:
          "| org… | quote_number | client/lead | quote_ttc | linked_sum | inv_count | block_linked | block_std_sim | missing_client | repairable_lead | cause |",
        markdown_table_sep: "|---|---|---|---|---|---|---|---|---|---|---|",
        markdown_table_rows: flatMarkdown,
        search_8628_global: global8628,
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
