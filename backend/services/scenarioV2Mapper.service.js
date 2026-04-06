/**
 * Mapper scénarios V2 — structure unifiée pour persistance (PDF-ready, study_versions.data_json.scenarios_v2).
 * Les montants financiers viennent du moteur (financeService) ; ce fichier ne fait que structurer pour la persistance.
 */

import { resolveShadingTotalLossPct } from "./shading/resolveShadingTotalLossPct.js";

const LABELS = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
};

function round2(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.round(Number(x) * 100) / 100;
}

function round4(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.round(Number(x) * 10000) / 10000;
}

/**
 * Mappe un scénario V2 vers la structure normalisée (10 blocs).
 * @param {Object} scenario - Scénario après merge finance (name, energy, capex_ttc, roi_years, flows, _virtualBatteryQuote, etc.)
 * @param {Object} ctx - Contexte calcul (pv, battery_input, form, production si fourni)
 * @returns {Object} Scénario V2 normalisé
 */
function firstFiniteNum(...vals) {
  for (const v of vals) {
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function mapScenarioToV2(scenario, ctx) {
  const id = scenario.name ?? "BASE";
  if (scenario.name === "BATTERY_VIRTUAL" && process.env.NODE_ENV !== "production" && process.env.DEBUG_BV_MAPPER === "1") {
    console.log("=== BV MAPPER INPUT ===");
    console.log(JSON.stringify(scenario, null, 2));
  }
  const label = LABELS[id] ?? id;
  const bvSrc = id === "BATTERY_VIRTUAL" ? (scenario.battery_virtual || {}) : {};

  const prodKwh = scenario.energy?.production_kwh ?? scenario.energy?.prod ?? scenario.prod_kwh ?? null;
  const consoKwh = scenario.energy?.consumption_kwh ?? scenario.conso_kwh ?? (scenario.energy?.conso != null ? scenario.energy.conso : null);
  const autoKwh = scenario.energy?.autoconsumption_kwh ?? scenario.energy?.auto ?? scenario.auto_kwh ?? null;
  const autoproductionKwh = scenario.energy?.autoproduction_kwh ?? scenario.autoproduction_kwh ?? null;
  // BATTERY_VIRTUAL : afficher l'import facturé (billable_import_kwh = import_kwh)
  const importKwhDisplay = id === "BATTERY_VIRTUAL"
    ? (scenario.energy?.import_kwh ?? scenario.import_kwh ?? scenario.energy?.billable_import_kwh ?? scenario.billable_import_kwh ?? scenario.energy?.import ?? null)
    : (scenario.energy?.import ?? null);

  const selfConsumptionPct = scenario.self_consumption_pct ?? scenario.auto_pct_real ?? (consoKwh > 0 && autoKwh != null ? (autoKwh / consoKwh) * 100 : null);
  const selfProductionPct = id === "BATTERY_VIRTUAL" && (scenario.self_production_pct != null || (autoproductionKwh != null && consoKwh > 0))
    ? (scenario.self_production_pct ?? (consoKwh > 0 && autoproductionKwh != null ? (autoproductionKwh / consoKwh) * 100 : 0))
    : (prodKwh > 0 && consoKwh > 0 ? (prodKwh / consoKwh) * 100 : 0);

  const energyBase = {
    production_kwh: prodKwh,
    consumption_kwh: consoKwh,
    autoconsumption_kwh: autoKwh,
    surplus_kwh: scenario.energy?.surplus ?? scenario.surplus_kwh ?? null,
    import_kwh: importKwhDisplay,
    monthly: scenario.energy?.monthly ?? null,
    self_consumption_pct: selfConsumptionPct,
    self_production_pct: selfProductionPct,
    // BATTERY_VIRTUAL : lecture directe depuis le scénario (energy ou racine)
    ...(id === "BATTERY_VIRTUAL" ? {
      production_kwh: prodKwh,
      consumption_kwh: consoKwh,
      autoconsumption_kwh: autoKwh,
      autoproduction_kwh: autoproductionKwh,
      import_kwh: importKwhDisplay,
      grid_import_kwh:
        firstFiniteNum(
          scenario.energy?.grid_import_kwh,
          importKwhDisplay,
          scenario.energy?.import_kwh
        ),
      grid_export_kwh:
        firstFiniteNum(
          scenario.energy?.grid_export_kwh,
          scenario.energy?.surplus,
          scenario.surplus_kwh
        ) ?? null,
      credited_kwh: firstFiniteNum(
        scenario.energy?.credited_kwh,
        scenario.credited_kwh,
        bvSrc.credited_kwh,
        bvSrc.annual_charge_kwh
      ) ?? 0,
      used_credit_kwh: firstFiniteNum(
        scenario.energy?.used_credit_kwh,
        scenario.used_credit_kwh,
        bvSrc.restored_kwh,
        bvSrc.annual_discharge_kwh
      ) ?? 0,
      restored_kwh: firstFiniteNum(
        scenario.energy?.restored_kwh,
        scenario.energy?.used_credit_kwh,
        scenario.used_credit_kwh,
        bvSrc.restored_kwh,
        bvSrc.annual_discharge_kwh
      ) ?? 0,
      remaining_credit_kwh: scenario.energy?.remaining_credit_kwh ?? scenario.remaining_credit_kwh ?? null,
      billable_import_kwh: firstFiniteNum(
        scenario.energy?.billable_import_kwh,
        scenario.billable_import_kwh,
        importKwhDisplay
      ) ?? 0,
      billable_monthly: scenario.energy?.billable_monthly ?? scenario.billable_monthly ?? null,
      overflow_export_kwh:
        firstFiniteNum(
          scenario.energy?.overflow_export_kwh,
          scenario.energy?.virtual_battery_overflow_export_kwh,
          bvSrc.overflow_export_kwh
        ) ?? 0,
      virtual_battery_overflow_export_kwh:
        firstFiniteNum(
          scenario.energy?.virtual_battery_overflow_export_kwh,
          scenario.energy?.overflow_export_kwh,
          bvSrc.overflow_export_kwh
        ) ?? 0,
    } : {}),
    // Pertes batterie pour équilibre production = auto + surplus + battery_losses (BATTERY_PHYSICAL)
    ...(id === "BATTERY_PHYSICAL" && scenario.energy?.battery_losses_kwh != null ? { battery_losses_kwh: scenario.energy.battery_losses_kwh } : {}),
  };
  const energy = {
    ...energyBase,
    energy_independence_pct: scenario.energy_independence_pct ?? null,
  };

  const financeBase = {
    capex_ttc: scenario.capex_ttc ?? null,
    capex_net: scenario.capex_net ?? null,
    roi_years: scenario.roi_years ?? null,
    payback: scenario.roi_years ?? null,
    irr_pct: scenario.irr_pct ?? null,
    lcoe: scenario.lcoe_eur_kwh ?? null,
    annual_cashflows: scenario.flows ?? null,
    economie_year_1: scenario.economie_an1 ?? null,
    economie_total: scenario.economie_25a ?? scenario.gain_25a ?? null,
    virtual_battery_cost_annual: scenario._virtualBatteryQuote?.annual_cost_ttc ?? null,
    finance_meta: {
      cumul_eur_definition: "net_after_capex_ttc",
      cumul_gains_eur_definition: "cumulative_sum_of_total_eur",
      prime_included_in_year1_total_eur: true
    },
    warnings: Array.isArray(scenario.finance_warnings) ? scenario.finance_warnings : []
  };
  const finance = {
    ...financeBase,
    residual_bill_eur: scenario.residual_bill_eur ?? null,
    surplus_revenue_eur: scenario.surplus_revenue_eur ?? null
  };

  const costs = {
    battery_physical_price_ttc: id === "BATTERY_PHYSICAL" ? (Number(ctx?.finance_input?.battery_physical_price_ttc) || 0) : 0,
    battery_virtual_annual_cost: id === "BATTERY_VIRTUAL"
      ? (Number(scenario.costs?.battery_virtual_annual_cost) || Number(scenario._virtualBatteryQuote?.annual_cost_ttc) || 0)
      : 0,
  };

  const capex = {
    total_ttc: scenario.capex_ttc ?? null,
    injected_from_devis: scenario._v2 === true,
  };

  const pv = ctx?.pv ?? {};
  const hardware = {
    panels_count: pv.panelsCount ?? scenario.metadata?.nb_panneaux ?? null,
    kwc: pv.kwc ?? scenario.metadata?.kwc ?? null,
    battery_capacity_kwh:
      id === "BATTERY_VIRTUAL"
        ? firstFiniteNum(
            scenario.battery_virtual?.capacity_simulated_kwh,
            ctx?.virtual_battery_input?.capacity_kwh
          )
        : (ctx?.battery_input?.capacity_kwh ?? null),
    /** Identité technique catalogue (payload builder) — pas de prix ici. */
    battery_id:
      id === "BATTERY_PHYSICAL"
        ? (ctx?.battery_input?.battery_id ?? ctx?.battery_input?.id ?? null)
        : null,
    battery_usable_kwh:
      id === "BATTERY_PHYSICAL"
        ? (ctx?.battery_input?.usable_kwh ?? ctx?.battery_input?.capacity_kwh ?? null)
        : null,
  };

  const shadingSrc = ctx?.shading ?? ctx?.form?.installation?.shading ?? {};
  const shading = {
    near_loss_pct: shadingSrc.nearLossPct ?? shadingSrc.near_loss_pct ?? null,
    far_loss_pct: shadingSrc.farLossPct ?? shadingSrc.far_loss_pct ?? null,
    total_loss_pct: resolveShadingTotalLossPct(shadingSrc, ctx?.form) ?? null,
    quality: shadingSrc.shadingQuality ?? shadingSrc.quality ?? null,
  };

  const prodAnnual = ctx?.production?.annualKwh ?? ctx?.production?.annual_kwh ?? scenario.energy?.prod ?? scenario.prod_kwh;
  const prodMonthly = ctx?.production?.monthlyKwh ?? ctx?.production?.monthly_kwh ?? null;
  const production = {
    annual_kwh: prodAnnual ?? null,
    monthly_kwh: prodMonthly ?? null,
  };

  const physicalBatteryObj =
    typeof scenario.battery === "object" &&
    scenario.battery !== null &&
    scenario.battery.enabled === true &&
    scenario.battery.annual_charge_kwh != null;

  const assumptions = {
    battery_enabled:
      scenario.batterie === true ||
      scenario.battery === true ||
      physicalBatteryObj ||
      (typeof scenario.battery === "object" &&
        scenario.battery !== null &&
        scenario.battery.enabled === true),
    virtual_enabled: id === "BATTERY_VIRTUAL",
    shading_source: shadingSrc.farSource ?? shadingSrc.far_source ?? null,
    model_version: "ENGINE_V2",
  };

  const batteryPhysicalMetrics =
    id === "BATTERY_PHYSICAL" && physicalBatteryObj
      ? {
          battery_cycles_per_year: round2(scenario.battery.equivalent_cycles),
          battery_daily_cycles: round4(scenario.battery.daily_cycles_avg),
          battery_utilization_pct: round2(
            Number(scenario.battery.battery_utilization_rate) * 100
          ),
          battery_throughput_kwh: Math.round(
            Number(scenario.battery.annual_throughput_kwh)
          ),
          battery_charge_kwh: Math.round(Number(scenario.battery.annual_charge_kwh)),
          battery_discharge_kwh: Math.round(
            Number(scenario.battery.annual_discharge_kwh)
          ),
        }
      : {};

  const mappedScenario = {
    scenario_type: id,
    id,
    label,
    energy,
    finance,
    capex,
    costs,
    hardware,
    shading,
    production,
    assumptions,
    computed_at: new Date().toISOString(),
    battery_virtual:
      id === "BATTERY_VIRTUAL"
        ? (scenario.battery_virtual ??
            (scenario._skipped === true
              ? { enabled: false, annual_charge_kwh: 0, annual_discharge_kwh: 0 }
              : null))
        : null,
    virtual_battery_8760:
      id === "BATTERY_VIRTUAL" ? (scenario._virtualBattery8760 ?? null) : null,
    ...batteryPhysicalMetrics,
  };
  if (mappedScenario.id === "BATTERY_VIRTUAL" && process.env.NODE_ENV !== "production" && process.env.DEBUG_BV_MAPPER === "1") {
    console.log("=== BV MAPPER OUTPUT ===");
    console.log(JSON.stringify(mappedScenario, null, 2));
  }
  if (process.env.NODE_ENV !== "production" && process.env.DEBUG_SCENARIO_V2_MAP === "1") {
    console.log("[A1] scenario mappé =", JSON.stringify(mappedScenario, null, 2));
  }
  return mappedScenario;
}
