import { computeFinance } from "../services/financeService.js";
import { computeVirtualBatteryP2Finance } from "../services/virtualBatteryP2Finance.service.js";

const PRICE=0.195, PROD=9114, CONSO=10200, KWC=8.3, KVA=9, OA=0.011;
const PV_CAPEX_TTC=12360, BATT_TTC=4000;
const baseAuto=2930, baseImport=CONSO-baseAuto, baseSurplus=PROD-baseAuto;
const physAuto=6065, physImport=CONSO-physAuto, physSurplus=PROD-physAuto, physDischarge=physAuto-baseAuto;
const virtImport=1084, virtDischarge=(CONSO-virtImport)-baseAuto;
const hybBillable=1241, hybVirtDischarge=physImport-hybBillable;
const mk=(d,i)=>({virtual_battery_total_discharged_kwh:d,virtual_battery_overflow_export_kwh:0,grid_import_kwh:i,virtual_battery_hourly_discharge_kwh:new Array(8760).fill(0)});
const vf=(d,i)=>computeVirtualBatteryP2Finance({providerCode:"URBAN_SOLAR",contractType:"BASE",installedKwc:KWC,meterKva:KVA,vbSim:mk(d,i),unboundedRequiredCapacityKwh:50,hourlyDischargeKwh:new Array(8760).fill(0),hphcHourlyIsHp:null,tariffElectricityPerKwh:PRICE,oaRatePerKwh:OA,virtual_battery_settings:null}).virtual_battery_finance;
const ctx={form:{params:{tarif_kwh:PRICE},economics:{horizon_years:25,elec_growth_pct:3,pv_degradation_pct:0.5,battery_degradation_pct:2,oa_rate_lt_9:OA,oa_rate_gte_9:OA,prime_lt9:0,prime_gte9:0,maintenance_pct:1,onduleur_year:15,onduleur_cost_pct:10},pv_inverter:{type:"string"}},finance_input:{capex_ttc:PV_CAPEX_TTC,battery_physical_price_ttc:BATT_TTC},settings:{}};
const E=o=>({production_kwh:PROD,consumption_kwh:CONSO,...o});
const scenarios={
 BASE:{_v2:true,name:"BASE",kwc:KWC,prod_kwh:PROD,conso_kwh:CONSO,auto_kwh:baseAuto,surplus_kwh:baseSurplus,import_kwh:baseImport,energy:E({autoconsumption_kwh:baseAuto,surplus:baseSurplus,import_kwh:baseImport,energy_grid_import_kwh:baseImport})},
 BATTERY_PHYSICAL:{_v2:true,name:"BATTERY_PHYSICAL",kwc:KWC,prod_kwh:PROD,conso_kwh:CONSO,auto_kwh:physAuto,surplus_kwh:physSurplus,import_kwh:physImport,battery:{annual_discharge_kwh:physDischarge},energy:E({autoconsumption_kwh:physAuto,surplus:physSurplus,import_kwh:physImport,energy_grid_import_kwh:physImport})},
 BATTERY_VIRTUAL:{_v2:true,name:"BATTERY_VIRTUAL",kwc:KWC,prod_kwh:PROD,conso_kwh:CONSO,auto_kwh:baseAuto,surplus_kwh:baseSurplus,import_kwh:virtImport,billable_import_kwh:virtImport,virtual_battery_finance:vf(virtDischarge,virtImport),_virtualBattery8760:{virtual_battery_overflow_export_kwh:0},energy:E({autoconsumption_kwh:baseAuto,surplus:baseSurplus,import_kwh:virtImport,billable_import_kwh:virtImport,virtual_battery_overflow_export_kwh:0})},
 BATTERY_HYBRID:{_v2:true,name:"BATTERY_HYBRID",kwc:KWC,prod_kwh:PROD,conso_kwh:CONSO,auto_kwh:physAuto+hybVirtDischarge,surplus_kwh:0,import_kwh:hybBillable,billable_import_kwh:hybBillable,battery:{annual_discharge_kwh:physDischarge},virtual_battery_finance:vf(hybVirtDischarge,hybBillable),_virtualBattery8760:{virtual_battery_overflow_export_kwh:0},energy:E({autoconsumption_kwh:physAuto+hybVirtDischarge,surplus:0,import_kwh:hybBillable,billable_import_kwh:hybBillable,physical_auto_kwh:physAuto,physical_grid_import_kwh:physImport,physical_grid_export_kwh:physSurplus,virtual_battery_overflow_export_kwh:0})},
};
const out=await computeFinance(ctx,scenarios);
const r=k=>{const s=out.scenarios[k];return{capex:s.capex_ttc,eco_an1:s.economie_an1,cashflow_an1:Math.round(s.flows?.[0]?.total_eur),eco_25a:Math.round(s.economie_25a)};};
console.log("OA =",OA,"€/kWh");
for(const k of ["BASE","BATTERY_PHYSICAL","BATTERY_VIRTUAL","BATTERY_HYBRID"]) console.log(k.padEnd(18), r(k));
const v=r("BATTERY_VIRTUAL"),h=r("BATTERY_HYBRID");
console.log("\nHYBRIDE - VIRTUEL  an1:",h.eco_an1-v.eco_an1,"€ | 25ans:",h.eco_25a-v.eco_25a,"€ | batterie TTC:",BATT_TTC);
