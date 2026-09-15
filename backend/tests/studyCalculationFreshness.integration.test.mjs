import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { readStudyCalculationInputs, assertStudyCalculationCurrent } from '../services/studyCalculationFreshness.service.js';
import { CALC_ENGINE_VERSION } from '../services/calc/calc.constants.js';

test('actual SQL sources detect tariffs, profiles, quote, roof, hardware settings and preserve read-only history', async()=>{
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const org=(await client.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[`calc-audit-${randomUUID()}`])).rows[0].id;
    const stage=(await client.query("INSERT INTO pipeline_stages(organization_id,name,position,is_closed) VALUES($1,'Fixture',0,false) RETURNING id",[org])).rows[0].id;
    const lead=(await client.query("INSERT INTO leads(organization_id,stage_id,full_name,consumption_mode,consumption_annual_kwh) VALUES($1,$2,'Fixture calcul','ANNUAL',10000) RETURNING id",[org,stage])).rows[0].id;
    const meter=(await client.query("INSERT INTO lead_meters(organization_id,lead_id,name,is_default,consumption_mode,consumption_annual_kwh) VALUES($1,$2,'Compteur test',true,'ANNUAL',10000) RETURNING id",[org,lead])).rows[0].id;
    const study=(await client.query("INSERT INTO studies(organization_id,lead_id,study_number,status,current_version) VALUES($1,$2,$3,'draft',1) RETURNING id",[org,lead,`AUDIT-${randomUUID()}`])).rows[0].id;
    const version=(await client.query("INSERT INTO study_versions(organization_id,study_id,version_number,data_json) VALUES($1,$2,1,$3) RETURNING id",[org,study,{selected_meter_id:meter}])).rows[0].id;
    await client.query("INSERT INTO economic_snapshots(study_id,study_version_id,organization_id,version_number,status,config_json) VALUES($1,$2,$3,1,'DRAFT',$4)",[study,version,org,{capex_total_ttc:14960}]);
    await client.query('INSERT INTO calpinage_data(organization_id,study_version_id,geometry_json) VALUES($1,$2,$3)',[org,version,{pans:[{azimuth:90}]}]);
    const args={studyId:study,versionId:version,organizationId:org,db:client};
    const before=await readStudyCalculationInputs(args);
    await assert.rejects(assertStudyCalculationCurrent(args),{code:'INPUT_FINGERPRINT_MISSING'});
    await client.query("UPDATE study_versions SET data_json=data_json || $1::jsonb WHERE id=$2",[{calculation_trace:{input_fingerprint:before.input_fingerprint},scenarios_engine_version:CALC_ENGINE_VERSION,scenarios_v2:[{id:'BASE',finance:{economie_total:-100}}]},version]);
    await assertStudyCalculationCurrent(args);
    for(const [label,sql,values] of [
      ['annual bill','UPDATE lead_meters SET electricity_annual_bill_ttc=1955 WHERE id=$1',[meter]],
      ['explicit zero subscription','UPDATE lead_meters SET electricity_subscription_ttc_month=0 WHERE id=$1',[meter]],
      ['HP price','UPDATE lead_meters SET elec_price_hp_eur_kwh=.30 WHERE id=$1',[meter]],
      ['HC price','UPDATE lead_meters SET elec_price_hc_eur_kwh=.13 WHERE id=$1',[meter]],
      ['annual consumption','UPDATE lead_meters SET consumption_annual_kwh=9000 WHERE id=$1',[meter]],
      ['profile and provenance','UPDATE lead_meters SET energy_profile=$1 WHERE id=$2',[{engine:{hourly:[1,2],source:'R65_REBUILT'}},meter]],
      ['quote and finance','UPDATE economic_snapshots SET config_json=$1 WHERE study_version_id=$2',[{capex_total_ttc:15260,finance_projection:{horizon_years:30}},version]],
      ['injection contract','UPDATE study_versions SET data_json=data_json || $1::jsonb WHERE id=$2',[{simulation_contract:{injection_mode:'none'}},version]],
      ['study tariff override','UPDATE study_versions SET data_json=data_json || $1::jsonb WHERE id=$2',[{economics:{price_eur_kwh:.50}},version]],
      ['roof orientation','UPDATE calpinage_data SET geometry_json=$1 WHERE study_version_id=$2',[{pans:[{azimuth:270}]},version]],
      ['provider rules and default tariffs','UPDATE organizations SET settings_json=$1 WHERE id=$2',[{economics:{price_eur_kwh:.25},pv:{virtual_battery:{provider_code:'URBAN_SOLAR'}}},org]],
    ]){
      await client.query('SAVEPOINT source_change');await client.query(sql,values);
      await assert.rejects(assertStudyCalculationCurrent(args),{code:'CALCULATION_INPUTS_CHANGED'},label);
      await client.query('ROLLBACK TO SAVEPOINT source_change');
    }
    const versionBefore=(await client.query('SELECT data_json FROM study_versions WHERE id=$1',[version])).rows[0].data_json;
    await client.query('SAVEPOINT monthly_dependency');
    await client.query("UPDATE lead_meters SET consumption_mode='MONTHLY' WHERE id=$1",[meter]);
    await client.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,meter_id,year,month,kwh) VALUES($1,$2,$3,EXTRACT(YEAR FROM now())::int,1,500)',[org,lead,meter]);
    const monthlyBefore=await readStudyCalculationInputs(args);
    await client.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,meter_id,year,month,kwh) VALUES($1,$2,$3,2000,1,999)',[org,lead,meter]);
    assert.equal((await readStudyCalculationInputs(args)).input_fingerprint,monthlyBefore.input_fingerprint,'Unused historic year is not a dependency');
    await client.query('UPDATE lead_consumption_monthly SET kwh=501 WHERE meter_id=$1 AND year=EXTRACT(YEAR FROM now())::int',[meter]);
    assert.notEqual((await readStudyCalculationInputs(args)).input_fingerprint,monthlyBefore.input_fingerprint,'Current monthly value is a dependency');
    await client.query('ROLLBACK TO SAVEPOINT monthly_dependency');
    await readStudyCalculationInputs(args);await assertStudyCalculationCurrent(args);
    assert.deepEqual((await client.query('SELECT data_json FROM study_versions WHERE id=$1',[version])).rows[0].data_json,versionBefore);
    await assert.rejects(assertStudyCalculationCurrent({...args,snapshot:{input_fingerprint:'previous'}}),{code:'SELECTED_SNAPSHOT_STALE'});
  } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
