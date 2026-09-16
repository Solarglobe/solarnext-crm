import { reconcilePercentParts } from "./pdfEnergyCanonical.js";
import { calendarForLength, calendarParts } from "../energyCalendar.service.js";

/** Mapping only: no new energy simulation, inferred injections, or rescaled months. */
export function applyVerifiedEnergyPresentation(vm, ref, scenario = {}) {
  if (!ref || !["ac-energy-ledger-1", "ac-energy-ledger-2"].includes(ref.version)) return vm;
  const a = ref.annual;
  const q = Math.round;
  const useful = a.direct_kwh + a.battery_discharge_solar_kwh;
  const credit = ref.virtual_credit;
  const pct = (x) => x == null ? null : q(x * 100);
  const coverage = pct(ref.ratios.solar_coverage);
  const utilization = pct(ref.ratios.useful_pv_utilization);
  const m = (key) => ref.monthly.map((r) => r[key]);
  const fr = vm.fullReport;
  if(ref.daily_average) Object.assign(fr.p5, {
    production_kw:ref.daily_average.production_kwh,consommation_kw:ref.daily_average.consumption_kwh,
    batterie_kw:ref.daily_average.battery_discharge_solar_kwh,direct_kw:ref.daily_average.direct_kwh,
    profile_notes:{production:`Moyenne des ${(ref.validation?.hourly_periods??ref.calendar?.length??8760)/24} jours de simulation, par heure ${ref.version==="ac-energy-ledger-1"?"UTC (historique)":"Europe/Paris"} ; journée illustrative.`,consumption:"Même série horaire que les bilans ; les moyennes des flux directs sont calculées avant agrégation."},
  });
  if(fr.p1?.p1_auto) Object.assign(fr.p1.p1_auto,{p1_m_auto:coverage==null?"—":`${coverage} %`,p1_k_autonomie:coverage==null?"—":`${coverage} %`});
  vm.results_reference = ref;
  vm.meta.results_hash = ref.input_hash;
  vm.meta.results_version = ref.version;
  vm.production.annualProductionKwh = a.production_kwh;
  vm.production.monthlyProduction = m("production_kwh");
  vm.savings.selfConsumptionRate = utilization;
  vm.savings.autonomyRate = coverage;
  vm.savings.gridImportBefore = a.consumption_kwh;
  vm.savings.gridImportAfter = a.grid_to_load_kwh;
  Object.assign(fr.p3.energy_summary, {
    production_kwh:q(a.production_kwh), consumption_kwh:q(a.consumption_kwh),
    solar_used_kwh:q(useful), direct_self_consumption_kwh:q(a.direct_kwh),
    exported_kwh:q(a.physical_export_kwh), grid_import_kwh:q(a.grid_to_load_kwh),
    surplus_creditable_kwh:credit ? q(credit.credited_kwh) : null,
    coverage_pct:coverage,pv_self_consumption_pct:utilization,
  });
  Object.assign(fr.p4, {
    production_kwh:m("production_kwh"), consommation_kwh:m("consumption_kwh"),
    autoconso_kwh:ref.monthly.map(r=>r.direct_kwh+r.battery_discharge_solar_kwh),
    solar_covered_kwh:ref.monthly.map(r=>r.direct_kwh+r.battery_discharge_solar_kwh),
    direct_pv_kwh:m("direct_kwh"), surplus_kwh:m("physical_export_kwh"), batterie_kwh:m("battery_discharge_solar_kwh"),
    production_annuelle:q(a.production_kwh),consommation_annuelle:q(a.consumption_kwh),
    energie_consommee_directement:q(a.direct_kwh),energie_solaire_valorisee:q(useful),
    energie_solaire_utilisee_avec_credit_kwh:q(useful+(credit?.used_kwh??0)),reste_reseau_kwh:q(a.grid_to_load_kwh),
    energie_injectee:q(a.physical_export_kwh),taux_autoconsommation_pct:utilization,couverture_besoins_pct:coverage,autonomie_pct:coverage,
    surplus_brut_kwh:q(a.production_kwh-a.direct_kwh),restitution_batterie_kwh:q(a.battery_discharge_solar_kwh),
    charge_batterie_kwh:q(a.battery_charge_solar_kwh),pertes_batterie_kwh:q(a.storage_losses_kwh),
    variation_stock_kwh:q(a.stock_change_kwh),roundtrip_efficiency:ref.battery?.roundtrip_efficiency ?? null,
    storage_legend_label: "Restitution solaire", storage_legend_sublabel: "batterie physique",
    credit_virtuel_utilise_kwh: credit ? q(credit.used_kwh) : null,
  });
  const scenarioMonthlyForP6 = Array.isArray(scenario?.energy?.monthly) ? scenario.energy.monthly.slice(0, 12) : [];
  const virtualMonthlyFallback = scenarioMonthlyForP6.length === 12
    ? scenarioMonthlyForP6.map(r => Number(r.virtual_battery_discharge_kwh ?? r.used_credit_kwh ?? r.used_credit) || 0)
    : Array(12).fill(0);
  const hasVirtualMonthlyFallback = virtualMonthlyFallback.some(v => v > 0);
  const physicalMonthlyBase = m("battery_discharge_solar_kwh").map(v => Number(v) || 0);
  Object.assign(fr.p6.p6, {
    dir:m("direct_kwh"),
    bat:physicalMonthlyBase.map((v,i) => v + (hasVirtualMonthlyFallback ? virtualMonthlyFallback[i] : 0)),
    grid:m("grid_to_load_kwh").map((v,i) => Math.max(0, (Number(v) || 0) - (hasVirtualMonthlyFallback ? virtualMonthlyFallback[i] : 0))),
    tot:m("consumption_kwh"),
    is_virtual_credit_scenario:hasVirtualMonthlyFallback,
    totals:{solar_coverage_pct:ref.ratios.solar_coverage==null?null:ref.ratios.solar_coverage*100,useful_pv_pct:ref.ratios.useful_pv_utilization==null?null:ref.ratios.useful_pv_utilization*100,conso_kwh:a.consumption_kwh,solar_used_kwh:useful,grid_import_kwh:a.grid_to_load_kwh,production_kwh:a.production_kwh,overflow_export_kwh:a.physical_export_kwh},
  });
  const consumptionPct = reconcilePercentParts([a.direct_kwh,a.battery_discharge_solar_kwh,a.grid_to_load_kwh]);
  const productionPct = reconcilePercentParts([a.direct_kwh,a.battery_charge_solar_kwh,a.physical_export_kwh+a.curtailment_kwh]);
  Object.assign(fr.p7, {
    pct:{c_pv_pct:consumptionPct[0],c_bat_pct:consumptionPct[1],c_grid_pct:consumptionPct[2],p_auto_pct:productionPct[0],p_bat_pct:productionPct[1],p_surplus_pct:productionPct[2]},
    c_grid:q(a.grid_to_load_kwh),p_surplus:q(a.physical_export_kwh),curtailment_kwh:q(a.curtailment_kwh),
    p_surplus_valorise:q(a.battery_discharge_solar_kwh),
    energy_solar_used_direct_kwh:q(a.direct_kwh),energy_solar_used_kwh:q(useful),
    energy_grid_import_kwh:q(a.grid_to_load_kwh),solar_coverage_pct:ref.ratios.solar_coverage == null ? null : ref.ratios.solar_coverage*100,
    consumption_kwh:q(a.consumption_kwh),production_kwh:q(a.production_kwh),autoconsumption_kwh:q(useful),
    captured_pv_pct:pct(ref.ratios.captured_pv_before_storage_losses),useful_pv_pct:utilization,
    is_virtual_credit_scenario:false,is_storage_scenario:!!ref.battery,
    storage_label:"Entrée batterie",storage_long_label:"batterie physique",
  });
  // Virtual credit remains a separate accounting page; the physical diagrams above
  // always retain real grid withdrawals and physical injections.
  if (credit) {
    fr.p7.virtual_credit_accounting = credit;
    // Use chronological credit withdrawals, never annual credit spread over months.
    const months = credit.monthly;
    if (Array.isArray(months) && months.length === 12 && months.every(r => Number.isFinite(r.used_credit) && r.used_credit >= 0)) {
      const used = months.map(r => r.used_credit);
      const total = used.reduce((s, v) => s + v, 0);
      if (Math.abs(total - credit.used_kwh) > 0.01 || used.some((v,i) => v > ref.monthly[i].grid_to_load_kwh + 0.01)) throw new Error("PDF_VIRTUAL_CREDIT_MONTHLY_MISMATCH");
      const physicalMonthly = ref.monthly.map(r => Number(r.battery_discharge_solar_kwh) || 0);
      const storageMonthly = used.map((v, i) => physicalMonthly[i] + v);
      Object.assign(fr.p6.p6, {
        dir: ref.monthly.map(r => Number(r.direct_kwh) || 0),
        bat: storageMonthly,
        grid: ref.monthly.map((r,i) => Math.max(0, (Number(r.grid_to_load_kwh) || 0) - used[i])),
        is_virtual_credit_scenario: true,
        totals: { ...fr.p6.p6.totals, is_virtual_credit_scenario: true,
          solar_used_kwh: useful + credit.used_kwh, grid_import_kwh: Math.max(0,a.grid_to_load_kwh-credit.used_kwh),
          solar_coverage_pct: a.consumption_kwh > 0 ? (useful+credit.used_kwh)/a.consumption_kwh*100 : null,
          credit_used_kwh: credit.used_kwh },
      });
    }
    const hourly = credit.hourly_used_kwh ?? scenario.virtual_battery_8760?.virtual_battery_hourly_discharge_kwh ?? scenario._virtualBattery8760?.virtual_battery_hourly_discharge_kwh;
    if (Array.isArray(hourly) && hourly.length === (ref.validation?.hourly_periods??ref.calendar?.length??8760) && hourly.every(v => Number.isFinite(v) && v >= 0)) {
      if (Math.abs(hourly.reduce((s,v)=>s+v,0)-credit.used_kwh)>0.01) throw new Error("PDF_VIRTUAL_CREDIT_HOURLY_MISMATCH");
      const parts=ref.version==="ac-energy-ledger-1"?null:calendarParts(ref.calendar??calendarForLength(hourly.length));
      fr.p5.credit_kw = Array.from({length:24},(_,h)=>hourly.reduce((s,v,i)=>(parts?.[i].hour??i%24)===h?s+v:s,0)/(hourly.length/24));
    }
    for(const key of ["p7_virtual_battery","p7_hybrid_battery"]){
      const page=fr[key];if(!page)continue;
      const billed=a.grid_to_load_kwh-credit.used_kwh, accounted=useful+credit.used_kwh;
      if(page.max_theoretical) Object.assign(page.max_theoretical,{production_kwh:a.production_kwh,consumption_kwh:a.consumption_kwh});
      page.limits=["Le solaire local et le crédit comptable sont deux flux distincts.","Le crédit utilisable dépend de sa disponibilité chronologique, de la capacité contractuelle et du report paramétré.",`Solde de crédit à la clôture : ${Math.round(credit.closing_kwh).toLocaleString("fr-FR")} kWh.`];
      Object.assign(page.kpis??(page.kpis={}),{energy_solar_used_kwh:accounted,energy_grid_import_kwh:billed,solar_coverage_pct:a.consumption_kwh>0?accounted/a.consumption_kwh*100:null,overflow_export_kwh:credit.overflow_kwh ?? 0});
      Object.assign(page.with_virtual_battery??(page.with_virtual_battery={}),{pv_total_used_kwh:accounted,battery_discharged_kwh:credit.used_kwh,grid_import_kwh:billed,autonomie_ratio:a.consumption_kwh>0?accounted/a.consumption_kwh:null});
      page.subtitle="Comptabilité du crédit virtuel : les kWh repris restent physiquement prélevés au réseau, sans décharge locale.";
    }
  }
  fr.p10.best.annual_production_kwh=q(a.production_kwh);
  fr.p10.best.autoprod_pct=utilization;
  fr.p10.best.autonomy_pct=coverage;
  vm.consumption_source_label=ref.provenance?.label ?? "Source : profil horaire de simulation ; provenance détaillée à confirmer";
  return vm;
}
