import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectMigrationHistory, assertMigrationIntegrity } from '../services/system/migrationIntegrity.js';
import { LEAD_SOURCES_EXCEPTION as rule } from '../services/system/leadSourcesMigrationException.js';

const directory = path.resolve(import.meta.dirname, '../migrations');
const checks = {columns_valid:true,unique_slug_index:true,old_name_uniqueness_removed:true,rows_complete:true,no_duplicates:true,lead_links_valid:true,canonical_catalog_complete:true};
function database({stored={},effects=checks,name=rule.migration}={}) {
  const statements=[];
  return {statements,async query(sql){
    statements.push(sql);assert.match(sql,/^SELECT/);
    if(sql.includes('to_regclass'))return {rows:[{applied:'pgmigrations',checksums:'migration_checksums'}]};
    if(sql.includes('FROM public.pgmigrations'))return {rows:[{name}]};
    if(sql.includes('FROM public.migration_checksums'))return {rows:[{migration_name:name,checksum:rule.historicalRaw,checksum_normalized:rule.historicalNormalized,...stored}]};
    if(sql.includes('/* lead-sources-20260421-v1 */'))return {rows:effects?[effects]:[]};
    throw Error('Unexpected query');
  }};
}
test('one exact historical/canonical pair is accepted only after all actual effects pass',async()=>{
  const db=database(),r=await inspectMigrationHistory(db,directory);
  assert.equal(r.comparison[0].status,'verified_historical_exception');assert.equal(r.comparison[0].exception,rule.id);assertMigrationIntegrity(r);
  assert.equal(db.statements.length,4);assert.ok(db.statements.every(s=>s.startsWith('SELECT')));
});
test('every missing effect fails closed without rewriting historical metadata',async()=>{
  for(const key of Object.keys(checks)){
    const r=await inspectMigrationHistory(database({effects:{...checks,[key]:false}}),directory);
    assert.throws(()=>assertMigrationIntegrity(r),{code:'MIGRATION_TAMPERED_SUBSTANTIVE'},key);
  }
  const missing = await inspectMigrationHistory(database({effects:null}),directory);
  assert.throws(()=>assertMigrationIntegrity(missing),{code:'MIGRATION_TAMPERED_SUBSTANTIVE'});
});
test('any different recorded raw or normalized fingerprint remains rejected',async()=>{
  for(const stored of [{checksum:'0'.repeat(64)},{checksum_normalized:'1'.repeat(64)}]){
    const db=database({stored}),r=await inspectMigrationHistory(db,directory);assert.throws(()=>assertMigrationIntegrity(r),{code:'MIGRATION_TAMPERED_SUBSTANTIVE'});assert.equal(db.statements.length,3);
  }
});
test('canonical source changes and another migration cannot use the exception',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'migration-exception-'));
  try{
    const original=fs.readFileSync(path.join(directory,rule.migration+'.js'),'utf8');
    fs.writeFileSync(path.join(temp,rule.migration+'.js'),original.replace('min(id::text)::uuid','min(id)'));
    const changed=await inspectMigrationHistory(database(),temp);
    assert.throws(()=>assertMigrationIntegrity(changed),{code:'MIGRATION_TAMPERED_SUBSTANTIVE'});
    const other='1790400200000_monthly_consumption_meter_scope';
    fs.writeFileSync(path.join(temp,other+'.js'),original);
    const otherReport=await inspectMigrationHistory(database({name:other}),temp);
    assert.throws(()=>assertMigrationIntegrity(otherReport),{code:'MIGRATION_TAMPERED_SUBSTANTIVE'});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
