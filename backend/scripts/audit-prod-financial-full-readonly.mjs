/**
 * Audit PROD global devis/factures — lecture seule.
 * DATABASE_URL requis (ex. proxy TCP Postgres Railway).
 *
 * Aucun UPDATE / DELETE.
 *
 * Sortie : JSON { summary_counts, anomalies: [...] }
 * Chaque anomalie : type_anomalie, quote_number, invoice_number, id, lead_client,
 *   total_en_tete, total_lignes, ecart, status, created_at, updated_at,
 *   impact_facturation, action_recommandee
 */

import pg from "pg";

const EPS = 0.03;
const u = process.env.DATABASE_URL || "";
if (!u) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: u,
  ssl: { rejectUnauthorized: false },
});

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function round2(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function ecart(a, b) {
  if (a == null || b == null) return null;
  return round2(Number(a) - Number(b));
}

/** @type {Array<Record<string, unknown>>} */
const anomalies = [];
/** @type {Record<string, number>} */
const summary_counts = {};

function push(type, row) {
  anomalies.push({
    type_anomalie: type,
    quote_number: row.quote_number ?? null,
    invoice_number: row.invoice_number ?? null,
    id: row.id ?? row.quote_id ?? row.invoice_id ?? null,
    lead_client: row.lead_client ?? null,
    total_en_tete: row.total_en_tete ?? null,
    total_lignes: row.total_lignes ?? null,
    ecart: row.ecart ?? null,
    status: row.status ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    impact_facturation: row.impact_facturation ?? null,
    action_recommandee: row.action_recommandee ?? null,
    organization_id: row.organization_id ?? null,
    extra: row.extra ?? null,
  });
  summary_counts[type] = (summary_counts[type] || 0) + 1;
}

let hasInvoicesArchivedAt = false;

try {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'archived_at'`
  );
  hasInvoicesArchivedAt = col.rows.length > 0;

  // --- 1) quotes header vs quote_lines sums ---
  const q1 = await pool.query(`
    WITH s AS (
      SELECT quote_id, organization_id,
             COALESCE(SUM(total_line_ht), 0)::numeric AS sum_ht,
             COALESCE(SUM(total_line_vat), 0)::numeric AS sum_vat,
             COALESCE(SUM(total_line_ttc), 0)::numeric AS sum_ttc
      FROM quote_lines
      WHERE (is_active IS DISTINCT FROM false)
      GROUP BY quote_id, organization_id
    )
    SELECT q.id::text, q.organization_id::text, q.quote_number, q.status::text,
           q.total_ht::numeric, q.total_vat::numeric, q.total_ttc::numeric,
           COALESCE(s.sum_ht, 0) AS lines_ht, COALESCE(s.sum_vat, 0) AS lines_vat, COALESCE(s.sum_ttc, 0) AS lines_ttc,
           q.lead_id::text, q.client_id::text, q.created_at, q.updated_at
    FROM quotes q
    LEFT JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    WHERE q.archived_at IS NULL
      AND (
        ABS(COALESCE(q.total_ht, 0) - COALESCE(s.sum_ht, 0)) > ${EPS}
        OR ABS(COALESCE(q.total_vat, 0) - COALESCE(s.sum_vat, 0)) > ${EPS}
        OR ABS(COALESCE(q.total_ttc, 0) - COALESCE(s.sum_ttc, 0)) > ${EPS}
      )
  `);
  for (const r of q1.rows) {
    const dh = ecart(r.total_ht, r.lines_ht);
    const dv = ecart(r.total_vat, r.lines_vat);
    const dt = ecart(r.total_ttc, r.lines_ttc);
    push("1_quote_header_vs_lines_mismatch", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      invoice_number: null,
      lead_client: null,
      total_en_tete: `HT ${r.total_ht} | TVA ${r.total_vat} | TTC ${r.total_ttc}`,
      total_lignes: `HT ${r.lines_ht} | TVA ${r.lines_vat} | TTC ${r.lines_ttc}`,
      ecart: `ΔHT ${dh} | ΔTVA ${dv} | ΔTTC ${dt}`,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation:
        "Affichages devis et plafonds basés sur l’en-tête peuvent diverger des lignes ; facture STANDARD suit les lignes.",
      action_recommandee: "Recalculer / réaligner quotes.total_* sur la somme des quote_lines (ou corriger les lignes).",
      extra: { lead_id: r.lead_id, client_id: r.client_id },
    });
  }

  // --- 2) invoices header vs invoice_lines ---
  const q2b = hasInvoicesArchivedAt
    ? await pool.query(`
    WITH s AS (
      SELECT invoice_id, organization_id,
             COALESCE(SUM(total_line_ht), 0)::numeric AS sum_ht,
             COALESCE(SUM(total_line_vat), 0)::numeric AS sum_vat,
             COALESCE(SUM(total_line_ttc), 0)::numeric AS sum_ttc
      FROM invoice_lines
      GROUP BY invoice_id, organization_id
    )
    SELECT i.id::text, i.organization_id::text, i.invoice_number, i.status::text,
           i.total_ht::numeric, i.total_vat::numeric, i.total_ttc::numeric,
           COALESCE(s.sum_ht, 0) AS lines_ht, COALESCE(s.sum_vat, 0) AS lines_vat, COALESCE(s.sum_ttc, 0) AS lines_ttc,
           i.quote_id::text, i.created_at, i.updated_at
    FROM invoices i
    LEFT JOIN s ON s.invoice_id = i.id AND s.organization_id = i.organization_id
    WHERE i.archived_at IS NULL
      AND (
        ABS(COALESCE(i.total_ht, 0) - COALESCE(s.sum_ht, 0)) > ${EPS}
        OR ABS(COALESCE(i.total_vat, 0) - COALESCE(s.sum_vat, 0)) > ${EPS}
        OR ABS(COALESCE(i.total_ttc, 0) - COALESCE(s.sum_ttc, 0)) > ${EPS}
      )
  `)
    : await pool.query(`
    WITH s AS (
      SELECT invoice_id, organization_id,
             COALESCE(SUM(total_line_ht), 0)::numeric AS sum_ht,
             COALESCE(SUM(total_line_vat), 0)::numeric AS sum_vat,
             COALESCE(SUM(total_line_ttc), 0)::numeric AS sum_ttc
      FROM invoice_lines
      GROUP BY invoice_id, organization_id
    )
    SELECT i.id::text, i.organization_id::text, i.invoice_number, i.status::text,
           i.total_ht::numeric, i.total_vat::numeric, i.total_ttc::numeric,
           COALESCE(s.sum_ht, 0) AS lines_ht, COALESCE(s.sum_vat, 0) AS lines_vat, COALESCE(s.sum_ttc, 0) AS lines_ttc,
           i.quote_id::text, i.created_at, i.updated_at
    FROM invoices i
    LEFT JOIN s ON s.invoice_id = i.id AND s.organization_id = i.organization_id
    WHERE ABS(COALESCE(i.total_ht, 0) - COALESCE(s.sum_ht, 0)) > ${EPS}
       OR ABS(COALESCE(i.total_vat, 0) - COALESCE(s.sum_vat, 0)) > ${EPS}
       OR ABS(COALESCE(i.total_ttc, 0) - COALESCE(s.sum_ttc, 0)) > ${EPS}
  `);

  for (const r of q2b.rows) {
    push("2_invoice_header_vs_lines_mismatch", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: null,
      invoice_number: r.invoice_number,
      lead_client: null,
      total_en_tete: `HT ${r.total_ht} | TVA ${r.total_vat} | TTC ${r.total_ttc}`,
      total_lignes: `HT ${r.lines_ht} | TVA ${r.lines_vat} | TTC ${r.lines_ttc}`,
      ecart: `ΔTTC ${ecart(r.total_ttc, r.lines_ttc)}`,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Montants facture PDF / plafonds / paiements potentiellement faux.",
      action_recommandee: "Relancer recalcInvoiceTotals ou réparer lignes vs en-tête.",
      extra: { quote_id: r.quote_id },
    });
  }

  // --- 3 & 4 ACCEPTED lines vs header TTC ---
  const q34 = await pool.query(`
    WITH s AS (
      SELECT quote_id, organization_id, COALESCE(SUM(total_line_ttc), 0)::numeric AS sum_ttc
      FROM quote_lines WHERE (is_active IS DISTINCT FROM false)
      GROUP BY quote_id, organization_id
    )
    SELECT q.id::text, q.quote_number, q.status::text, q.total_ttc::numeric, COALESCE(s.sum_ttc, 0)::numeric AS lines_ttc,
           q.organization_id::text, q.created_at, q.updated_at
    FROM quotes q
    LEFT JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    WHERE q.archived_at IS NULL AND UPPER(COALESCE(q.status,'')) = 'ACCEPTED'
      AND ABS(COALESCE(q.total_ttc,0) - COALESCE(s.sum_ttc,0)) > ${EPS}
  `);
  for (const r of q34.rows) {
    const lines = n(r.lines_ttc);
    const head = n(r.total_ttc);
    const gt = lines > head + EPS;
    push(gt ? "3_accepted_lines_gt_header_ttc" : "4_accepted_lines_lt_header_ttc", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      invoice_number: null,
      lead_client: null,
      total_en_tete: head,
      total_lignes: lines,
      ecart: round2((lines ?? 0) - (head ?? 0)),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: gt
        ? "Création facture STANDARD peut dépasser le plafond basé sur quotes.total_ttc."
        : "En-tête TTC surévalué vs lignes : reste à facturer surestimé côté UI.",
      action_recommandee: "Synchroniser en-tête et lignes (recompute quote totals ou correction manuelle traçable).",
    });
  }

  // --- 5 zero header positive lines ---
  const q5 = await pool.query(`
    WITH s AS (
      SELECT quote_id, organization_id, COALESCE(SUM(total_line_ttc), 0)::numeric AS sum_ttc
      FROM quote_lines WHERE (is_active IS DISTINCT FROM false)
      GROUP BY quote_id, organization_id
    )
    SELECT q.id::text, q.quote_number, q.status::text, q.total_ttc::numeric, s.sum_ttc,
           q.organization_id::text, q.created_at, q.updated_at
    FROM quotes q
    JOIN s ON s.quote_id = q.id AND s.organization_id = q.organization_id
    WHERE q.archived_at IS NULL AND COALESCE(q.total_ttc, 0) <= ${EPS} AND s.sum_ttc > ${EPS}
  `);
  for (const r of q5.rows) {
    push("5_quote_zero_header_positive_lines", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      total_en_tete: r.total_ttc,
      total_lignes: r.sum_ttc,
      ecart: r.sum_ttc,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Devis affiché à 0 mais facturable au montant des lignes.",
      action_recommandee: "Recalculer totaux devis ou corriger statut / lignes.",
    });
  }

  // --- 6 no lines positive header ---
  const q6 = await pool.query(`
    WITH c AS (
      SELECT quote_id, organization_id, COUNT(*)::int AS n
      FROM quote_lines WHERE (is_active IS DISTINCT FROM false)
      GROUP BY quote_id, organization_id
    )
    SELECT q.id::text, q.quote_number, q.status::text, q.total_ttc::numeric, COALESCE(c.n, 0) AS line_count,
           q.organization_id::text, q.created_at, q.updated_at
    FROM quotes q
    LEFT JOIN c ON c.quote_id = q.id AND c.organization_id = q.organization_id
    WHERE q.archived_at IS NULL AND COALESCE(c.n, 0) = 0 AND COALESCE(q.total_ttc, 0) > ${EPS}
  `);
  for (const r of q6.rows) {
    push("6_quote_positive_header_no_lines", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      total_en_tete: r.total_ttc,
      total_lignes: 0,
      ecart: r.total_ttc,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Facture STANDARD impossible (pas de lignes) ; incohérence données.",
      action_recommandee: "Ajouter lignes ou remettre totaux à zéro.",
    });
  }

  // --- 7 single invoice total > linked quote total ---
  const q7sql = hasInvoicesArchivedAt
    ? `
    SELECT i.id::text, i.invoice_number, i.status::text, i.total_ttc::numeric AS inv_ttc,
           q.id::text AS quote_id, q.quote_number, q.total_ttc::numeric AS quote_ttc,
           i.organization_id::text, i.created_at, i.updated_at
    FROM invoices i
    JOIN quotes q ON q.id = i.quote_id AND q.organization_id = i.organization_id
    WHERE i.archived_at IS NULL
      AND COALESCE(i.total_ttc, 0) > COALESCE(q.total_ttc, 0) + 5 + ${EPS}
  `
    : `
    SELECT i.id::text, i.invoice_number, i.status::text, i.total_ttc::numeric AS inv_ttc,
           q.id::text AS quote_id, q.quote_number, q.total_ttc::numeric AS quote_ttc,
           i.organization_id::text, i.created_at, i.updated_at
    FROM invoices i
    JOIN quotes q ON q.id = i.quote_id AND q.organization_id = i.organization_id
    WHERE COALESCE(i.total_ttc, 0) > COALESCE(q.total_ttc, 0) + 5 + ${EPS}
  `;
  const q7b = await pool.query(q7sql);
  for (const r of q7b.rows) {
    push("7_invoice_linked_gt_quote_total", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      invoice_number: r.invoice_number,
      total_en_tete: r.quote_ttc,
      total_lignes: r.inv_ttc,
      ecart: ecart(r.inv_ttc, r.quote_ttc),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Une facture dépasse seule le total devis en-tête (hors logique acompte/solde).",
      action_recommandee: "Vérifier rôle billing, lignes facture, ou total devis.",
      extra: { quote_id: r.quote_id },
    });
  }

  // --- 7b sum invoices per quote > quote total (non cancelled) ---
  const q7sum = await pool.query(`
    SELECT q.id::text AS quote_id, q.quote_number, q.total_ttc::numeric AS quote_ttc,
           COALESCE(SUM(i.total_ttc),0)::numeric AS sum_inv,
           q.organization_id::text, q.status::text, q.created_at, q.updated_at
    FROM quotes q
    JOIN invoices i ON i.quote_id = q.id AND i.organization_id = q.organization_id
      AND UPPER(COALESCE(i.status,'')) != 'CANCELLED'
      ${hasInvoicesArchivedAt ? "AND i.archived_at IS NULL" : ""}
    WHERE q.archived_at IS NULL
    GROUP BY q.id, q.quote_number, q.total_ttc, q.organization_id, q.status, q.created_at, q.updated_at
    HAVING COALESCE(SUM(i.total_ttc),0) > COALESCE(q.total_ttc,0) + 5 + ${EPS}
  `);
  for (const r of q7sum.rows) {
    push("7b_sum_invoices_on_quote_gt_quote_total", {
      id: r.quote_id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      invoice_number: "(somme)",
      total_en_tete: r.quote_ttc,
      total_lignes: r.sum_inv,
      ecart: ecart(r.sum_inv, r.quote_ttc),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Plafond backend déclenché ou risque de refus à la prochaine facture.",
      action_recommandee: "Annuler brouillons, ajuster devis, ou corriger factures liées.",
    });
  }

  // --- 8 orphan or cross-org quote_id on invoice ---
  const q8 = await pool.query(`
    SELECT i.id::text, i.invoice_number, i.quote_id::text, i.organization_id::text, i.status::text, i.created_at
    FROM invoices i
    WHERE i.quote_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.id = i.quote_id AND q.organization_id = i.organization_id AND q.archived_at IS NULL
      )
      ${hasInvoicesArchivedAt ? "AND i.archived_at IS NULL" : ""}
  `);
  for (const r of q8.rows) {
    push("8_invoice_quote_link_invalid_or_wrong_org", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: null,
      invoice_number: r.invoice_number,
      total_en_tete: null,
      total_lignes: null,
      ecart: null,
      status: r.status,
      created_at: r.created_at,
      updated_at: null,
      impact_facturation: "Lien devis invalide ou devis archivé / autre org.",
      action_recommandee: "Corriger quote_id ou restaurer le devis ; vérifier organization_id.",
      extra: { quote_id: r.quote_id },
    });
  }

  // --- 9 ACCEPTED no client ---
  const q9 = await pool.query(`
    SELECT q.id::text, q.quote_number, q.organization_id::text, q.status::text, q.total_ttc::numeric,
           q.lead_id::text, q.created_at, q.updated_at
    FROM quotes q
    WHERE q.archived_at IS NULL AND UPPER(COALESCE(q.status,'')) = 'ACCEPTED' AND q.client_id IS NULL
  `);
  for (const r of q9.rows) {
    push("9_accepted_quote_without_client_id", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      total_en_tete: r.total_ttc,
      total_lignes: null,
      ecart: null,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Facturation nécessite ensureClientForQuote (lead) ou bloque si pas de lead.",
      action_recommandee: "Rattacher client ou lead exploitable.",
      extra: { lead_id: r.lead_id },
    });
  }

  // --- 10 leads CLIENT without client_id ---
  const q10 = await pool.query(`
    SELECT l.id::text, l.organization_id::text, l.full_name, l.status::text, l.created_at, l.updated_at
    FROM leads l
    WHERE (l.archived_at IS NULL) AND UPPER(COALESCE(l.status,'')) = 'CLIENT' AND l.client_id IS NULL
  `);
  for (const r of q10.rows) {
    push("10_lead_status_client_without_client_id", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: null,
      invoice_number: null,
      lead_client: r.full_name,
      total_en_tete: null,
      total_lignes: null,
      ecart: null,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "État pipeline incohérent ; conversion client incomplète.",
      action_recommandee: "Créer/rattacher client ou repasser lead en LEAD selon métier.",
    });
  }

  // --- 11 quote client null but lead has client ---
  const q11 = await pool.query(`
    SELECT q.id::text, q.quote_number, q.organization_id::text, q.status::text,
           q.lead_id::text, l.client_id::text AS lead_client_id, q.created_at, q.updated_at
    FROM quotes q
    JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id AND (l.archived_at IS NULL)
    WHERE q.archived_at IS NULL AND q.client_id IS NULL AND l.client_id IS NOT NULL
  `);
  for (const r of q11.rows) {
    push("11_quote_client_null_lead_has_client", {
      id: r.id,
      organization_id: r.organization_id,
      quote_number: r.quote_number,
      total_en_tete: null,
      total_lignes: null,
      ecart: null,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Acceptation / UI peuvent diverger de la facturation (sync au clic).",
      action_recommandee: "Backfill quotes.client_id depuis lead.client_id (hors audit).",
      extra: { lead_id: r.lead_id, lead_client_id: r.lead_client_id },
    });
  }

  // --- 12 duplicate quotes same lead (non-archived), spread TTC ---
  const q12lead = await pool.query(`
    SELECT q.lead_id::text, q.organization_id::text, COUNT(*)::int AS n,
           MIN(q.total_ttc::numeric) AS min_ttc, MAX(q.total_ttc::numeric) AS max_ttc,
           ARRAY_AGG(q.quote_number ORDER BY q.created_at DESC) AS numbers
    FROM quotes q
    WHERE q.archived_at IS NULL AND q.lead_id IS NOT NULL
    GROUP BY q.lead_id, q.organization_id
    HAVING COUNT(*) > 1 AND MAX(q.total_ttc) - MIN(q.total_ttc) > ${EPS}
  `);
  for (const r of q12lead.rows) {
    push("12_duplicate_quotes_same_lead_different_amounts", {
      id: r.lead_id,
      organization_id: r.organization_id,
      quote_number: (r.numbers || []).join(", "),
      invoice_number: null,
      lead_client: `lead_id=${r.lead_id}`,
      total_en_tete: r.min_ttc,
      total_lignes: r.max_ttc,
      ecart: ecart(r.max_ttc, r.min_ttc),
      status: `${r.n} devis`,
      created_at: null,
      updated_at: null,
      impact_facturation: "Risque de confusion au moment de facturer le mauvais devis.",
      action_recommandee: "Clarifier dossiers / fusion / archivage des doublons.",
    });
  }

  const q12client = await pool.query(`
    SELECT q.client_id::text, q.organization_id::text, COUNT(*)::int AS n,
           MIN(q.total_ttc::numeric) AS min_ttc, MAX(q.total_ttc::numeric) AS max_ttc,
           ARRAY_AGG(q.quote_number ORDER BY q.created_at DESC) AS numbers
    FROM quotes q
    WHERE q.archived_at IS NULL AND q.client_id IS NOT NULL
    GROUP BY q.client_id, q.organization_id
    HAVING COUNT(*) > 1 AND MAX(q.total_ttc) - MIN(q.total_ttc) > ${EPS}
  `);
  for (const r of q12client.rows) {
    push("12_duplicate_quotes_same_client_different_amounts", {
      id: r.client_id,
      organization_id: r.organization_id,
      quote_number: (r.numbers || []).join(", "),
      lead_client: `client_id=${r.client_id}`,
      total_en_tete: r.min_ttc,
      total_lignes: r.max_ttc,
      ecart: ecart(r.max_ttc, r.min_ttc),
      status: `${r.n} devis`,
      impact_facturation: "Idem risque de mauvais devis sélectionné.",
      action_recommandee: "Contrôle métier des versions de devis.",
    });
  }

  // --- 13 multiple non-cancelled invoices same quote (potential duplicate billing) ---
  const q13 = await pool.query(`
    SELECT i.quote_id::text, i.organization_id::text, COUNT(*)::int AS n,
           ARRAY_AGG(i.invoice_number ORDER BY i.created_at) AS numbers,
           ARRAY_AGG(i.status ORDER BY i.created_at) AS statuses
    FROM invoices i
    WHERE i.quote_id IS NOT NULL AND UPPER(COALESCE(i.status,'')) != 'CANCELLED'
    ${hasInvoicesArchivedAt ? "AND i.archived_at IS NULL" : ""}
    GROUP BY i.quote_id, i.organization_id
    HAVING COUNT(*) > 1
  `);
  for (const r of q13.rows) {
    push("13_multiple_active_invoices_same_quote", {
      id: r.quote_id,
      organization_id: r.organization_id,
      quote_number: null,
      invoice_number: (r.numbers || []).join(" | "),
      total_en_tete: null,
      total_lignes: r.n,
      ecart: null,
      status: (r.statuses || []).join(","),
      impact_facturation: "Acompte/solde ou brouillons multiples — plafond cumule les TTC.",
      action_recommandee: "Annuler brouillons inutiles ou structurer DEPOSIT/BALANCE.",
    });
  }

  // --- 14 informational: invoice status counts on linked invoices ---
  const q14 = await pool.query(`
    SELECT UPPER(COALESCE(i.status,'')) AS st, COUNT(*)::int AS n
    FROM invoices i
    WHERE i.quote_id IS NOT NULL ${hasInvoicesArchivedAt ? "AND i.archived_at IS NULL" : ""}
    GROUP BY 1 ORDER BY n DESC
  `);
  // --- 15 archived invoices still in cap sum ---
  if (hasInvoicesArchivedAt) {
    const q15 = await pool.query(`
      SELECT i.id::text, i.invoice_number, i.status::text, i.total_ttc::numeric, i.archived_at, i.quote_id::text, i.organization_id::text
      FROM invoices i
      WHERE i.quote_id IS NOT NULL AND i.archived_at IS NOT NULL
        AND UPPER(COALESCE(i.status,'')) != 'CANCELLED'
    `);
    for (const r of q15.rows) {
      push("15_archived_invoice_still_counts_in_cap_rule", {
        id: r.id,
        organization_id: r.organization_id,
        invoice_number: r.invoice_number,
        quote_number: null,
        total_en_tete: r.total_ttc,
        total_lignes: null,
        ecart: null,
        status: r.status,
        created_at: null,
        updated_at: r.archived_at,
        impact_facturation: "Le backend sumQuoteInvoiceTtcNonCancelled ne filtre pas archived_at — montant compté au plafond.",
        action_recommandee: "Filtrer archived_at dans la somme ou exclure quote_id sur archivage.",
        extra: { quote_id: r.quote_id },
      });
    }
  } else {
    summary_counts["15_archived_invoice_column"] = 0;
  }

  // --- 16 credit notes exist (informational: not in quote cap) ---
  let q16 = { rows: [] };
  try {
    q16 = await pool.query(`
    SELECT cn.id::text, cn.invoice_id::text, cn.organization_id::text, cn.status::text, cn.total_ttc::numeric,
           i.invoice_number, i.quote_id::text
    FROM credit_notes cn
    JOIN invoices i ON i.id = cn.invoice_id AND i.organization_id = cn.organization_id
    WHERE cn.archived_at IS NULL
    LIMIT 500
  `);
  } catch {
    q16 = { rows: [] };
  }
  for (const r of q16.rows) {
    push("16_credit_note_exists_plafond_devis_ignore_avoir", {
      id: r.id,
      organization_id: r.organization_id,
      invoice_number: r.invoice_number,
      quote_number: null,
      total_en_tete: r.total_ttc,
      total_lignes: null,
      ecart: null,
      status: r.status,
      impact_facturation: "Les avoirs réduisent total_credited / amount_due mais pas la somme plafond quote.",
      action_recommandee: "Définir règle métier nette (hors audit).",
      extra: { invoice_id: r.invoice_id, quote_id: r.quote_id },
    });
  }

  // --- 17 cross org mismatches ---
  const q17a = await pool.query(`
    SELECT i.id::text AS id, i.invoice_number, i.organization_id::text AS inv_org, q.organization_id::text AS quote_org
    FROM invoices i
    JOIN quotes q ON q.id = i.quote_id
    WHERE i.organization_id IS DISTINCT FROM q.organization_id
  `);
  for (const r of q17a.rows) {
    push("17_org_mismatch_invoice_vs_quote", {
      id: r.id,
      organization_id: r.inv_org,
      invoice_number: r.invoice_number,
      total_en_tete: r.inv_org,
      total_lignes: r.quote_org,
      ecart: null,
      impact_facturation: "Critique — intégrité multi-tenant.",
      action_recommandee: "Corriger données sous contrôle DBA.",
    });
  }

  const q17b = await pool.query(`
    SELECT q.id::text, q.quote_number, q.organization_id::text AS q_org, l.organization_id::text AS l_org
    FROM quotes q
    JOIN leads l ON l.id = q.lead_id
    WHERE q.archived_at IS NULL AND q.organization_id IS DISTINCT FROM l.organization_id
  `);
  for (const r of q17b.rows) {
    push("17_org_mismatch_quote_vs_lead", {
      id: r.id,
      quote_number: r.quote_number,
      organization_id: r.q_org,
      total_en_tete: r.q_org,
      total_lignes: r.l_org,
      impact_facturation: "Critique.",
      action_recommandee: "Corriger lead_id ou organization_id.",
    });
  }

  const q17c = await pool.query(`
    SELECT q.id::text, q.quote_number, q.organization_id::text AS q_org, c.organization_id::text AS c_org
    FROM quotes q
    JOIN clients c ON c.id = q.client_id
    WHERE q.archived_at IS NULL AND q.client_id IS NOT NULL AND q.organization_id IS DISTINCT FROM c.organization_id
  `);
  for (const r of q17c.rows) {
    push("17_org_mismatch_quote_vs_client", {
      id: r.id,
      quote_number: r.quote_number,
      organization_id: r.q_org,
      total_en_tete: r.q_org,
      total_lignes: r.c_org,
      impact_facturation: "Critique.",
      action_recommandee: "Corriger client_id.",
    });
  }

  const q17dSql = hasInvoicesArchivedAt
    ? `
    SELECT i.id::text, i.invoice_number, i.organization_id::text AS i_org, c.organization_id::text AS c_org
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.archived_at IS NULL AND i.organization_id IS DISTINCT FROM c.organization_id
  `
    : `
    SELECT i.id::text, i.invoice_number, i.organization_id::text AS i_org, c.organization_id::text AS c_org
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.organization_id IS DISTINCT FROM c.organization_id
  `;
  const q17d2 = await pool.query(q17dSql);
  for (const r of q17d2.rows) {
    push("17_org_mismatch_invoice_vs_client", {
      id: r.id,
      invoice_number: r.invoice_number,
      organization_id: r.i_org,
      total_en_tete: r.i_org,
      total_lignes: r.c_org,
      impact_facturation: "Critique.",
      action_recommandee: "Corriger client ou facture.",
    });
  }

  const q17eSql = hasInvoicesArchivedAt
    ? `
    SELECT i.id::text, i.invoice_number, i.organization_id::text AS i_org, l.organization_id::text AS l_org
    FROM invoices i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.archived_at IS NULL AND i.lead_id IS NOT NULL AND i.organization_id IS DISTINCT FROM l.organization_id
  `
    : `
    SELECT i.id::text, i.invoice_number, i.organization_id::text AS i_org, l.organization_id::text AS l_org
    FROM invoices i
    JOIN leads l ON l.id = i.lead_id
    WHERE i.lead_id IS NOT NULL AND i.organization_id IS DISTINCT FROM l.organization_id
  `;
  const q17e = await pool.query(q17eSql);
  for (const r of q17e.rows) {
    push("17_org_mismatch_invoice_vs_lead", {
      id: r.id,
      invoice_number: r.invoice_number,
      organization_id: r.i_org,
      total_en_tete: r.i_org,
      total_lignes: r.l_org,
      impact_facturation: "Critique.",
      action_recommandee: "Corriger lead_id ou facture.",
    });
  }

  // --- 18 VAT line vs rate * ht (quote_lines) ---
  const q18q = await pool.query(`
    SELECT ql.id::text, ql.quote_id::text, q.quote_number,
           ql.total_line_ht::numeric, ql.vat_rate::numeric, ql.total_line_vat::numeric,
           ROUND((ql.total_line_ht * ql.vat_rate / 100.0)::numeric, 2) AS expected_vat,
           q.organization_id::text
    FROM quote_lines ql
    JOIN quotes q ON q.id = ql.quote_id AND q.organization_id = ql.organization_id
    WHERE q.archived_at IS NULL
      AND ABS(COALESCE(ql.total_line_vat,0) - ROUND((COALESCE(ql.total_line_ht,0) * COALESCE(ql.vat_rate,0) / 100.0)::numeric, 2)) > ${EPS}
  `);
  for (const r of q18q.rows) {
    push("18_quote_line_vat_inconsistent_with_rate", {
      id: r.id,
      quote_number: r.quote_number,
      organization_id: r.organization_id,
      total_en_tete: r.total_line_vat,
      total_lignes: r.expected_vat,
      ecart: ecart(r.total_line_vat, r.expected_vat),
      impact_facturation: "TVA ligne ne correspond pas au taux × HT net.",
      action_recommandee: "Recalculer ligne ou vérifier saisie taux.",
      extra: { quote_id: r.quote_id },
    });
  }

  const q18i2 = hasInvoicesArchivedAt
    ? await pool.query(`
    SELECT il.id::text, il.invoice_id::text, i.invoice_number,
           il.total_line_ht::numeric, il.vat_rate::numeric, il.total_line_vat::numeric,
           ROUND((il.total_line_ht * il.vat_rate / 100.0)::numeric, 2) AS expected_vat,
           i.organization_id::text
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = il.organization_id
    WHERE i.archived_at IS NULL
      AND ABS(COALESCE(il.total_line_vat,0) - ROUND((COALESCE(il.total_line_ht,0) * COALESCE(il.vat_rate,0) / 100.0)::numeric, 2)) > ${EPS}
  `)
    : await pool.query(`
    SELECT il.id::text, il.invoice_id::text, i.invoice_number,
           il.total_line_ht::numeric, il.vat_rate::numeric, il.total_line_vat::numeric,
           ROUND((il.total_line_ht * il.vat_rate / 100.0)::numeric, 2) AS expected_vat,
           i.organization_id::text
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = il.organization_id
    WHERE ABS(COALESCE(il.total_line_vat,0) - ROUND((COALESCE(il.total_line_ht,0) * COALESCE(il.vat_rate,0) / 100.0)::numeric, 2)) > ${EPS}
  `);
  for (const r of q18i2.rows) {
    push("18_invoice_line_vat_inconsistent_with_rate", {
      id: r.id,
      invoice_number: r.invoice_number,
      organization_id: r.organization_id,
      total_en_tete: r.total_line_vat,
      total_lignes: r.expected_vat,
      ecart: ecart(r.total_line_vat, r.expected_vat),
      impact_facturation: "Idem côté facture.",
      action_recommandee: "Recalculer ligne facture.",
      extra: { invoice_id: r.invoice_id },
    });
  }

  // --- 19 TTC != HT + VAT lines ---
  const q19q = await pool.query(`
    SELECT ql.id::text, q.quote_number, ql.total_line_ht::numeric, ql.total_line_vat::numeric, ql.total_line_ttc::numeric,
           (ql.total_line_ht + ql.total_line_vat)::numeric AS sumhv, q.organization_id::text
    FROM quote_lines ql
    JOIN quotes q ON q.id = ql.quote_id AND q.organization_id = ql.organization_id
    WHERE q.archived_at IS NULL
      AND ABS(COALESCE(ql.total_line_ttc,0) - COALESCE(ql.total_line_ht,0) - COALESCE(ql.total_line_vat,0)) > ${EPS}
  `);
  for (const r of q19q.rows) {
    push("19_quote_line_ttc_neq_ht_plus_vat", {
      id: r.id,
      quote_number: r.quote_number,
      organization_id: r.organization_id,
      total_en_tete: r.total_line_ttc,
      total_lignes: r.sumhv,
      ecart: ecart(r.total_line_ttc, r.sumhv),
      impact_facturation: "Ligne devis incohérente.",
      action_recommandee: "Corriger les trois montants ligne.",
    });
  }

  const q19i = hasInvoicesArchivedAt
    ? await pool.query(`
    SELECT il.id::text, i.invoice_number, il.total_line_ht::numeric, il.total_line_vat::numeric, il.total_line_ttc::numeric,
           (il.total_line_ht + il.total_line_vat)::numeric AS sumhv, i.organization_id::text
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = il.organization_id
    WHERE i.archived_at IS NULL
      AND ABS(COALESCE(il.total_line_ttc,0) - COALESCE(il.total_line_ht,0) - COALESCE(il.total_line_vat,0)) > ${EPS}
  `)
    : await pool.query(`
    SELECT il.id::text, i.invoice_number, il.total_line_ht::numeric, il.total_line_vat::numeric, il.total_line_ttc::numeric,
           (il.total_line_ht + il.total_line_vat)::numeric AS sumhv, i.organization_id::text
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = il.organization_id
    WHERE ABS(COALESCE(il.total_line_ttc,0) - COALESCE(il.total_line_ht,0) - COALESCE(il.total_line_vat,0)) > ${EPS}
  `);
  for (const r of q19i.rows) {
    push("19_invoice_line_ttc_neq_ht_plus_vat", {
      id: r.id,
      invoice_number: r.invoice_number,
      organization_id: r.organization_id,
      total_en_tete: r.total_line_ttc,
      total_lignes: r.sumhv,
      ecart: ecart(r.total_line_ttc, r.sumhv),
      impact_facturation: "Ligne facture incohérente.",
      action_recommandee: "Corriger ligne ou recalcul.",
    });
  }

  // --- 20 negative or null header ---
  const q20q = await pool.query(`
    SELECT id::text, quote_number, organization_id::text, status::text,
           total_ht::numeric, total_vat::numeric, total_ttc::numeric, created_at, updated_at
    FROM quotes
    WHERE archived_at IS NULL
      AND (total_ht IS NULL OR total_vat IS NULL OR total_ttc IS NULL
           OR total_ht < 0 OR total_vat < 0 OR total_ttc < 0)
  `);
  for (const r of q20q.rows) {
    push("20_quote_totals_null_or_negative", {
      id: r.id,
      quote_number: r.quote_number,
      organization_id: r.organization_id,
      total_en_tete: `${r.total_ht}/${r.total_vat}/${r.total_ttc}`,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Montants devis invalides.",
      action_recommandee: "Corriger ou recalculer.",
    });
  }

  const q20iSql = hasInvoicesArchivedAt
    ? `
    SELECT id::text, invoice_number, organization_id::text, status::text,
           total_ht::numeric, total_vat::numeric, total_ttc::numeric, created_at, updated_at
    FROM invoices WHERE archived_at IS NULL
      AND (total_ht IS NULL OR total_vat IS NULL OR total_ttc IS NULL
           OR total_ht < 0 OR total_vat < 0 OR total_ttc < 0)
  `
    : `
    SELECT id::text, invoice_number, organization_id::text, status::text,
           total_ht::numeric, total_vat::numeric, total_ttc::numeric, created_at, updated_at
    FROM invoices
    WHERE total_ht IS NULL OR total_vat IS NULL OR total_ttc IS NULL
       OR total_ht < 0 OR total_vat < 0 OR total_ttc < 0
  `;
  const q20i = await pool.query(q20iSql);
  for (const r of q20i.rows) {
    push("20_invoice_totals_null_or_negative", {
      id: r.id,
      invoice_number: r.invoice_number,
      organization_id: r.organization_id,
      total_en_tete: `${r.total_ht}/${r.total_vat}/${r.total_ttc}`,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      impact_facturation: "Montants facture invalides.",
      action_recommandee: "Corriger ou recalcul.",
    });
  }

  const byType = {};
  for (const a of anomalies) {
    const t = a.type_anomalie;
    byType[t] = (byType[t] || 0) + 1;
  }

  const out = {
    meta: {
      epsilon: EPS,
      has_invoices_archived_at: hasInvoicesArchivedAt,
      invoice_status_on_linked_invoices: q14.rows,
      anomalies_total: anomalies.length,
      anomalies_by_type: byType,
    },
    summary_counts,
    anomalies,
  };
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
} finally {
  await pool.end();
}
