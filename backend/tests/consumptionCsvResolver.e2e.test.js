/** Real DB document → filesystem → hourly CSV importer integration.
 * Existing ORG_ID/LEAD_ID remain supported. To create isolated local fixtures:
 * CONSUMPTION_CSV_TEST_AUTO_FIXTURE=1 node backend/tests/consumptionCsvResolver.e2e.test.js
 * Automatic fixture creation is limited to a localhost database in test mode.
 */
import '../config/register-local-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {pool}=await import('../config/db.js');
const {resolveConsumptionCsv}=await import('../services/consumptionCsvResolver.service.js');
const {loadConsumption}=await import('../services/consumptionService.js');
const {STORAGE_ROOT}=await import('../services/localStorage.service.js');

function csvFixture(year){
 const start=Date.UTC(year,0,1),end=Date.UTC(year+1,0,1),hours=(end-start)/3600000;
 const lines=['startdate,powerinwatts'];let expectedKwh=0;
 for(let h=0;h<hours;h++){
  const watts=1000+h%500;expectedKwh+=watts/1000;
  lines.push(`${new Date(start+h*3600000).toISOString()},${watts}`);
 }
 return {content:lines.join('\n'),hours,expectedKwh};
}

async function run(){
 let orgId=process.env.ORG_ID?.trim(),leadId=process.env.LEAD_ID?.trim(),stageId=null,sourceId=null,createdOrg=false;
 try{
  if((!orgId||!leadId)&&process.env.CONSUMPTION_CSV_TEST_AUTO_FIXTURE==='1'){
   const url=new URL(process.env.DATABASE_URL);
   assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Automatic CSV fixtures require localhost');
   assert.equal(process.env.NODE_ENV,'test','Automatic CSV fixtures require NODE_ENV=test');
   const actual=(await pool.query('SELECT current_database() AS database, inet_server_addr()::text AS host')).rows[0];
   assert.equal(actual.database,decodeURIComponent(url.pathname.slice(1)));
   assert.ok(['127.0.0.1','::1'].includes(actual.host?.split('/')[0]),'Connected database must be local');
   orgId=(await pool.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id',[`CSV resolver isolated test ${randomUUID()}`])).rows[0].id;createdOrg=true;
   stageId=(await pool.query('INSERT INTO pipeline_stages (organization_id,name,position,is_closed) SELECT $1,$2,COALESCE(MAX(position),0)+1,false FROM pipeline_stages WHERE organization_id=$1 RETURNING id',[orgId,'CSV isolated test'])).rows[0].id;
   sourceId=(await pool.query('INSERT INTO lead_sources (organization_id,name,slug) VALUES ($1,$2,$3) RETURNING id',[orgId,'CSV isolated test','csv-isolated-test'])).rows[0].id;
   leadId=(await pool.query('INSERT INTO leads (organization_id,stage_id,source_id,full_name) VALUES ($1,$2,$3,$4) RETURNING id',[orgId,stageId,sourceId,'CSV isolated fixture'])).rows[0].id;
  }
  if(!orgId||!leadId){console.warn('SKIP consumptionCsvResolver.e2e.test: ORG_ID/LEAD_ID ou CONSUMPTION_CSV_TEST_AUTO_FIXTURE=1 requis');return;}
  for(const year of [2025,2024]){
   const fixture=csvFixture(year),fileName=`${randomUUID()}_conso_${year}.csv`;
   const key=[orgId,'lead',leadId,fileName].join('/'),absolutePath=path.resolve(STORAGE_ROOT,key);
   assert.ok(absolutePath.startsWith(path.resolve(STORAGE_ROOT)+path.sep),'CSV path must remain inside storage');
   let documentId=null;
   try{
    await fs.mkdir(path.dirname(absolutePath),{recursive:true});
    await fs.writeFile(absolutePath,fixture.content,{encoding:'utf8',flag:'wx'});
    documentId=(await pool.query(`INSERT INTO entity_documents
     (organization_id,entity_type,entity_id,file_name,file_size,mime_type,storage_key,url,uploaded_by,document_type)
     VALUES ($1,'lead',$2,$3,$4,'text/csv',$5,'local',NULL,'consumption_csv') RETURNING id`,
     [orgId,leadId,fileName,Buffer.byteLength(fixture.content),key])).rows[0].id;
    const resolved=await resolveConsumptionCsv({db:pool,organizationId:orgId,leadId,studyId:null});
    assert.equal(resolved.docId,documentId,'Resolver selects the inserted document');
    assert.equal(path.resolve(resolved.csvPath),absolutePath,'Resolver selects its real file');
    const conso=loadConsumption({},resolved.csvPath,{});
    assert.equal(conso.hourly.length,fixture.hours,`${year}: complete source calendar preserved`);
    assert.ok(Math.abs(conso.annual_kwh-fixture.expectedKwh)<1e-6,`${year}: annual kWh must equal integrated observed W`);
    assert.ok(Math.abs(conso.hourly.reduce((s,v)=>s+v,0)-fixture.expectedKwh)<1e-6);
    assert.equal(conso.consumption_source_mode,'CSV_HOURLY');
    assert.equal(conso.engine_consumption_source,'CSV_HOURLY_FULL_YEAR');
    assert.equal(conso.provenance.reconstructed,false,'A complete CSV must not fall back to a synthetic profile');
    assert.equal(conso.provenance.measured_hours,fixture.hours);
    assert.equal(conso.provenance.estimated_hours,0);
    console.log(`OK real DB document→file→CSV ${year}: ${fixture.hours} measured hours, ${conso.annual_kwh.toFixed(3)} kWh, no reconstruction`);
   }finally{
    if(documentId)await pool.query('DELETE FROM entity_documents WHERE id=$1 AND organization_id=$2',[documentId,orgId]);
    await fs.unlink(absolutePath).catch(error=>{if(error.code!=='ENOENT')throw error;});
   }
  }
 }catch(error){console.error('CSV fixture run failed:',error);throw error;}finally{
  if(createdOrg){
   if(leadId)await pool.query('DELETE FROM leads WHERE id=$1 AND organization_id=$2',[leadId,orgId]);
   if(stageId)await pool.query('DELETE FROM pipeline_stages WHERE id=$1 AND organization_id=$2',[stageId,orgId]);
   if(sourceId)await pool.query('DELETE FROM lead_sources WHERE id=$1 AND organization_id=$2',[sourceId,orgId]);
   await pool.query('DELETE FROM rbac_roles WHERE organization_id=$1',[orgId]);
   await pool.query('DELETE FROM organizations WHERE id=$1',[orgId]);
   const remaining=(await pool.query('SELECT count(*)::int AS n FROM organizations WHERE id=$1',[orgId])).rows[0].n;
   assert.equal(remaining,0,'Automatic fixture organisation was removed');
   for(const relative of [[orgId,'lead',leadId],[orgId,'lead'],[orgId]]){
    if(relative.some(x=>!x))continue;
    const directory=path.resolve(STORAGE_ROOT,...relative);
    assert.ok(directory.startsWith(path.resolve(STORAGE_ROOT)+path.sep));
    await fs.rmdir(directory).catch(error=>{if(!['ENOENT','ENOTEMPTY'].includes(error.code))throw error;});
   }
   console.log('OK isolated organisation, stage, lead, documents and CSV files cleaned');
  }
  await pool.end();
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
