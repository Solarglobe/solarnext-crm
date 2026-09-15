import { cashflowIrr } from "./financialIndicators.service.js";
import { resolveSimulationContract } from './simulationContract.service.js';
import { resolveVirtualStorageOaCompatibility } from './virtualStorageOaCompatibility.service.js';
// ======================================================================
// SMARTPITCH V9 — FINANCE SERVICE (FORMAT SCENARIO V-LIGHT COMPATIBLE)
// ======================================================================
// 100% COMPATIBLE AVEC scenarioService.js + calc.controller.js
// ======================================================================
//
// --- Règles métier V2 (scénarios _v2 === true) — source de vérité persistée ---
//
// 1) CAPEX TTC (scenario.capex_ttc après calcul)
//    - BASE : finance_input.capex_ttc = coût total installation PV TTC (devis / economic_snapshot).
//    - BATTERY_PHYSICAL : même PV + finance_input.battery_physical_price_ttc (jamais un sous-total
//      ambigu pris sur scenario.capex_ttc — le moteur recalcule depuis finance_input).
//    - BATTERY_VIRTUAL : PV uniquement. Les frais ponctuels du crédit virtuel restent séparés
//      du prix photovoltaïque et ne sont pas financés avec l'installation.
//
// 2) Flux annuels (total_eur)
//    - Économies (auto, OA, import BV), + prime d’autoconsommation en année 1 uniquement,
//      − maintenance, − onduleur si année de remplacement.
//
// 3) Cumuls dans flows[]
//    - cumul_gains_eur : somme des total_eur (gains cumulés « hors barre d’investissement »).
//    - cumul_eur       : position nette après investissement BRUT = -capex_ttc + cumul_gains_eur.
//      La courbe d’amortissement part donc sous zéro et le passage ≥ 0 = récupération du CAPEX TTC
//      via les flux (prime comprise en année 1 comme entrée de trésorerie).
//
// 4) ROI (roi_years)
//    - Première année où cumul_eur >= 0 (investissement TTC amorti par les flux).
//
// 5) TRI (irr_pct)
//    - Flux initiaux : -capex_ttc à t0, puis total_eur par année (cohérent avec le cumul brut).
//
// 6) capex_net / prime
//    - capex_net = max(capex_ttc - prime_autoconso, 0) reste exposé pour LCOE / lecture ;
//      la prime n’est pas retirée deux fois du cumul : elle est dans les flux année 1.
//
// ======================================================================

import { round } from "./utils/helpers.js";
import { isMicroInverterForFinance } from "./pv/inverterFinanceContext.js";
import {
  DEFAULT_ECONOMICS_FALLBACK,
  mergeOrgEconomicsPartial,
  overlayFormEconomics,
  resolveElectricityGrowthPctFromOrg,
  resolveOaTariffForKwc,
} from "./economicsResolve.service.js";
import { resolveFinanceProjection, resolveScenarioAid, resolveScenarioSale, batteryAgeAtYear } from "./financeProjection.service.js";

function hasOwn(obj, key) {
  return obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

async function sha256Hex(input) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(String(input)).digest("hex");
}

function resolveEconomicSource({ form, rawOrgEconomics, key, formPaths = [] }) {
  for (const p of formPaths) {
    const parts = p.split(".");
    let cur = form;
    for (const part of parts) cur = cur && typeof cur === "object" ? cur[part] : undefined;
    if (cur != null && Number.isFinite(Number(cur))) return `form.${p}`;
  }
  if (hasOwn(rawOrgEconomics, key)) return `organizations.settings_json.economics.${key}`;
  return "DEFAULT_ECONOMICS_FALLBACK";
}

function normalizeFinancingSnapshot(configJson, capexTtc) {
  const cfg = configJson && typeof configJson === "object" ? configJson : {};
  const raw = cfg.financing && typeof cfg.financing === "object" ? cfg.financing : {};
  const totalsTtc = Number(cfg?.totals?.ttc);
  const amountRaw = Number(raw.amount);
  const duration = Number(raw.duration_months);
  const rate = Number(raw.interest_rate_annual);
  const fallbackAmount = Number.isFinite(totalsTtc) && totalsTtc > 0 ? totalsTtc : Number(capexTtc);
  const rateKnown = raw.interest_rate_annual != null && raw.interest_rate_annual !== '' && Number.isFinite(rate) && rate >= 0;
  const enabled = Number.isFinite(duration) && duration > 0 && rateKnown;
  const amount =
    Number.isFinite(amountRaw) && amountRaw > 0
      ? amountRaw
      : enabled && Number.isFinite(fallbackAmount) && fallbackAmount > 0
        ? fallbackAmount
        : null;
  return {
    enabled,
    amount_eur: amount,
    duration_months: Number.isFinite(duration) && duration > 0 ? duration : null,
    interest_rate_annual_pct: rateKnown ? rate : null,
    taeg_pct: raw.taeg_pct != null && Number.isFinite(Number(raw.taeg_pct)) ? Number(raw.taeg_pct) : null,
    insurance_eur: raw.insurance_eur != null && Number.isFinite(Number(raw.insurance_eur)) ? Number(raw.insurance_eur) : null,
    application_fee_eur: raw.application_fee_eur != null && Number.isFinite(Number(raw.application_fee_eur)) ? Number(raw.application_fee_eur) : null,
    other_costs_eur: raw.other_costs_eur != null && Number.isFinite(Number(raw.other_costs_eur)) ? Number(raw.other_costs_eur) : null,
    source: cfg.financing ? "economic_snapshots.config_json.financing@calculation" : "not_configured",
  };
}

// ======================================================================
// PARAMÈTRES FINANCIERS
// ======================================================================
function pickEconomics(ctx) {
  const f = ctx.form || {};
  const rawOrgEconomics = Object.hasOwn(ctx.settings ?? {}, 'economics_raw')
    ? ctx.settings.economics_raw
    : ctx.settings?.economics;
  const e = overlayFormEconomics(mergeOrgEconomicsPartial(ctx.settings?.economics), f.economics);
  const elecGrowth = resolveElectricityGrowthPctFromOrg(rawOrgEconomics, {
    context: "financeService.pickEconomics",
  });

  const num = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };

  const out = {
    // Prix kWh : params lead (payload) > form.economics > admin (déjà dans e) > fallback
    price_eur_kwh: num(
      f.params?.tarif_kwh ?? f.params?.tarif_actuel ?? e.price_eur_kwh,
      DEFAULT_ECONOMICS_FALLBACK.price_eur_kwh
    ),
    elec_growth_pct: elecGrowth.elec_growth_pct,
    elec_growth_source: elecGrowth.source,
    elec_growth_missing: elecGrowth.missing,
    elec_growth_warnings: elecGrowth.warnings,
    // Dégradation PV annuelle : fiche panneau > params.degradation > form.economics > admin > défaut
    pv_degradation_pct: num(
      f.panel_input?.degradation_annual_pct ??
        f.params?.degradation ??
        e.pv_degradation_pct,
      DEFAULT_ECONOMICS_FALLBACK.pv_degradation_pct
    ),
    // LID / LeTID : le moteur energetique applique deja la perte an 1 sur la production.
    // Ici on garde 0 dans les cashflows pour eviter un double retrait.
    pv_degradation_first_year_pct:
      f.panel_input?.degradation_first_year_pct_applied_to_energy === true
        ? 0
        : num(f.panel_input?.degradation_first_year_pct ?? 0, 0),
    oa_rate_lt_3: num(e.oa_rate_lt_3, DEFAULT_ECONOMICS_FALLBACK.oa_rate_lt_3),
    oa_rate_lt_9: num(e.oa_rate_lt_9, DEFAULT_ECONOMICS_FALLBACK.oa_rate_lt_9),
    oa_rate_gte_9: num(e.oa_rate_gte_9, DEFAULT_ECONOMICS_FALLBACK.oa_rate_gte_9),
    prime_lt9: num(f.economics?.prime_lt9 ?? rawOrgEconomics?.prime_lt9, 0),
    prime_gte9: num(f.economics?.prime_gte9 ?? rawOrgEconomics?.prime_gte9, 0),
    horizon_years: num(e.horizon_years, DEFAULT_ECONOMICS_FALLBACK.horizon_years),
    maintenance_pct: num(e.maintenance_pct, DEFAULT_ECONOMICS_FALLBACK.maintenance_pct),
    inverter_replacement_year: num(f.economics?.onduleur_year ?? rawOrgEconomics?.onduleur_year, 0),
    inverter_cost_pct: num(f.economics?.onduleur_cost_pct ?? rawOrgEconomics?.onduleur_cost_pct, 0),
    // Dégradation énergie batterie physique (cashflows) — admin / form.economics ; pas d’UI dédiée tant que non exposé
    battery_degradation_pct: num(
      e.battery_degradation_pct,
      DEFAULT_ECONOMICS_FALLBACK.battery_degradation_pct
    ),
  };

  out.sources = {
    price_eur_kwh: resolveEconomicSource({
      form: f,
      rawOrgEconomics,
      key: "price_eur_kwh",
      formPaths: ["params.tarif_kwh", "params.tarif_actuel", "economics.price_eur_kwh"],
    }),
    elec_growth_pct: out.elec_growth_source ?? resolveEconomicSource({ form: f, rawOrgEconomics, key: "elec_growth_pct" }),
    pv_degradation_pct: resolveEconomicSource({
      form: f,
      rawOrgEconomics,
      key: "pv_degradation_pct",
      formPaths: ["panel_input.degradation_annual_pct", "params.degradation", "economics.pv_degradation_pct"],
    }),
    oa_rate_lt_3: resolveEconomicSource({ form: f, rawOrgEconomics, key: "oa_rate_lt_3", formPaths: ["economics.oa_rate_lt_3"] }),
    oa_rate_lt_9: resolveEconomicSource({ form: f, rawOrgEconomics, key: "oa_rate_lt_9", formPaths: ["economics.oa_rate_lt_9"] }),
    oa_rate_gte_9: resolveEconomicSource({ form: f, rawOrgEconomics, key: "oa_rate_gte_9", formPaths: ["economics.oa_rate_gte_9"] }),
    prime_lt9: resolveEconomicSource({ form: f, rawOrgEconomics, key: "prime_lt9", formPaths: ["economics.prime_lt9"] }),
    prime_gte9: resolveEconomicSource({ form: f, rawOrgEconomics, key: "prime_gte9", formPaths: ["economics.prime_gte9"] }),
    horizon_years: resolveEconomicSource({ form: f, rawOrgEconomics, key: "horizon_years", formPaths: ["economics.horizon_years"] }),
    maintenance_pct: resolveEconomicSource({ form: f, rawOrgEconomics, key: "maintenance_pct", formPaths: ["economics.maintenance_pct"] }),
    inverter_replacement_year: resolveEconomicSource({ form: f, rawOrgEconomics, key: "onduleur_year", formPaths: ["economics.onduleur_year"] }),
    inverter_cost_pct: resolveEconomicSource({ form: f, rawOrgEconomics, key: "onduleur_cost_pct", formPaths: ["economics.onduleur_cost_pct"] }),
    battery_degradation_pct: resolveEconomicSource({ form: f, rawOrgEconomics, key: "battery_degradation_pct", formPaths: ["economics.battery_degradation_pct"] }),
  };

  return out;
}

/**
 * Micro-onduleurs : pas de remplacement onduleur dans les cashflows (hypothèse centrale/string).
 * Les paramètres org economics.onduleur_* sont ignorés pour ce cas.
 */
function applyInverterReplacementPolicy(ctx, econ) {
  const pv = ctx.form?.pv_inverter;
  if (!isMicroInverterForFinance(pv)) return econ;
  return {
    ...econ,
    inverter_replacement_year: null,
    inverter_cost_pct: 0
  };
}

function toPositiveFiniteCapex(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return x;
}

function toNonNegativeFinite(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function resolveVirtualSetupFeeTtc(sc) {
  const vf = sc?.virtual_battery_finance || {};
  const candidates = [
    sc?.virtualSetupFee,
    vf.one_time_setup_fee_ttc,
    vf.oneTimeSetupFeeTtc,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (value != null && value !== "" && Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/**
 * CAPEX TTC projet pour le scénario V2 — règle unique depuis finance_input.
 * Ne lit pas scenario.capex_ttc pour BASE / PHYSICAL (évite sous-totaux / valeurs partielles).
 */
export function resolveScenarioCapexTtcV2(sc, ctx) {
  const fi = ctx.finance_input || {};
  const pvCapex = toPositiveFiniteCapex(fi.capex_ttc);
  const batteryPhysExtra = toNonNegativeFinite(fi.battery_physical_price_ttc);

  if (sc.name === "BASE") {
    return pvCapex;
  }
  if (sc.name === "BATTERY_PHYSICAL") {
    if (pvCapex == null) return null;
    return pvCapex + batteryPhysExtra;
  }
  if (sc.name === "BATTERY_VIRTUAL") {
    return pvCapex;
  }
  if (sc.name === "BATTERY_HYBRID") {
    // CAPEX = PV + batterie physique (abonnement VB = OPEX uniquement)
    if (pvCapex == null) return null;
    return pvCapex + batteryPhysExtra;
  }
  // Phase 3B V2H — décision v1 : AUCUN coût véhicule ajouté. Chaque combo réutilise
  // le CAPEX de ses composants batterie MAISON (la voiture n'est pas un matériel vendu).
  if (sc.name === "VEHICLE_V2H") {
    // Voiture seule → PV uniquement (comme BASE).
    return pvCapex;
  }
  if (sc.name === "VEHICLE_V2H_PHYSICAL") {
    // + batterie physique maison → même CAPEX que BATTERY_PHYSICAL.
    if (pvCapex == null) return null;
    return pvCapex + batteryPhysExtra;
  }
  if (sc.name === "VEHICLE_V2H_VIRTUAL") {
    // + batterie virtuelle → PV uniquement ; frais VB ponctuels séparés.
    return pvCapex;
  }
  if (sc.name === "VEHICLE_V2H_PHYSICAL_VIRTUAL") {
    // triplette → PV + batterie physique (abonnement VB = OPEX), comme BATTERY_HYBRID.
    if (pvCapex == null) return null;
    return pvCapex + batteryPhysExtra;
  }
  return null;
}

/**
 * Recalcule cumul_gains_eur et cumul_eur (net après -capex_ttc) après modification des total_eur.
 */
export function recalcCumulColumns(flows, capexTtc) {
  const capex = Number(capexTtc);
  if (!Array.isArray(flows) || !Number.isFinite(capex)) return flows;
  let cumulGains = 0;
  return flows.map((f) => {
    const t = Number(f.total_eur);
    const add = Number.isFinite(t) ? t : 0;
    cumulGains += add;
    return {
      ...f,
      cumul_gains_eur: cumulGains,
      cumul_eur: -capex + cumulGains
    };
  });
}

function buildFinanceWarningsV2({
  capex_ttc,
  roi_years,
  flows,
  maintenance_pct,
  elec_growth_pct,
  elec_growth_missing,
  horizon_years,
}) {
  const w = [];
  const capex = capex_ttc != null ? Number(capex_ttc) : null;
  const y1 = flows?.[0];
  const t1 = y1 != null ? Number(y1.total_eur) : null;
  const c1 = y1 != null ? Number(y1.cumul_eur) : null;

  if (maintenance_pct != null && Number.isFinite(Number(maintenance_pct)) && Number(maintenance_pct) === 0) {
    w.push("MAINTENANCE_PCT_ZERO");
  }
  if (elec_growth_pct != null && Number.isFinite(Number(elec_growth_pct)) && Number(elec_growth_pct) > 3) {
    w.push("ELEC_GROWTH_OVER_3_PCT");
  }
  if (elec_growth_missing === true) {
    w.push("ELEC_GROWTH_MISSING");
  }
  if (horizon_years != null && Number.isFinite(Number(horizon_years)) && Number(horizon_years) > 20) {
    w.push("HORIZON_LONG_PROJECTION_NOTE");
  }
  if (capex != null && Number.isFinite(capex) && capex > 0 && capex < 1000) {
    w.push("LOW_CAPEX_SUSPICIOUS");
  }
  if (
    roi_years != null &&
    Number.isFinite(roi_years) &&
    roi_years < 2 &&
    capex != null &&
    capex >= 1000
  ) {
    w.push("ROI_VERY_FAST");
  }
  if (
    capex != null &&
    Number.isFinite(capex) &&
    capex >= 1000 &&
    t1 != null &&
    Number.isFinite(t1) &&
    t1 > capex * 0.5
  ) {
    w.push("YEAR1_NET_FLOW_SUSPICIOUSLY_HIGH_VS_CAPEX");
  }
  if (
    capex != null &&
    Number.isFinite(capex) &&
    capex >= 3000 &&
    c1 != null &&
    Number.isFinite(c1) &&
    c1 >= 0
  ) {
    w.push("NET_POSITION_NON_NEGATIVE_YEAR1");
  }
  return w;
}

// ======================================================================
// CASHFLOWS
// ======================================================================
export function buildCashflows(params) {
  const {
    prod_y1,
    auto_y1,
    surplus_y1,
    price_y1,
    oa_rate,
    elec_growth_pct,
    pv_degradation_pct,
    horizon_years,
    prime_eur,
    maintenance_pct,
    inverter_replacement_year,
    inverter_cost_pct,
    capex_ttc,
    virtual_battery_import_savings: virtualImportSavings = null,
    virtual_battery_mode = false,
    virtual_overflow_export_kwh = 0,
    // HYBRIDE : taux de restitution €/kWh (acheminement+accise) appliqué à l'énergie que la
    // batterie physique dégradée cède au crédit virtuel. 0 → comportement rétrocompatible.
    virtual_restitution_rate_eur_kwh = 0,
    // Dégradation physique batterie (BATTERY_PHYSICAL uniquement).
    // battery_contribution_y1 : part de auto_y1 provenant de la décharge batterie (kWh an 1).
    // Si absent ou 0 → comportement identique à avant (rétrocompatible).
    battery_contribution_y1 = 0,
    battery_degradation_pct = 2,
    // LID — dégradation première année (panneau neuf, irréversible). Défaut 0 = rétrocompatible.
    pv_degradation_first_year_pct = 0,
    // LOT3-HPHC-VALO : prix effectifs HP/HC par flux (pondérés 8760). null → price_y1 (rétrocompatible).
    // price_auto_y1 : valeur des kWh évités par autoconso (direct + décharge physique).
    // price_vb_y1   : valeur des kWh évités par le crédit virtuel (heures de décharge).
    price_auto_y1 = null,
    price_vb_y1 = null,
    battery_replacements = [],
    inverter_replacements = null,
    prime_payments = null,
    oa_contract_years = null,
    oa_post_contract_rate = 0,
    annual_energy_projection = null,
    injection_allowed = true
  } = params;

  if (!Array.isArray(battery_replacements) || battery_replacements.some(r=>!Number.isInteger(r.year)||r.year<1||!Number.isFinite(r.cost_eur)||r.cost_eur<0)) throw new Error("Remplacement batterie : annee et cout explicites requis");
  // Décomposer l'autoconsommation an 1 en deux composantes :
  //   - pvDirectAuto : autoconso directe PV (suit la dégradation PV)
  //   - battContrib  : apport batterie (suit sa propre dégradation physique)
  const _battContrib_y1 = Math.min(Math.max(0, Number(battery_contribution_y1) || 0), auto_y1);
  const _pvDirectAuto_y1 = auto_y1 - _battContrib_y1;
  // Ratio de l'auto PV directe sur la production de référence (auto+surplus) — identique à
  // l'ancien auto_ratio quand battery_contribution_y1 === 0 (aucune régression).
  const _refProd = prod_y1 > 0 ? prod_y1 : 1;
  const _pvDirectRatio = _pvDirectAuto_y1 / _refProd;
  let _battContrib = _battContrib_y1;

  const isVirtualBattery = virtual_battery_mode === true;
  const capexNum = Number(capex_ttc);
  const capexOk = Number.isFinite(capexNum) && capexNum > 0;

  const flows = [];

  let price = price_y1;
  // LOT3-HPHC-VALO : prix effectifs indexés au même rythme que le prix plat (elec_growth
  // identique HP/HC → pondérations horaires invariantes sur l'horizon).
  let priceAuto = price_auto_y1 != null && Number.isFinite(Number(price_auto_y1)) && Number(price_auto_y1) >= 0 ? Number(price_auto_y1) : price_y1;
  let priceVb = price_vb_y1 != null && Number.isFinite(Number(price_vb_y1)) && Number(price_vb_y1) >= 0 ? Number(price_vb_y1) : price_y1;
  let prod = prod_y1;
  let auto = auto_y1;
  let surplus = surplus_y1;
  // Scalar long-term projection: preserve unserved PV (storage losses / stock /
  // curtailment), rather than silently selling it from year two onwards.
  let unservedPv = Math.max(0, prod_y1 - auto_y1 - surplus_y1);

  let cumulGains = 0;

  // BUG A/B FIX — dégradation VB proportionnelle à la production PV sur 25 ans.
  // Justification : le surplus stockable en batterie virtuelle est une fraction de la prod PV.
  // Quand le PV dégrade de pv_degradation_pct/an, le surplus — et donc la décharge VB —
  // décroît au même rythme. Avant ce fix, _vbOverflow et _vbImportSavings restaient constants
  // toute la durée de vie → overstatement cumulé de 6-12 % des gains VB sur 25 ans.
  // Rétrocompatible : si virtualImportSavings=null ou isVirtualBattery=false → aucun effet.
  let _vbOverflow = isVirtualBattery ? (Number(virtual_overflow_export_kwh) || 0) : 0;
  let _vbImportSavings = (isVirtualBattery && virtualImportSavings != null && Number.isFinite(Number(virtualImportSavings)))
    ? Number(virtualImportSavings)
    : null;
  // HYBRIDE — énergie cumulée cédée par la batterie physique (dégradation) et reprise par le crédit
  // virtuel. Valorisée nette de restitution (prix − acheminement/accise), pas au prix plein.
  let _transferredFromPhysicalKwh = 0;
  const _virtRestitRate = Math.max(0, Number(virtual_restitution_rate_eur_kwh) || 0);

  for (let y = 1; y <= horizon_years; y++) {
    const projected = annual_energy_projection?.[y - 1];
    if (projected) {
      prod = projected.prod_kwh ?? prod;
      auto = projected.auto_kwh;
      surplus = projected.surplus_kwh ?? surplus;
      if (isVirtualBattery) {
        _vbImportSavings = projected.used_credit_kwh ?? 0;
        _vbOverflow = projected.overflow_export_kwh ?? projected.surplus_kwh ?? 0;
      }
    } else if (battery_replacements.some(row => row.year === y && row.kind === 'replacement')) {
      // A real replacement restores a new battery; a financial provision does not.
      _battContrib = _battContrib_y1;
      auto = Math.min(prod * _pvDirectRatio + _battContrib, Math.max(0, prod - unservedPv));
      surplus = injection_allowed ? Math.max(0, prod - auto - unservedPv) : 0;
    }
    // LID (Light-Induced Degradation) : perte irréversible en toute première année seulement.
    // Appliquée avant les gains de l'an 1, sur la base de la fiche technique panneau.
    if (y === 1 && pv_degradation_first_year_pct > 0) {
      prod   *= (1 - pv_degradation_first_year_pct / 100);
      auto    = prod * _pvDirectRatio + _battContrib;
      unservedPv *= 1 - pv_degradation_first_year_pct / 100;
      surplus = injection_allowed ? Math.max(0, prod - auto - unservedPv) : 0;
    }

    const energyPriceGrowth = Math.pow(1 + elec_growth_pct / 100, y - 1);
    const gain_auto = projected?.current_auto_value_at_initial_rates != null
      ? projected.current_auto_value_at_initial_rates * energyPriceGrowth : auto * priceAuto;
    const saleRate = oa_contract_years != null && y > oa_contract_years ? oa_post_contract_rate : oa_rate;
    const gain_oa = isVirtualBattery
      ? _vbOverflow * saleRate
      : surplus * saleRate;
    const import_savings_eur = (isVirtualBattery && _vbImportSavings !== null)
      ? projected?.current_credit_value_at_initial_rates != null
        ? projected.current_credit_value_at_initial_rates * energyPriceGrowth
        : Math.max(0, _vbImportSavings) * priceVb
      : 0;

    // HYBRIDE : énergie cédée par le physique dégradé, récupérée par le virtuel à sa valeur nette
    // (prix évité − restitution). Évite à la fois de la perdre (ancien bug) et de la sur-créditer.
    const transferred_recovery_eur = (!projected && isVirtualBattery && _vbImportSavings !== null)
      ? _transferredFromPhysicalKwh * Math.max(0, priceVb - _virtRestitRate)
      : 0;

    const virtualCashout = Number(projected?.virtual_cashout_eur) || 0;
    let total = gain_auto + gain_oa + import_savings_eur + transferred_recovery_eur + virtualCashout;

    const primeYear = Array.isArray(prime_payments)
      ? prime_payments.filter(row => row.year === y).reduce((sum, row) => sum + row.amount_eur, 0)
      : y === 1 ? prime_eur : 0;
    total += primeYear;

    const maintenance = capexOk ? capexNum * (maintenance_pct / 100) : 0;

    const replacementYear =
      inverter_replacement_year != null &&
      Number.isFinite(Number(inverter_replacement_year)) &&
      Number(inverter_replacement_year) > 0
        ? Number(inverter_replacement_year)
        : null;

    let inverter_cost = 0;
    if (Array.isArray(inverter_replacements)) {
      inverter_cost = inverter_replacements.filter(row => row.year === y).reduce((sum, row) => sum + row.cost_eur, 0);
    } else if (replacementYear != null && y === replacementYear && capexOk) {
      inverter_cost = capexNum * (inverter_cost_pct / 100);
    }

    const battery_cost = battery_replacements.filter(r=>r.year===y).reduce((sum,r)=>sum+r.cost_eur,0);
    total -= (maintenance + inverter_cost + battery_cost);

    cumulGains += total;

    flows.push({
      year: y,
      auto_kwh: auto,
      virtual_credit_used_kwh: isVirtualBattery ? _vbImportSavings ?? 0 : 0,
      gain_auto,
      gain_oa,
      virtual_cashout_eur: virtualCashout,
      ...(isVirtualBattery ? { import_savings_eur } : {}),
      maintenance,
      inverter_cost,
      battery_cost,
      prime: primeYear,
      oa_rate_eur_kwh: saleRate,
      battery_age_years: batteryAgeAtYear(y, battery_replacements),
      battery_replaced: battery_replacements.some(row => row.year === y && row.kind === 'replacement'),
      battery_provision_eur: battery_replacements.filter(row => row.year === y && row.kind !== 'replacement').reduce((sum, row) => sum + row.cost_eur, 0),
      ...(projected ? {
        scenario_energy_purchase_at_initial_rates: projected.scenario_energy_purchase_at_initial_rates,
        virtual_restitution_cost_at_initial_rates: projected.virtual_restitution_cost_at_initial_rates,
        virtual_credit_opening_kwh: projected.virtual_credit_opening_kwh,
        virtual_credit_end_kwh: projected.virtual_credit_end_kwh,
        projection_energy: projected,
      } : {}),
      total_eur: total,
      cumul_gains_eur: cumulGains,
      cumul_eur: capexOk ? -capexNum + cumulGains : cumulGains
    });

    price *= 1 + elec_growth_pct / 100;
    priceAuto *= 1 + elec_growth_pct / 100;
    priceVb *= 1 + elec_growth_pct / 100;
    prod *= 1 - pv_degradation_pct / 100;
    // PV direct auto suit la dégradation PV ; contribution batterie suit sa propre dégradation physique
    const _battContribBefore = _battContrib;
    _battContrib *= 1 - battery_degradation_pct / 100;
    const _battContribLost = Math.max(0, _battContribBefore - _battContrib);
    auto = prod * _pvDirectRatio + _battContrib;
    unservedPv *= 1 - pv_degradation_pct / 100;
    auto = Math.min(auto, Math.max(0, prod - unservedPv));
    surplus = injection_allowed ? Math.max(0, prod - auto - unservedPv) : 0;
    // BUG A/B FIX — dégrader overflow VB et import_savings VB au même rythme que le PV
    if (isVirtualBattery) {
      _vbOverflow *= 1 - pv_degradation_pct / 100;
      if (_vbImportSavings !== null) {
        _vbImportSavings *= 1 - pv_degradation_pct / 100;
        // HYBRIDE — l'énergie que la batterie physique ne capte plus en se dégradant retourne au
        // crédit virtuel (lossless). On l'accumule (et elle suit la dégradation PV) pour la
        // récupérer à sa valeur nette les années suivantes, au lieu de la perdre (ancien bug).
        // Sans effet pour BATTERY_VIRTUAL (battery_contribution_y1 = 0 → _battContribLost = 0).
        _transferredFromPhysicalKwh = 0; // No hypothetical credit without a new chronological availability simulation.
      }
    }
  }

  return flows;
}

// ======================================================================
// IRR (taux de rentabilité interne)
// ======================================================================
function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computeAnnualBillAfterSolarYear1(sc, priceEurKwh) {
  const vf = sc?.virtual_battery_finance;
  if (vf && typeof vf === "object") {
    const gridImportCost = Number(vf.annual_grid_import_cost_ttc) || 0;
    const virtualCost = Number(vf.annual_total_virtual_cost_ttc) || 0;
    // §5 FIX — Cohérence inter-scénarios : l'« économie année 1 » est définie comme une
    // économie sur facture HORS revente de surplus (cf. scenarioYear1BillSavings.test.mjs +
    // economie_an1_definition = "bill_before_solar_minus_bill_after_solar_year1"). Les scénarios
    // BASE / BATTERY_PHYSICAL ne créditent PAS le revenu OA dans ce KPI ; on ne crédite donc pas
    // non plus le revenu d'export du surplus résiduel (overflow) pour BATTERY_VIRTUAL / HYBRID,
    // sinon la comparaison entre cartes est faussée (pommes/oranges). Le revenu de revente reste
    // bien pris en compte ailleurs (gain_oa dans les cashflows → economie_25a / TRI).
    return Math.max(0, gridImportCost + virtualCost);
  }

  const explicitBill = firstFiniteNumber(
    sc?.finance?.estimated_annual_bill_eur,
    sc?.finance?.remaining_bill_eur,
    sc?.finance?.residual_bill_eur,
    sc?.residual_bill_eur
  );
  if (explicitBill != null) return Math.max(0, explicitBill);

  const importKwh = firstFiniteNumber(
    sc?.billable_import_kwh,
    sc?.energy?.billable_import_kwh,
    sc?.energy?.energy_grid_import_kwh,
    sc?.energy?.grid_import_kwh,
    sc?.import_kwh,
    sc?.energy?.import_kwh,
    sc?.energy?.import
  );
  if (importKwh == null) return null;

  const virtualAnnualCost =
    VIRTUAL_CREDIT_FINANCE.has(sc?.name)
      ? firstFiniteNumber(
          sc?.costs?.battery_virtual_annual_cost,
          sc?._virtualBatteryQuote?.annual_cost_ttc
        ) ?? 0
      : 0;

  // LOT3-HPHC-VALO : import résiduel au prix effectif d'import (pondéré HP/HC 8760) si dispo.
  const priceImport = firstFiniteNumber(sc?.pricing?.p_eff_import) ?? priceEurKwh;
  return Math.max(0, importKwh * priceImport + virtualAnnualCost);
}

function computeBillSavingsYear1(sc, priceEurKwh) {
  if (sc.electricity_billing) return sc.electricity_billing.bill_savings_eur;
  const consumptionKwh = firstFiniteNumber(
    sc?.conso_kwh,
    sc?.energy?.consumption_kwh,
    sc?.energy?.conso
  );
  if (consumptionKwh == null || consumptionKwh < 0) return null;

  // LOT3-HPHC-VALO : facture avant solaire au prix effectif conso (pondéré HP/HC 8760)
  // quand sc.pricing existe ; sinon prix plat historique.
  const priceConso = firstFiniteNumber(sc?.pricing?.p_eff_conso) ?? priceEurKwh;
  const billBeforeSolar = consumptionKwh * priceConso;
  const billAfterSolar = computeAnnualBillAfterSolarYear1(sc, priceEurKwh);
  if (billAfterSolar == null) return null;

  return billBeforeSolar - billAfterSolar;
}

function irr(values) { return cashflowIrr(values).rate; }

// ======================================================================
// LCOE (coût actualisé de l'énergie)
// Definition financiere : LCOE = (CAPEX_net + ΣOPEX_actualisé) / Σprod_actualisée
// annual_opex_eur : charge O&M annuelle constante (capex × maintenance_pct/100).
//   Défaut 0 → comportement rétrocompatible identique à l'ancien `num += 0`.
// ======================================================================
function lcoe(capex_ttc, prod_y1, degradation_pct, horizon_years, discount_rate = 0.03, annual_opex_eur = 0, replacements = [], aidPayments = []) {
  let num = capex_ttc;
  let den = 0;

  let prod = prod_y1;

  for (let y = 1; y <= horizon_years; y++) {
    const factor = Math.pow(1 + discount_rate, y);
    num += (annual_opex_eur + (replacements[y - 1] ?? 0) - (aidPayments[y - 1] ?? 0)) / factor;
    den += prod / factor;

    prod *= 1 - degradation_pct / 100;
  }

  if (den <= 0) return null;
  return num / den;
}

// ======================================================================
// CALCUL FINANCIER PRINCIPAL
// ======================================================================
// Phase 3B V2H — les combos incluant le virtuel se valorisent comme l'HYBRIDE
// (étape physique/V2H puis virtuel sur résidu). ⚠️ Chiffres à valider en réel.
const HYBRID_LIKE_FINANCE = new Set(["BATTERY_HYBRID", "VEHICLE_V2H_VIRTUAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL"]);
const VIRTUAL_CREDIT_FINANCE = new Set(["BATTERY_VIRTUAL", "BATTERY_HYBRID", "VEHICLE_V2H_VIRTUAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL"]);
const PHYSICAL_DEGRADE_FINANCE = new Set(["BATTERY_PHYSICAL", "BATTERY_HYBRID", "VEHICLE_V2H_PHYSICAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL"]);

/** Keep tariff changes in every projected year, including residual purchases as PV degrades. */
export function applyElectricityBillingToCashflows(flows, sc, econ, projection = {}) {
  const billing = sc.electricity_billing;
  if (!billing || billing.status === 'INCOMPLETE') return flows;
  const virtual = VIRTUAL_CREDIT_FINANCE.has(sc.name);
  const originalService = Number(sc.virtual_battery_finance?.annual_total_virtual_cost_ttc ?? sc._virtualBatteryQuote?.annual_cost_ttc) || 0;
  const firstCreditKwh = Number(flows[0]?.virtual_credit_used_kwh) || 0;
  const variableYear1 = Number(billing.virtual_restitution_cost_eur ?? sc.virtual_battery_finance?.annual_virtual_discharge_cost_ttc) || 0;
  const fixedYear1 = Number(billing.virtual_service_fixed_cost_eur ?? Math.max(0, (billing.virtual_service_cost_eur ?? 0) - variableYear1));
  const restitutionRate = Number(billing.virtual_restitution_price_eur_kwh ?? (firstCreditKwh > 0 ? variableYear1 / firstCreditKwh : 0));
  return flows.map((f, index) => {
    const growth = Math.pow(1 + econ.elec_growth_pct / 100, f.year - 1);
    const beforeEnergy = billing.current_energy_bill_eur * growth;
    // Value the remaining hourly-shaped demand directly at the future contract.
    // This also prices imports that first appear AFTER year one as PV degrades.
    const afterEnergy = index === 0
      ? billing.scenario_energy_purchase_eur
      : f.scenario_energy_purchase_at_initial_rates != null
        ? f.scenario_energy_purchase_at_initial_rates * growth
      : Math.max(0, (
        billing.scenario_consumption_energy_eur
        - f.auto_kwh * billing.scenario_effective_auto_price
        - (f.virtual_credit_used_kwh ?? 0) * billing.scenario_effective_credit_price
      ) * growth);
    const tariffGain = virtual ? beforeEnergy - f.gain_auto - (f.import_savings_eur ?? 0) - afterEnergy : 0;
    const supplierGrowth = Math.pow(1 + (projection.supplier_subscription_growth_pct ?? 0) / 100, f.year - 1);
    const beforeSubscription = (billing.current_supplier_subscription_eur ?? 0) * supplierGrowth;
    const afterSubscription = (billing.scenario_supplier_subscription_eur ?? 0) * supplierGrowth;
    const before = beforeEnergy + beforeSubscription;
    const fixedService = fixedYear1 * Math.pow(1 + (projection.virtual_subscription_growth_pct ?? 0) / 100, f.year - 1);
    const variableService = (f.virtual_restitution_cost_at_initial_rates ?? (f.virtual_credit_used_kwh ?? 0) * restitutionRate)
      * Math.pow(1 + (projection.virtual_restitution_growth_pct ?? 0) / 100, f.year - 1);
    const service = index === 0 ? billing.virtual_service_cost_eur ?? 0 : virtual ? fixedService + variableService : 0;
    const after = afterEnergy + afterSubscription + service;
    // P2 already separates these one-time fees from the photovoltaic investment.
    const initialFees = virtual && index === 0
      ? Math.max(0, (f.virtual_service_cost_eur ?? 0) - originalService) + (billing.legacy_initial_service_fee_eur ?? 0)
      : 0;
    const billSavings = before - after;
    return {
      ...f,
      supplier_tariff_gain_eur: tariffGain,
      supplier_subscription_gain_eur: beforeSubscription - afterSubscription,
      bill_without_project_eur: before,
      bill_with_project_energy_eur: afterEnergy,
      bill_with_project_and_service_eur: after,
      electricity_bill_savings_eur: billSavings,
      current_supplier_subscription_eur: beforeSubscription,
      supplier_subscription_eur: afterSubscription,
      virtual_service_cost_eur: service,
      virtual_fixed_service_cost_eur: virtual ? fixedService : 0,
      virtual_restitution_cost_eur: virtual ? variableService : 0,
      initial_virtual_service_fees_eur: initialFees,
      total_eur: billSavings + f.gain_oa + (f.virtual_cashout_eur ?? 0) + f.prime - f.maintenance - f.inverter_cost - (f.battery_cost ?? 0) - initialFees,
    };
  });
}

export async function computeFinance(ctx, scenarios) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[A1] finance_input reçu =", ctx.finance_input);
  }
  const econ = applyInverterReplacementPolicy(ctx, pickEconomics(ctx));
  const projection = resolveFinanceProjection(ctx);
  const simulationContract = resolveSimulationContract({ ...ctx.simulation_contract, ...ctx.finance_input?.economic_snapshot_config?.simulation_contract });
  if (projection.horizon_years != null) {
    econ.horizon_years = projection.horizon_years;
    econ.sources.horizon_years = 'finance_projection.horizon_years';
  }
  if (projection.maintenance_pct != null) {
    econ.maintenance_pct = projection.maintenance_pct;
    econ.sources.maintenance_pct = 'finance_projection.maintenance_pct';
  }
  if (!Number.isInteger(econ.horizon_years) || econ.horizon_years < 1 || econ.horizon_years > 100) throw new Error('Horizon financier invalide');
  for (const key of ['pv_degradation_pct', 'battery_degradation_pct']) {
    if (econ[key] < 0 || econ[key] > 100) throw new Error(`Dégradation invalide : ${key}`);
  }
  if (econ.elec_growth_pct <= -100) throw new Error('Indexation électrique invalide');
  const calculationTimestamp = new Date().toISOString();

  const out = {
    horizon_years: econ.horizon_years,
    scenarios: {}
  };

  for (const key of Object.keys(scenarios)) {
    const sc = scenarios[key];

    if (sc._skipped === true) {
      out.scenarios[key] = {
        ...sc,
        capex_ttc: null,
        capex_net: null,
        prime_eur: null,
        roi_years: null,
        irr_pct: null,
        lcoe_eur_kwh: null,
        economie_an1: null,
        gain_25a: null,
        economie_25a: null,
        flows: null,
        finance_warnings: [],
        auto_pct_real: sc.conso_kwh > 0 ? (sc.auto_kwh / sc.conso_kwh) * 100 : 0
      };
      continue;
    }

    if (sc._v2 === true) {
      const capex_ttc = resolveScenarioCapexTtcV2(sc, ctx);
      const oaCompatibility = VIRTUAL_CREDIT_FINANCE.has(sc.name)
        ? resolveVirtualStorageOaCompatibility(simulationContract, projection) : null;

      if (oaCompatibility?.status === 'BLOCKED') {
        out.scenarios[key] = {
          ...sc, grid_contract: simulationContract, capex_ttc, capex_net: null, prime_eur: null,
          roi_years: null, irr_pct: null, lcoe_eur_kwh: null,
          economie_an1: null, gain_25a: null, economie_25a: null, flows: null,
          display_blocked: true, blocked_reason: oaCompatibility.code,
          finance_meta: { electricity_billing: sc.electricity_billing, virtual_storage_oa_compatibility: oaCompatibility, projection_assumptions: projection },
          finance_warnings: [oaCompatibility.code],
          auto_pct_real: sc.conso_kwh > 0 ? sc.auto_kwh / sc.conso_kwh * 100 : 0,
        };
        continue;
      }

      if (sc.electricity_billing?.status === 'INCOMPLETE') {
        out.scenarios[key] = {
          ...sc, capex_ttc, capex_net: null, prime_eur: null,
          roi_years: null, irr_pct: null, lcoe_eur_kwh: null,
          economie_an1: null, gain_25a: null, economie_25a: null, flows: null,
          finance_meta: { electricity_billing: sc.electricity_billing, virtual_storage_oa_compatibility: oaCompatibility },
          finance_warnings: sc.electricity_billing.missing_fields.map((field) => `ELECTRICITY_CONTRACT_INCOMPLETE:${field}`),
          auto_pct_real: sc.conso_kwh > 0 ? sc.auto_kwh / sc.conso_kwh * 100 : 0,
        };
        continue;
      }

      if (key === "BATTERY_HYBRID") {
        console.log("[FINANCE_HYBRID_DEBUG]", JSON.stringify({
          key,
          _skipped: sc._skipped,
          _v2: sc._v2,
          capex_ttc_resolved: capex_ttc,
          fi_capex: ctx.finance_input?.capex_ttc,
          fi_batt_price: ctx.finance_input?.battery_physical_price_ttc,
          has_vb_quote: !!sc._virtualBatteryQuote,
          billable_import_kwh: sc.billable_import_kwh ?? sc.energy?.billable_import_kwh,
        }));
      }

      if (capex_ttc == null) {
        out.scenarios[key] = {
          ...sc,
          capex_ttc: null,
          capex_net: null,
          prime_eur: null,
          roi_years: null,
          irr_pct: null,
          lcoe_eur_kwh: null,
          economie_an1: null,
          gain_25a: null,
          economie_25a: null,
          flows: null,
          finance_warnings: ["MISSING_CAPEX"],
          auto_pct_real: sc.conso_kwh > 0 ? (sc.auto_kwh / sc.conso_kwh) * 100 : 0
        };
        continue;
      }

      const kwc = sc.kwc ?? sc.metadata?.kwc ?? 0;
      const primeKey = kwc <= 9 ? "prime_lt9" : "prime_gte9";
      const virtual = VIRTUAL_CREDIT_FINANCE.has(sc.name);
      const aid = resolveScenarioAid({ projection, injectionMode: ctx.simulation_contract?.injection_mode, virtual, kwc, primeRate: econ[primeKey], horizonYears: econ.horizon_years });
      const prime = aid.received_within_horizon_eur;
      const capex_net = Math.max(capex_ttc - prime, 0);
      const prod_y1 = sc.prod_kwh ?? 0;
      const baseScenario = scenarios.BASE;
      const auto_y1 =
        sc.name === "BATTERY_VIRTUAL"
          ? (baseScenario?.auto_kwh ?? baseScenario?.energy?.auto ?? sc.auto_kwh ?? 0)
          : HYBRID_LIKE_FINANCE.has(sc.name)
            ? (sc.energy?.physical_auto_kwh ?? scenarios.BATTERY_PHYSICAL?.auto_kwh ?? scenarios.BATTERY_PHYSICAL?.energy?.auto ?? sc.auto_kwh ?? 0)
          : (sc.auto_kwh ?? 0);
      const surplus_y1 =
        sc.name === "BATTERY_VIRTUAL"
          ? (baseScenario?.surplus_kwh ?? baseScenario?.energy?.surplus ?? sc.surplus_kwh ?? 0)
          : HYBRID_LIKE_FINANCE.has(sc.name)
            ? (sc.energy?.physical_grid_export_kwh ?? scenarios.BATTERY_PHYSICAL?.surplus_kwh ?? scenarios.BATTERY_PHYSICAL?.energy?.surplus ?? sc.surplus_kwh ?? 0)
          : (sc.surplus_kwh ?? 0);
      const oaTariff = resolveOaTariffForKwc(ctx, kwc);
      const oaRateKey = oaTariff.key;
      const sale = { ...resolveScenarioSale({ projection, injectionMode: ctx.simulation_contract?.injection_mode, virtual, configuredRate: oaTariff.rate_eur_kwh }), tariff: oaTariff };
      const oa_rate = sale.rate_eur_kwh;
      const batteryReplacements = PHYSICAL_DEGRADE_FINANCE.has(sc.name) ? projection.battery_replacements : [];
      let annualEnergyProjection = null;
      if (sc._energyProjectionInput) {
        const { simulateAnnualScenarioEnergy } = await import('./annualScenarioEnergy.service.js');
        annualEnergyProjection = [];
        let openingCredit = sc._virtualBattery8760?.virtual_battery_credit_start_kwh ?? sc.energy?.reference?.virtual_credit?.opening_kwh ?? sc._energyProjectionInput.virtual_battery_input?.initial_credit_kwh ?? 0;
        let openingCreditLots = sc._energyProjectionInput.virtual_battery_input?.initial_credit_lots ?? null;
        for (let year = 1; year <= econ.horizon_years; year++) {
          const result = await simulateAnnualScenarioEnergy(sc._energyProjectionInput, {
            year,
            pv_factor: Math.pow(1 - econ.pv_degradation_pct / 100, year - 1),
            battery_factor: Math.pow(1 - econ.battery_degradation_pct / 100, batteryAgeAtYear(year, batteryReplacements)),
            initial_credit_kwh: openingCredit,
            initial_credit_lots: openingCreditLots,
          });
          annualEnergyProjection.push({ ...result, year, virtual_credit_opening_kwh: openingCredit });
          openingCredit = result.virtual_credit_end_kwh ?? 0;
          openingCreditLots = result.virtual_credit_end_lots ?? null;
        }
      }
      const projectionAssumptions = { ...projection, virtual_storage_oa_compatibility: oaCompatibility, horizon_years: econ.horizon_years, maintenance_pct: econ.maintenance_pct, surplus_sale: sale, aid, battery_replacements: batteryReplacements, energy_projection_method: annualEnergyProjection ? 'annual_hourly_resimulation' : 'annual_scalar_degradation', financial_result_basis: 'nominal_before_financing' };

      const baseImportKwh = baseScenario?.energy?.import ?? baseScenario?.import_kwh ?? 0;
      const virtualSavingsReferenceImportKwh =
        HYBRID_LIKE_FINANCE.has(sc.name)
          ? (sc.energy?.physical_grid_import_kwh ?? scenarios.BATTERY_PHYSICAL?.import_kwh ?? scenarios.BATTERY_PHYSICAL?.energy?.import ?? baseImportKwh)
          : baseImportKwh;
      const billableImportKwh = sc.billable_import_kwh ?? sc.energy?.billable_import_kwh ?? null;
      const virtualImportSavingsKwh =
        VIRTUAL_CREDIT_FINANCE.has(sc.name) && billableImportKwh != null && Number.isFinite(billableImportKwh)
          ? Math.max(0, (virtualSavingsReferenceImportKwh || 0) - billableImportKwh)
          : null;

      // Pour BATTERY_PHYSICAL / BATTERY_HYBRID : séparation de la contribution batterie pour dégradation physique.
      // sc.battery.annual_discharge_kwh = énergie restituée par la batterie physique en an 1 (kWh).
      // Les scénarios BASE / BATTERY_VIRTUAL reçoivent battery_contribution_y1 = 0
      // → comportement identique à avant (rétrocompatible).
      const _battContribY1 =
        PHYSICAL_DEGRADE_FINANCE.has(sc.name)
          ? (sc.battery?.annual_discharge_kwh ?? 0)
          : 0;

      // Taux de restitution €/kWh TTC (acheminement+accise) déduit du coût VB année 1 / décharge VB année 1.
      // Sert à valoriser, nette de restitution, l'énergie que le physique cède au virtuel en se dégradant.
      const _vfForRate = sc.virtual_battery_finance;
      const virtualRestitutionRatePerKwh =
        _vfForRate && virtualImportSavingsKwh != null && virtualImportSavingsKwh > 0
          ? Math.max(0, (Number(_vfForRate.annual_virtual_discharge_cost_ttc) || 0) / virtualImportSavingsKwh)
          : 0;

      let flows = buildCashflows({
        battery_replacements: batteryReplacements,
        inverter_replacements: projection.inverter_replacements,
        prime_payments: aid.payments,
        oa_contract_years: sale.contract_years,
        oa_post_contract_rate: sale.post_contract_rate_eur_kwh,
        annual_energy_projection: annualEnergyProjection,
        injection_allowed: ctx.simulation_contract?.injection_mode !== "none",
        prod_y1,
        auto_y1,
        surplus_y1,
        price_y1: econ.price_eur_kwh,
        oa_rate,
        elec_growth_pct: econ.elec_growth_pct,
        pv_degradation_pct: econ.pv_degradation_pct,
        horizon_years: econ.horizon_years,
        prime_eur: prime,
        maintenance_pct: econ.maintenance_pct,
        inverter_replacement_year: econ.inverter_replacement_year,
        inverter_cost_pct: econ.inverter_cost_pct,
        capex_ttc,
        virtual_battery_import_savings: virtualImportSavingsKwh,
        virtual_battery_mode: VIRTUAL_CREDIT_FINANCE.has(sc.name),
        virtual_overflow_export_kwh:
          sc._virtualBattery8760?.virtual_battery_overflow_export_kwh ??
          sc.energy?.virtual_battery_overflow_export_kwh ??
          sc.energy?.overflow_export_kwh ??
          0,
        battery_contribution_y1: _battContribY1,
        battery_degradation_pct: econ.battery_degradation_pct,
        // The billing ledger is built from the simulated year-one production.
        // Its hourly energy and annual cashflows must share that same reference.
        pv_degradation_first_year_pct: sc.electricity_billing ? 0 : econ.pv_degradation_first_year_pct,
        virtual_restitution_rate_eur_kwh: virtualRestitutionRatePerKwh,
        // LOT3-HPHC-VALO : prix effectifs HP/HC du scénario (attachés par calc.controller
        // via attachHpHcPricingToScenarios) ; null → prix plat historique.
        price_auto_y1: sc.pricing?.p_eff_auto ?? null,
        price_vb_y1: sc.pricing?.p_eff_vb ?? null
      });

      const _isVbScenario = VIRTUAL_CREDIT_FINANCE.has(sc.name);
      if (_isVbScenario && sc.virtual_battery_finance) {
        const recurring = Number(sc.virtual_battery_finance.annual_total_virtual_cost_ttc);
        const variable = Number(sc.virtual_battery_finance.annual_virtual_discharge_cost_ttc) || 0;
        const fixed = Math.max(0, recurring - variable);
        const creditY1 = flows[0]?.virtual_credit_used_kwh ?? 0;
        const act = Number(sc.virtual_battery_finance.annual_activation_fee_ttc || 0) || 0;
        const actInCapex = false;
        flows = flows.map((f, idx) => {
          const activationYear = actInCapex ? 0 : act;
          const setup = sc.virtual_battery_finance.one_time_setup_fee_ttc ?? sc.virtual_battery_finance.oneTimeSetupFeeTtc ?? (act===0?resolveVirtualSetupFeeTtc(sc):0);
          const variableCost = f.virtual_restitution_cost_at_initial_rates ?? (creditY1 > 0 ? variable * (f.virtual_credit_used_kwh ?? 0) / creditY1 : 0);
          const recurringYear = idx === 0 ? recurring : fixed * Math.pow(1 + projection.virtual_subscription_growth_pct / 100, f.year - 1)
            + variableCost * Math.pow(1 + projection.virtual_restitution_growth_pct / 100, f.year - 1);
          const virtualCostYear = idx === 0 ? recurringYear + activationYear + setup : recurringYear;
          const total_eur = f.total_eur - virtualCostYear;
          return { ...f, virtual_service_cost_eur: f.total_eur - total_eur, total_eur };
        });
        flows = recalcCumulColumns(flows, capex_ttc);
      } else if (_isVbScenario && sc._virtualBatteryQuote?.annual_cost_ttc != null) {
        const opexVirtual = Number(sc._virtualBatteryQuote.annual_cost_ttc);
        const feeFixedTtc = Number(sc._virtualBatteryQuote?.detail?.fee_fixed_ttc ?? 0) || 0;
        const recurringCost = feeFixedTtc > 0 ? opexVirtual - feeFixedTtc : opexVirtual;
        flows = flows.map((f, idx) => {
          const virtualCostYear = idx === 0 ? opexVirtual : recurringCost;
          const total_eur = f.total_eur - virtualCostYear;
          return { ...f, virtual_service_cost_eur: f.total_eur - total_eur, total_eur };
        });
        flows = recalcCumulColumns(flows, capex_ttc);
      }

      // Explicit financial ledger: electricity, service expenses, revenues and aids remain separate.
      if (sc.electricity_billing) {
        flows = applyElectricityBillingToCashflows(flows, sc, econ, projection);
        flows = recalcCumulColumns(flows, capex_ttc);
      } else {
        flows=flows.map(f=>{
          const before=(sc.conso_kwh??sc.energy?.consumption_kwh)* (sc.pricing?.p_eff_conso??econ.price_eur_kwh) * Math.pow(1+econ.elec_growth_pct/100,f.year-1);
          return {...f,bill_without_project_eur:before,bill_with_project_energy_eur:before-f.gain_auto-(f.import_savings_eur??0),bill_with_project_and_service_eur:before-f.gain_auto-(f.import_savings_eur??0)+(f.virtual_service_cost_eur??0)};
        });
      }
      const roi_years = flows.find((f) => f.cumul_eur >= 0)?.year ?? null;
      const irr_values = [-capex_ttc, ...flows.map((f) => f.total_eur)];
      const irr_pct = irr(irr_values);
      // OPEX annuel constant = maintenance_pct × CAPEX TTC (cohérent avec buildCashflows)
      const _lcoe_annual_opex = capex_ttc > 0 ? capex_ttc * (econ.maintenance_pct / 100) : 0;
      const lcoe_eur = lcoe(capex_ttc, prod_y1, econ.pv_degradation_pct, econ.horizon_years, 0.03, _lcoe_annual_opex, flows.map(f => (f.inverter_cost ?? 0) + (f.battery_cost ?? 0)), flows.map(f => f.prime ?? 0));
      const auto_pct_real = sc.conso_kwh > 0 ? (sc.auto_kwh / sc.conso_kwh) * 100 : 0;

      const finance_warnings = buildFinanceWarningsV2({
        capex_ttc,
        roi_years,
        flows,
        maintenance_pct: econ.maintenance_pct,
        elec_growth_pct: econ.elec_growth_pct,
        elec_growth_missing: econ.elec_growth_missing,
        horizon_years: econ.horizon_years,
      });

      const horizonY = Number(econ.horizon_years) || 25;
      const economicBlockingWarnings = [];
      const mandatorySources = {
        price_eur_kwh: econ.sources?.price_eur_kwh,
        ...(oa_rate > 0 ? { [oaRateKey]: oaTariff.source } : {}),
        ...(prime > 0 ? { [primeKey]: econ.sources?.[primeKey] } : {}),
        elec_growth_pct: econ.sources?.elec_growth_pct,
        horizon_years: econ.sources?.horizon_years,
      };
      for (const [field, source] of Object.entries(mandatorySources)) {
        if (!source || source === "DEFAULT_ECONOMICS_FALLBACK" || /fallback/i.test(String(source))) {
          economicBlockingWarnings.push(`ECONOMIC_ASSUMPTION_NOT_TRACEABLE:${field}`);
        }
      }
      const financingSnapshot = normalizeFinancingSnapshot(ctx.finance_input?.economic_snapshot_config, capex_ttc);
      if (
        financingSnapshot.enabled &&
        (financingSnapshot.taeg_pct == null ||
          financingSnapshot.insurance_eur == null ||
          financingSnapshot.application_fee_eur == null ||
          financingSnapshot.other_costs_eur == null)
      ) {
        economicBlockingWarnings.push("FINANCING_INDICATIVE_ONLY_MISSING_TAEG_INSURANCE_OR_FEES");
      }
      const economicSnapshotCore = {
        schema_version: 1,
        electricity_billing: sc.electricity_billing ?? null,
        projection_assumptions: projectionAssumptions,
        calculated_at: calculationTimestamp,
        source: "financeService.computeFinance",
        source_detail: "values_used_by_cashflow_engine",
        scenario_id: key,
        system_kwc: kwc,
        price_eur_kwh: econ.price_eur_kwh,
        price_eur_kwh_source: econ.sources?.price_eur_kwh ?? null,
        elec_growth_pct: econ.elec_growth_pct,
        elec_growth_source: econ.sources?.elec_growth_pct ?? econ.elec_growth_source ?? null,
        oa_rate_eur_kwh: oa_rate,
        oa_rate_key: oaRateKey,
        oa_rate_source: oaTariff.source,
        oa_indexation_pct: null,
        oa_indexation_source: "not_configured",
        prime_rate_eur_kwc: econ[primeKey],
        prime_rate_key: primeKey,
        prime_rate_source: econ.sources?.[primeKey] ?? null,
        prime_eur: prime,
        horizon_years: horizonY,
        horizon_years_source: econ.sources?.horizon_years ?? null,
        pv_degradation_pct: econ.pv_degradation_pct,
        pv_degradation_source: econ.sources?.pv_degradation_pct ?? null,
        capex_ttc,
        capex_source: ctx.finance_input?.capex_ttc != null ? "finance_input.capex_ttc@calculation" : null,
        capex_net_after_prime: capex_net,
        reste_a_charge_eur: capex_net,
        maintenance_pct: econ.maintenance_pct,
        maintenance_source: econ.sources?.maintenance_pct ?? null,
        inverter_replacement_year: econ.inverter_replacement_year,
        inverter_replacement_year_source: econ.sources?.inverter_replacement_year ?? null,
        inverter_cost_pct: econ.inverter_cost_pct,
        inverter_cost_pct_source: econ.sources?.inverter_cost_pct ?? null,
        battery_degradation_pct: econ.battery_degradation_pct,
        battery_degradation_source: econ.sources?.battery_degradation_pct ?? null,
        virtual_battery:
          sc.virtual_battery_finance && typeof sc.virtual_battery_finance === "object"
            ? {
                enabled: true,
                finance: sc.virtual_battery_finance,
                source: "scenario.virtual_battery_finance@calculation",
              }
            : {
                enabled: false,
                source: null,
              },
        financing: financingSnapshot,
        blocking_warnings: economicBlockingWarnings,
      };
      const economicSnapshot = {
        ...economicSnapshotCore,
        hash: await sha256Hex(stableStringify(economicSnapshotCore)),
      };
      const year1NetCashflow = flows[0]?.total_eur ?? null;
      const annualSavings = computeBillSavingsYear1(sc, econ.price_eur_kwh) ?? year1NetCashflow;
      if (process.env.NODE_ENV !== "production") {
        console.log("[D3] scenario", key, "capex_ttc =", capex_ttc, "capex_net =", capex_net, "annual savings =", annualSavings, "flows length =", flows?.length);
        console.log("[D3] flows =", flows);
      }

      if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
        const lastFlow = flows[flows.length - 1];
        const tracePayload = {
          tag: `TRACE_FINANCE_${key}`,
          capex_ttc,
          capex_net,
          year1_total_eur: year1NetCashflow,
          year1_bill_savings_eur: annualSavings,
          gain_25a: lastFlow?.cumul_eur ?? null,
          cumul_gains_end: lastFlow?.cumul_gains_eur ?? null,
          roi_years,
          irr_pct: irr_pct !== null ? round(irr_pct * 100, 2) : null
        };
        if (VIRTUAL_CREDIT_FINANCE.has(sc.name)) {
          const virtualImportSavingsEur =
            virtualImportSavingsKwh != null && Number.isFinite(virtualImportSavingsKwh)
              ? virtualImportSavingsKwh * econ.price_eur_kwh
              : null;
          tracePayload.virtualImportSavingsKwh = virtualImportSavingsKwh;
          tracePayload.virtualImportSavingsEur = virtualImportSavingsEur;
          tracePayload.virtualAnnualCostTtc = sc._virtualBatteryQuote?.annual_cost_ttc ?? null;
          tracePayload.netDeltaYear1 = flows[0]?.total_eur ?? null;
        }
        console.log(JSON.stringify(tracePayload));
      }

      out.scenarios[key] = {
        ...sc,
        grid_contract: simulationContract,
        auto_pct_real,
        capex_ttc: capex_ttc,
        pvInstallationPrice: capex_ttc,
        virtualSetupFee: _isVbScenario ? round(resolveVirtualSetupFeeTtc(sc), 0) : 0,
        virtualAnnualFees:
          _isVbScenario && sc.virtual_battery_finance
            ? round(Number(sc.electricity_billing?.virtual_service_cost_eur ?? sc.virtual_battery_finance.annual_total_virtual_cost_ttc) || 0, 2)
            : 0,
        capex_net: capex_net,
        prime_eur: prime,
        roi_years,
        irr_pct: irr_pct !== null ? round(irr_pct * 100, 2) : null,
        lcoe_eur_kwh: lcoe_eur != null ? lcoe_eur : null,
        economie_an1: annualSavings,
        gain_25a: flows[flows.length - 1].cumul_eur,
        economie_25a: flows[flows.length - 1].cumul_eur,
        economie_horizon_years: horizonY,
        economie_total_horizon_label: `Projection sur ${horizonY} ans`,
        finance_meta: {
          electricity_billing: sc.electricity_billing ?? null,
          horizon_years: horizonY,
          horizon_years_display: horizonY,
          elec_growth_pct: econ.elec_growth_pct,
          elec_growth_source: econ.elec_growth_source,
          elec_growth_missing: econ.elec_growth_missing,
          economie_total_label: `Gain net cumulé sur ${horizonY} ans`,
          cumul_eur_definition: "net_after_capex_ttc",
          economie_an1_definition: "bill_before_solar_minus_bill_after_solar_year1",
          year1_net_cashflow_eur: round(year1NetCashflow, 2),
          prime_disclaimer:
            "Prime et tarifs d'obligation d'achat : sous réserve d'éligibilité du projet et des tarifs en vigueur à la date de mise en service.",
          projection_method: projectionAssumptions.energy_projection_method,
          projection_assumptions: projectionAssumptions,
          virtual_storage_oa_compatibility: oaCompatibility,
          battery_replacement_modelled: flows.some(f=>f.battery_replaced),
          battery_replacements: batteryReplacements,
          lcoe_scope: "Project investment, maintenance, configured replacements and aid at their actual payment years; PV production and future cashflows discounted at 3%; virtual service fees excluded",
          irr_status: cashflowIrr(irr_values).status,
          economic_snapshot: economicSnapshot,
        },
        flows,
        finance_warnings: [...finance_warnings, ...economicBlockingWarnings, ...projection.warnings, ...aid.warnings]
      };
      delete out.scenarios[key]._energyProjectionInput;
      continue;
    }

    if (sc.capex_ttc == null) {
      out.scenarios[key] = {
        ...sc,
        capex_ttc: null,
        capex_net: null,
        prime_eur: null,
        roi_years: null,
        irr_pct: null,
        lcoe_eur_kwh: null,
        economie_an1: null,
        gain_25a: null,
        economie_25a: null,
        flows: null,
        finance_warnings: [],
        auto_pct_real: sc.conso_kwh > 0 ? (sc.auto_kwh / sc.conso_kwh) * 100 : 0
      };
      continue;
    }
  }

  return out;
}
