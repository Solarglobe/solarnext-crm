import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import * as accountState from '../services/mail/mailAccountState.service.js';

// Real account orchestrator + PostgreSQL SQL in memory. The IMAP transport and
// per-folder operation are scripted; the latter has its own actual-service suite.
// Advisory locks are simulated across distinct logical pool clients.
const outcomeUrl=new URL('../services/mail/mailSyncOutcome.service.js',import.meta.url);
const outcomes=existsSync(outcomeUrl)?await import(outcomeUrl.href):{};
const org='10000000-0000-4000-8000-000000000001',account='20000000-0000-4000-8000-000000000001';
const inbox='30000000-0000-4000-8000-000000000001',archive='30000000-0000-4000-8000-000000000002';
const oldSuccess='2020-01-01T00:00:00.000Z';
let db, results, transportError, discoveryError, onFolder, events, locks, nextClient, api;
const iso=value=>value?new Date(value).toISOString():null;
const row=async()=> (await db.query('SELECT * FROM mail_accounts WHERE id=$1',[account])).rows[0];
const invoke=extra=>api.syncMailAccount({organizationId:org,mailAccountId:account,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function makePool(){
  return {query:(sql,params)=>db.query(sql,params),async connect(){
    const id=++nextClient;
    return {async query(sql,params){
      if(sql.includes('pg_try_advisory_lock')){
        const key=params[0];const locked=!locks.has(key);
        if(locked)locks.set(key,id);events.push({kind:'lock',id,key,locked});
        return{rows:[{locked}]};
      }
      if(sql.includes('pg_advisory_unlock')){
        const key=params[0],owned=locks.get(key)===id;
        if(owned)locks.delete(key);events.push({kind:'unlock',id,key,owned});
        return{rows:[{pg_advisory_unlock:owned}]};
      }
      return db.query(sql,params);
    },release(error){events.push({kind:'release',id,error:Boolean(error)});if(error)for(const[key,owner]of locks)if(owner===id)locks.delete(key);}};
  }};
}
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE TYPE mail_account_lifecycle_state AS ENUM ('CONNECTED','DEGRADED','AUTH_REQUIRED','DISABLED');
    CREATE TABLE mail_accounts(id uuid PRIMARY KEY,organization_id uuid,user_id uuid,email text,is_active boolean,
      lifecycle_state mail_account_lifecycle_state,sync_enabled boolean,reconnect_required boolean,
      imap_host text,imap_port int,imap_secure boolean,encrypted_credentials jsonb,
      sync_status text,imap_status text,last_imap_sync_at timestamptz,last_sync_at timestamptz,
      last_successful_sync_at timestamptz,last_sync_attempt_at timestamptz,last_error_code text,last_error_message text,
      last_imap_error_at timestamptz,last_imap_error_code text,last_imap_error_message text,updated_at timestamptz);
    CREATE TABLE mail_folders(id uuid PRIMARY KEY,organization_id uuid,mail_account_id uuid,type text,name text,external_id text,
      uid_validity text,highest_modseq text,remote_unread_count int,selectable boolean,is_active boolean,
      sync_priority int,last_message_sync_at timestamptz,depth int);
  `);
});
after(()=>db.close());
beforeEach(async()=>{
  results=new Map();transportError=null;discoveryError=null;onFolder=null;events=[];locks=new Map();nextClient=0;
  await db.exec('TRUNCATE mail_accounts,mail_folders');
  await db.query(`INSERT INTO mail_accounts(id,organization_id,email,is_active,lifecycle_state,sync_enabled,
    reconnect_required,imap_host,imap_port,imap_secure,encrypted_credentials,sync_status,imap_status,
    last_successful_sync_at,last_imap_sync_at,last_sync_at)
    VALUES($1,$2,'synthetic@example.invalid',true,'CONNECTED',true,false,'imap.example.invalid',993,true,'{}','IDLE','OK',$3,$3,$3)`,[account,org,oldSuccess]);
  for(const[id,name,priority]of[[inbox,'INBOX',1],[archive,'Archives',2]])await db.query(`
    INSERT INTO mail_folders(id,organization_id,mail_account_id,type,name,external_id,uid_validity,highest_modseq,
      selectable,is_active,sync_priority,depth)VALUES($1,$2,$3,'CUSTOM',$4,$4,'1','10',true,true,$5,0)`,[id,org,account,name,priority]);
  const source=readFileSync(new URL('../services/mail/mailSync.service.js',import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
  const pool=makePool();
  api=vm.runInNewContext(`${source}\nsyncFolderForAccount=scriptedFolder;({syncMailAccount,syncAllMailAccounts});`,{
    pool,...accountState,...outcomes,process:{env:{MAIL_SYNC_FOLDER_LIMIT:'2'}},console,
    ImapErrorCodes:{AUTH_FAILED:'AUTH_FAILED',CONNECTION_TIMEOUT:'CONNECTION_TIMEOUT',INVALID_CONFIG:'INVALID_CONFIG',SYNC_FAILED:'SYNC_FAILED'},
    decryptJson:()=>({password:'synthetic'}),resolveImapCredentials:()=>({user:'synthetic',password:'synthetic'}),
    syncFoldersFromImap:async()=>{if(discoveryError)throw discoveryError;return{synced:2};},
    createImapClient:async()=>{if(transportError)throw transportError;return{logout:async()=>{events.push({kind:'logout'});}};},
    scriptedFolder:async(_imap,_pool,_account,folder)=>{if(onFolder)await onFolder(folder);return{
      folderId:folder.id,imported:0,skipped:0,...results.get(folder.id)};},
  });
});

test('M2 full folder success alone advances full-success timestamp and clears previous errors',async()=>{
  await db.query("UPDATE mail_accounts SET sync_status='ERROR',imap_status='ERROR',last_error_code='OLD',last_error_message='Old error'");
  const response=await invoke();const stored=await row();
  assert.equal(response.ok,true);assert.equal(response.outcome,'SUCCESS');assert.equal(stored.sync_status,'IDLE');
  assert.notEqual(iso(stored.last_successful_sync_at),oldSuccess);assert.ok(stored.last_sync_attempt_at);
  assert.equal(stored.last_error_code,null);assert.equal(stored.last_error_message,null);
});
test('M2 one folder timeout is partial, preserves last success and persists structured useful details',async()=>{
  results.set(archive,{error:'CONNECTION_TIMEOUT',message:'Synthetic folder timeout',stage:'fetch',imported:1});
  const response=await invoke();const stored=await row();
  assert.equal(response.ok,false);assert.equal(response.outcome,'PARTIAL');
  assert.equal(stored.sync_status,'ERROR');assert.equal(stored.imap_status,'ERROR');
  assert.equal(iso(stored.last_successful_sync_at),oldSuccess);assert.equal(iso(stored.last_imap_sync_at),oldSuccess);
  assert.ok(stored.last_sync_attempt_at);assert.equal(stored.last_error_code,'SYNC_PARTIAL');
  const detail=JSON.parse(stored.last_error_message);
  assert.equal(detail.counts.succeeded,1);assert.equal(detail.counts.failed,1);
  assert.equal(detail.errors[0].folderId,archive);assert.equal(detail.errors[0].folderName,'Archives');
  assert.equal(detail.errors[0].stage,'fetch');assert.equal(detail.errors[0].code,'CONNECTION_TIMEOUT');assert.ok(detail.errors[0].at);
  assert.equal(response.summary.folders[1].imported,1);
});
test('M2 all failed folders never produce account success',async()=>{
  for(const id of[inbox,archive])results.set(id,{error:'SYNC_FAILED',stage:'import',message:'Synthetic failure'});
  const response=await invoke();assert.equal(response.ok,false);assert.equal(response.outcome,'FAILED');
  assert.equal((await row()).last_error_code,'FOLDER_SYNC_FAILED');assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);
});
test('M2 NOSELECT is intentionally ignored without treating message duplicate counts as ignored folders',async()=>{
  await db.query('UPDATE mail_folders SET selectable=false WHERE id=$1',[archive]);
  results.set(inbox,{skipped:5});
  const response=await invoke();assert.equal(response.ok,true);assert.equal(response.summary.counts.succeeded,1);
  assert.equal(response.summary.counts.ignored,1);assert.equal(response.summary.counts.failed,0);
});
for(const code of['AUTH_FAILED','CONNECTION_TIMEOUT'])test(`M2 transport ${code} preserves last success and records stage`,async()=>{
  transportError=Object.assign(new Error('Synthetic '+code),{code});
  await assert.rejects(invoke(),error=>error.code===code);
  const stored=await row();assert.equal(stored.sync_status,'ERROR');assert.equal(stored.last_error_code,code);
  assert.equal(iso(stored.last_successful_sync_at),oldSuccess);assert.ok(stored.last_sync_attempt_at);
  const detail=JSON.parse(stored.last_error_message);assert.equal(detail.errors[0].stage,'connection');
  if(code==='AUTH_FAILED'){assert.equal(stored.lifecycle_state,'AUTH_REQUIRED');assert.equal(stored.reconnect_required,true);}
});
test('M2 discovery failure records attempted stage without claiming success',async()=>{
  discoveryError=Object.assign(new Error('Synthetic list failure'),{code:'CONNECTION_TIMEOUT'});
  await assert.rejects(invoke());const stored=await row();
  assert.equal(JSON.parse(stored.last_error_message).errors[0].stage,'discovery');assert.equal(iso(stored.last_successful_sync_at),oldSuccess);
});
test('M2 retry after partial failure clears error only after the subsequent complete success',async()=>{
  results.set(archive,{error:'SYNC_FAILED',message:'Partial message import',stage:'import',imported:1});
  assert.equal((await invoke()).ok,false);assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);
  results.clear();assert.equal((await invoke()).ok,true);assert.equal((await row()).last_error_message,null);
  assert.notEqual(iso((await row()).last_successful_sync_at),oldSuccess);
});
test('M2 a failure after a successful attempt retains that successful timestamp',async()=>{
  await invoke();const successful=iso((await row()).last_successful_sync_at);
  results.set(inbox,{error:'SYNC_FAILED',message:'Failure after success'});
  assert.equal((await invoke()).ok,false);assert.equal(iso((await row()).last_successful_sync_at),successful);
});
test('M2 a selected folder cannot prove full-account synchronization',async()=>{
  const response=await invoke({folderId:inbox});assert.equal(response.ok,false);
  assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);
});
test('M2 folder budget exhaustion leaves pending work explicit',async()=>{
  await db.query(`INSERT INTO mail_folders(id,organization_id,mail_account_id,name,external_id,selectable,is_active,sync_priority,depth)
    VALUES('30000000-0000-4000-8000-000000000003',$1,$2,'More','More',true,true,3,0)`,[org,account]);
  const response=await invoke();assert.equal(response.ok,false);assert.equal(response.summary.counts.pending,1);
  assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);
});
test('M2 no folders do not erase an earlier useful error or advance success',async()=>{
  await db.exec('TRUNCATE mail_folders');
  const response=await invoke();assert.equal(response.ok,false);assert.equal((await row()).last_error_code,'SYNC_NOT_COMPLETE');
  assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);
});
test('M2 concurrent same-account attempt is busy and never overwrites the first attempt failure',async()=>{
  const entered=deferred(),resume=deferred();let paused=false;
  onFolder=async()=>{if(!paused){paused=true;entered.resolve();await resume.promise;}};
  results.set(archive,{error:'SYNC_FAILED',message:'First run failed',stage:'import'});
  const first=invoke();await entered.promise;const attemptTime=iso((await row()).last_sync_attempt_at);
  const second=await invoke();assert.equal(second.ok,false);assert.equal(second.code,'SYNC_ALREADY_RUNNING');
  assert.equal(iso((await row()).last_sync_attempt_at),attemptTime);assert.equal((await row()).sync_status,'SYNCING');
  resume.resolve();assert.equal((await first).ok,false);assert.equal((await row()).sync_status,'ERROR');
  assert.equal(iso((await row()).last_successful_sync_at),oldSuccess);assert.equal(locks.size,0);
  assert.equal(events.filter(e=>e.kind==='unlock'&&!e.owned).length,0);
});
test('M2 syncAll counts partial account result as failed instead of successful',async()=>{
  results.set(archive,{error:'CONNECTION_TIMEOUT',message:'Synthetic timeout'});
  const response=await api.syncAllMailAccounts({organizationId:org});
  assert.equal(response.ok,0);assert.equal(response.failed,1);assert.equal(response.errors.length,1);
});

test('M2 targeted success preserves the earlier unverified failure of another folder',async()=>{
  results.set(archive,{error:'CONNECTION_TIMEOUT',message:'Archives still unverified',stage:'fetch'});
  await invoke();results.clear();
  const response=await invoke({folderId:inbox});
  assert.equal(response.ok,false);const stored=await row();const details=JSON.parse(stored.last_error_message);
  assert.ok(details.unresolvedErrors.some(error=>error.folderId===archive&&error.code==='CONNECTION_TIMEOUT'));
  assert.match(stored.last_imap_error_message,/Archives still unverified/);
  assert.equal(iso(stored.last_successful_sync_at),oldSuccess);
  await invoke();assert.equal((await row()).last_error_message,null);
});
test('M2 targeted failure keeps both new and previously unverified folder diagnostics',async()=>{
  results.set(archive,{error:'CONNECTION_TIMEOUT',message:'Old archive failure',stage:'fetch'});await invoke();
  results.clear();results.set(inbox,{error:'SYNC_FAILED',message:'New inbox failure',stage:'import'});
  await invoke({folderId:inbox});const details=JSON.parse((await row()).last_error_message);
  assert.deepEqual(details.unresolvedErrors.map(error=>error.folderId).sort(),[inbox,archive].sort());
});
