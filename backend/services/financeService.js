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

  return {
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
    // LID (Light-Induced Degradation) — source : fiche panneau uniquement.
    // Défaut 0 si absent → comportement conservateur (pas de sur-dégradation an 1 inventée).
    // Évolution future : si f.panel_input?.technology est connu (PERC/TOPCon → ~2-3%, HJT/BSF → ~0.5%),
    //   utiliser un fallback technologique plutôt que 0. À implémenter avec le catalogue panneaux.
    pv_degradation_first_year_pct: num(f.panel_input?.degradation_first_year_pct ?? 0, 0),
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
    // Dégradation physique batterie (BATTERY_PHYSICAL uniquement).
    // battery_contribution_y1 : part de auto_y1 provenant de la décharge batterie (kWh an 1).
    // Si absent ou 0 → comportement identique à avant (rétrocompatible).
    battery_contribution_y1 = 0,
    battery_degradation_pct = 2,
    // LID — dégradation première année (panneau neuf, irréversible). Défaut 0 = rétrocompatible.
    pv_degradation_first_year_pct = 0
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

  for (let y = 1; y <= horizon_years; y++) {
    // LID (Light-Induced Degradation) : perte irréversible en toute première année seulement.
    // Appliquée avant les gains de l'an 1, sur la base de la fiche technique panneau.
    if (y === 1 && pv_degradation_first_year_pct > 0) {
      prod   *= (1 - pv_degradation_first_year_pct / 100);
      auto    = prod * _pvDirectRatio + _battContrib;
      surplus = Math.max(0, prod - auto);
    }

    const gain_auto = auto * price;
    const gain_oa = isVirtualBattery
      ? _vbOverflow * oa_rate           // dégradé chaque année (voir init _vbOverflow)
      : surplus * oa_rate;
    const import_savings_eur = (isVirtualBattery && _vbImportSavings !== null)
      ? Math.max(0, _vbImportSavings) * price  // dégradé chaque année (voir init _vbImportSavings)
      : 0;

    let total = gain_auto + gain_oa + import_savings_eur;

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
    prod *= 1 - pv_degradation_pct / 100;
    // PV direct auto suit la dégradation PV ; contribution batterie suit sa propre dégradation physique
    _battContrib *= 1 - battery_degradation_pct / 100;
    auto = prod * _pvDirectRatio + _battContrib;
    surplus = Math.max(0, prod - auto);  // garde : évite surplus négatif (edge cases batterie / round-trip)
    // BUG A/B FIX — dégrader overflow VB et import_savings VB au même rythme que le PV
    if (isVirtualBattery) {
      _vbOverflow *= 1 - pv_degradation_pct / 100;
      if (_vbImportSavings !== null) _vbImportSavings *= 1 - pv_degradation_pct / 100;
    }
  }

  return flows;
}

// ======================================================================
// IRR (taux de rentabilité interne)
// ======================================================================
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
export async function computeFinance(ctx, scenarios) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[A1] finance_input reçu =", ctx.finance_input);
  }
  const econ = applyInverterReplacementPolicy(ctx, pickEconomics(ctx));

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
          : (sc.auto_kwh ?? 0);
      const surplus_y1 =
        sc.name === "BATTERY_VIRTUAL"
          ? (baseScenario?.surplus_kwh ?? baseScenario?.energy?.surplus ?? sc.surplus_kwh ?? 0)
          : (sc.surplus_kwh ?? 0);
      const oa_rate = kwc < 9 ? econ.oa_rate_lt_9 : econ.oa_rate_gte_9;

      const baseImportKwh = baseScenario?.energy?.import ?? baseScenario?.import_kwh ?? 0;
      const billableImportKwh = sc.billable_import_kwh ?? sc.energy?.billable_import_kwh ?? null;
      const virtualImportSavingsKwh =
        sc.name === "BATTERY_VIRTUAL" && billableImportKwh != null && Number.isFinite(billableImportKwh)
          ? Math.max(0, (baseImportKwh || 0) - billableImportKwh)
          : null;

      // Pour BATTERY_PHYSICAL / BATTERY_HYBRID : séparation de la contribution batterie pour dégradation physique.
      // sc.battery.annual_discharge_kwh = énergie restituée par la batterie physique en an 1 (kWh).
      // Les scénarios BASE / BATTERY_VIRTUAL reçoivent battery_contribution_y1 = 0
      // → comportement identique à avant (rétrocompatible).
      const _battContribY1 =
        (sc.name === "BATTERY_PHYSICAL" || sc.name === "BATTERY_HYBRID")
          ? (sc.battery?.annual_discharge_kwh ?? 0)
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
        virtual_battery_mode: sc.name === "BATTERY_VIRTUAL",
        virtual_overflow_export_kwh:
          sc._virtualBattery8760?.virtual_battery_overflow_export_kwh ??
          sc.energy?.virtual_battery_overflow_export_kwh ??
          0,
        battery_contribution_y1: _battContribY1,
        battery_degradation_pct: econ.battery_degradation_pct,
        pv_degradation_first_year_pct: econ.pv_degradation_first_year_pct
      });

      const _isVbScenario = sc.name === "BATTERY_VIRTUAL" || sc.name === "BATTERY_HYBRID";
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
      const annualSavings = flows[0]?.total_eur ?? null;
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
          year1_total_eur: flows[0]?.total_eur ?? null,
          gain_25a: lastFlow?.cumul_eur ?? null,
          cumul_gains_end: lastFlow?.cumul_gains_eur ?? null,
          roi_years,
          irr_pct: irr_pct !== null ? round(irr_pct * 100, 2) : null
        };
        if (sc.name === "BATTERY_VIRTUAL") {
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
        economie_an1: round(flows[0].total_eur, 0),
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
          prime_disclaimer:
            "Prime et tarifs d'obligation d'achat : sous réserve d'éligibilité du projet et des tarifs en vigueur à la date de mise en service.",
        },
        flows,
        finance_warnings
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
