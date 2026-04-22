// ======================================================================
// SMARTPITCH — Scenario Builder V2
// Un seul scénario BASE : calpinage réel, PV réel, conso réelle, sans batterie.
// Aucun pricing interne ; capex = null (injecté plus tard).
// ======================================================================

import { aggregateMonthly } from "../monthlyAggregator.js";
import {
  resolvePanelPowerWc,
  computeInstalledKwcRounded2,
  ENGINE_ERROR_PANEL_REQUIRED,
} from "../../utils/resolvePanelPowerWc.js";

const HOURS_PER_YEAR = 8760;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Construit le scénario BASE V2 à partir du contexte (PV réel, conso réelle).
 * @param {Object} ctx - Contexte (ctx.pv.hourly, ctx.conso, ctx.conso_p_pilotee, ctx.form, ctx.settings)
 * @returns {Object} Scénario BASE V2 (energy, finance nulls, capex null, metadata + clés plates pour pipeline)
 */
export function buildScenarioBaseV2(ctx) {
  const pvHourly = Array.isArray(ctx?.pv?.hourly) && ctx.pv.hourly.length === HOURS_PER_YEAR
    ? ctx.pv.hourly.map(v => Number(v) || 0)
    : null;
  const consoHourly = Array.isArray(ctx?.conso_p_pilotee) && ctx.conso_p_pilotee.length === HOURS_PER_YEAR
    ? ctx.conso_p_pilotee
    : Array.isArray(ctx?.conso?.hourly) && ctx.conso.hourly.length === HOURS_PER_YEAR
      ? ctx.conso.hourly.map(v => Number(v) || 0)
      : Array.isArray(ctx?.conso?.clamped) && ctx.conso.clamped.length === HOURS_PER_YEAR
        ? ctx.conso.clamped.map(v => Number(v) || 0)
        : null;

  if (!pvHourly || !consoHourly) {
    return buildFallbackBaseV2(ctx);
  }

  const months = aggregateMonthly(pvHourly, consoHourly);

  const prod = months.reduce((a, m) => a + m.prod_kwh, 0);
  // Consommation maison = SUM(load_8760) uniquement ; jamais recalculée (import, auto, surplus ne la remplacent pas)
  const load8760Sum = typeof ctx?.conso?.annual_kwh === "number" && Number.isFinite(ctx.conso.annual_kwh) && ctx.conso.annual_kwh >= 0
    ? ctx.conso.annual_kwh
    : months.reduce((a, m) => a + m.conso_kwh, 0);
  const conso = load8760Sum;
  const auto = months.reduce((a, m) => a + m.auto_kwh, 0);
  const surplus = months.reduce((a, m) => a + m.surplus_kwh, 0);
  const importKwh = months.reduce((a, m) => a + m.import_kwh, 0);

  const kwc = resolveKwc(ctx);
  const nbPanneaux = resolveNbPanneaux(ctx);

  const energy = {
    prod,
    auto,
    surplus,
    import: importKwh,
    conso,
    monthly: months.map(m => ({
      prod: m.prod_kwh,
      conso: m.conso_kwh,
      auto: m.auto_kwh,
      surplus: m.surplus_kwh,
      import: m.import_kwh,
    })),
    hourly: null,
  };

  const finance = {
    roi_years: null,
    irr: null,
    lcoe: null,
    cashflows: null,
    note: "capex_required",
  };

  const metadata = {
    kwc,
    nb_panneaux: nbPanneaux,
  };

  if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
    const selfProdPct = prod > 0 ? (auto / prod) * 100 : null;
    const selfConsoPct = conso > 0 ? (auto / conso) * 100 : null;
    console.log(JSON.stringify({
      tag: "TRACE_SCENARIO_BASE",
      prodKwh: prod,
      consoKwh: conso,
      autoKwh: auto,
      importKwh,
      surplusKwh: surplus,
      self_prod_pct: selfProdPct,
      self_conso_pct: selfConsoPct,
    }));
  }

  return {
    name: "BASE",
    _v2: true,
    capex: null,
    capex_ttc: null,
    energy,
    finance,
    metadata,
    battery: false,
    batterie: false,

    prod_kwh: prod,
    conso_kwh: conso,
    auto_kwh: auto,
    surplus_kwh: surplus,
    monthly: months,
    annual: {
      prod_kwh: prod,
      conso_kwh: conso,
      auto_kwh: auto,
      surplus_kwh: surplus,
    },
    roi_years: null,
    irr_pct: null,
    lcoe_eur_kwh: null,
    flows: null,
  };
}

function buildFallbackBaseV2(ctx) {
  const kwc = resolveKwc(ctx);
  const nbPanneaux = resolveNbPanneaux(ctx);
  const prod = 0;
  const conso = typeof ctx?.conso?.annual_kwh === "number" && Number.isFinite(ctx.conso.annual_kwh) && ctx.conso.annual_kwh >= 0
    ? ctx.conso.annual_kwh
    : 0;
  const auto = 0;
  const surplus = 0;
  const importKwh = 0;
  const monthlyEmpty = Array.from({ length: 12 }, () => ({
    prod_kwh: 0,
    conso_kwh: 0,
    auto_kwh: 0,
    surplus_kwh: 0,
    import_kwh: 0,
    auto_pct: 0,
  }));

  return {
    name: "BASE",
    _v2: true,
    capex: null,
    capex_ttc: null,
    energy: {
      prod,
      auto,
      surplus,
      import: importKwh,
      conso,
      monthly: monthlyEmpty.map(m => ({ prod: m.prod_kwh, conso: m.conso_kwh, auto: m.auto_kwh, surplus: m.surplus_kwh, import: m.import_kwh })),
      hourly: null,
    },
    finance: { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "capex_required" },
    metadata: { kwc, nb_panneaux: nbPanneaux },
    battery: false,
    batterie: false,
    prod_kwh: prod,
    conso_kwh: conso,
    auto_kwh: auto,
    surplus_kwh: surplus,
    monthly: monthlyEmpty,
    annual: { prod_kwh: prod, conso_kwh: conso, auto_kwh: auto, surplus_kwh: surplus },
    roi_years: null,
    irr_pct: null,
    lcoe_eur_kwh: null,
    flows: null,
  };
}

function resolveKwc(ctx) {
  if (ctx?.pv?.kwc != null && Number.isFinite(Number(ctx.pv.kwc))) {
    return Number(ctx.pv.kwc);
  }
  const maxPanels = Math.floor(Number(ctx?.form?.maison?.panneaux_max || 0));
  const pi = ctx?.form?.panel_input;
  const pid = pi?.panel_id ?? pi?.panelId ?? pi?.id ?? null;
  const fromCatalog =
    pid != null &&
    String(pid).trim() !== "" &&
    pi?.power_wc != null &&
    Number.isFinite(Number(pi.power_wc)) &&
    Number(pi.power_wc) > 50
      ? Number(pi.power_wc)
      : null;
  const realPanelWc = fromCatalog ?? resolvePanelPowerWc(pi);
  if (maxPanels > 0 && realPanelWc != null) {
    return computeInstalledKwcRounded2(maxPanels, realPanelWc);
  }
  console.error("[ENGINE ERROR] Missing panel in study");
  throw new Error(ENGINE_ERROR_PANEL_REQUIRED);
}

function resolveNbPanneaux(ctx) {
  if (ctx?.pv?.panelsCount != null && Number.isInteger(ctx.pv.panelsCount)) {
    return ctx.pv.panelsCount;
  }
  const n = Number(ctx?.form?.maison?.panneaux_max || 0);
  if (Number.isInteger(n)) return n;
  const pans = ctx?.form?.roof?.pans;
  if (Array.isArray(pans)) return pans.length;
  return null;
}
