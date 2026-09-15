import {bindCalendar,getCalendar,monthlySums} from './energyCalendar.service.js';
import {simulateBattery8760} from './batteryService.js';
import {simulateVirtualBattery8760} from './virtualBattery8760.service.js';
import {priceElectricitySeries} from './scenarioElectricityBilling.service.js';
const sum=xs=>xs.reduce((a,b)=>a+b,0);
/** Pure annual replay: finance supplies ageing/replacement factors and real credit
 * opening balances. No DB, external calls, or hidden tariff assumptions. */
export function simulateAnnualScenarioEnergy(input,{year=1,pv_factor=1,battery_factor=1,initial_credit_kwh=null,initial_credit_lots=null}={}) {
  const calendar=input.calendar??getCalendar(input.conso_hourly);
  const uncut=input.pv_unclipped_hourly??input.pv_hourly;
  const cap=input.pv_unclipped_hourly&&Number(input.inverter_nominal_kw_total)>0?Number(input.inverter_nominal_kw_total):Infinity;
  const pv=bindCalendar(uncut.map(v=>Math.min(cap,v*pv_factor)),calendar);
  const load=bindCalendar(input.conso_hourly.slice(),calendar);
  const physical=['BATTERY_PHYSICAL','BATTERY_HYBRID'].includes(input.scenario_id);
  const virtual=['BATTERY_VIRTUAL','BATTERY_HYBRID'].includes(input.scenario_id);
  let battery=null;
  if(physical) {
    const config={...input.battery,enabled:true,capacity_kwh:Number(input.battery.capacity_kwh)*battery_factor};
    if(config.initial_soc_kwh!=null)config.initial_soc_kwh*=battery_factor;
    battery=simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:config});
    if(!battery.ok)throw new Error(`ANNUAL_BATTERY_${battery.reason}`);
  }
  const direct=pv.map((v,i)=>Math.min(v,load[i]));
  const auto=bindCalendar(battery?.auto_hourly??direct,calendar);
  const rawSurplus=battery?.surplus_hourly??pv.map((v,i)=>v-direct[i]);
  const limit=input.injection_limit_kw;
  const surplus=bindCalendar(rawSurplus.map(v=>limit==null?v:Math.min(v,limit)),calendar);
  let imports=bindCalendar(load.map((v,i)=>Math.max(0,v-auto[i])),calendar);
  let vb=null;
  if(virtual) {
    vb=simulateVirtualBattery8760({pv_hourly:surplus,conso_hourly:imports,config:{...input.virtual_battery_input,calendar,
      credit_month_offset:(year-1)*12,initial_credit_lots:initial_credit_lots??input.virtual_battery_input?.initial_credit_lots,
      initial_credit_kwh:initial_credit_kwh??input.virtual_battery_input?.initial_credit_kwh??0}});
    if(!vb.ok)throw new Error(`ANNUAL_VIRTUAL_${vb.reason}`);
    imports=bindCalendar(vb.virtual_battery_hourly_grid_import_kwh,calendar);
  }
  const contract=input.scenario_contract??input.current_contract;
  let purchase=priceElectricitySeries(imports,contract);
  if(vb?.commercial_ledger&&contract?.contract_type==='HPHC') purchase=vb.commercial_ledger.billable_hp_kwh*contract.price_hp_eur_kwh+vb.commercial_ledger.billable_hc_kwh*contract.price_hc_eur_kwh;
  const rates=input.restitution??{};
  const used=vb?.virtual_battery_total_discharged_kwh??0;
  let fee=0;
  if(virtual&&used>0) {
    if(vb.commercial_ledger&&contract?.contract_type==='HPHC') fee=vb.commercial_ledger.used_hp_kwh*(rates.rate_hp_ttc??0)+vb.commercial_ledger.used_hc_kwh*(rates.rate_hc_ttc??0);
    else if(contract?.contract_type==='HPHC') fee=priceElectricitySeries(vb.virtual_battery_hourly_discharge_kwh,{...contract,price_hp_eur_kwh:rates.rate_hp_ttc??rates.effective_rate_ttc??0,price_hc_eur_kwh:rates.rate_hc_ttc??rates.effective_rate_ttc??0});
    else fee=used*(rates.rate_base_ttc??rates.effective_rate_ttc??0);
  }
  return {year,prod_kwh:sum(pv),auto_kwh:sum(auto),physical_discharge_kwh:battery?.annual_discharge_kwh??0,
    surplus_kwh:virtual?vb.virtual_battery_overflow_export_kwh:sum(surplus),physical_export_kwh:sum(surplus),
    used_credit_kwh:used,virtual_credit_end_kwh:vb?.virtual_battery_credit_end_kwh??0,virtual_credit_expired_kwh:vb?.commercial_ledger?.expired_kwh??0,
    virtual_cashout_eur:vb?.commercial_ledger?.cashout_eur??0,virtual_credit_end_lots:vb?.commercial_ledger?.closing_lots??null,billable_import_kwh:sum(imports),
    physical_import_kwh:sum(load)-sum(auto),battery_losses_kwh:battery?.battery_losses_kwh??0,
    scenario_energy_purchase_at_initial_rates:purchase,virtual_restitution_cost_at_initial_rates:fee,
    current_auto_value_at_initial_rates:priceElectricitySeries(auto,input.current_contract),
    current_credit_value_at_initial_rates:vb?priceElectricitySeries(vb.virtual_battery_hourly_discharge_kwh,input.current_contract):0,
    monthly_production_kwh:monthlySums(pv),commercial_ledger:vb?.commercial_ledger??null};
}
