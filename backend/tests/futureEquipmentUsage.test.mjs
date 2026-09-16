import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFutureEquipment } from '../../shared/equipmentEnergy.js';
import { applyEquipmentShape } from '../services/consumptionService.js';
import { validateEquipmentJsonbField } from '../services/equipmentPayloadValidate.js';
const ve = { id:'ve',kind:'ve',energy_model:'usage_v3',annual_km:15000,vehicle_kwh_100km:18,home_charge_pct:80,charge_loss_pct:10 };
const pac = { id:'pac',kind:'pac',energy_model:'usage_v3',pac_type:'air_eau',season_mode:'heating',heating_estimate_mode:'thermal',heating_thermal_kwh:12000,scop:4,replaces:'electric',replaced_electric_kwh:6000 };
const base = () => ({ annual_kwh:9000, hourly:Array(8760).fill(9000/8760) });
const run = items => applyEquipmentShape(base(),{equipements_a_venir:{schemaVersion:2,items}},true);
test('VE uses distance, home fraction and explicit losses; zero stays zero',()=>{
  assert.equal(estimateFutureEquipment(ve).added_kwh,2400);
  for(const field of ['annual_km','home_charge_pct']) assert.equal(estimateFutureEquipment({...ve,[field]:0}).added_kwh,0);
  assert.equal(estimateFutureEquipment({...ve,charge_loss_pct:0}).added_kwh,2160);
});
test('replacement reduces measured base and preserves hourly conservation',()=>{
  const out=run([pac]); assert.equal(out.annual_kwh,6000);
  assert.ok(Math.abs(out.hourly.reduce((a,b)=>a+b,0)-6000)<1e-6);
  assert.ok(out.hourly.every(n=>n>=0));
  assert.equal(out.equipment_impact.removed_kwh,6000);
  assert.equal(run([pac,ve]).annual_kwh,8400);
  assert.equal(run([{...pac,replaces:'fuel'}]).annual_kwh,12000);
});
test('cooling only adds nothing in winter; disabled heating values ignored',()=>{
  const cool={...pac,pac_type:'air_air',season_mode:'cooling',replaces:'none',cooling_electric_kw:1,cooling_hours_day:4,cooling_days_month:20,cooling_months:3,cooling_start_month:6};
  assert.equal(estimateFutureEquipment(cool).added_kwh,240);
  const out=run([cool]); assert.equal(out.annual_kwh,9240);
  assert.ok(Math.abs(out.hourly.slice(0,24*31).reduce((a,b)=>a+b,0)-9000/365*31)<1e-7);
  assert.equal(estimateFutureEquipment({...cool,cooling_months:0}).added_kwh,0);
});
test('missing inputs, negative values, fractional months and excessive removal cannot simulate',()=>{
  assert.throws(()=>run([{...ve,annual_km:undefined}]),/incomplet/);
  assert.throws(()=>run([{...ve,annual_km:-1}]),/incomplet/);
  assert.throws(()=>run([{...pac,replaced_electric_kwh:10000}]),/dépasse/);
  assert.equal(validateEquipmentJsonbField({schemaVersion:2,items:[{...ve,home_charge_pct:101}]},'equipment').ok,false);
});
test('existing and disabled equipment never add future consumption',()=>{
  assert.equal(run([{...ve,enabled:false}]).annual_kwh,9000);
  const out=applyEquipmentShape(base(),{equipement_actuel_params:{schemaVersion:2,items:[ve]}},true);
  assert.equal(out.annual_kwh,9000);
});
test('documented heated area and thermal intensity produce electricity through SCOP',()=>{
  const item={...pac,heating_estimate_mode:'building',heated_area_m2:100,heating_need_kwh_m2:120};
  assert.equal(estimateFutureEquipment(item).added_kwh,3000);
  assert.equal(estimateFutureEquipment({...item,heated_area_m2:undefined}).complete,false);
});
test('sensitivity is explicit and never changes the central simulation',()=>{
  const e=estimateFutureEquipment({...ve,uncertainty_pct:20});
  assert.equal(e.delta_low_kwh,1920); assert.equal(e.delta_high_kwh,2880);
  assert.equal(run([{...ve,uncertainty_pct:20}]).annual_kwh,11400);
});
