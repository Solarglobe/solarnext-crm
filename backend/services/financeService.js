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
//    - BATTERY_VIRTUAL : PV (finance_input.capex_ttc) + activation batterie virtuelle (scenario.capex_ttc
//      = coût d’activation seul côté calc ; 0 si abonnement seul).
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
} from "./economicsResolve.service.js";

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
  const enabled = Number.isFinite(duration) && duration > 0 && Number.isFinite(rate) && rate > 0;
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
    interest_rate_annual_pct: Number.isFinite(rate) && rate > 0 ? rate : null,
    taeg_pct: raw.taeg_pct != null && Number.isFinite(Number(raw.taeg_pct)) ? Number(raw.taeg_pct) : null,
    insurance_eur: raw.insurance_eur != null && Number.isFinite(Number(raw.insurance_eur)) ? Number(raw.insurance_eur) : null,
    application_fee_eur: raw.application_fee_eur != null && Number.isFinite(Number(raw.application_fee_eur)) ? Number(raw.application_fee_eur) : null,
    source: cfg.financing ? "economic_snapshots.config_json.financing@calculation" : "not_configured",
  };
}

// ======================================================================
// PARAMÈTRES FINANCIERS
// ======================================================================
function pickEconomics(ctx) {
  const f = ctx.form || {};
  const rawOrgEconomics = ctx.settings?.economics_raw ?? ctx.settings?.economics;
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
    prime_lt9: num(e.prime_lt9, DEFAULT_ECONOMICS_FALLBACK.prime_lt9),
    prime_gte9: num(e.prime_gte9, DEFAULT_ECONOMICS_FALLBACK.prime_gte9),
    horizon_years: num(e.horizon_years, DEFAULT_ECONOMICS_FALLBACK.horizon_years),
    maintenance_pct: num(e.maintenance_pct, DEFAULT_ECONOMICS_FALLBACK.maintenance_pct),
    inverter_replacement_year: num(e.onduleur_year, DEFAULT_ECONOMICS_FALLBACK.onduleur_year),
    inverter_cost_pct: num(e.onduleur_cost_pct, DEFAULT_ECONOMICS_FALLBACK.onduleur_cost_pct),
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

/**
 * CAPEX TTC projet pour le scénario V2 — règle unique depuis finance_input (+ activation BV).
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
    const virtRaw = sc.capex_ttc != null ? Number(sc.capex_ttc) : 0;
    const virtAdd = Number.isFinite(virtRaw) && virtRaw > 0 ? virtRaw : 0;
    if (pvCapex == null) return null;
    return pvCapex + virtAdd;
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
    // + batterie virtuelle → PV + frais d'activation VB (comme BATTERY_VIRTUAL).
    const virtRaw = sc.capex_ttc != null ? Number(sc.capex_ttc) : 0;
    const virtAdd = Number.isFinite(virtRaw) && virtRaw > 0 ? virtRaw : 0;
    if (pvCapex == null) return null;
    return pvCapex + virtAdd;
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
  w.push("PRIME_ELIGIBILITY_NOT_CONFIRMED");
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
function buildCashflows(params) {
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
    price_vb_y1 = null
  } = params;

  // Décomposer l'autoconsommation an 1 en deux composantes :
  //   - pvDirectAuto : autoconso directe PV (suit la dégradation PV)
  //   - battContrib  : apport batterie (suit sa propre dégradation physique)
  const _battContrib_y1 = Math.min(Math.max(0, Number(battery_contribution_y1) || 0), auto_y1);
  const _pvDirectAuto_y1 = auto_y1 - _battContrib_y1;
  // Ratio de l'auto PV directe sur la production de référence (auto+surplus) — identique à
  // l'ancien auto_ratio quand battery_contribution_y1 === 0 (aucune régression).
  const _refProd = (auto_y1 + surplus_y1) || 1;
  const _pvDirectRatio = _pvDirectAuto_y1 / _refProd;
  let _battContrib = _battContrib_y1;

  const isVirtualBattery = virtual_battery_mode === true;
  const capexNum = Number(capex_ttc);
  const capexOk = Number.isFinite(capexNum) && capexNum > 0;

  const flows = [];

  let price = price_y1;
  // LOT3-HPHC-VALO : prix effectifs indexés au même rythme que le prix plat (elec_growth
  // identique HP/HC → pondérations horaires invariantes sur l'horizon).
  let priceAuto = Number.isFinite(Number(price_auto_y1)) && Number(price_auto_y1) > 0 ? Number(price_auto_y1) : price_y1;
  let priceVb = Number.isFinite(Number(price_vb_y1)) && Number(price_vb_y1) > 0 ? Number(price_vb_y1) : price_y1;
  let prod = prod_y1;
  let auto = auto_y1;
  let surplus = surplus_y1;

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
    // LID (Light-Induced Degradation) : perte irréversible en toute première année seulement.
    // Appliquée avant les gains de l'an 1, sur la base de la fiche technique panneau.
    if (y === 1 && pv_degradation_first_year_pct > 0) {
      prod   *= (1 - pv_degradation_first_year_pct / 100);
      auto    = prod * _pvDirectRatio + _battContrib;
      surplus = Math.max(0, prod - auto);
    }

    const gain_auto = auto * priceAuto;
    const gain_oa = isVirtualBattery
      ? _vbOverflow * oa_rate           // dégradé chaque année (voir init _vbOverflow)
      : surplus * oa_rate;
    const import_savings_eur = (isVirtualBattery && _vbImportSavings !== null)
      ? Math.max(0, _vbImportSavings) * priceVb  // dégradé chaque année (voir init _vbImportSavings)
      : 0;

    // HYBRIDE : énergie cédée par le physique dégradé, récupérée par le virtuel à sa valeur nette
    // (prix évité − restitution). Évite à la fois de la perdre (ancien bug) et de la sur-créditer.
    const transferred_recovery_eur = (isVirtualBattery && _vbImportSavings !== null)
      ? _transferredFromPhysicalKwh * Math.max(0, priceVb - _virtRestitRate)
      : 0;

    let total = gain_auto + gain_oa + import_savings_eur + transferred_recovery_eur;

    if (y === 1) total += prime_eur;

    const maintenance = capexOk ? capexNum * (maintenance_pct / 100) : 0;

    const replacementYear =
      inverter_replacement_year != null &&
      Number.isFinite(Number(inverter_replacement_year)) &&
      Number(inverter_replacement_year) > 0
        ? Number(inverter_replacement_year)
        : null;

    let inverter_cost = 0;
    if (replacementYear != null && y === replacementYear && capexOk) {
      inverter_cost = capexNum * (inverter_cost_pct / 100);
    }

    total -= (maintenance + inverter_cost);

    cumulGains += total;

    flows.push({
      year: y,
      gain_auto,
      gain_oa,
      ...(isVirtualBattery ? { import_savings_eur } : {}),
      maintenance,
      inverter_cost,
      prime: y === 1 ? prime_eur : 0,
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
    surplus = Math.max(0, prod - auto);  // garde : évite surplus négatif (edge cases batterie / round-trip)
    // BUG A/B FIX — dégrader overflow VB et import_savings VB au même rythme que le PV
    if (isVirtualBattery) {
      _vbOverflow *= 1 - pv_degradation_pct / 100;
      if (_vbImportSavings !== null) {
        _vbImportSavings *= 1 - pv_degradation_pct / 100;
        // HYBRIDE — l'énergie que la batterie physique ne capte plus en se dégradant retourne au
        // crédit virtuel (lossless). On l'accumule (et elle suit la dégradation PV) pour la
        // récupérer à sa valeur nette les années suivantes, au lieu de la perdre (ancien bug).
        // Sans effet pour BATTERY_VIRTUAL (battery_contribution_y1 = 0 → _battContribLost = 0).
        _transferredFromPhysicalKwh = (_transferredFromPhysicalKwh + _battContribLost) * (1 - pv_degradation_pct / 100);
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

  return Math.max(0, billBeforeSolar - billAfterSolar);
}

function irr(values, guess = 0.1) {
  let rate = guess;

  for (let i = 0; i < 50; i++) {
    let npv = 0;
    let deriv = 0;

    for (let t = 0; t < values.length; t++) {
      const v = values[t];
      const discount = Math.pow(1 + rate, t);
      npv += v / discount;

      if (t > 0) {
        deriv -= (t * v) / (discount * (1 + rate));
      }
    }

    if (Math.abs(deriv) < 1e-12) return null;

    const newRate = rate - npv / deriv;
    if (Math.abs(newRate - rate) < 1e-12) return newRate;

    rate = newRate;
  }

  return null;
}

// ======================================================================
// LCOE (coût actualisé de l'énergie)
// Formule IEC 62722 : LCOE = (CAPEX_net + ΣOPEX_actualisé) / Σprod_actualisée
// annual_opex_eur : charge O&M annuelle constante (capex × maintenance_pct/100).
//   Défaut 0 → comportement rétrocompatible identique à l'ancien `num += 0`.
// ======================================================================
function lcoe(capex_net, prod_y1, degradation_pct, horizon_years, discount_rate = 0.03, annual_opex_eur = 0) {
  let num = capex_net;
  let den = 0;

  let prod = prod_y1;

  for (let y = 1; y <= horizon_years; y++) {
    const factor = Math.pow(1 + discount_rate, y);
    num += annual_opex_eur / factor;   // OPEX actualisé — correction bug (était num += 0)
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

export async function computeFinance(ctx, scenarios) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[A1] finance_input reçu =", ctx.finance_input);
  }
  const econ = applyInverterReplacementPolicy(ctx, pickEconomics(ctx));
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
      const prime = kwc < 9 ? kwc * econ.prime_lt9 : kwc * econ.prime_gte9;
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
      const oa_rate = kwc < 9 ? econ.oa_rate_lt_9 : econ.oa_rate_gte_9;
      const oaRateKey = kwc < 9 ? "oa_rate_lt_9" : "oa_rate_gte_9";
      const primeKey = kwc < 9 ? "prime_lt9" : "prime_gte9";

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
          sc.surplus_kwh ??
          0,
        battery_contribution_y1: _battContribY1,
        battery_degradation_pct: econ.battery_degradation_pct,
        pv_degradation_first_year_pct: econ.pv_degradation_first_year_pct,
        virtual_restitution_rate_eur_kwh: virtualRestitutionRatePerKwh,
        // LOT3-HPHC-VALO : prix effectifs HP/HC du scénario (attachés par calc.controller
        // via attachHpHcPricingToScenarios) ; null → prix plat historique.
        price_auto_y1: sc.pricing?.p_eff_auto ?? null,
        price_vb_y1: sc.pricing?.p_eff_vb ?? null
      });

      const _isVbScenario = VIRTUAL_CREDIT_FINANCE.has(sc.name);
      if (_isVbScenario && sc.virtual_battery_finance) {
        const recurring = Number(sc.virtual_battery_finance.annual_total_virtual_cost_ttc);
        const act = Number(sc.virtual_battery_finance.annual_activation_fee_ttc || 0) || 0;
        const actInCapex = sc._virtual_battery_activation_in_capex === true;
        flows = flows.map((f, idx) => {
          const activationYear = actInCapex ? 0 : act;
          const virtualCostYear = idx === 0 ? recurring + activationYear : recurring;
          const total_eur = f.total_eur - virtualCostYear;
          return { ...f, total_eur };
        });
        flows = recalcCumulColumns(flows, capex_ttc);
      } else if (_isVbScenario && sc._virtualBatteryQuote?.annual_cost_ttc != null) {
        const opexVirtual = Number(sc._virtualBatteryQuote.annual_cost_ttc);
        const feeFixedTtc = Number(sc._virtualBatteryQuote?.detail?.fee_fixed_ttc ?? 0) || 0;
        const recurringCost = feeFixedTtc > 0 ? opexVirtual - feeFixedTtc : opexVirtual;
        flows = flows.map((f, idx) => {
          const virtualCostYear = idx === 0 ? opexVirtual : recurringCost;
          const total_eur = f.total_eur - virtualCostYear;
          return { ...f, total_eur };
        });
        flows = recalcCumulColumns(flows, capex_ttc);
      }

      const roi_years = flows.find((f) => f.cumul_eur >= 0)?.year ?? null;
      const irr_values = [-capex_ttc, ...flows.map((f) => f.total_eur)];
      const irr_pct = irr(irr_values);
      // OPEX annuel constant = maintenance_pct × CAPEX TTC (cohérent avec buildCashflows)
      const _lcoe_annual_opex = capex_ttc > 0 ? capex_ttc * (econ.maintenance_pct / 100) : 0;
      const lcoe_eur = lcoe(capex_net, prod_y1, econ.pv_degradation_pct, econ.horizon_years, 0.03, _lcoe_annual_opex);
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
        [oaRateKey]: econ.sources?.[oaRateKey],
        [primeKey]: econ.sources?.[primeKey],
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
          financingSnapshot.application_fee_eur == null)
      ) {
        economicBlockingWarnings.push("FINANCING_INDICATIVE_ONLY_MISSING_TAEG_INSURANCE_OR_FEES");
      }
      const economicSnapshotCore = {
        schema_version: 1,
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
        oa_rate_source: econ.sources?.[oaRateKey] ?? null,
        oa_indexation_pct: null,
        oa_indexation_source: "not_configured",
        prime_rate_eur_kwc: kwc < 9 ? econ.prime_lt9 : econ.prime_gte9,
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
        auto_pct_real,
        capex_ttc: round(capex_ttc, 0),
        capex_net: round(capex_net, 0),
        prime_eur: round(prime, 0),
        roi_years,
        irr_pct: irr_pct !== null ? round(irr_pct * 100, 2) : null,
        lcoe_eur_kwh: lcoe_eur ? round(lcoe_eur, 4) : null,
        economie_an1: round(annualSavings, 0),
        gain_25a: flows[flows.length - 1].cumul_eur,
        economie_25a: flows[flows.length - 1].cumul_eur,
        economie_horizon_years: horizonY,
        economie_total_horizon_label: `Projection sur ${horizonY} ans`,
        finance_meta: {
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
          economic_snapshot: economicSnapshot,
        },
        flows,
        finance_warnings: [...finance_warnings, ...economicBlockingWarnings]
      };
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
