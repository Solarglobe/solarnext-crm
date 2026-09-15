import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { getStudyScenarioPageSummary, getStudyById, getVersionById } from '../routes/studies/service.js';

test('comparison header SQL stays small with many large versions and preserves meter trace', async t => {
  const client=await pool.connect(),originalQuery=pool.query;
  try {
    await client.query('BEGIN');
    const org=(await client.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[`summary-fixture-${randomUUID()}`])).rows[0].id;
    const study=(await client.query("INSERT INTO studies(organization_id,study_number,title,status,current_version) VALUES($1,$2,'Comparison header fixture','draft',24) RETURNING id",[org,`SUMMARY-${randomUUID()}`])).rows[0].id;
    const trace={selected_meter_id:randomUUID(),meter_snapshot:{name:'Compteur test',energy_profile:{hourly:Array(8760).fill(1)}},meter_snapshot_captured_at:'2026-09-15T00:00:00Z',meter_snapshot_previous:{name:'Ancien compteur',energy_profile:{hourly:Array(8760).fill(2)}},meter_snapshot_previous_captured_at:'2026-09-14T00:00:00Z',meter_calc_change_lines_fr:['Tarif actuel modifié : 0,20 → 0,25 €/kWh']};
    const payload={...trace,calc_result:{computed_at:'2026-09-13T00:00:00Z',large:'x'.repeat(20000)},calculation_input_snapshot:{private:'y'.repeat(20000)},scenarios_v2:[{id:'BASE',hourly:Array(8760).fill(3)}],calculation_history:Array.from({length:21},()=>({scenarios:[{large:'z'.repeat(20000)}],input_snapshot:{hourly:Array(8760).fill(4)}}))};
    const versions=(await client.query('INSERT INTO study_versions(organization_id,study_id,version_number,data_json,selected_scenario_snapshot) SELECT $1,$2,n,$3::jsonb,$4::jsonb FROM generate_series(1,24) n RETURNING id,version_number',[org,study,JSON.stringify(payload),JSON.stringify({large:'p'.repeat(20000)})])).rows;
    const version=versions.find(v=>v.version_number===24).id;
    await t.test('projects the requested header directly in SQL, not every version or stored payload',async()=>{
      const summary=await getStudyScenarioPageSummary(study,version,org,client);
      assert.equal(summary.study.id,study);assert.equal(summary.study.title,'Comparison header fixture');
      assert.equal(summary.versions.length,1);assert.equal(summary.versions[0].id,version);assert.equal(summary.versions[0].version_number,24);
      const data=summary.versions[0].data;
      assert.deepEqual(data.meter_snapshot,{name:'Compteur test'});assert.deepEqual(data.meter_snapshot_previous,{});
      assert.equal(data.meter_snapshot_captured_at,trace.meter_snapshot_captured_at);assert.equal(data.meter_snapshot_previous_captured_at,trace.meter_snapshot_previous_captured_at);
      assert.deepEqual(data.meter_calc_change_lines_fr,trace.meter_calc_change_lines_fr);assert.equal(data.selected_meter_id,trace.selected_meter_id);
      for(const key of ['calculation_history','calculation_input_snapshot','calc_result','scenarios_v2'])assert.equal(data[key],undefined);
      assert.equal(summary.versions[0].selected_scenario_snapshot,undefined);assert.equal(summary.lead,undefined);
      assert.ok(Buffer.byteLength(JSON.stringify(summary))<1800);
    });
    await t.test('full server reads remain full for calculation/export callers',async()=>{
      pool.query=client.query.bind(client);
      const full=await getStudyById(study,org),row=await getVersionById(version,org);
      assert.equal(full.versions.length,24);assert.equal(row.data.calculation_history.length,21);assert.equal(row.selected_scenario_snapshot.large.length,20000);
      assert.ok(Buffer.byteLength(JSON.stringify(full))>10000000);
      pool.query=originalQuery;
    });
    await t.test('legacy computed_at fallback and no previous meter remain accurate',async()=>{
      await client.query("UPDATE study_versions SET data_json=$1 WHERE id=$2",[{meter_snapshot_captured_at:null,calc_result:{computed_at:'2026-09-12T00:00:00Z'}},version]);
      const data=(await getStudyScenarioPageSummary(study,version,org,client)).versions[0].data;
      assert.equal(data.meter_snapshot_captured_at,'2026-09-12T00:00:00Z');assert.equal(data.meter_snapshot_previous,null);
    });
    await t.test('other organisation, wrong study and deleted version do not disclose metadata',async()=>{
      assert.equal(await getStudyScenarioPageSummary(study,version,randomUUID(),client),null);
      assert.equal(await getStudyScenarioPageSummary(randomUUID(),version,org,client),null);
      await client.query('UPDATE study_versions SET deleted_at=now() WHERE id=$1',[version]);
      assert.equal(await getStudyScenarioPageSummary(study,version,org,client),null);
    });
  } finally {pool.query=originalQuery;await client.query('ROLLBACK');client.release();await pool.end();}
});
