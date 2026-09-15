import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../services/calculationFingerprint.service.js';
import {selectQuoteCalculationValues,selectEnergyProfile,selectSettingsCalculationValues,selectGeometryCalculationValues,selectedVirtualProvider} from '../services/calculationInputSelection.service.js';

test('quote revision can change without invalidating numerical inputs',()=>{
 const quote={totals:{ht:10000,ttc:12000},conditions:'A',items:[{label:'Panneau'}],finance_projection:{horizon_years:25}};
 const changed={...quote,conditions:'B',items:[{label:'Panneau renommé'}]};
 assert.notEqual(fingerprint(quote),fingerprint(changed));
 assert.equal(fingerprint(selectQuoteCalculationValues(quote)),fingerprint(selectQuoteCalculationValues(changed)));
 assert.notEqual(fingerprint(selectQuoteCalculationValues(quote)),fingerprint(selectQuoteCalculationValues({...quote,totals:{ht:11000,ttc:13200}})));
});

test('selected provider edition, option and kVA alone determine tariff dependencies',()=>{
 const quote={totals:{ttc:15000},virtualBattery:{provider:'URBAN_SOLAR',contractType:'HPHC',tariff_reference_date:'2026-09-15'}};
 const settings={economics:{elec_growth_pct:5},pv:{virtual_battery:{providers:{URBAN_SOLAR:{segments:{PARTICULIER_HPHC:{rowsByKva:{9:{enabled:true,abonnement_fixed_month_ttc:21.48},18:{enabled:true,abonnement_fixed_month_ttc:35.68}}}}},MYLIGHT_MYBATTERY:{anything:12}}}}};
 const select=s=>selectSettingsCalculationValues(s,quote,{meter_power_kva:18});
 const baseline=select(settings),changed=structuredClone(settings);
 changed.pv.virtual_battery.providers.MYLIGHT_MYBATTERY.anything=999;
 changed.pv.virtual_battery.providers.URBAN_SOLAR.segments.PARTICULIER_HPHC.rowsByKva[9].abonnement_fixed_month_ttc=1000;
 changed.pv.virtual_battery.providers.URBAN_SOLAR.segments.PARTICULIER_HPHC.rowsByKva[18].notes='Only a comment';
 changed.pvtech={system_yield_pct:99};changed.components={standard_loss_pct:99};
 changed.pv.pvgis_database='Unused label';changed.pv.pvgis_version='Unused version';
 assert.equal(fingerprint(baseline),fingerprint(select(changed)));
 assert.equal(baseline.pv.virtual_battery.published.id,'URBAN_SOLAR_PARTICULIER_2026_08_01');
 assert.deepEqual(baseline.pv.virtual_battery.published.restitution_ttc,{hp:.1122,hc:.0945});
 assert.equal(selectedVirtualProvider(quote).tariffReferenceDate,'2026-09-15');
 changed.pv.virtual_battery.providers.URBAN_SOLAR.segments.PARTICULIER_HPHC.rowsByKva[18].abonnement_fixed_month_ttc=1000;
 assert.notEqual(fingerprint(baseline),fingerprint(select(changed)));
});

test('organisation HC fallback is a dependency only when imported current hours are missing',()=>{
 const quote={virtualBattery:{provider:'URBAN_SOLAR',contractType:'HPHC'}};
 const settings={pv:{virtual_battery:{off_peak_periods:[{start:'23:00',end:'07:00'}]}}};
 const changed=structuredClone(settings);changed.pv.virtual_battery.off_peak_periods=[{start:'12:00',end:'20:00'}];
 assert.notEqual(fingerprint(selectSettingsCalculationValues(settings,quote)),fingerprint(selectSettingsCalculationValues(changed,quote)));
 const meter={energy_profile:{contract:{off_peak_periods:[{start:'22:30',end:'06:30'}]}}};
 assert.equal(fingerprint(selectSettingsCalculationValues(settings,quote,meter)),fingerprint(selectSettingsCalculationValues(changed,quote,meter)));
});

test('profile tariff aliases, current HC window and measurement provenance remain dependencies',()=>{
 const profile={tariff_kwh:.2,inputs:{tariff_kwh:.19,import_log:'ignored'},contract:{off_peak_periods:[{start:'22:30',end:'06:30'}]},engine:{contract_summary:'HP/HC (22H30-6H30)',engine_consumption_source:'MEASURED_HOURLY',period_start:'2025-01-01',period_end:'2025-12-31',hourly:[1,2]},raw_csv:'large ignored document'};
 const selected=selectEnergyProfile(profile);
 assert.equal(selected.tariff_kwh,.2);assert.deepEqual(selected.inputs,{tariff_kwh:.19});
 assert.equal(selected.engine.engine_consumption_source,'MEASURED_HOURLY');
 assert.equal(selected.engine.contract_summary,'HP/HC (22H30-6H30)');assert.equal(selected.raw_csv,undefined);
 for(const field of ['contract_summary','engine_consumption_source','period_start','period_end']){
  const changed=structuredClone(profile);changed.engine[field]='changed';
  assert.notEqual(fingerprint(selected),fingerprint(selectEnergyProfile(changed)),field);
 }
});

test('preview and display state are not roof dependencies, obstacle geometry is',()=>{
 const geometry={pans:[{azimuth:90,obstacles:[{height:2}]}],preview:'image',camera:{zoom:5}};
 assert.deepEqual(selectGeometryCalculationValues({...geometry,preview:'new',camera:{zoom:10}}),selectGeometryCalculationValues(geometry));
 const changed=structuredClone(geometry);changed.pans[0].obstacles[0].height=3;
 assert.notEqual(fingerprint(selectGeometryCalculationValues(changed)),fingerprint(selectGeometryCalculationValues(geometry)));
});
