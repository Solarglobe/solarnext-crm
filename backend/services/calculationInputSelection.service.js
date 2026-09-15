import { ORG_ECONOMICS_NUMERIC_KEYS } from '../config/orgEconomics.common.js';
import { vbGetSegmentRow } from './pv/virtualBatteryGridResolve.service.js';
import { computeProjectEconomicTotalsFromConfig } from './projectEconomicTotals.service.js';
import { resolveUrbanSolarTariffsForDate } from '../../shared/urbanSolarVirtualBatteryTariffs2026.js';
import { resolveCurrentMeterOffPeakPeriods } from './economicsResolve.service.js';

export const pickCalculationFields = (value,keys) => Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const pick=pickCalculationFields;
export function selectedVirtualProvider(quote={},options={}) {
 const config=quote.virtualBattery ?? quote.battery_virtual ?? quote.batteries?.virtual ?? quote.virtual_battery ?? options.batterie_virtuelle;
 if(!config || (!quote.virtualBattery && config.enabled===false))return null;
 return {provider:String(config.provider??config.provider_code??'').toUpperCase(),contractType:config.contractType??config.contract_type??'BASE',capacityKwh:config.capacityKwh??config.capacity_kwh,
  tariffReferenceDate:quote.virtualBattery?.tariff_reference_date??quote.battery_virtual?.tariff_reference_date??quote.batteries?.virtual?.tariff_reference_date??quote.virtual_battery?.tariff_reference_date??options.batterie_virtuelle?.tariff_reference_date??null};
}

/** Inputs consumed by the calculator, separate from the complete saved quote revision. */
export function selectQuoteCalculationValues(quote={}) {
 return {
  ...pick(quote,['capex_total_ttc','batteries','battery_physical','battery_virtual','battery','batterie','virtual_battery','virtualBattery','vehicleV2h','finance_projection','simulation_contract','electricity_contract','electricity_tariff_effective_date','tarif_kwh','economics','electrical_phase_decision']),
  totals:pick(quote.totals,['ht','tva','vat','ttc']),
  installer_cost:pick(quote.installer_cost,['final_total_ht_cents','final_total_vat_cents','final_total_ttc_cents','electrical_type']),
  financing:pick(quote.financing,['amount','duration_months','interest_rate_annual','taeg_pct','insurance_eur','application_fee_eur','other_costs_eur']),
 };
}

/** Presentation/export images and import logs never change energy or tariffs. */
export function selectEnergyProfile(profile) {
 if(!profile || typeof profile!=='object')return null;
 const result=pick(profile,['contract','current_contract','current_supplier_contract','supplier_contract','tariff','tariff_kwh','billing','summary','annual_kwh','source','provenance','hourly','monthly','monthly_kwh','calendar','phase_detection','off_peak_periods','hc_periods','plage_hc','parameters','params','quality','equipment']);
 if(profile.inputs)result.inputs=pick(profile.inputs,['tariff_kwh']);
 if(profile.engine)result.engine=pick(profile.engine,['hourly','calendar','annual_kwh','monthly_kwh','source','provenance','phase_detection','off_peak_periods','hc_periods','plage_hc','contract_summary','quality','source_mode','consumption_source_mode','engine_consumption_source','annual_source_label','period_start','period_end','timezone','grid_operator','estimated_share']);
 return result;
}

export function selectCalpinageSnapshot(snapshot) {
 if(!snapshot?.payload)return null;
 return {payload:pick(snapshot.payload,['panelSpec','panel','inverter','inverter_totals','pvParams','inverter_family'])};
}

export function selectGeometryCalculationValues(value) {
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(selectGeometryCalculationValues);
 const irrelevant=new Set(['screenshot','screenshot_data_url','preview','preview_image','thumbnail','canvasDataUrl','imageDataUrl','lastSavedAt','updated_at','created_at','uiState','camera','cameraState','selectedPanelId','selectedPanId','history','undoStack','redoStack','notes']);
 return Object.fromEntries(Object.entries(value).filter(([key])=>!irrelevant.has(key)).map(([key,v])=>[key,selectGeometryCalculationValues(v)]));
}

export function selectSettingsCalculationValues(settings={},quote={},meter={},options={}) {
 const provider=selectedVirtualProvider(quote,options),pv=settings.pv??{};
 const economics=pick(settings.economics,ORG_ECONOMICS_NUMERIC_KEYS);
 // A default overridden by an explicit study assumption is not a dependency.
 if(quote.finance_projection?.horizon_years!=null)delete economics.horizon_years;
 if(quote.finance_projection?.maintenance_pct!=null)delete economics.maintenance_pct;
 if(quote.finance_projection?.inverter_replacements!=null){delete economics.onduleur_year;delete economics.onduleur_cost_pct;}
 const grid=pv.virtual_battery;
 let selectedGrid=null;
 if(provider?.provider) {
  const source=grid?.providers?.[provider.provider];
  const row=vbGetSegmentRow(grid,provider.provider,provider.contractType,Number(meter.meter_power_kva)||9);
  selectedGrid={provider:provider.provider,contractType:provider.contractType,
   row:row?pick(row,['enabled','abonnement_per_kwc_month','abonnement_fixed_month_ttc','abonnement_fixed_month','abonnement_includes_contribution','contribution_eur_per_year']):null,
   ...(provider.provider==='MYLIGHT_MYSMARTBATTERY'?{
    capacityTiers:source?.capacityTiers?.map(tier=>pick(tier,['kwh','abonnement_month_ht']))??null,
    contributionRule:pick(source?.contributionRule,['a','b']),
   }:{}),
   // Builder uses imported current hours first, then this organisation fallback.
   off_peak_periods:resolveCurrentMeterOffPeakPeriods(meter.energy_profile)??grid?.off_peak_periods??null};
  if(provider.provider==='URBAN_SOLAR') {
   const edition=resolveUrbanSolarTariffsForDate(provider.tariffReferenceDate);
   selectedGrid.published=edition?{
    ...pick(edition,['id','effectiveDate','oneTimeSetupFeeTtc','storageSubscriptionEurPerKwcMonthHt','autoproducerContributionEurPerYearHt','supplierSubscriptionIncludesAutoproducerContribution','restitutionTaxTreatment']),
    restitution_ttc:pick(edition.restitutionTtcPerKwh,provider.contractType==='HPHC'?['hp','hc']:['base']),
    restitution_htt:pick(edition.restitutionHttPerKwh,provider.contractType==='HPHC'?['hp','hc']:['base']),
   }:null;
  }
 }
 const hasQuotePrice=computeProjectEconomicTotalsFromConfig(quote).project.ttc>0 || Number(quote.capex_total_ttc)>0;
 return {economics,
  pricing:hasQuotePrice?{}:pick(settings.pricing,['kit_panel_power_w','kit_price_lt_4_5','kit_price_gt_4_5','coffret_mono_ht','coffret_tri_ht','install_tiers','battery_unit_price_ht','battery_atmoce_unit_price_ht']),
  // Legacy pvtech/components values and database/version labels are no longer
  // consumed: those coefficients and API versions are defined by the engine.
  pv:{...pick(pv,['pvgis_reference_year']),virtual_battery:selectedGrid},
 };
}

export const CALCULATION_CATALOG_FIELDS={
 pv_panels:['id','active','power_wc','width_mm','height_mm','temp_coeff_pct_per_deg','degradation_annual_pct','degradation_first_year_pct','voc_v','isc_a','vmp_v'],
 pv_inverters:['id','active','inverter_type','inverter_family','nominal_power_kw','nominal_va','phases','mppt_count','inputs_per_mppt','modules_per_inverter','euro_efficiency_pct','max_dc_power_kw','max_input_current_a','mppt_min_v','mppt_max_v'],
 pv_batteries:['id','active','usable_kwh','nominal_voltage_v','max_charge_kw','max_discharge_kw','roundtrip_efficiency_pct','depth_of_discharge_pct','cycle_life','chemistry','scalable','max_modules','max_system_charge_kw','max_system_discharge_kw'],
};
