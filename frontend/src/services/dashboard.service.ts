/**
 * Dashboard pilotage — données agrégées serveur uniquement (GET /api/dashboard/overview).
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "";

export type DashboardRange = "7d" | "30d" | "90d" | "12m" | "custom";

export interface DashboardOverviewParams {
  range?: DashboardRange;
  date_from?: string;
  date_to?: string;
  assigned_user_id?: string | null;
  source_id?: string | null;
}

export interface DashboardMeta {
  generated_at: string;
  organization_id: string;
  date_mode: string;
  period: { range: string; start: string; end: string };
  applied_filters: { assigned_user_id: string | null; source_id: string | null; scope: string };
  formulas: Record<string, string>;
}

export interface DashboardOverview {
  meta: DashboardMeta;
  global_kpis: {
    leads_total_cohort_created: number;
    quotes_cohort_created_total: number;
    quotes_cohort_created_accepted_count: number;
    quotes_accepted_in_period_count: number;
    quotes_stock_total: number;
    quotes_stock_accepted_count: number;
    sign_rate_stock_pct: number;
    sign_rate_cohort_created_pct: number;
    revenue_signed_accepted_in_period: number;
    revenue_signed_created_in_period: number;
    revenue_invoiced_ttc: number;
    cash_collected_ttc: number;
    remaining_to_collect_ttc: number;
    avg_quote_cycle_days: number | null;
    avg_sent_to_sign_days: number | null;
  };
  pipeline: {
    leads_by_stage: {
      stage_id: string;
      stage_name: string;
      position: number;
      is_closed: boolean;
      leads_count: number;
      total_potential_revenue: number;
    }[];
    pipeline_summary: {
      open_leads_count: number;
      lost_leads_count: number;
      signed_leads_count: number;
      archived_leads_count: number;
    };
    lead_conversion_summary: {
      cohort_created: {
        leads_total: number;
        leads_with_quote_count: number;
        leads_without_quote_count: number;
        lead_to_quote_rate: number;
        formula: string;
      };
      stock_open_leads: {
        open_leads_count: number;
        open_leads_with_quote_count: number;
        open_leads_without_quote_count: number;
        lead_to_quote_rate: number;
        formula: string;
      };
    };
    notes?: {
      potential_revenue?: string;
      summary_badges?: string;
    };
  };
  commercial_performance: {
    rank: number;
    user_id: string | null;
    display_name: string;
    leads_count: number;
    leads_created_count: number;
    quotes_count: number;
    quotes_signed_count: number;
    quotes_sent_count: number;
    sign_rate: number;
    sign_rate_formula?: string;
    revenue_signed_ttc: number;
    avg_quote_value_ttc: number | null;
    avg_time_to_sign_days: number | null;
  }[];
  acquisition_performance: {
    source_id: string;
    source_name: string;
    /** Slug stable — regroupements ROI */
    source_slug?: string | null;
    leads_count: number;
    quotes_count: number;
    quotes_signed_count: number;
    quotes_signed_in_period_count?: number;
    lead_to_quote_rate: number;
    lead_to_quote_formula?: string;
    quote_sign_rate: number;
    quote_sign_formula?: string;
    revenue_signed_ttc: number;
    revenue_signed_formula?: string;
    avg_quote_value_ttc: number | null;
  }[];
  /** Marge matériel : uniquement lignes avec coût d’achat ; lignes sans achat exclues. */
  margin_overview: {
    material_margin_ht: number;
    material_margin_pct: number;
    material_sales_ht: number;
    material_purchase_ht: number;
    lines_excluded_count: number;
    quotes_in_period_count: number;
  };
  /** Par devis : marge et % sur le seul périmètre « matériel » (lignes avec prix d’achat). */
  margin_top_quotes: {
    quote_id: string;
    quote_number: string | null;
    entity_label: string | null;
    margin_ht: number | null;
    purchase_cost_ht: number | null;
    sales_ht: number;
    margin_pct: number | null;
    lines_excluded_count: number;
  }[];
  activity_recent_7d: {
    leads_created_7d: number;
    quotes_sent_7d: number;
    quotes_signed_7d: number;
    invoices_issued_7d: number;
    cash_collected_7d: number;
    note?: string;
  };
  activity_timeline: {
    date: string;
    leads_created: number;
    quotes_sent: number;
    quotes_signed: number;
    invoices_issued: number;
    cash_collected: number;
  }[];
  forecast: {
    pipeline_quotes_to_sign_ttc: number;
    weighted_pipeline_ttc: number;
    weighted_method: string;
    weighted_method_short?: string;
    overdue_invoices_amount: number;
    expected_cash_short_term_30d_ttc: number;
  };
}

export async function fetchDashboardOverview(params: DashboardOverviewParams): Promise<DashboardOverview> {
  const sp = new URLSearchParams();
  if (params.range) sp.set("range", params.range);
  if (params.date_from) sp.set("date_from", params.date_from);
  if (params.date_to) sp.set("date_to", params.date_to);
  if (params.assigned_user_id) sp.set("assigned_user_id", params.assigned_user_id);
  if (params.source_id) sp.set("source_id", params.source_id);
  const q = sp.toString();
  const res = await apiFetch(`${API_BASE}/api/dashboard/overview${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json() as Promise<DashboardOverview>;
}
