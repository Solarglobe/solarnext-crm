// ======================================================================
// SMARTPITCH — SCENARIO SERVICE (VERSION PRO 2025, SOLARGLOBE)
// Corrige :
// - Utilise VRAIMENT la simulation 8760h (PV + conso pilotée) dès que dispo
// - mensuels batterie basés sur 8760h (simulateBattery8760 + aggregateMonthly)
// - auto_pct = auto / conso (part de la consommation couverte par le PV)
// - annual.* ajouté pour impactService
// - prod_kwh = production PV réelle (brute, avant batterie)
// - import_kwh mensuel ajouté (via monthlyAggregator)
// - fallback mensuel physiquement cohérent (auto ≤ prod et auto ≤ conso)
// ======================================================================

import { simulateBattery8760 } from "./batteryService.js";
import { aggregateMonthly } from "./monthlyAggregator.js";
import {
  SCENARIO_HOURS_PER_YEAR,
  SCENARIO_MONTHLY_BATTERY_AUTO_BOOST,
} from "./core/engineConstants.js";


// ======================================================================
// Simulation directe (sans batterie) — renvoie aussi les arrays 8760h
// ======================================================================
function simulateDirect8760(pv, load, ctx) {
  let auto = 0;
  let surplus = 0;

  const auto_hourly = [];
  const surplus_hourly = [];

  // -------------------------------------------
  // Récupération du KVA & type réseau
  // -------------------------------------------
  const kva = Number(ctx?.form?.params?.puissance_kva || 0);
  const reseau = ctx?.form?.params?.reseau_type || "mono";

  // Limite injection réseau
  const injection_max = kva > 0 ? kva : Infinity;

  for (let i = 0; i < SCENARIO_HOURS_PER_YEAR; i++) {
    const p = pv[i] || 0;
    const l = load[i] || 0;

    // autoconsommation brute
    const a = Math.min(p, l);
    auto += a;

    // surplus brut
    const s = Math.max(0, p - l);

    // limitation réseau
    const s_lim = Math.min(s, injection_max);
    surplus += s_lim;

    auto_hourly.push(a);
    surplus_hourly.push(s_lim);
  }

  // import réseau
  const import_hourly = [];
  for (let i = 0; i < SCENARIO_HOURS_PER_YEAR; i++) {
    import_hourly.push(Math.max(0, load[i] - auto_hourly[i]));
  }

  return {
    auto_kwh: Math.round(auto),
    surplus_kwh: Math.round(surplus),
    auto_hourly,
    surplus_hourly,
    import_hourly
  };
}



// ======================================================================
// Fonction principale — construction d'un scénario
// ======================================================================
export function buildScenario(ctx, name, kwc, production, consumption, pricing, options = {}) {
  const hasBattery =
    Boolean(options?.battery) ||
    (typeof name === "string" && name.includes("2"));

  const energy = simulateEnergyAnnual(ctx, name, kwc, production, consumption, hasBattery);

  return {
    name,
    kwc,
    battery: hasBattery,
    batterie: hasBattery,

    prod_kwh: energy.prod_kwh,
    conso_kwh: energy.conso_kwh,
    auto_kwh: energy.auto_kwh,
    surplus_kwh: energy.surplus_kwh,
    auto_pct: energy.auto_pct,       // part de la conso couverte
    surplus_pct: energy.surplus_pct, // part de la prod injectée

    monthly: energy.monthly,

    // Pour impactService
    annual: {
      prod_kwh: energy.prod_kwh,
      conso_kwh: energy.conso_kwh,
      auto_kwh: energy.auto_kwh,
      surplus_kwh: energy.surplus_kwh
    },

    // Indicateur propre (identique ici, mais garde la porte ouverte)
    auto_pct_real: energy.auto_pct
  };
}

// ======================================================================
// Simulation énergie annuelle
// ======================================================================
function simulateEnergyAnnual(ctx, name, kwc, production, consumption, hasBattery) {
  const pv_monthly = normalizeMonthly(production);
  const conso_monthly = normalizeMonthly(consumption);

  // --------------------------------------------------------------------
  // 1) MODE PREMIUM 8760h (PV = ctx.pv.hourly * kWc, conso = profil piloté)
// --------------------------------------------------------------------
  const have8760PV = Array.isArray(ctx?.pv?.hourly) && ctx.pv.hourly.length === SCENARIO_HOURS_PER_YEAR;

  // On récupère la conso pilotée 8760h dans l'ordre de priorité :
  //  - ctx.conso_p_pilotee (nom utilisé dans calc.controller.js)
  //  - ctx.conso_pilotee (au cas où)
  //  - ctx.conso.hourly (fallback ultime)
const loadHourly = Array.isArray(ctx?.conso?.clamped) && ctx.conso.clamped.length === SCENARIO_HOURS_PER_YEAR
  ? ctx.conso.clamped
  : ctx.conso.hourly;


  const have8760Conso = Array.isArray(loadHourly) && loadHourly.length === SCENARIO_HOURS_PER_YEAR;

  if (have8760PV && have8760Conso) {
    // PV réel du scénario = profil 1 kWc × kWc
const pv = ctx.pv.hourly.map(v => (v || 0) * kwc);

// PATCH SECURITE : garantie pipeline unifié même en mode forcé
if (!Array.isArray(pv) || pv.length !== SCENARIO_HOURS_PER_YEAR) {
  throw new Error("PV 8760 invalide dans simulateEnergyAnnual");
}

const load = loadHourly;


    // ---------------- A) SANS BATTERIE ----------------
    if (!hasBattery) {
      const direct = simulateDirect8760(pv, load, ctx);


      // On utilise aggregateMonthly avec les auto/surplus calculés
      const monthly = aggregateMonthly(pv, load, {
        auto_hourly: direct.auto_hourly,
        surplus_hourly: direct.surplus_hourly
      });

      const prodYear = sum(monthly.map(m => m.prod_kwh));
      const consoYear = sum(monthly.map(m => m.conso_kwh));
      const autoYear = sum(monthly.map(m => m.auto_kwh));
      const surplusYear = sum(monthly.map(m => m.surplus_kwh));

      return {
        prod_kwh: prodYear,
        conso_kwh: consoYear,
        auto_kwh: autoYear,
        surplus_kwh: surplusYear,
        auto_pct: consoYear > 0 ? Math.round((autoYear / consoYear) * 100) : 0,
        surplus_pct: prodYear > 0 ? Math.round((surplusYear / prodYear) * 100) : 0,
        monthly
      };
    }

    // ---------------- B) AVEC BATTERIE (paramètres devis uniquement, pas de 7 kWh) ----------------
    const battery = ctx.battery_input || null;
    const batt = simulateBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      battery,
    });

    if (!batt.ok) {
      if (batt.reason === "MISSING_BATTERY_CAPACITY" || !batt.auto_hourly) {
        const direct = simulateDirect8760(pv, load, ctx);
        const monthly = aggregateMonthly(pv, load, {
          auto_hourly: direct.auto_hourly,
          surplus_hourly: direct.surplus_hourly
        });
        const prodYear = sum(monthly.map(m => m.prod_kwh));
        const consoYear = sum(monthly.map(m => m.conso_kwh));
        const autoYear = sum(monthly.map(m => m.auto_kwh));
        const surplusYear = sum(monthly.map(m => m.surplus_kwh));
        return {
          prod_kwh: prodYear,
          conso_kwh: consoYear,
          auto_kwh: autoYear,
          surplus_kwh: surplusYear,
          auto_pct: consoYear > 0 ? Math.round((autoYear / consoYear) * 100) : 0,
          surplus_pct: prodYear > 0 ? Math.round((surplusYear / prodYear) * 100) : 0,
          monthly
        };
      }
    }

    const monthlyBatt = aggregateMonthly(batt.pv_hourly, load, batt);

    const prodYear = sum(monthlyBatt.map(m => m.prod_kwh));
    const consoYear = sum(monthlyBatt.map(m => m.conso_kwh));
    const autoYear = sum(monthlyBatt.map(m => m.auto_kwh));
    const surplusYear = sum(monthlyBatt.map(m => m.surplus_kwh));

    return {
      prod_kwh: prodYear,
      conso_kwh: consoYear,
      auto_kwh: autoYear,
      surplus_kwh: surplusYear,
      auto_pct: consoYear > 0 ? Math.round((autoYear / consoYear) * 100) : 0,
      surplus_pct: prodYear > 0 ? Math.round((surplusYear / prodYear) * 100) : 0,
      monthly: monthlyBatt
    };
  }

  // --------------------------------------------------------------------
  // 2) FALLBACK MENSUEL (cas exceptionnel, sans 8760h exploitable)
  //    On reste STRICTEMENT physiquement cohérents :
  //    auto ≤ prod et auto ≤ conso, jamais d'auto_kwh > prod_kwh
  // --------------------------------------------------------------------
  const fallbackMonthly = [];

  for (let i = 0; i < 12; i++) {
    const prod = pv_monthly[i];
    const conso = conso_monthly[i];

    let auto;
    let surplus;

    if (!hasBattery) {
      // Sans batterie : auto = min(prod, conso), surplus = max(prod - auto, 0)
      auto = Math.min(prod, conso);
      surplus = Math.max(0, prod - auto);
    } else {
      // Avec batterie en fallback mensuel :
      // Hypothèse simple et SAFE : la batterie permet d'effacer une partie
      // du surplus mais ne crée pas d'énergie.
      // On borne strictement :
      //    auto ≤ prod et auto ≤ conso
      // Pour rester conservateur on autorise à peine plus d'auto
      // que le minimum direct, sans jamais dépasser prod ni conso.
      const autoDirect = Math.min(prod, conso);

      // petit bonus d'autoconsommation (max +10%), borné physiquement
      const autoBoost = autoDirect * SCENARIO_MONTHLY_BATTERY_AUTO_BOOST;
      auto = Math.min(prod, conso, autoBoost);
      surplus = Math.max(0, prod - auto);
    }

    const autoRounded = Math.round(auto);
    const surplusRounded = Math.round(surplus);
    const import_kwh = Math.max(0, conso - autoRounded);

    fallbackMonthly.push({
      prod_kwh: prod,
      conso_kwh: conso,
      auto_kwh: autoRounded,
      surplus_kwh: surplusRounded,
      auto_pct: conso > 0 ? Math.round((autoRounded / conso) * 100) : 0,
      import_kwh
    });
  }

  const prodYear = sum(fallbackMonthly.map(m => m.prod_kwh));
  const consoYear = sum(fallbackMonthly.map(m => m.conso_kwh));
  const autoYear = sum(fallbackMonthly.map(m => m.auto_kwh));
  const surplusYear = sum(fallbackMonthly.map(m => m.surplus_kwh));

  return {
    prod_kwh: prodYear,
    conso_kwh: consoYear,
    auto_kwh: autoYear,
    surplus_kwh: surplusYear,
    auto_pct: consoYear > 0 ? Math.round((autoYear / consoYear) * 100) : 0,
    surplus_pct: prodYear > 0 ? Math.round((surplusYear / prodYear) * 100) : 0,
    monthly: fallbackMonthly
  };
}

// ======================================================================
// Utils
// ======================================================================
function normalizeMonthly(obj) {
  if (!obj) return Array(12).fill(0);
  if (Array.isArray(obj)) return pad12(obj);
  if (obj.monthly) return pad12(obj.monthly);
  if (obj.values) return pad12(obj.values);
  return Array(12).fill(0);
}

function pad12(arr) {
  const out = new Array(12).fill(0);
  for (let i = 0; i < 12; i++) out[i] = Number(arr[i] || 0);
  return out;
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}
