import test from 'node:test';import assert from 'node:assert/strict';
import {getClientPortalHistory,projectPortalHistoricalResult} from '../services/clientPortalHistory.service.js';
test('portal history exposes only a read-only projection, including negative savings',()=>{
  const r=projectPortalHistoricalResult({version_id:'fixture',history_index:0,study_number:'FICTIVE',scenario:{id:'BASE',finance:{economie_year_1:-42,finance_meta:{horizon_years:25},internal_margin:999},token:'fictitious-do-not-expose'}});
  assert.equal(r.annual_savings_eur,-42);assert.equal(r.horizon_years,25);assert.equal(r.export_blocked,true);
  assert.deepEqual(Object.keys(r).sort(),['id','study_number','computed_at','scenario_label','annual_savings_eur','horizon_years','export_blocked'].sort());
});
test('portal history is scoped to token organization and lead, paginated without inputs',async()=>{
  let recorded;const db={query:async(sql,params)=>{recorded={sql,params};return{rows:Array.from({length:11},(_,i)=>({version_id:'fixture',history_index:i,scenario:{}}))};}};
  const result=await getClientPortalHistory(db,{organizationId:'fake-org',leadId:'fake-lead',offset:20});
  assert.deepEqual(recorded.params,['fake-lead','fake-org',20]);assert.match(recorded.sql,/s\.lead_id=\$1 AND s\.organization_id=\$2/);assert.match(recorded.sql,/scenario->>'id'=v.data_json->'portal_offer'->>'scenario_id'/);assert.equal(result.items.length,10);assert.equal(result.next_offset,30);
});
