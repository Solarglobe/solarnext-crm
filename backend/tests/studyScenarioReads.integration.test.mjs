import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../config/db.js';
import {readStudyCalculationInputs,assertStudyCalculationCurrent} from '../services/studyCalculationFreshness.service.js';
import {getStudyScenarios,getStudyScenarioFreshness,getStudyScenarioHistory,getStudyScenarioHistoryEntry} from '../controllers/studyScenarios.controller.js';
import {CALC_ENGINE_VERSION} from '../services/calc/calc.constants.js';

test('actual database: selected dependencies, lightweight reads, isolated lazy history and legacy export guard',async t=>{
 const client=await pool.connect(),originalQuery=pool.query;
 try{
  await client.query('BEGIN');
  const org=(await client.query('INSERT INTO organizations(name,settings_json) VALUES($1,$2) RETURNING id',[`read-test-${randomUUID()}`,{economics:{price_eur_kwh:.2,elec_growth_pct:5}}])).rows[0].id;
  const stage=(await client.query("INSERT INTO pipeline_stages(organization_id,name,position,is_closed) VALUES($1,'Fixture',0,false) RETURNING id",[org])).rows[0].id;
  const lead=(await client.query("INSERT INTO leads(organization_id,stage_id,full_name,consumption_mode,consumption_annual_kwh) VALUES($1,$2,'Read fixture','ANNUAL',10000) RETURNING id",[org,stage])).rows[0].id;
  const meter=(await client.query("INSERT INTO lead_meters(organization_id,lead_id,name,is_default,consumption_mode,consumption_annual_kwh,meter_power_kva,tariff_type) VALUES($1,$2,'Fixture',true,'ANNUAL',10000,18,'HPHC') RETURNING id",[org,lead])).rows[0].id;
  const study=(await client.query("INSERT INTO studies(organization_id,lead_id,study_number,status,current_version) VALUES($1,$2,$3,'draft',1) RETURNING id",[org,lead,`READ-${randomUUID()}`])).rows[0].id;
  const version=(await client.query('INSERT INTO study_versions(organization_id,study_id,version_number,data_json) VALUES($1,$2,1,$3) RETURNING id',[org,study,{selected_meter_id:meter}])).rows[0].id;
  const panel=(await client.query("INSERT INTO pv_panels(name,brand,model_ref,power_wc,efficiency_pct,width_mm,height_mm) VALUES('Fixture','Test',$1,450,22,1100,1800) RETURNING id",[randomUUID()])).rows[0].id;
  const quote={totals:{ttc:15000},virtualBattery:{provider:'URBAN_SOLAR',contractType:'HPHC',tariff_reference_date:'2026-09-15'}};
  await client.query("INSERT INTO economic_snapshots(study_id,study_version_id,organization_id,version_number,status,config_json) VALUES($1,$2,$3,1,'DRAFT',$4)",[study,version,org,quote]);
  await client.query('INSERT INTO calpinage_data(organization_id,study_version_id,geometry_json) VALUES($1,$2,$3)',[org,version,{panel_id:panel,pans:[{azimuth:90}]}]);
  const args={studyId:study,versionId:version,organizationId:org,db:client};
  const source=await readStudyCalculationInputs(args);
  await t.test('catalog technical selection excludes commercial metadata',async()=>{
   assert.equal(source.inputs.catalogs.pv_panels.length,1);
   await client.query('SAVEPOINT dependency');
   await client.query("UPDATE pv_panels SET name='Renamed',image_url='https://example.test/new.png',updated_at=now() WHERE id=$1",[panel]);
   assert.equal((await readStudyCalculationInputs(args)).input_fingerprint,source.input_fingerprint);
   await client.query('UPDATE pv_panels SET power_wc=460 WHERE id=$1',[panel]);
   assert.notEqual((await readStudyCalculationInputs(args)).input_fingerprint,source.input_fingerprint);
   await client.query('ROLLBACK TO SAVEPOINT dependency');
  });
  await t.test('unrelated notes, quote text, provider and geometry preview do not invalidate',async()=>{
   await client.query('SAVEPOINT dependency');
   await client.query("UPDATE leads SET full_name='Other display name' WHERE id=$1",[lead]);
   await client.query("UPDATE economic_snapshots SET config_json=config_json || $1::jsonb WHERE study_version_id=$2",[{conditions:'Changed commercial text'},version]);
   await client.query("UPDATE calpinage_data SET geometry_json=geometry_json || $1::jsonb WHERE study_version_id=$2",[{preview:'large image',camera:{zoom:9}},version]);
   await client.query("UPDATE organizations SET settings_json=settings_json || $1::jsonb WHERE id=$2",[{pv:{virtual_battery:{providers:{MYLIGHT_MYBATTERY:{electricity_supply:{price_base_eur_kwh:99}}}}}},org]);
   const changed=await readStudyCalculationInputs(args);
   assert.equal(changed.input_fingerprint,source.input_fingerprint);assert.notEqual(changed.quote_fingerprint,source.quote_fingerprint);
   await client.query('ROLLBACK TO SAVEPOINT dependency');
  });
  const scenarios=[{id:'BASE',energy_basis:'hourly_8760',finance:{economie_total:-100}}];
  const history=Array.from({length:21},(_,i)=>({computed_at:`2026-09-${String(i+1).padStart(2,'0')}T00:00:00Z`,input_fingerprint:`old-${i}`,engine_version:'OLD',scenarios,input_snapshot:{private_trace:'x'.repeat(20000)},calc_result:{large:'not public'},trace:{internal:'not public'}}));
  await client.query('UPDATE study_versions SET data_json=data_json || $1::jsonb WHERE id=$2',[{scenarios_v2:scenarios,scenarios_engine_version:CALC_ENGINE_VERSION,scenarios_computed_at:'2026-09-15T00:00:00Z',calculation_trace:{input_fingerprint:source.input_fingerprint},calculation_history:history},version]);
  pool.query=client.query.bind(client); // actual SQL in one rollback-only fixture, no canned results
  const req={params:{studyId:study,versionId:version},user:{organizationId:org},query:{}};
  const call=async(fn,extra={})=>{let status=200,body;await fn({...req,...extra},{status(s){status=s;return this;},json(v){body=v;return this;}});return {status,body};};
  await t.test('freshness and current reads omit full history',async()=>{
   const fresh=await call(getStudyScenarioFreshness);assert.equal(fresh.status,200);assert.equal(fresh.body.needs_recompute,false);assert.equal(fresh.body.history_count,21);
   assert.ok(Buffer.byteLength(JSON.stringify(fresh.body))<1500);assert.equal(fresh.body.scenarios,undefined);assert.equal(fresh.body.history,undefined);
   const current=await call(getStudyScenarios);assert.equal(current.status,200);assert.equal(current.body.scenarios.length,1);assert.equal(current.body.history_count,21);assert.equal(current.body.history,undefined);
  });
  await t.test('history index is paginated, newest first; one snapshot loads without internal traces',async()=>{
   const page=await call(getStudyScenarioHistory);assert.equal(page.body.items.length,20);assert.equal(page.body.total,21);assert.equal(page.body.next_offset,20);assert.equal(page.body.items[0].id,'20');
   assert.equal(page.body.items[0].scenarios,undefined);assert.ok(Buffer.byteLength(JSON.stringify(page.body))<6000);
   const last=await call(getStudyScenarioHistory,{query:{offset:20}});assert.equal(last.body.items.length,1);assert.equal(last.body.next_offset,null);
   const old=await call(getStudyScenarioHistoryEntry,{params:{...req.params,historyId:'0'}});assert.deepEqual(old.body.scenarios,scenarios);assert.equal(old.body.export_blocked,true);assert.equal(old.body.display_blocked,false);
   for(const key of ['input_snapshot','trace','calc_result'])assert.equal(old.body[key],undefined);
   for(const bad of ['-1','text','999999999999'])assert.equal((await call(getStudyScenarioHistoryEntry,{params:{...req.params,historyId:bad}})).status,400);
   assert.equal((await call(getStudyScenarioHistoryEntry,{params:{...req.params,historyId:'22'}})).status,404);
   assert.equal((await call(getStudyScenarioHistory,{query:{limit:51}})).status,400);
  });
  await t.test('cross-organisation and wrong study reads are refused',async()=>{
   for(const fn of [getStudyScenarios,getStudyScenarioFreshness,getStudyScenarioHistory,getStudyScenarioHistoryEntry]){
    const params={...req.params,historyId:'0'};
    assert.equal((await call(fn,{params,user:{organizationId:randomUUID()}})).status,404);
    assert.equal((await call(fn,{params:{...params,studyId:randomUUID()}})).status,404);
   }
  });
  await t.test('old engine remains readable but requires recalculation before export',async()=>{
   await client.query("UPDATE study_versions SET data_json=jsonb_set(data_json,'{scenarios_engine_version}','\"OLD\"') WHERE id=$1",[version]);
   const old=await call(getStudyScenarios);assert.equal(old.status,200);assert.equal(old.body.display_blocked,false);assert.equal(old.body.export_blocked,true);assert.equal(old.body.needs_recompute,true);
   await assert.rejects(assertStudyCalculationCurrent(args),{code:'ENGINE_VERSION_CHANGED'});
   assert.equal((await call(getStudyScenarioHistoryEntry,{params:{...req.params,historyId:'0'}})).status,200);
  });
 }finally{pool.query=originalQuery;await client.query('ROLLBACK');client.release();await pool.end();}
});
