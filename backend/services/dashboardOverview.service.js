/**
 * Agrégats dashboard CRM — calculs serveur uniquement.
 * Paramètres communs : $1=org, $2=start, $3=end, $4=assigned_user_id (nullable), $5=source_id (nullable)
 * Filtre : « NULL = pas de filtre » (COALESCE / IS NULL OR col = $n).
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import {
  resolveEffectiveHighestRole,
  SUPER_ADMIN_ROLE_CODE,
} from "../lib/superAdminUserGuards.js";
import { isSuperAdminBypassEnabled } from "../config/rbacMode.js";
import {
  num,
  ratePercent,
  avgMoneyOrNull,
  roundMoney2,
  ratioPercent,
} from "./dashboardOverview.kpiMath.js";

export function resolveDashboardPeriod(q) {
  const range = String(q?.range || "30d").toLowerCase();
  const now = new Date();
  let start;
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range === "custom" && q?.date_from && q?.date_to) {
    const a = String(q.date_from).slice(0, 10);
    const b = String(q.date_to).slice(0, 10);
    start = new Date(a + "T00:00:00.000Z");
    end = new Date(b + "T23:59:59.999Z");
    return { range: "custom", start, end, startIso: start.toISOString(), endIso: end.toISOString() };
  }

  if (range === "12m") {
    start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    const days = { "7d": 7, "30d": 30, "90d": 90 }[range] ?? 30;
    start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
  }

  return { range, start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Filtre leads : création dans la période + commercial + source */
const LEAD_PERIOD_WHERE = `
  l.organization_id = $1
  AND l.created_at >= $2::timestamptz AND l.created_at <= $3::timestamptz
  AND ($4::uuid IS NULL OR l.assigned_user_id = $4)
  AND ($5::uuid IS NULL OR l.source_id = $5)`;

/** Jointure quote → lead pour filtres commercial / source */
const QUOTE_LEAD_JOIN = `LEFT JOIN leads lq ON lq.id = q.lead_id`;
const QUOTE_TOTAL_TTC_SQL = `COALESCE(NULLIF(q.document_snapshot_json->'totals'->>'total_ttc', '')::numeric, q.total_ttc)`;
const QUOTE_FILTERS = `
  AND ($4::uuid IS NULL OR lq.assigned_user_id = $4)
  AND ($5::uuid IS NULL OR lq.source_id = $5)`;

/** invoices n’a pas lead_id : lien lead via quotes (i.quote_id → quotes.lead_id). */
const INVOICE_LEAD_JOINS = `
         LEFT JOIN quotes iq ON iq.id = i.quote_id AND iq.organization_id = i.organization_id
         LEFT JOIN leads li ON li.id = iq.lead_id AND li.organization_id = i.organization_id`;

/** Même logique lorsque la facture est aliasée `inv` (sous-requêtes timeline). */
const INVOICE_INV_LEAD_JOINS = `
         LEFT JOIN quotes iq ON iq.id = inv.quote_id AND iq.organization_id = inv.organization_id
         LEFT JOIN leads li ON li.id = iq.lead_id AND li.organization_id = inv.organization_id`;

const PARAMS = (org, p, assignId, sourceId) => [org, p.startIso, p.endIso, assignId, sourceId];

/** Filtres quote←lead sans fenêtre de dates ($1=org, $2=assign, $3=source) */
const QUOTE_STOCK_FILTERS = `
  AND ($2::uuid IS NULL OR lq.assigned_user_id = $2)
  AND ($3::uuid IS NULL OR lq.source_id = $3)`;

/** Délais : uniquement chronologies cohérentes (pas de durées négatives) */
const QUOTE_DELAY_VALID_CYCLE = `
  AND q.accepted_at IS NOT NULL AND q.created_at IS NOT NULL
  AND q.accepted_at >= q.created_at
  AND EXTRACT(EPOCH FROM (q.accepted_at - q.created_at)) > 0`;

const QUOTE_DELAY_VALID_SENT = `
  AND q.sent_at IS NOT NULL AND q.accepted_at IS NOT NULL
  AND q.accepted_at >= q.sent_at
  AND EXTRACT(EPOCH FROM (q.accepted_at - q.sent_at)) > 0`;

/**
 * @param {{ organizationId: string, userId: string, range?: string, date_from?: string, date_to?: string, assigned_user_id?: string, source_id?: string }} input
 */
export async function buildDashboardOverview(input) {
  const org = input.organizationId;
  const uid = input.userId;
  const period = resolveDashboardPeriod(input);

  const effective = await resolveEffectiveHighestRole(pool, uid);
  let canReadAll = false;
  let canReadSelf = false;
  if (input.superAdminContext === true) {
    canReadAll = true;
    canReadSelf = true;
  } else if (effective === SUPER_ADMIN_ROLE_CODE && isSuperAdminBypassEnabled()) {
    canReadAll = true;
    canReadSelf = true;
  } else {
    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    canReadAll =
      perms.has("lead.read.all") || perms.has("quote.manage") || perms.has("invoice.manage");
    canReadSelf = perms.has("lead.read.self");
  }

  if (!canReadAll && !canReadSelf) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  let assignId = input.assigned_user_id || null;
  const sourceId = input.source_id || null;
  if (!canReadAll && canReadSelf) {
    assignId = uid;
  }

  const p = period;
  const base = PARAMS(org, p, assignId, sourceId);
  const roll7 = new Date();
  roll7.setDate(roll7.getDate() - 7);
  const roll7iso = roll7.toISOString();

  // —— A. KPI globaux ——
  const stockParams = [org, assignId, sourceId];

  const leads_total = (
    await pool.query(`SELECT COUNT(*)::int AS c FROM leads l WHERE ${LEAD_PERIOD_WHERE}`, base)
  ).rows[0].c;

  /** Devis créés sur la période (cohorte) */
  const quotes_cohort_created_total = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.created_at >= $2::timestamptz AND q.created_at <= $3::timestamptz
         ${QUOTE_FILTERS}`,
      base
    )
  ).rows[0].c;

  /** Signatures dont la date d’acceptation tombe dans la période */
  const quotes_accepted_in_period_count = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.status = 'ACCEPTED'
         AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
         ${QUOTE_FILTERS}`,
      base
    )
  ).rows[0].c;

  /** Cohorte « devis créés dans la période » : combien sont aujourd’hui ACCEPTED */
  const quotes_cohort_created_accepted_count = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.created_at >= $2::timestamptz AND q.created_at <= $3::timestamptz
         AND q.status = 'ACCEPTED'
         ${QUOTE_FILTERS}`,
      base
    )
  ).rows[0].c;

  /** Stock filtré : tous les devis non archivés (instantané, hors fenêtre de dates) */
  const quotes_stock_row = (
    await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE q.status = 'ACCEPTED')::int AS accepted
       FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         ${QUOTE_STOCK_FILTERS}`,
      stockParams
    )
  ).rows[0];
  const quotes_stock_total = quotes_stock_row.total ?? 0;
  const quotes_stock_accepted_count = quotes_stock_row.accepted ?? 0;

  const sign_rate_stock_pct = ratePercent(quotes_stock_accepted_count, quotes_stock_total);

  const sign_rate_cohort_created_pct = ratePercent(quotes_cohort_created_accepted_count, quotes_cohort_created_total);

  /** CA signé : (1) acceptation dans la période — (2) devis créés dans la période déjà acceptés */
  const revenue_signed_accepted_in_period = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}), 0)::numeric AS s FROM quotes q ${QUOTE_LEAD_JOIN}
         WHERE q.organization_id = $1 AND q.archived_at IS NULL
           AND q.status = 'ACCEPTED'
           AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
           ${QUOTE_FILTERS}`,
        base
      )
    ).rows[0].s
  );

  const revenue_signed_created_in_period = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}), 0)::numeric AS s FROM quotes q ${QUOTE_LEAD_JOIN}
         WHERE q.organization_id = $1 AND q.archived_at IS NULL
           AND q.status = 'ACCEPTED'
           AND q.created_at >= $2::timestamptz AND q.created_at <= $3::timestamptz
           ${QUOTE_FILTERS}`,
        base
      )
    ).rows[0].s
  );

  const revenue_invoiced_ttc = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(i.total_ttc), 0)::numeric AS s FROM invoices i
${INVOICE_LEAD_JOINS}
         WHERE i.organization_id = $1 AND i.archived_at IS NULL
           AND COALESCE(i.issue_date, i.created_at::date)::timestamp >= $2::timestamptz
           AND COALESCE(i.issue_date, i.created_at::date)::timestamp <= $3::timestamptz
           AND ($4::uuid IS NULL OR li.assigned_user_id = $4)
           AND ($5::uuid IS NULL OR li.source_id = $5)`,
        base
      )
    ).rows[0].s
  );

  const cash_collected_ttc = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(p.amount), 0)::numeric AS s FROM payments p
         INNER JOIN invoices i ON i.id = p.invoice_id AND i.organization_id = p.organization_id
${INVOICE_LEAD_JOINS}
         WHERE p.organization_id = $1 AND p.status = 'RECORDED'
           AND p.payment_date >= $2::date AND p.payment_date <= $3::date
           AND ($4::uuid IS NULL OR li.assigned_user_id = $4)
           AND ($5::uuid IS NULL OR li.source_id = $5)`,
        [org, p.startIso.slice(0, 10), p.endIso.slice(0, 10), assignId, sourceId]
      )
    ).rows[0].s
  );

  const remaining_to_collect_ttc = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(i.amount_due), 0)::numeric AS s FROM invoices i
${INVOICE_LEAD_JOINS}
         WHERE i.organization_id = $1 AND i.archived_at IS NULL
           AND ($2::uuid IS NULL OR li.assigned_user_id = $2)
           AND ($3::uuid IS NULL OR li.source_id = $3)`,
        [org, assignId, sourceId]
      )
    ).rows[0].s
  );

  const rowAvgCycle = (
    await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (q.accepted_at - q.created_at)) / 86400.0)::numeric AS d
       FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.status = 'ACCEPTED'
         AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
         ${QUOTE_DELAY_VALID_CYCLE}
         ${QUOTE_FILTERS}`,
      base
    )
  ).rows[0];
  const avg_quote_cycle_days = rowAvgCycle.d != null ? roundMoney2(rowAvgCycle.d) : null;

  const rowAvgSent = (
    await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (q.accepted_at - q.sent_at)) / 86400.0)::numeric AS d
       FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.status = 'ACCEPTED'
         AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
         ${QUOTE_DELAY_VALID_SENT}
         ${QUOTE_FILTERS}`,
      base
    )
  ).rows[0];
  const avg_sent_to_sign_days = rowAvgSent.d != null ? roundMoney2(rowAvgSent.d) : null;

  // —— B. Pipeline (instantané) ——
  const lfLive = `l.organization_id = $1 AND l.status <> 'CLIENT' AND l.archived_at IS NULL
    AND ($2::uuid IS NULL OR l.assigned_user_id = $2)
    AND ($3::uuid IS NULL OR l.source_id = $3)`;
  const liveParams = [org, assignId, sourceId];

  const stagesRes = await pool.query(
    `SELECT id, name, position, is_closed FROM pipeline_stages
     WHERE organization_id = $1 ORDER BY position ASC`,
    [org]
  );

  const byStage = (
    await pool.query(
      `SELECT l.stage_id,
              COUNT(*)::int AS leads_count,
              COALESCE(SUM(COALESCE(l.potential_revenue, 0)), 0)::numeric AS total_potential_revenue
       FROM leads l WHERE ${lfLive}
       GROUP BY l.stage_id`,
      liveParams
    )
  ).rows;
  const smap = new Map(byStage.map((r) => [String(r.stage_id), r]));

  const leads_by_stage = stagesRes.rows.map((s) => {
    const row = smap.get(String(s.id));
    return {
      stage_id: s.id,
      stage_name: s.name,
      position: s.position,
      is_closed: s.is_closed,
      leads_count: row ? row.leads_count : 0,
      total_potential_revenue: row ? num(row.total_potential_revenue) : 0,
    };
  });

  const pipeRow = (
    await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE l.status <> 'CLIENT' AND l.archived_at IS NULL)::int AS open_leads,
         COUNT(*) FILTER (WHERE l.status = 'LOST')::int AS lost,
         COUNT(*) FILTER (WHERE l.status = 'CLIENT' AND l.archived_at IS NULL)::int AS clients_active,
         COUNT(*) FILTER (WHERE l.archived_at IS NOT NULL)::int AS archived
       FROM leads l WHERE l.organization_id = $1
         AND ($2::uuid IS NULL OR l.assigned_user_id = $2)
         AND ($3::uuid IS NULL OR l.source_id = $3)`,
      liveParams
    )
  ).rows[0];

  const clientsActive = pipeRow.clients_active ?? 0;
  const pipeline_summary = {
    open_leads_count: pipeRow.open_leads ?? 0,
    lost_leads_count: pipeRow.lost ?? 0,
    /** Dossiers client actifs (aligné liste Clients), pas « devis ACCEPTED ». */
    clients_active_count: clientsActive,
    /** @deprecated Utiliser clients_active_count — conservé pour compat. */
    signed_leads_count: clientsActive,
    archived_leads_count: pipeRow.archived ?? 0,
  };

  const conv = (
    await pool.query(
      `WITH cohort AS (SELECT l.id FROM leads l WHERE ${LEAD_PERIOD_WHERE})
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM quotes q WHERE q.lead_id = c.id AND q.organization_id = $1 AND q.archived_at IS NULL
         ))::int AS with_quote
       FROM cohort c`,
      base
    )
  ).rows[0];
  const cohortLeadsTotal = conv.total ?? 0;
  const cohortLeadsWithQuote = conv.with_quote ?? 0;
  const lead_to_quote_rate_cohort_created_pct = ratePercent(cohortLeadsWithQuote, cohortLeadsTotal);

  /** Stock : leads ouverts (LEAD) — au moins un devis (tout statut) */
  const stockConv = (
    await pool.query(
      `SELECT
         COUNT(*)::int AS open_total,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM quotes q
           WHERE q.lead_id = l.id AND q.organization_id = l.organization_id AND q.archived_at IS NULL
         ))::int AS with_quote
       FROM leads l
       WHERE l.organization_id = $1 AND l.status <> 'CLIENT' AND l.archived_at IS NULL
         AND ($2::uuid IS NULL OR l.assigned_user_id = $2)
         AND ($3::uuid IS NULL OR l.source_id = $3)`,
      liveParams
    )
  ).rows[0];
  const stockOpen = stockConv.open_total ?? 0;
  const stockWithQuote = stockConv.with_quote ?? 0;
  const lead_to_quote_rate_stock_pct = ratePercent(stockWithQuote, stockOpen);

  const lead_conversion_summary = {
    cohort_created: {
      leads_total: cohortLeadsTotal,
      leads_with_quote_count: cohortLeadsWithQuote,
      leads_without_quote_count: Math.max(0, cohortLeadsTotal - cohortLeadsWithQuote),
      lead_to_quote_rate: lead_to_quote_rate_cohort_created_pct,
      formula:
        "leads créés dans la période ayant au moins un devis (tout statut) / leads créés dans la même période",
    },
    stock_open_leads: {
      open_leads_count: stockOpen,
      open_leads_with_quote_count: stockWithQuote,
      open_leads_without_quote_count: Math.max(0, stockOpen - stockWithQuote),
      lead_to_quote_rate: lead_to_quote_rate_stock_pct,
      formula:
        "leads au statut LEAD non archivés avec au moins un devis / leads LEAD ouverts (instantané, filtre commercial/source)",
    },
  };

  // —— C. Performance commerciale (cohorte leads créés période) ——
  const comm = await pool.query(
    `SELECT
       COALESCE(l.assigned_user_id::text, '_none') AS uid_key,
       COUNT(DISTINCT l.id)::int AS leads_created,
       COUNT(DISTINCT q.id)::int AS quotes_n,
       COUNT(DISTINCT q.id) FILTER (WHERE q.status = 'ACCEPTED')::int AS quotes_signed_n,
       COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}) FILTER (
         WHERE q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
       ), 0)::numeric AS revenue_signed,
       AVG(${QUOTE_TOTAL_TTC_SQL}) FILTER (
         WHERE q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
       )::numeric AS avg_quote,
       AVG(EXTRACT(EPOCH FROM (q.accepted_at - q.created_at)) / 86400.0) FILTER (
         WHERE q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
         AND q.accepted_at >= q.created_at AND q.created_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (q.accepted_at - q.created_at)) > 0
       )::numeric AS avg_sign_days,
       COUNT(DISTINCT q.id) FILTER (
         WHERE q.sent_at >= $2::timestamptz AND q.sent_at <= $3::timestamptz
       )::int AS quotes_sent_n
     FROM leads l
     LEFT JOIN quotes q ON q.lead_id = l.id AND q.organization_id = l.organization_id AND q.archived_at IS NULL
     WHERE ${LEAD_PERIOD_WHERE}
     GROUP BY l.assigned_user_id`,
    base
  );

  const commercial_performance = [];
  for (const row of comm.rows) {
    const idKey = row.uid_key === "_none" ? null : row.uid_key;
    let display_name = "Non assigné";
    if (idKey) {
      const ur = (
        await pool.query(
          `SELECT email, first_name, last_name FROM users WHERE id = $1 AND organization_id = $2`,
          [idKey, org]
        )
      ).rows[0];
      if (ur) {
        const fn = [ur.first_name, ur.last_name].filter(Boolean).join(" ").trim();
        display_name = fn || ur.email || idKey;
      }
    }
    const qn = num(row.quotes_n);
    const qsig = num(row.quotes_signed_n);
    commercial_performance.push({
      user_id: idKey,
      display_name,
      leads_created_count: num(row.leads_created),
      leads_count: num(row.leads_created),
      quotes_count: qn,
      quotes_signed_count: qsig,
      quotes_sent_count: num(row.quotes_sent_n),
      sign_rate: ratePercent(qsig, qn),
      sign_rate_formula:
        "devis ACCEPTED liés aux leads de la cohorte (créés sur la période) / tous les devis liés à ces leads",
      revenue_signed_ttc: num(row.revenue_signed),
      avg_quote_value_ttc: row.avg_quote != null ? roundMoney2(row.avg_quote) : null,
      avg_time_to_sign_days: row.avg_sign_days != null ? roundMoney2(row.avg_sign_days) : null,
    });
  }
  commercial_performance.sort((a, b) => b.revenue_signed_ttc - a.revenue_signed_ttc);
  commercial_performance.forEach((row, i) => {
    row.rank = i + 1;
  });

  // —— D. Acquisition ——
  const acq = await pool.query(
    `SELECT
       ls.id AS source_id,
       ls.name AS source_name,
       ls.slug AS source_slug,
       COUNT(DISTINCT l.id)::int AS leads_count,
       COUNT(DISTINCT q.id)::int AS quotes_count,
       COUNT(DISTINCT q.id) FILTER (WHERE q.status = 'ACCEPTED')::int AS quotes_signed,
       COUNT(DISTINCT q.id) FILTER (
         WHERE q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
       )::int AS quotes_signed_in_period,
        COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}) FILTER (
         WHERE q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
       ), 0)::numeric AS revenue_signed
     FROM leads l
     INNER JOIN lead_sources ls ON ls.id = l.source_id
     LEFT JOIN quotes q ON q.lead_id = l.id AND q.organization_id = l.organization_id AND q.archived_at IS NULL
     WHERE ${LEAD_PERIOD_WHERE}
     GROUP BY ls.id, ls.name, ls.slug
     ORDER BY leads_count DESC`,
    base
  );

  const acquisition_performance = acq.rows.map((r) => {
    const lc = num(r.leads_count);
    const qc = num(r.quotes_count);
    const qs = num(r.quotes_signed);
    const qsPeriod = num(r.quotes_signed_in_period);
    const rev = num(r.revenue_signed);
    return {
      source_id: r.source_id,
      source_name: r.source_name,
      source_slug: r.source_slug ?? null,
      leads_count: lc,
      quotes_count: qc,
      quotes_signed_count: qs,
      quotes_signed_in_period_count: qsPeriod,
      lead_to_quote_rate: ratePercent(qc, lc),
      lead_to_quote_formula: "devis liés aux leads créés sur la période / leads créés sur la période",
      quote_sign_rate: ratePercent(qs, qc),
      quote_sign_formula: "devis ACCEPTED liés à la cohorte / devis liés à la cohorte (même périmètre)",
      revenue_signed_ttc: rev,
      revenue_signed_formula:
        "somme TTC des devis ACCEPTED dont accepted_at est dans la fenêtre (aligné CA « direction » période)",
      avg_quote_value_ttc: avgMoneyOrNull(rev, qsPeriod),
    };
  });

  // —— E. Marge matériel (devis ACCEPTÉS, accepted_at dans période) ——
  // Uniquement lignes avec purchase_unit_price_ht_cents ; les autres sont ignorées (prestations sans achat, etc.).
  const marginRows = (
    await pool.query(
      `SELECT
         q.id,
         q.quote_number,
         COALESCE(SUM(CASE
           WHEN COALESCE(ql.is_active, true) AND ql.purchase_unit_price_ht_cents IS NOT NULL
           THEN ql.total_line_ht ELSE 0 END), 0)::numeric AS sales_covered_ht,
         COALESCE(SUM(CASE WHEN COALESCE(ql.is_active, true) THEN ql.quantity * (ql.purchase_unit_price_ht_cents::numeric / 100.0) ELSE 0 END), 0)::numeric AS purchase_ht,
         (COUNT(*) FILTER (WHERE COALESCE(ql.is_active, true) AND ql.purchase_unit_price_ht_cents IS NULL))::int AS lines_excluded
       FROM quotes q
       ${QUOTE_LEAD_JOIN}
       INNER JOIN quote_lines ql ON ql.quote_id = q.id AND ql.organization_id = q.organization_id
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.status = 'ACCEPTED'
         AND q.accepted_at >= $2::timestamptz AND q.accepted_at <= $3::timestamptz
         ${QUOTE_FILTERS}
       GROUP BY q.id, q.quote_number`,
      base
    )
  ).rows;

  let total_material_sales = 0;
  let total_material_purchase = 0;
  let total_lines_excluded = 0;
  const margin_detail = [];

  for (const row of marginRows) {
    const salesCoveredHt = num(row.sales_covered_ht);
    const purchaseHt = num(row.purchase_ht);
    const linesExcluded = Number(row.lines_excluded) || 0;

    total_lines_excluded += linesExcluded;

    let marginHt = null;
    let marginPct = null;

    if (salesCoveredHt > 0) {
      marginHt = roundMoney2(salesCoveredHt - purchaseHt);
      marginPct = ratioPercent(marginHt, salesCoveredHt);
      total_material_sales += salesCoveredHt;
      total_material_purchase += purchaseHt;
    }

    margin_detail.push({
      quote_id: row.id,
      quote_number: row.quote_number,
      margin_ht: marginHt,
      purchase_cost_ht: marginHt != null ? roundMoney2(purchaseHt) : null,
      sales_ht: salesCoveredHt,
      margin_pct: marginPct,
      lines_excluded_count: linesExcluded,
      entity_label: null,
    });
  }

  const total_material_margin = roundMoney2(total_material_sales - total_material_purchase);
  const material_margin_pct_global = ratioPercent(total_material_margin, total_material_sales);

  const margin_overview = {
    material_margin_ht: total_material_margin,
    material_margin_pct: material_margin_pct_global,
    material_sales_ht: roundMoney2(total_material_sales),
    material_purchase_ht: roundMoney2(total_material_purchase),
    lines_excluded_count: total_lines_excluded,
    quotes_in_period_count: marginRows.length,
  };

  margin_detail.sort(
    (a, b) => (b.margin_ht ?? Number.NEGATIVE_INFINITY) - (a.margin_ht ?? Number.NEGATIVE_INFINITY)
  );
  const margin_top_quotes = margin_detail.slice(0, 15);

  for (const m of margin_top_quotes) {
    const lr = (
      await pool.query(
        `SELECT l.full_name AS lead_name, c.company_name, c.first_name AS cfn, c.last_name AS cln
         FROM quotes q
         LEFT JOIN leads l ON l.id = q.lead_id
         LEFT JOIN clients c ON c.id = q.client_id
         WHERE q.id = $1`,
        [m.quote_id]
      )
    ).rows[0];
    let label = "—";
    if (lr?.company_name?.trim()) label = lr.company_name.trim();
    else if (lr?.cfn || lr?.cln) label = [lr.cfn, lr.cln].filter(Boolean).join(" ").trim();
    else if (lr?.lead_name?.trim()) label = lr.lead_name.trim();
    m.entity_label = label;
  }

  // —— F. Activité ——
  const rollParams = [org, roll7iso, assignId, sourceId];
  const ROLL_FILTERS = `
    AND ($3::uuid IS NULL OR l.assigned_user_id = $3)
    AND ($4::uuid IS NULL OR l.source_id = $4)`;
  const QROLL_FILTERS = `
    AND ($3::uuid IS NULL OR lq.assigned_user_id = $3)
    AND ($4::uuid IS NULL OR lq.source_id = $4)`;

  const leads_created_7d = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM leads l
       WHERE l.organization_id = $1 AND l.created_at >= $2::timestamptz ${ROLL_FILTERS}`,
      rollParams
    )
  ).rows[0].c;

  const quotes_sent_7d = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL AND q.sent_at >= $2::timestamptz ${QROLL_FILTERS}`,
      rollParams
    )
  ).rows[0].c;

  const quotes_signed_7d = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND q.status = 'ACCEPTED' AND q.accepted_at >= $2::timestamptz ${QROLL_FILTERS}`,
      rollParams
    )
  ).rows[0].c;

  const invoices_issued_7d = (
    await pool.query(
      `SELECT COUNT(*)::int AS c FROM invoices i
${INVOICE_LEAD_JOINS}
       WHERE i.organization_id = $1 AND i.archived_at IS NULL
         AND COALESCE(i.issue_date, i.created_at::date) >= $2::date
         AND ($3::uuid IS NULL OR li.assigned_user_id = $3)
         AND ($4::uuid IS NULL OR li.source_id = $4)`,
      rollParams
    )
  ).rows[0].c;

  const cash_collected_7d = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(p.amount), 0)::numeric AS s FROM payments p
         INNER JOIN invoices i ON i.id = p.invoice_id AND i.organization_id = p.organization_id
${INVOICE_LEAD_JOINS}
         WHERE p.organization_id = $1 AND p.status = 'RECORDED' AND p.payment_date >= $2::date
           AND ($3::uuid IS NULL OR li.assigned_user_id = $3)
           AND ($4::uuid IS NULL OR li.source_id = $4)`,
        rollParams
      )
    ).rows[0].s
  );

  const activity_recent_7d = {
    leads_created_7d,
    quotes_sent_7d,
    quotes_signed_7d,
    invoices_issued_7d,
    cash_collected_7d,
    note: "Fenêtre glissante 7 jours ; factures et encaissements filtrés par lead (commercial / source) lorsque renseignés.",
  };

  const tl = await pool.query(
    `WITH days AS (
       SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS d
     )
     SELECT
       days.d,
       (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = $1 AND l.created_at::date = days.d
         AND ($4::uuid IS NULL OR l.assigned_user_id = $4) AND ($5::uuid IS NULL OR l.source_id = $5)) AS leads_created,
       (SELECT COUNT(*)::int FROM quotes q ${QUOTE_LEAD_JOIN}
         WHERE q.organization_id = $1 AND q.archived_at IS NULL AND q.sent_at::date = days.d ${QUOTE_FILTERS}) AS quotes_sent,
       (SELECT COUNT(*)::int FROM quotes q ${QUOTE_LEAD_JOIN}
         WHERE q.organization_id = $1 AND q.archived_at IS NULL AND q.status = 'ACCEPTED' AND q.accepted_at::date = days.d ${QUOTE_FILTERS}) AS quotes_signed,
       (SELECT COUNT(*)::int FROM invoices i
${INVOICE_LEAD_JOINS}
         WHERE i.organization_id = $1 AND i.archived_at IS NULL
           AND COALESCE(i.issue_date, i.created_at::date) = days.d
           AND ($4::uuid IS NULL OR li.assigned_user_id = $4)
           AND ($5::uuid IS NULL OR li.source_id = $5)) AS invoices_issued,
       (SELECT COALESCE(SUM(p.amount), 0)::numeric FROM payments p
         INNER JOIN invoices inv ON inv.id = p.invoice_id AND inv.organization_id = p.organization_id
${INVOICE_INV_LEAD_JOINS}
         WHERE p.organization_id = $1 AND p.status = 'RECORDED' AND p.payment_date = days.d
           AND ($4::uuid IS NULL OR li.assigned_user_id = $4)
           AND ($5::uuid IS NULL OR li.source_id = $5)) AS cash_collected
     FROM days ORDER BY days.d ASC`,
    base
  );

  const activity_timeline = tl.rows.map((r) => ({
    date: r.d,
    leads_created: r.leads_created,
    quotes_sent: r.quotes_sent,
    quotes_signed: r.quotes_signed,
    invoices_issued: r.invoices_issued,
    cash_collected: num(r.cash_collected),
  }));

  // —— G. Prévisionnel ——
  const fq = (
    await pool.query(
      `SELECT
         COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}) FILTER (WHERE q.status IN ('READY_TO_SEND', 'SENT')), 0)::numeric AS pipe,
         COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}) FILTER (WHERE q.status = 'READY_TO_SEND'), 0)::numeric * 0.5
         + COALESCE(SUM(${QUOTE_TOTAL_TTC_SQL}) FILTER (WHERE q.status = 'SENT'), 0)::numeric * 0.65 AS weighted
       FROM quotes q ${QUOTE_LEAD_JOIN}
       WHERE q.organization_id = $1 AND q.archived_at IS NULL
         AND ($2::uuid IS NULL OR lq.assigned_user_id = $2)
         AND ($3::uuid IS NULL OR lq.source_id = $3)`,
      [org, assignId, sourceId]
    )
  ).rows[0];

  const overdue_invoices_amount = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(i.amount_due), 0)::numeric AS s FROM invoices i
${INVOICE_LEAD_JOINS}
         WHERE i.organization_id = $1 AND i.archived_at IS NULL
           AND i.status NOT IN ('PAID', 'CANCELLED', 'DRAFT')
           AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.amount_due > 0
           AND ($2::uuid IS NULL OR li.assigned_user_id = $2)
           AND ($3::uuid IS NULL OR li.source_id = $3)`,
        [org, assignId, sourceId]
      )
    ).rows[0].s
  );

  const expected_cash_short_term_30d = num(
    (
      await pool.query(
        `SELECT COALESCE(SUM(i.amount_due), 0)::numeric AS s FROM invoices i
${INVOICE_LEAD_JOINS}
         WHERE i.organization_id = $1 AND i.archived_at IS NULL
           AND i.status NOT IN ('PAID', 'CANCELLED')
           AND i.due_date IS NOT NULL
           AND i.due_date >= CURRENT_DATE
           AND i.due_date <= CURRENT_DATE + INTERVAL '30 days'
           AND i.amount_due > 0
           AND ($2::uuid IS NULL OR li.assigned_user_id = $2)
           AND ($3::uuid IS NULL OR li.source_id = $3)`,
        [org, assignId, sourceId]
      )
    ).rows[0].s
  );

  const date_mode = p.range === "custom" ? "custom_range" : "rolling_window";

  const formulas = {
    sign_rate_main:
      "Taux affiché en principal : devis créés dans la période avec statut ACCEPTED ÷ devis créés dans la période (cohorte création).",
    sign_rate_stock:
      "Devis ACCEPTED ÷ tous les devis non archivés (instantané), même filtre commercial/source sur le lead.",
    sign_rate_cohort_created:
      "Identique au taux principal — numérateur et dénominateur alignés sur la date de création du devis.",
    lead_to_quote_rate_main:
      "Taux affiché en principal : leads créés dans la période avec au moins un devis ÷ leads créés dans la période.",
    lead_to_quote_rate_stock:
      "Leads au statut LEAD ouverts avec au moins un devis ÷ leads LEAD ouverts (instantané).",
    lead_to_quote_rate_cohort_created: "Identique au taux principal (cohorte création des leads).",
    weighted_pipeline:
      "Pipeline ouvert : somme TTC des devis READY_TO_SEND et SENT non signés ; pondération = READY_TO_SEND × 50 % + SENT × 65 %.",
    revenue_signed_main:
      "Valeur direction par défaut : somme TTC des devis ACCEPTED dont accepted_at ∈ période affichée.",
    revenue_signed_accepted_in_period:
      "Somme TTC des devis ACCEPTED avec date d’acceptation dans [début, fin].",
    revenue_signed_created_in_period:
      "Somme TTC des devis créés dans [début, fin] et déjà au statut ACCEPTED.",
    material_margin:
      "Marge matériel : CA HT et coûts uniquement sur les lignes de devis avec purchase_unit_price_ht_cents renseigné ; les lignes sans coût d’achat sont exclues (prestations, pose, etc.).",
  };

  return {
    meta: {
      generated_at: new Date().toISOString(),
      organization_id: org,
      date_mode,
      period: { range: p.range, start: p.startIso, end: p.endIso },
      applied_filters: {
        assigned_user_id: assignId,
        source_id: sourceId,
        scope: canReadAll ? "organization" : "self",
      },
      formulas,
    },
    global_kpis: {
      leads_total_cohort_created: leads_total,
      quotes_cohort_created_total,
      quotes_cohort_created_accepted_count,
      quotes_accepted_in_period_count,
      quotes_stock_total,
      quotes_stock_accepted_count,
      sign_rate_stock_pct,
      sign_rate_cohort_created_pct,
      revenue_signed_accepted_in_period,
      revenue_signed_created_in_period,
      revenue_invoiced_ttc,
      cash_collected_ttc,
      remaining_to_collect_ttc,
      avg_quote_cycle_days,
      avg_sent_to_sign_days,
    },
    pipeline: {
      leads_by_stage,
      pipeline_summary,
      lead_conversion_summary,
      notes: {
        potential_revenue:
          "Somme des champs « potentiel » sur les leads ouverts à l’étape (estimation interne, non contractuelle).",
        summary_badges:
          "Perdus / Clients actifs (statut CLIENT non archivé) / Archivés : périmètre filtre commercial & source, hors timeline.",
      },
    },
    commercial_performance,
    acquisition_performance,
    margin_overview,
    margin_top_quotes,
    activity_recent_7d,
    activity_timeline,
    forecast: {
      pipeline_quotes_to_sign_ttc: roundMoney2(fq.pipe),
      weighted_pipeline_ttc: roundMoney2(fq.weighted),
      weighted_method: "READY_TO_SEND × 50 % + SENT × 65 % (montants TTC)",
      weighted_method_short: "READY_TO_SEND×0,5 + SENT×0,65",
      overdue_invoices_amount,
      expected_cash_short_term_30d_ttc: expected_cash_short_term_30d,
    },
  };
}
