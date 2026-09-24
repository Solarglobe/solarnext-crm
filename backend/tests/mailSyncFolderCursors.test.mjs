import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { simpleParser } from 'mailparser';
import { discoverImapFoldersWithStatus } from '../services/mail/mailFolderDiscovery.service.js';

// True folder/discovery/import and flag-observation service bodies, real SQL in
// ephemeral PostgreSQL. Only external infrastructure/threading is substituted.
// No db.js, environment files, network, external accounts or storage loaded.
function load(path,names,deps={}) {
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'')
    .replace(/^export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`,{
    ...deps,Buffer,Date,process:{env:{}},console:{info(){},warn(){},error(){}},
  });
}
const account={id:'10000000-0000-0000-0000-000000000001',organization_id:'20000000-0000-0000-0000-000000000002',email:'synthetic@example.test'};
const folderId='30000000-0000-0000-0000-000000000003';
let db,pg,sync,persistDiscovery,sqlLog,locks,sequence;
let beforeQuery,lockResponseFailure,unlockFailure,releases;
const flags=value=>Array.from(value||[]);
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE TYPE mail_folder_type AS ENUM('INBOX','SENT','DRAFT','TRASH','ARCHIVE','CUSTOM','SPAM');
    CREATE TYPE mail_message_direction AS ENUM('INBOUND','OUTBOUND');
    CREATE TYPE mail_message_status AS ENUM('RECEIVED','SENT');
    CREATE TABLE mail_folders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,mail_account_id uuid,
      name text,type mail_folder_type,external_id text,parent_id uuid,parent_path text,delimiter text,depth integer DEFAULT 0,
      attributes_json jsonb,special_use text,selectable boolean DEFAULT true,subscribed boolean,is_active boolean DEFAULT true,
      last_discovered_at timestamptz,uid_validity text,highest_modseq text,remote_message_count integer,remote_unread_count integer,
      message_sync_status text DEFAULT 'NEVER_SYNCED',history_sync_status text DEFAULT 'PARTIAL',sync_priority integer DEFAULT 10,
      last_message_sync_error_at timestamptz,last_message_sync_error_code text,last_message_sync_error_message text,
      flag_sync_error_code text,flag_sync_error_message text,flag_sync_error_at timestamptz,last_flag_sync_at timestamptz,
      last_message_sync_at timestamptz,history_backfill_status text DEFAULT 'NOT_STARTED',history_backfill_cursor_uid bigint,
      oldest_imported_uid bigint,oldest_imported_at timestamptz,history_backfill_has_more boolean,history_backfill_last_success_at timestamptz,
      history_backfill_completed_at timestamptz,history_backfill_last_error text,remote_total_count integer,local_imported_count integer,updated_at timestamptz);
    CREATE UNIQUE INDEX uq_folders ON mail_folders(mail_account_id,external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE mail_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,mail_account_id uuid,folder_id uuid,
      mail_thread_id uuid,message_id text,in_reply_to text,references_ids text[],subject text,body_text text,body_html text,
      direction mail_message_direction DEFAULT 'INBOUND',status mail_message_status DEFAULT 'RECEIVED',sent_at timestamptz,received_at timestamptz,
      is_read boolean DEFAULT false,has_attachments boolean,external_uid bigint,external_uid_validity text,external_modseq text,external_flags jsonb DEFAULT '[]',
      external_internal_date timestamptz,raw_headers jsonb,sync_source text,read_sync_status text,read_sync_error text,read_synced_at timestamptz,
      external_size_bytes bigint,remote_missing_at timestamptz,remote_deleted_at timestamptz,move_sync_status text,move_sync_error text,
      move_synced_at timestamptz,previous_folder_id uuid,previous_folder_path text,created_at timestamptz DEFAULT now(),updated_at timestamptz);
    CREATE UNIQUE INDEX uq_namespace ON mail_messages(mail_account_id,folder_id,COALESCE(external_uid_validity,''),external_uid) WHERE external_uid IS NOT NULL;
    CREATE TABLE mail_participants(organization_id uuid,mail_message_id uuid,type text,email text,name text);
    CREATE TYPE mail_participant_type AS ENUM('FROM','TO','CC','BCC');
    CREATE TABLE mail_flag_mutations(id uuid,organization_id uuid,mail_account_id uuid,folder_id uuid,external_uid bigint,external_uid_validity text,status text);
    CREATE TABLE mail_move_mutations(mail_message_id uuid,status text);
  `);
  function makeClient(){const owner=++sequence;return{
    async query(sql,params=[]){
      sqlLog.push({sql,params,owner});
      if(beforeQuery)await beforeQuery(sql,params);
      if(/pg_try_advisory_lock/.test(sql)){
        const locked=!locks.has(params[0])||locks.get(params[0])===owner;
        if(locked)locks.set(params[0],owner);
        if(lockResponseFailure)throw new Error('synthetic lost lock response');
        return{rows:[{locked}]};
      }
      if(/pg_advisory_unlock/.test(sql)){
        if(unlockFailure==='throw')throw new Error('synthetic unlock failure');
        if(unlockFailure==='false')return{rows:[{unlocked:false}]};
        if(locks.get(params[0])===owner)locks.delete(params[0]);return{rows:[{unlocked:true}]};
      }
      return db.query(sql,params);
    },release(error){releases.push({owner,error});for(const[key,value]of locks)if(value===owner)locks.delete(key);}
  };}
  pg={connect:async()=>makeClient(),query:async(sql,params)=>{const client=makeClient();try{return await client.query(sql,params);}finally{client.release();}}};
  const observations=load('../services/mail/mailFlagMutation.service.js',['applyRemoteReadObservationInTransaction'],{rebuildThreadMetadata:async()=>{}});
  const persistence=load('../services/mail/mailSyncPersistence.service.js',[
    'findExistingMessageId','normalizeSubject','addressesEqual','parseReferencesHeader','snippetFromBodies',
  ]);
  sync=load('../services/mail/mailSync.service.js',['syncFolderForAccount','reconcileExistingFlagsForFolder','getMaxExternalUidForFolder'],{
    pool:pg,simpleParser,...persistence,...observations,
    ImapErrorCodes:{SYNC_FAILED:'SYNC_FAILED',CONNECTION_TIMEOUT:'CONNECTION_TIMEOUT',AUTH_FAILED:'AUTH_FAILED'},
    hasSeenFlag:value=>flags(value).includes('\\Seen'),normalizeImapFlagsForJsonValue:flags,
    resolveThreadForMessage:async()=>({threadId:'40000000-0000-0000-0000-000000000004'}),
    rebuildThreadMetadata:async()=>{},syncCrmLinkForNewMessage:async()=>{},emitEventAsync:()=>{},
    processAttachmentsForMessage:()=>{throw new Error('Unexpected attachment handling');},
  });
  persistDiscovery=load('../services/mail/imap.service.js',['persistDiscoveredMailFolders']).persistDiscoveredMailFolders;
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  sqlLog=[];locks=new Map();sequence=0;
  beforeQuery=null;lockResponseFailure=false;unlockFailure=null;releases=[];
  await db.exec('TRUNCATE mail_folders,mail_messages,mail_participants,mail_flag_mutations,mail_move_mutations');
  await db.query(`INSERT INTO mail_folders(id,organization_id,mail_account_id,name,type,external_id,uid_validity,highest_modseq,message_sync_status)
    VALUES($1,$2,$3,'INBOX','INBOX','INBOX','7','10','SYNCED')`,[folderId,account.organization_id,account.id]);
});
const folder=async()=> (await db.query('SELECT * FROM mail_folders WHERE id=$1',[folderId])).rows[0];
async function seed(uid,{validity='7',modseq='10',seen=false,messageId=`<uid-${uid}@example.test>`}={}){
  await db.query(`INSERT INTO mail_messages(organization_id,mail_account_id,folder_id,external_uid,external_uid_validity,external_modseq,
    is_read,external_flags,message_id,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
  [account.organization_id,account.id,folderId,uid,validity,modseq,seen,JSON.stringify(seen?['\\Seen']:[]),messageId,new Date(uid*1000)]);
}
function imap({validity='7',modseq='11',messages=[],extension=true,noModseq=false,searchError=null,searchResult,fetchErrorUid=null,emptyUid=null,flagFailure=false,missingFlagUid=null,wrongRawUid=false,openGate=null}={}){
  const calls=[];
  const remote=messages.map(m=>typeof m==='number'?{uid:m,seen:false,modseq}:m);
  const mailbox={uidValidity:BigInt(validity),highestModseq:modseq==null?null:BigInt(modseq),exists:remote.length,noModseq};
  return{calls,mailbox,enabled:new Set(extension?['CONDSTORE']:[]),
    async list(){return[{path:'INBOX',specialUse:'\\Inbox',delimiter:'/'}];},
    async status(){return{uidValidity:mailbox.uidValidity,highestModseq:mailbox.highestModseq,messages:remote.length,unseen:remote.filter(m=>!m.seen).length};},
    async mailboxOpen(path){calls.push({type:'open',path});if(openGate)await openGate;return mailbox;},
    async search(){calls.push({type:'search'});if(searchError)throw searchError;return searchResult===undefined?remote.map(m=>m.uid):searchResult;},
    async *fetch(range,query,options){
      calls.push({type:query.source?'raw':'flags',range,options});
      const ids=range==='1:*'?null:range.split(',').map(Number);
      for(const m of remote){if(ids&&!ids.includes(m.uid))continue;
        if(options.changedSince&&BigInt(m.modseq||modseq)<=BigInt(options.changedSince))continue;
        if(query.source&&fetchErrorUid===m.uid)throw Object.assign(new Error('synthetic timeout'),{code:'CONNECTION_TIMEOUT'});
        if(query.source&&emptyUid===m.uid)continue;
        if(!query.source&&missingFlagUid===m.uid)continue;
        const raw={uid:m.uid,flags:new Set(m.seen?['\\Seen']:[]),modseq:modseq==null?null:BigInt(m.modseq||modseq)};
        if(query.source&&wrongRawUid)raw.uid=m.uid+100;
        if(query.source){raw.source=Buffer.from(`From: test@example.test\r\nTo: synthetic@example.test\r\nMessage-ID: ${m.messageId||`<uid-${m.uid}@example.test>`}\r\nSubject: synthetic ${m.uid}\r\n\r\nSynthetic body`);raw.size=raw.source.length;}
        yield raw;if(!query.source&&flagFailure)throw new Error('synthetic partial flag response');
      }
    }
  };
}
const run=async(client,original)=>sync.syncFolderForAccount(client,pg,account,original||await folder(),{incremental:true,forceFull:false});
async function discover(client){const found=await discoverImapFoldersWithStatus(client);await persistDiscovery(pg,{organizationId:account.organization_id,mailAccountId:account.id,folders:found.folders});}
const cursors=async()=>{const f=await folder();return[f.uid_validity,f.highest_modseq];};

test('M1 discovery preserves confirmed cursors and old-message delta survives compensated unread counts',async()=>{
  for(let uid=1;uid<=202;uid++)await seed(uid,{seen:uid===2});
  const messages=Array.from({length:202},(_,i)=>({uid:i+1,seen:i===0,modseq:i<2?'11':'10'}));
  const client=imap({messages});await discover(client);
  assert.deepEqual(await cursors(),['7','10']);
  const result=await run(client);assert.equal(result.error,undefined);
  const rows=(await db.query('SELECT external_uid,is_read FROM mail_messages WHERE external_uid<=2 ORDER BY external_uid')).rows;
  assert.deepEqual(rows.map(r=>r.is_read),[true,false]);
  assert.ok(client.calls.some(c=>c.type==='flags'&&c.range==='1:*'&&c.options.changedSince==='10'));
  assert.deepEqual(await cursors(),['7','11']);
});
test('M1 equal MODSEQ does not rescan flags unnecessarily',async()=>{
  await seed(1);const client=imap({modseq:'10',messages:[1]});
  assert.equal((await run(client)).error,undefined);
  assert.equal(client.calls.filter(c=>c.type==='flags').length,0);
});
test('M1 UIDVALIDITY reset imports UID1 below old max and keeps old namespace separate',async()=>{
  await seed(900);await seed(1,{messageId:'<same@example.test>'});
  const client=imap({validity:'8',modseq:'2',messages:[{uid:1,messageId:'<same@example.test>',seen:true,modseq:'2'}]});
  await discover(client);const result=await run(client);assert.equal(result.error,undefined,JSON.stringify(result));
  const rows=(await db.query('SELECT * FROM mail_messages ORDER BY external_uid_validity,external_uid')).rows;
  assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.external_uid_validity==='8').length,1);
  assert.ok(rows.filter(r=>r.external_uid_validity==='7').every(r=>r.remote_missing_at));
  assert.deepEqual(await cursors(),['8','2']);
});
test('M1 failed SEARCH after discovery never advances MODSEQ',async()=>{
  const client=imap({searchError:new Error('synthetic search failure')});await discover(client);
  assert.ok((await run(client)).error);assert.deepEqual(await cursors(),['7','10']);
});
test('M1 a partial import preserves confirmed cursors, progress and retry',async()=>{
  await seed(1);const first=await run(imap({messages:[1,2,3],fetchErrorUid:3}));
  assert.ok(first.error);assert.equal(first.imported,1,JSON.stringify(first));assert.equal(first.stage,'message_import');
  assert.deepEqual(await cursors(),['7','10']);
  const retry=await run(imap({messages:[1,2,3]}));assert.equal(retry.error,undefined);
  assert.equal((await db.query('SELECT * FROM mail_messages')).rows.length,3);assert.deepEqual(await cursors(),['7','11']);
});
test('M1 a missing FETCH response is not confirmed as a successful skipped import',async()=>{
  const result=await run(imap({messages:[1],emptyUid:1}));assert.ok(result.error);
  assert.deepEqual(await cursors(),['7','10']);
});
test('M1 invalid SEARCH response is an error, never an empty folder',async()=>{
  await seed(1);const result=await run(imap({messages:[1],searchResult:false}));
  assert.ok(result.error);assert.deepEqual(await cursors(),['7','10']);
  assert.equal((await db.query('SELECT remote_missing_at FROM mail_messages')).rows[0].remote_missing_at,null);
});
test('M1 partial flag response cannot confirm a new MODSEQ',async()=>{
  await seed(1);const result=await run(imap({messages:[{uid:1,seen:true,modseq:'11'}],flagFailure:true}));
  assert.ok(result.error);assert.deepEqual(await cursors(),['7','10']);
});
test('M1 a genuinely empty folder confirms successful cursors and marks missing messages',async()=>{
  await seed(1);const result=await run(imap({messages:[]}));assert.equal(result.error,undefined);
  assert.deepEqual(await cursors(),['7','11']);assert.equal(result.totalRemoteUids,0);
  assert.ok((await db.query('SELECT remote_missing_at FROM mail_messages')).rows[0].remote_missing_at);
});
test('M1 newly discovered folder starts unconfirmed and confirms only after import',async()=>{
  await db.exec('TRUNCATE mail_folders');const client=imap({messages:[1]});await discover(client);
  const discovered=(await db.query('SELECT * FROM mail_folders')).rows[0];
  assert.equal(discovered.uid_validity,null);assert.equal(discovered.highest_modseq,null);
  const result=await run(client,discovered);assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.imported,1);
  const confirmed=(await db.query('SELECT * FROM mail_folders')).rows[0];assert.equal(confirmed.highest_modseq,'11');
});
for(const noModseq of [false,true])test(`M1 classic IMAP fallback works without usable CONDSTORE (noModseq=${noModseq})`,async()=>{
  await seed(1);const client=imap({messages:[{uid:1,seen:true}],extension:noModseq,modseq:noModseq?'11':null,noModseq});
  const result=await run(client);assert.equal(result.error,undefined);
  assert.ok(result.flags.strategy.startsWith('fallback_'));
  assert.equal(client.calls.some(c=>c.type==='flags'&&c.options.changedSince),false);
  assert.equal((await db.query('SELECT is_read FROM mail_messages')).rows[0].is_read,true);
  assert.equal((await cursors())[1],null,'an unsupported checkpoint must not claim a complete MODSEQ baseline');
});
test('M1 stale caller snapshot cannot regress a newer confirmed folder MODSEQ',async()=>{
  const stale=await folder();await run(imap({modseq:'12',messages:[]}));
  const result=await run(imap({modseq:'11',messages:[]}),stale);
  assert.ok(result.error);assert.deepEqual(await cursors(),['7','12']);
});
test('M1 concurrent folder attempts cannot overwrite the owner cursor',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const first=run(imap({modseq:'12',openGate:gate}));
  while(!locks.size)await new Promise(resolve=>setImmediate(resolve));
  const second=await run(imap({modseq:'11'}));assert.ok(second.error);
  release();assert.equal((await first).error,undefined);assert.deepEqual(await cursors(),['7','12']);
});
test('M1 unknown initial MODSEQ establishes flags baseline beyond the recent window',async()=>{
  await db.query('UPDATE mail_folders SET highest_modseq=NULL WHERE id=$1',[folderId]);
  for(let uid=1;uid<=202;uid++)await seed(uid);
  const client=imap({messages:Array.from({length:202},(_,i)=>({uid:i+1,seen:i===0,modseq:'11'}))});
  const result=await run(client);assert.equal(result.error,undefined);assert.equal(result.flags.strategy,'condstore_baseline');
  assert.equal((await db.query('SELECT is_read FROM mail_messages WHERE external_uid=1')).rows[0].is_read,true);
  assert.deepEqual(await cursors(),['7','11']);
});
test('M1 incomplete baseline flags cannot establish an initial MODSEQ',async()=>{
  await db.query('UPDATE mail_folders SET highest_modseq=NULL WHERE id=$1',[folderId]);
  const result=await run(imap({messages:[1,2],missingFlagUid:1}));
  assert.equal(result.error,'INVALID_IMAP_RESPONSE');assert.deepEqual(await cursors(),['7',null]);
});
test('M1 incomplete classic-IMAP flags response preserves the confirmed checkpoint',async()=>{
  await seed(1);const result=await run(imap({messages:[1],extension:false,missingFlagUid:1}));
  assert.equal(result.error,'INVALID_IMAP_RESPONSE');assert.deepEqual(await cursors(),['7','10']);
});
test('M1 partial SEARCH array must not mark an existing remote message missing',async()=>{
  await seed(2);const result=await run(imap({messages:[1,2],searchResult:[1]}));
  assert.equal(result.error,'INVALID_IMAP_RESPONSE');assert.deepEqual(await cursors(),['7','10']);
  assert.equal((await db.query('SELECT remote_missing_at FROM mail_messages')).rows[0].remote_missing_at,null);
});
test('M1 wrong UID returned by FETCH is not imported under the requested identity',async()=>{
  const result=await run(imap({messages:[1],wrongRawUid:true}));
  assert.equal(result.error,'INVALID_IMAP_RESPONSE');assert.equal((await db.query('SELECT * FROM mail_messages')).rows.length,0);
  assert.deepEqual(await cursors(),['7','10']);
});
test('M1 failed UID namespace rebuild preserves checkpoint and retries without mixing unknown legacy UID',async()=>{
  await seed(900,{validity:null});
  const failed=await run(imap({validity:'8',modseq:'1',messages:[1,2],fetchErrorUid:2}));
  assert.equal(failed.error,'CONNECTION_TIMEOUT');assert.equal(failed.imported,1);assert.deepEqual(await cursors(),['7','10']);
  const success=await run(imap({validity:'8',modseq:'1',messages:[1,2]}));assert.equal(success.error,undefined);
  assert.deepEqual(await cursors(),['8','1']);
  const rows=(await db.query('SELECT * FROM mail_messages')).rows;
  assert.equal(rows.length,3);assert.ok(rows.find(r=>r.external_uid_validity==null).remote_missing_at);
  assert.equal(rows.filter(r=>r.external_uid_validity==='8'&&!r.remote_missing_at).length,2);
});
test('M1 compare-and-set cannot overwrite a cursor changed by another writer',async()=>{
  let changed=false;
  beforeQuery=async sql=>{if(!changed&&/message_sync_status = 'SYNCED'/.test(sql)){
    changed=true;await db.query("UPDATE mail_folders SET uid_validity='8',highest_modseq='25' WHERE id=$1",[folderId]);
  }};
  const result=await run(imap({messages:[]}));assert.equal(result.error,'CURSOR_CHANGED');
  assert.deepEqual(await cursors(),['8','25']);
});
test('M1 discovery does not erase a previous failed message-sync diagnostic',async()=>{
  await db.query(`UPDATE mail_folders SET message_sync_status='ERROR',last_message_sync_error_code='CONNECTION_TIMEOUT',
    last_message_sync_error_message='retained failure',last_message_sync_error_at=now() WHERE id=$1`,[folderId]);
  await discover(imap());const f=await folder();
  assert.equal(f.last_message_sync_error_code,'CONNECTION_TIMEOUT');assert.equal(f.last_message_sync_error_message,'retained failure');
});
for(const mode of ['throw','false'])test(`M1 uncertain folder unlock destroys the held session (${mode})`,async()=>{
  unlockFailure=mode;assert.equal((await run(imap())).error,undefined);
  const owner=sqlLog.find(row=>/pg_try_advisory_lock/.test(row.sql)).owner;
  assert.ok(releases.find(row=>row.owner===owner)?.error);
});
test('M1 lost lock-acquisition response destroys the uncertain session without changing folder status',async()=>{
  lockResponseFailure=true;assert.ok((await run(imap())).error);
  const owner=sqlLog.find(row=>/pg_try_advisory_lock/.test(row.sql)).owner;
  assert.ok(releases.find(row=>row.owner===owner)?.error);
  assert.equal((await folder()).message_sync_status,'SYNCED');assert.deepEqual(await cursors(),['7','10']);
});
test('M1 namespace filter preserves existing deduplication for a local message with no IMAP reference',async()=>{
  await seed(null,{validity:null,messageId:'<local-before-imap@example.test>'});
  const result=await run(imap({messages:[{uid:1,messageId:'<local-before-imap@example.test>',modseq:'11'}]}));
  assert.equal(result.error,undefined);assert.equal(result.skipped,1);assert.equal(result.imported,0);
  assert.equal((await db.query('SELECT * FROM mail_messages')).rows.length,1);
});
test('M1 QRESYNC alone uses explicit full flags fallback when installed ImapFlow cannot send CHANGEDSINCE',async()=>{
  await seed(1);const client=imap({messages:[{uid:1,seen:true,modseq:'11'}]});
  client.enabled=new Set(['QRESYNC']);
  const result=await run(client);assert.equal(result.error,undefined);
  assert.equal(result.flags.strategy,'fallback_qresync_without_condstore');
  const fetch=client.calls.find(call=>call.type==='flags');assert.equal(fetch.range,'1:*');assert.equal(fetch.options.changedSince,undefined);
  assert.equal((await db.query('SELECT is_read FROM mail_messages')).rows[0].is_read,true);
});
