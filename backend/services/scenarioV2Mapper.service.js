/**
 * Mapper scénarios V2 — structure unifiée pour persistance (PDF-ready, study_versions.data_json.scenarios_v2).
 * Les montants financiers viennent du moteur (financeService) ; ce fichier ne fait que structurer pour la persistance.
 */

import { resolveShadingTotalLossPct } from "./shading/resolveShadingTotalLossPct.js";
import {
  computeExportPct,
  computePvSelfConsumptionPct,
  computeSiteAutonomyPct,
  computeSolarCoveragePct,
} from "./energyKpiDefinitions.service.js";
import { CALC_ENGINE_VERSION } from "./calc/calc.constants.js";

const LABELS = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
  BATTERY_HYBRID: "Hybride : physique + virtuelle",
  VEHICLE_V2H: "Voiture V2H",
  VEHICLE_V2H_PHYSICAL: "Voiture V2H + batterie physique",
  VEHICLE_V2H_VIRTUAL: "Voiture V2H + batterie virtuelle",
  VEHICLE_V2H_PHYSICAL_VIRTUAL: "Voiture V2H + physique + virtuelle",
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

function clampKwh(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let out = Math.max(min, n);
  if (Number.isFinite(max)) out = Math.min(out, max);
  return out;
}

function minPositiveCap(...vals) {
  const finite = vals.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0).map(Number);
  return finite.length > 0 ? Math.min(...finite) : Infinity;
}

export function mapScenarioToV2(scenario, ctx) {
  const id = scenario.name ?? "BASE";
  const isVirtualLike = id === "BATTERY_VIRTUAL" || id === "BATTERY_HYBRID" || id === "VEHICLE_V2H_VIRTUAL" || id === "VEHICLE_V2H_PHYSICAL_VIRTUAL";
  const isPhysicalLike = id === "BATTERY_PHYSICAL" || id === "BATTERY_HYBRID" || id === "VEHICLE_V2H_PHYSICAL" || id === "VEHICLE_V2H_PHYSICAL_VIRTUAL";
  if (scenario.name === "BATTERY_VIRTUAL" && process.env.NODE_ENV !== "production" && process.env.DEBUG_BV_MAPPER === "1") {
    console.log("=== BV MAPPER INPUT ===");
    console.log(JSON.stringify(scenario, null, 2));
  }
  const label = LABELS[id] ?? id;
  const bvSrc = isVirtualLike ? (scenario.battery_virtual || {}) : {};

  const prodKwh = scenario.energy?.production_kwh ?? scenario.energy?.prod ?? scenario.prod_kwh ?? null;
  const consoKwh = scenario.energy?.consumption_kwh ?? scenario.conso_kwh ?? (scenario.energy?.conso != null ? scenario.energy.conso : null);
  const autoKwh = scenario.energy?.autoconsumption_kwh ?? scenario.energy?.auto ?? scenario.auto_kwh ?? null;
  const autoproductionKwh = scenario.energy?.autoproduction_kwh ?? scenario.autoproduction_kwh ?? null;
  // BATTERY_VIRTUAL / BATTERY_HYBRID : afficher l'import facturé (billable_import_kwh = import_kwh)
  const importKwhDisplay = isVirtualLike
    ? (scenario.energy?.import_kwh ?? scenario.import_kwh ?? scenario.energy?.billable_import_kwh ?? scenario.billable_import_kwh ?? scenario.energy?.import ?? null)
    : (scenario.energy?.energy_grid_import_kwh ??
        scenario.energy?.billable_import_kwh ??
        scenario.energy?.grid_import_kwh ??
        scenario.energy?.import_kwh ??
        scenario.import_kwh ??
        scenario.energy?.import ??
        null);

  const pvUsedKwhRaw = firstFiniteNum(
    scenario.energy?.total_pv_used_on_site_kwh,
    scenario.energy?.autoconsumption_kwh,
    autoKwh
  );
  const pvUsedKwh = clampKwh(pvUsedKwhRaw, 0, minPositiveCap(prodKwh, consoKwh));
  const importForKpi = firstFiniteNum(
    importKwhDisplay,
    scenario.energy?.import_kwh,
    scenario.energy?.grid_import_kwh,
    scenario.import_kwh
  );
  const surplusKwhForKpi = firstFiniteNum(
    scenario.energy?.exported_kwh,
    scenario.energy?.surplus,
    scenario.surplus_kwh
  );
  const siteSolarOrCreditUsedForKpi =
    isVirtualLike && consoKwh != null && importForKpi != null
      ? clampKwh(consoKwh - importForKpi, 0, minPositiveCap(consoKwh, prodKwh))
      : null;

  const kpiPayload = {
    production_kwh: prodKwh,
    total_pv_used_on_site_kwh: siteSolarOrCreditUsedForKpi ?? pvUsedKwh,
    consumption_kwh: consoKwh,
    grid_import_kwh: importForKpi,
    surplus_kwh: surplusKwhForKpi,
  };

  const pvSelfPct =
    (!isVirtualLike ? scenario.energy?.pv_self_consumption_pct : null) ??
    computePvSelfConsumptionPct(kpiPayload);
  const siteAutPct =
    (!isVirtualLike ? scenario.energy?.site_autonomy_pct : null) ??
    computeSiteAutonomyPct(kpiPayload);
  const solarCoverPct =
    (!isVirtualLike ? scenario.energy?.solar_coverage_pct : null) ??
    computeSolarCoveragePct(kpiPayload);
  const exportPct =
    scenario.energy?.export_pct ??
    computeExportPct(kpiPayload);

  /** @deprecated Alias — = taux d’autoconsommation PV (pv_self_consumption_pct). */
  const selfConsumptionPctAlias = pvSelfPct;
  /** @deprecated Alias — = couverture solaire (solar_coverage_pct), pas prod/conso. */
  const selfProductionPctLegacy = solarCoverPct;

  const energyBase = {
    production_kwh: prodKwh,
    consumption_kwh: consoKwh,
    autoconsumption_kwh: pvUsedKwh ?? autoKwh,
    surplus_kwh: scenario.energy?.surplus ?? scenario.surplus_kwh ?? null,
    import_kwh: importKwhDisplay,
    billable_import_kwh: importKwhDisplay,
    grid_import_kwh: importKwhDisplay,
    energy_grid_import_kwh: importKwhDisplay,
    monthly: scenario.energy?.monthly ?? null,
    /** Alias legacy — voir pv_self_consumption_pct. */
    self_consumption_pct: selfConsumptionPctAlias,
    /** Alias legacy — voir solar_coverage_pct. */
    self_production_pct: selfProductionPctLegacy,
    solar_coverage_pct: solarCoverPct,
    export_pct: exportPct,
    // BATTERY_VIRTUAL / BATTERY_HYBRID : lecture directe depuis le scénario (energy ou racine)
    ...(isVirtualLike ? {
      production_kwh: prodKwh,
      consumption_kwh: consoKwh,
      autoconsumption_kwh: pvUsedKwh ?? autoKwh,
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
    // Pertes batterie pour équilibre production = auto + surplus + battery_losses (BATTERY_PHYSICAL + BATTERY_HYBRID)
    ...(isPhysicalLike && scenario.energy?.battery_losses_kwh != null ? { battery_losses_kwh: scenario.energy.battery_losses_kwh } : {}),
  };
  const energy = {
    ...energyBase,
    energy_independence_pct: scenario.energy_independence_pct ?? null,
    direct_self_consumption_kwh: scenario.energy?.direct_self_consumption_kwh ?? null,
    direct_self_consumption_pct: scenario.energy?.direct_self_consumption_pct ?? null,
    surplus_before_battery_kwh: scenario.energy?.surplus_before_battery_kwh ?? null,
    surplus_before_virtual_battery_kwh: scenario.energy?.surplus_before_virtual_battery_kwh ?? null,
    surplus_available_pct: scenario.energy?.surplus_available_pct ?? null,
    surplus_used_by_physical_battery_kwh: scenario.energy?.surplus_used_by_physical_battery_kwh ?? null,
    physical_battery_charge_from_surplus_kwh: scenario.energy?.physical_battery_charge_from_surplus_kwh ?? null,
    physical_battery_charge_to_soc_kwh: scenario.energy?.physical_battery_charge_to_soc_kwh ?? null,
    surplus_after_physical_battery_kwh: scenario.energy?.surplus_after_physical_battery_kwh ?? null,
    surplus_to_virtual_or_grid_kwh: scenario.energy?.surplus_to_virtual_or_grid_kwh ?? null,
    surplus_used_by_virtual_battery_kwh: scenario.energy?.surplus_used_by_virtual_battery_kwh ?? null,
    virtual_battery_valued_kwh: scenario.energy?.virtual_battery_valued_kwh ?? null,
    battery_discharge_kwh: scenario.energy?.battery_discharge_kwh ?? null,
    physical_battery_discharge_kwh: scenario.energy?.physical_battery_discharge_kwh ?? null,
    virtual_battery_discharge_kwh: scenario.energy?.virtual_battery_discharge_kwh ?? null,
    site_solar_or_credit_used_kwh: scenario.energy?.site_solar_or_credit_used_kwh ?? null,
    total_pv_used_on_site_kwh: pvUsedKwh ?? null,
    exported_kwh: scenario.energy?.exported_kwh ?? null,
    pv_self_consumption_pct: pvSelfPct ?? scenario.energy?.pv_self_consumption_pct ?? null,
    site_autonomy_pct: siteAutPct ?? scenario.energy?.site_autonomy_pct ?? null,
    solar_coverage_pct: solarCoverPct ?? scenario.energy?.solar_coverage_pct ?? null,
    export_pct: exportPct ?? scenario.energy?.export_pct ?? null,
  };
  if (isVirtualLike) {
    const gridImport = firstFiniteNum(energy.billable_import_kwh, energy.grid_import_kwh, energy.import_kwh) ?? 0;
    const creditStart =
      firstFiniteNum(
        scenario.virtual_credit_start_kwh,
        scenario.virtual_battery_rollover?.virtual_credit_start_kwh,
        scenario._virtualBattery8760?.virtual_battery_credit_start_kwh
      ) ?? 0;
    const creditEnd =
      firstFiniteNum(
        scenario.virtual_credit_end_kwh,
        scenario.virtual_battery_rollover?.virtual_credit_end_kwh,
        scenario._virtualBattery8760?.virtual_battery_credit_end_kwh
      ) ?? 0;
    const priorCreditUsedNet = Math.max(0, creditStart - creditEnd);
    const siteSolarOrCreditUsed = clampKwh(
      firstFiniteNum(energy.site_solar_or_credit_used_kwh, consoKwh != null ? consoKwh - gridImport : null),
      0,
      minPositiveCap(consoKwh, (prodKwh ?? 0) + priorCreditUsedNet)
    );
    energy.energy_solar_used_kwh = round2(pvUsedKwh ?? 0);
    energy.site_solar_or_credit_used_kwh = round2(siteSolarOrCreditUsed ?? 0);
    energy.energy_grid_import_kwh = round2(Math.max(0, gridImport));
  }

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
    economie_horizon_years: scenario.economie_horizon_years ?? null,
    economie_total_horizon_label: scenario.economie_total_horizon_label ?? null,
    virtual_battery_cost_annual: scenario._virtualBatteryQuote?.annual_cost_ttc ?? null,
    // LOT3-HPHC-VALO : traçabilité — prix effectifs HP/HC utilisés pour ce scénario (null = prix plat).
    pricing: scenario.pricing ?? null,
    finance_meta: {
      ...(scenario.finance_meta && typeof scenario.finance_meta === "object" ? scenario.finance_meta : {}),
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
  if (isVirtualLike) {
    const vf = scenario.virtual_battery_finance;
    const p2TotalBill =
      vf && typeof vf === "object"
        ? round2(
            (Number(vf.annual_grid_import_cost_ttc) || 0) +
              (Number(vf.annual_total_virtual_cost_ttc) || 0) -
              (Number(vf.annual_overflow_export_revenue_ttc) || 0)
          )
        : null;
    finance.estimated_annual_bill_eur = round2(
      firstFiniteNum(
        p2TotalBill,
        scenario.finance?.residual_bill_eur,
        scenario.residual_bill_eur,
        finance.residual_bill_eur
      )
    );
  }

  const costs = {
    battery_physical_price_ttc: isPhysicalLike ? (Number(ctx?.finance_input?.battery_physical_price_ttc) || 0) : 0,
    battery_virtual_annual_cost: isVirtualLike
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
    /** Capacité VB simulée (uniquement pour HYBRID — affichage combiné) */
    virtual_battery_capacity_kwh:
      id === "BATTERY_HYBRID"
        ? firstFiniteNum(
            scenario.battery_virtual?.capacity_simulated_kwh,
            scenario._virtualBatteryP2?.simulation_capacity_kwh
          )
        : null,
    /** Identité technique catalogue (payload builder) — pas de prix ici. */
    battery_id:
      isPhysicalLike
        ? (ctx?.battery_input?.battery_id ?? ctx?.battery_input?.id ?? null)
        : null,
    battery_usable_kwh:
      isPhysicalLike
        ? (ctx?.battery_input?.usable_kwh ?? ctx?.battery_input?.capacity_kwh ?? null)
        : null,
    /** Nombre d'unités batteries physiques couplées (1 si mono, N si multi). Exposé pour affichage frontend + PDF. */
    battery_units:
      isPhysicalLike
        ? (ctx?.battery_input?.battery_units ?? 1)
        : null,
    /**
     * Puissance de charge système totale après scaling V2 (kW).
     * = unitaire × qty si scalable sans cap, ou min(unitaire × qty, max_system_charge_kw) si capée,
     * ou puissance unitaire seule si scalable=false.
     */
    battery_max_charge_kw:
      isPhysicalLike
        ? (ctx?.battery_input?.max_charge_kw != null
            ? round2(ctx.battery_input.max_charge_kw)
            : null)
        : null,
    /** Puissance de décharge système totale après scaling V2 (kW). */
    battery_max_discharge_kw:
      isPhysicalLike
        ? (ctx?.battery_input?.max_discharge_kw != null
            ? round2(ctx.battery_input.max_discharge_kw)
            : null)
        : null,
    /**
     * true si la puissance système est limitée par l'onduleur hybride ou le BMS
     * (scalable=false OU cap max_system_*_kw atteint pour qty > 1).
     * Utilisé pour afficher l'avertissement "puissance limitée" en frontend / PDF.
     */
    battery_power_capped:
      isPhysicalLike
        ? (ctx?.battery_input?.battery_power_capped === true)
        : null,
  };

  const shadingSrc = ctx?.shading ?? ctx?.form?.installation?.shading ?? {};
  const shading = {
    near_loss_pct:  shadingSrc.nearLossPct ?? shadingSrc.near_loss_pct ?? null,
    far_loss_pct:   shadingSrc.farLossPct  ?? shadingSrc.far_loss_pct  ?? null,
    total_loss_pct: resolveShadingTotalLossPct(shadingSrc, ctx?.form)  ?? null,
    quality:        shadingSrc.shadingQuality ?? shadingSrc.quality    ?? null,
    // ── champs enrichis — propagés depuis payload.installation.shading ──────
    monthlyFactors:  shadingSrc.monthlyFactors  ?? null,
    monthlyKwhStats: shadingSrc.monthlyKwhStats ?? null,
    annualLossKwh:   shadingSrc.annualLossKwh   ?? null,
    pvgisReference:  shadingSrc.pvgisReference  ?? null,
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
    virtual_enabled: isVirtualLike,
    shading_source: shadingSrc.farSource ?? shadingSrc.far_source ?? null,
    elec_growth_pct: scenario.finance_meta?.elec_growth_pct ?? null,
    elec_growth_source: scenario.finance_meta?.elec_growth_source ?? null,
    elec_growth_missing: scenario.finance_meta?.elec_growth_missing === true,
    scenario_uses_piloted_profile: scenario.scenario_uses_piloted_profile === true,
    oversell_risk_score: Number.isFinite(Number(scenario.oversell_risk_score)) ? Number(scenario.oversell_risk_score) : 0,
    anti_oversell_flags: Array.isArray(scenario.anti_oversell_flags) ? scenario.anti_oversell_flags : [],
    model_version: "ENGINE_V2",
  };

  const batteryPhysicalMetrics =
    isPhysicalLike && physicalBatteryObj
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
          battery_charge_from_surplus_kwh: Math.round(
            Number(scenario.battery.annual_charge_from_surplus_kwh ?? scenario.energy?.physical_battery_charge_from_surplus_kwh ?? scenario.battery.annual_charge_kwh)
          ),
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
    scenario_uses_piloted_profile: scenario.scenario_uses_piloted_profile === true,
    // COHERENCE MOTEUR : base temporelle effective ("hourly_8760", "monthly_fallback" ou "skipped").
    energy_basis: scenario.energy_basis ?? (scenario._skipped === true ? "skipped" : "hourly_8760"),
    // TRACABILITE PROFIL DE CONSO — verite calculee exposee a l'API (front + PDF lisent la meme source).
    consumption_source: (() => {
      const m = String(ctx?.meta?.consumption_source_mode ?? "").toUpperCase();
      if (m.includes("CSV_HOURLY") || m.includes("PROFILE_8760")) return "ENEDIS_HOURLY";
      if (m.includes("DAILY")) return "ENEDIS_DAILY";
      if (m.includes("MONTHLY")) return "MONTHLY_SYNTHETIC";
      if (m.includes("ANNUAL")) return "ANNUAL_SYNTHETIC";
      if (m) return "FALLBACK";
      return null;
    })(),
    consumption_source_mode: ctx?.meta?.consumption_source_mode ?? null,
    occupancy_profile: ctx?.form?.conso?.profil ?? ctx?.form?.params?.profil ?? ctx?.meta?.occupancy_profile ?? null,
    solar_piloting_enabled: ctx?.meta?.solar_piloting_enabled === true,
    piloting_reason: ctx?.meta?.piloting_reason ?? (ctx?.meta?.solar_piloting_enabled === true ? "explicit_user_choice" : "not_enabled"),
    usages_pilotables: Array.isArray(ctx?.meta?.usages_pilotables) ? ctx.meta.usages_pilotables : [],
    base_consumption_profile_hash: ctx?.meta?.base_consumption_profile_hash ?? null,
    calculated_consumption_profile_hash: ctx?.meta?.calculated_consumption_profile_hash ?? null,
    scenarios_engine_version: CALC_ENGINE_VERSION,
    needs_recompute: scenario.needs_recompute === true,
    display_blocked: scenario.display_blocked === true,
    blocked_reason: scenario.blocked_reason ?? null,
    anti_oversell_flags: Array.isArray(scenario.anti_oversell_flags) ? scenario.anti_oversell_flags : [],
    oversell_risk_score: Number.isFinite(Number(scenario.oversell_risk_score)) ? Number(scenario.oversell_risk_score) : 0,
    computed_at: new Date().toISOString(),
    battery_virtual:
      isVirtualLike
        ? (scenario.battery_virtual ??
            (scenario._skipped === true
              ? { enabled: false, annual_charge_kwh: 0, annual_discharge_kwh: 0 }
              : null))
        : null,
    virtual_battery_8760:
      isVirtualLike ? (scenario._virtualBattery8760 ?? null) : null,
    ...(isVirtualLike ? {
      year1: scenario.year1 ?? scenario.virtual_battery_rollover?.year1 ?? null,
      stabilized: scenario.stabilized ?? scenario.virtual_battery_rollover?.stabilized ?? null,
      convergence_year: scenario.convergence_year ?? scenario.virtual_battery_rollover?.convergence_year ?? null,
      virtual_credit_start_kwh:
        scenario.virtual_credit_start_kwh ??
        scenario.virtual_battery_rollover?.virtual_credit_start_kwh ??
        scenario._virtualBattery8760?.virtual_battery_credit_start_kwh ??
        null,
      virtual_credit_end_kwh:
        scenario.virtual_credit_end_kwh ??
        scenario.virtual_battery_rollover?.virtual_credit_end_kwh ??
        scenario._virtualBattery8760?.virtual_battery_credit_end_kwh ??
        null,
      virtual_battery_rollover: scenario.virtual_battery_rollover ?? null,
    } : {}),
    ...(isVirtualLike && scenario.virtual_battery_finance && typeof scenario.virtual_battery_finance === "object"
      ? { virtual_battery_finance: scenario.virtual_battery_finance }
      : {}),
    _virtualBatteryP2: isVirtualLike ? (scenario._virtualBatteryP2 ?? null) : null,
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
