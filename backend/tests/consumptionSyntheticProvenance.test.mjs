import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadConsumption } from '../services/consumptionService.js';
import { mapScenarioToV2 } from '../services/scenarioV2Mapper.service.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Golden hashes captured before the provenance-only correction: every hourly and
// monthly kWh value must remain bit-for-bit identical, not just the annual total.
for (const [mode, annual, months, hourlyHash, monthlyHash, resolution, publicSource] of [
  ['annuelle',5000,undefined,'3de58abd1fac8b8978e80165b83ab2ec2ef53b691e49527a790c5c34b754981f','6b41b15281161208b64e4c5aa9a3c78329fbf468ec4b004e7971987720985eaf','year','ANNUAL_SYNTHETIC'],
  ['mensuelle',6000,Array.from({length:12},(_,i)=>225+i*50),'30c4e8f3a84da015216df26d7c2d563520bf328497cd24056cc09bcbfc7e06d7','07e22d4a35ed150a7fbba19d87781dea049ae45c7bf6c4a6cd5fd19eb51250e4','month','MONTHLY_SYNTHETIC'],
]) {
  test(`${mode}: reconstructed source is explicit, all kWh are unchanged`, () => {
    const out=loadConsumption({meter_consumption_authoritative:true,mode,annuelle_kwh:annual,mensuelle:months,
      provenance:{source:null,label:'Source : profil horaire fourni ; origine et résolution initiale à confirmer',measured_hourly:false,reconstructed:false}});
    assert.equal(out.annual_kwh,annual);assert.equal(hash(out.hourly),hourlyHash);assert.equal(hash(out.monthly_kwh_ref),monthlyHash);
    assert.equal(out.engine_consumption_source,'SYNTHETIC_MANUAL_PROFILE');assert.equal(out.provenance.source,publicSource);
    assert.equal(out.provenance.measured_hourly,false);assert.equal(out.provenance.reconstructed,true);
    assert.equal(out.provenance.input_resolution,resolution);assert.match(out.provenance.label,/profil horaire reconstruit/);
    const scenario=mapScenarioToV2({name:'BASE'},{meta:{consumption_source_mode:out.consumption_source_mode,consumption_provenance:out.provenance}});
    assert.equal(scenario.consumption_source,publicSource);
  });
}

test('an actually supplied hourly curve retains its import provenance and kWh', () => {
  const hourly=Array(8760).fill(1),provenance={source:'R65_DAILY_REBUILT',label:'Source : R65 ; profil horaire reconstruit',reconstructed:true,measured_hourly:false,input_resolution:'day'};
  const out=loadConsumption({meter_consumption_authoritative:true,mode:'annuelle',annuelle_kwh:8760,hourly,provenance});
  assert.deepEqual(out.hourly,hourly);assert.equal(out.engine_consumption_source,'PROFILE_8760_PREBUILT');
  for(const [key,value] of Object.entries(provenance))assert.equal(out.provenance[key],value);
});
