/**
 * CP-PDF-V2-020 — Types pour le portage fidèle
 * Alignés sur le ViewModel fullReport du mapper.
 */

export interface P1Auto {
  p1_client?: string;
  p1_ref?: string;
  p1_date?: string;
  p1_why?: string;
  p1_m_kwc?: number | string;
  p1_m_auto?: number | string;
  p1_m_gain?: number | string;
  p1_k_puissance?: number | string;
  p1_k_autonomie?: number | string;
  p1_k_tri?: number | string;
  p1_k_gains?: number | string;
  p1_param_kva?: string;
  p1_param_reseau?: string;
  p1_param_conso?: string;
}

export interface P1Data {
  p1_auto?: P1Auto;
}

export interface P2Data {
  p2_auto?: Record<string, unknown>;
}

export interface P3Data {
  meta?: { client?: string; ref?: string; date?: string };
  offer?: Record<string, unknown>;
  finance?: Record<string, unknown>;
  list_inclus?: string[];
  list_noninclus?: string[];
}

export interface P3bData {
  client?: string;
  ref?: string;
  date?: string;
  inclinaison?: string;
  orientation?: string;
  surface_m2?: number;
  nb_panneaux?: number;
  p3b_photo?: string;
}

export interface P4Data {
  meta?: { client?: string; ref?: string; date?: string };
  production_kwh?: number[];
  consommation_kwh?: number[];
  autoconso_kwh?: number[];
  batterie_kwh?: number[];
}

export interface P5Data {
  meta?: { client?: string; ref?: string; date?: string };
  production_kw?: number[];
  consommation_kw?: number[];
  batterie_kw?: number[];
}

export interface P6Data {
  p6?: {
    meta?: { client?: string; ref?: string; date?: string };
    price?: number;
    dir?: number[];
    bat?: number[];
    grid?: number[];
    tot?: number[];
  };
}

export interface P7Data {
  meta?: { client?: string; ref?: string; date?: string; scenario_label?: string };
  pct?: Record<string, number>;
  c_grid?: number;
  p_surplus?: number;
}

export interface P8Data {
  meta?: { client?: string; ref?: string; date?: string };
  year?: string;
  A?: Record<string, unknown>;
  B?: Record<string, unknown>;
  profile?: Record<string, number[]>;
  hypotheses?: Record<string, unknown>;
  texteSousBarres?: { b1?: string; b2?: string; b3?: string };
}

export interface P9Data {
  meta?: { client?: string; ref?: string; date?: string };
  recommended?: Record<string, unknown>;
  compare?: Record<string, unknown>;
}

export interface P10Data {
  meta?: { client?: string; ref?: string; date?: string };
  best?: Record<string, unknown> & {
    nb_panels?: number;
    annual_production_kwh?: number;
  };
  hyp?: { pv_degrad?: number; elec_infl?: number; oa_price?: number };
}

export interface P11Data {
  meta?: { client?: string; ref?: string; date?: string };
  data?: Record<string, unknown>;
}

export interface P12Data {
  meta?: { client?: string; ref?: string; date?: string };
  env?: Record<string, unknown>;
  v_co2?: string;
  v_trees?: string;
  v_cars?: string;
  v_co2_25?: string;
  v_trees_25?: string;
  v_cars_25?: string;
}

export interface P13Data {
  meta?: { client?: string; ref?: string; date?: string };
}

export interface P14Data {
  meta?: { client?: string; ref?: string; date?: string };
}
