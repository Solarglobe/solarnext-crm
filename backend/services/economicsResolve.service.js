/**
 * Hypothèses économiques globales — priorité officielle (SolarNext) :
 * 1) Surcharges explicites côté projet (form.params.*, form.economics partiel, profil énergie, snapshot métier)
 * 2) settings_json.economics (org / parameters_snapshot après merge défaut)
 * 3) DEFAULT_ECONOMICS_FALLBACK (= ORG_ECONOMICS_ENGINE_DEFAULTS, module commun)
 *
 * Dégradation PV : fiche panneau (panel_input) > params.degradation > form.economics > admin > défaut
 * (voir financeService.pickEconomics).
 *
 * battery_degradation_pct : lu depuis settings / form.economics ; pas de fiche batterie séparée ici.
 * Défaut moteur 2 % si absent partout.
 */

import { ORG_ECONOMICS_ENGINE_DEFAULTS, ORG_ECONOMICS_NUMERIC_KEYS } from "../config/orgEconomics.common.js";

/** @deprecated Import direct préféré : `ORG_ECONOMICS_ENGINE_DEFAULTS` depuis `config/orgEconomics.common.js` */
export const DEFAULT_ECONOMICS_FALLBACK = { ...ORG_ECONOMICS_ENGINE_DEFAULTS };
export const ELEC_GROWTH_MISSING_WARNING = "ELEC_GROWTH_MISSING";

function isFiniteNumberLike(v) {
  return v != null && v !== "" && Number.isFinite(Number(v));
}

/** Merge shallow : org partiel + défauts (même logique que loadOrgParams). */
export function mergeOrgEconomicsPartial(orgEconomics) {
  if (!orgEconomics || typeof orgEconomics !== "object") {
    console.warn("[ENGINE WARNING] Using default economics fallback");
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
  for (const k of ORG_ECONOMICS_NUMERIC_KEYS) {
    if (k === "elec_growth_pct") continue;
    if (!Object.prototype.hasOwnProperty.call(formEconomics, k)) continue;
    const v = formEconomics[k];
    if (v != null && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

/**
 * Source unique croissance prix elec : settings_json.economics.elec_growth_pct.
 * Le fallback technique existe pour ne pas crasher, mais il est toujours visible.
 * @param {unknown} orgEconomicsRaw
 * @param {{ log?: boolean, context?: string }} [opts]
 * @returns {{ elec_growth_pct: number, source: "organization_settings" | "technical_fallback", missing: boolean, warnings: string[] }}
 */
export function resolveElectricityGrowthPctFromOrg(orgEconomicsRaw, opts = {}) {
  const raw = orgEconomicsRaw && typeof orgEconomicsRaw === "object" ? orgEconomicsRaw : null;
  const candidate = raw?.elec_growth_pct;
  if (isFiniteNumberLike(candidate)) {
    return {
      elec_growth_pct: Number(candidate),
      source: "organization_settings",
      missing: false,
      warnings: [],
    };
  }

  const fallback = Number(DEFAULT_ECONOMICS_FALLBACK.elec_growth_pct);
  if (opts.log !== false) {
    console.warn(
      `[ENGINE WARNING] ${ELEC_GROWTH_MISSING_WARNING}: settings_json.economics.elec_growth_pct absent ou invalide` +
        `${opts.context ? ` (${opts.context})` : ""}; fallback technique temporaire ${fallback}%/an.`
    );
  }
  return {
    elec_growth_pct: fallback,
    source: "technical_fallback",
    missing: true,
    warnings: [ELEC_GROWTH_MISSING_WARNING],
  };
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

/** Taux OA effectif selon kWc installé (< 3, 3–9, 9–36 kWc). */
export function resolveOaRateForKwc(ctx, kwc) {
  const e = mergedEconomicsFromCtx(ctx);
  const k = Number(kwc) || 0;
  const lt3 = Number(e.oa_rate_lt_3 ?? DEFAULT_ECONOMICS_FALLBACK.oa_rate_lt_3);
  const lt = Number(e.oa_rate_lt_9 ?? DEFAULT_ECONOMICS_FALLBACK.oa_rate_lt_9);
  const gte = Number(e.oa_rate_gte_9 ?? DEFAULT_ECONOMICS_FALLBACK.oa_rate_gte_9);
  if (k > 0 && k < 3) return lt3;
  if (k < 9) return lt;
  return gte;
}
