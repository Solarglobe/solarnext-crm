/**
 * Hypothèses économiques globales — priorité officielle (SolarNext) :
 * 1) Surcharges explicites côté projet (form.params.*, form.economics partiel, profil énergie, snapshot métier)
 * 2) settings_json.economics (org / parameters_snapshot après merge défaut)
 * 3) DEFAULT_ECONOMICS_FALLBACK (legacy CP-5)
 *
 * Dégradation PV : fiche panneau (panel_input) > params.degradation > form.economics > admin > défaut
 * (voir financeService.pickEconomics).
 *
 * battery_degradation_pct : lu depuis settings / form.economics ; pas de fiche batterie séparée ici.
 * Défaut moteur 2 % si absent partout.
 */

export const DEFAULT_ECONOMICS_FALLBACK = {
  price_eur_kwh: 0.1952,
  elec_growth_pct: 5,
  pv_degradation_pct: 0.5,
  oa_rate_lt_9: 0.04,
  oa_rate_gte_9: 0.0617,
  prime_lt9: 80,
  prime_gte9: 180,
  horizon_years: 25,
  maintenance_pct: 0,
  onduleur_year: 15,
  onduleur_cost_pct: 12,
  battery_degradation_pct: 2,
};

/** Merge shallow : org partiel + défauts (même logique que loadOrgParams). */
export function mergeOrgEconomicsPartial(orgEconomics) {
  if (!orgEconomics || typeof orgEconomics !== "object") {
    return { ...DEFAULT_ECONOMICS_FALLBACK };
  }
  return { ...DEFAULT_ECONOMICS_FALLBACK, ...orgEconomics };
}

/**
 * Surcharge API / calc : objet `form.economics` partiel (clés numériques uniquement).
 */
export function overlayFormEconomics(base, formEconomics) {
  if (!formEconomics || typeof formEconomics !== "object") return { ...base };
  const out = { ...base };
  for (const k of Object.keys(DEFAULT_ECONOMICS_FALLBACK)) {
    if (!Object.prototype.hasOwnProperty.call(formEconomics, k)) continue;
    const v = formEconomics[k];
    if (v != null && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

/**
 * Tarif kWh « projet » explicite hors org (lead / étude / profil).
 * Si aucune source > 0 : null → appelant utilise admin.
 */
export function pickExplicitProjectTariffKwh({ energyProfile, economicSnapshot, studyData }) {
  const candidates = [
    studyData?.economics?.price_eur_kwh,
    economicSnapshot?.economics?.price_eur_kwh,
    energyProfile?.tariff_kwh,
    energyProfile?.inputs?.tariff_kwh,
    energyProfile?.summary?.price_eur_kwh,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function mergedEconomicsFromCtx(ctx) {
  const f = ctx.form || {};
  return overlayFormEconomics(mergeOrgEconomicsPartial(ctx.settings?.economics), f.economics);
}

/** Prix kWh au détail pour KPI / affichages (cohérent pickEconomics). */
export function resolveRetailElectricityKwhPrice(ctx) {
  const f = ctx.form || {};
  const e = mergedEconomicsFromCtx(ctx);
  const raw = f.params?.tarif_kwh ?? f.params?.tarif_actuel ?? e.price_eur_kwh;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ECONOMICS_FALLBACK.price_eur_kwh;
}

/** Taux OA effectif selon kWc installé. */
export function resolveOaRateForKwc(ctx, kwc) {
  const e = mergedEconomicsFromCtx(ctx);
  const k = Number(kwc) || 0;
  const lt = Number(e.oa_rate_lt_9 ?? DEFAULT_ECONOMICS_FALLBACK.oa_rate_lt_9);
  const gte = Number(e.oa_rate_gte_9 ?? DEFAULT_ECONOMICS_FALLBACK.oa_rate_gte_9);
  return k < 9 ? lt : gte;
}
