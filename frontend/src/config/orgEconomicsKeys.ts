/**
 * Clés `settings_json.economics` éditées côté UI — doit rester aligné sur
 * `backend/config/orgEconomics.common.js` (`ORG_ECONOMICS_NUMERIC_KEYS`).
 */
export const ORG_ECONOMICS_UI_KEYS = [
  "price_eur_kwh",
  "elec_growth_pct",
  "pv_degradation_pct",
  "horizon_years",
  "oa_rate_lt_9",
  "oa_rate_gte_9",
  "prime_lt9",
  "prime_gte9",
  "maintenance_pct",
  "onduleur_year",
  "onduleur_cost_pct",
  "battery_degradation_pct",
] as const;
