/**
 * Types pour le FullReport PDF — structures alignées sur pdfViewModel.mapper
 */

export interface FullReportViewModel {
  fullReport?: {
    p1?: { p1_auto?: Record<string, unknown> };
    p2?: { p2_auto?: Record<string, unknown> };
    p3?: { meta?: { client?: string; ref?: string; date?: string }; offer?: Record<string, unknown>; finance?: Record<string, unknown>; tech?: Record<string, unknown> };
    p3b?: { p3b_auto?: Record<string, unknown> };
    p4?: { meta?: Record<string, unknown>; production_kwh?: number[]; consommation_kwh?: number[]; autoconso_kwh?: number[]; batterie_kwh?: number[] };
    p5?: { meta?: Record<string, unknown>; production_kw?: number[]; consommation_kw?: number[]; batterie_kw?: number[] };
    p6?: { p6?: { meta?: Record<string, unknown>; price?: number; dir?: number[]; bat?: number[]; grid?: number[]; tot?: number[] } };
    p7?: { meta?: Record<string, unknown>; pct?: Record<string, number>; c_grid?: number; p_surplus?: number };
    p8?: { meta?: Record<string, unknown>; year?: string; A?: Record<string, unknown>; B?: Record<string, unknown>; profile?: { pv?: number[]; load?: number[]; charge?: number[]; discharge?: number[] }; hypotheses?: Record<string, unknown>; detailsBatterie?: Record<string, unknown>; kpis?: Record<string, unknown>; texteSousBarres?: Record<string, unknown>; interpretation?: Record<string, unknown> };
    p9?: {
      meta?: Record<string, unknown>;
      scenario?: {
        label?: string;
        cumul_25y?: number[];
        roi_year?: number | null;
        capex_eur?: number | null;
        avg_savings_eur_year?: number | null;
        final_cumul?: number | null;
      } | null;
      error?: string | null;
      warnings?: string[];
    };
    p10?: { meta?: Record<string, unknown>; best?: Record<string, unknown>; hyp?: Record<string, unknown> };
    p11?: { meta?: Record<string, unknown>; data?: { capex_ttc?: number; kwc?: number; battery_kwh?: number; economies_annuelles_25?: number[] } };
    p12?: { meta?: Record<string, unknown>; env?: { autocons_pct?: number }; v_co2?: string; v_trees?: string; v_cars?: string; v_co2_25?: string; v_trees_25?: string; v_cars_25?: string };
    p13?: { meta?: Record<string, unknown> };
    p14?: { meta?: Record<string, unknown> };
  };
  [key: string]: unknown;
}
