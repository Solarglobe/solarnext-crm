import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

let db, health, scanner;
const org='synthetic-org';
before(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE TABLE mail_accounts(id text,organization_id text,email text,display_name text,lifecycle_state text,
      imap_status text,smtp_status text,last_successful_sync_at timestamptz,next_sync_attempt_at timestamptz,
      last_error_code text,last_error_message text,reconnect_required boolean);
    CREATE TABLE mail_outbox(organization_id text,status text,sent_archive_status text,created_at timestamptz);
    CREATE TABLE mail_draft_sync_jobs(organization_id text,status text);
    CREATE TABLE mail_flag_mutations(organization_id text,status text);
    CREATE TABLE mail_move_mutations(organization_id text,status text);
    CREATE TABLE mail_drafts(organization_id text,sync_status text);
    CREATE TABLE mail_attachments(organization_id text,scan_status text,scan_attempt_count int,
      scan_next_attempt_at timestamptz,storage_path text);
    CREATE TABLE mail_draft_attachments(LIKE mail_attachments,cleanup_status text,upload_status text);
  `);
  const source=readFileSync(new URL('../services/mail/mailHealth.service.js',import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
  health=vm.runInNewContext(source+'\ngetMailHealthOverview',{
    pool:{query:(s,p)=>db.query(s,p)},MAIL_ATTACHMENT_SCAN_MAX_ATTEMPTS:6,
    getMailAttachmentScanConfig:()=>({scanMode:'required',scanner:'synthetic'}),
    getMailAttachmentScanMetrics:()=>({clean:0}),
    checkMailAttachmentScannerHealth:async()=>{if(scanner instanceof Error)throw scanner;return scanner;},
  });
});
after(()=>db.close());
beforeEach(async()=>{
  scanner={ok:true,provider:'synthetic',status:'CLEAN'};
  await db.exec('TRUNCATE mail_accounts,mail_outbox,mail_draft_sync_jobs,mail_flag_mutations,mail_move_mutations,mail_drafts,mail_attachments,mail_draft_attachments');
});
const get=()=>health({organizationId:org});
async function attachment(status,attempts=0,kind='messages',extra={}){
  const table=kind==='drafts'?'mail_draft_attachments':'mail_attachments';
  await db.query(`INSERT INTO ${table}(organization_id,scan_status,scan_attempt_count,scan_next_attempt_at,storage_path${kind==='drafts'?',cleanup_status,upload_status':''}) VALUES($1,$2,$3,$4,$5${kind==='drafts'?',\'active\',\'uploaded\'':''})`,
    [extra.org||org,status,attempts,extra.next===null?null:new Date(Date.now()+60000),extra.path===null?null:'synthetic/path']);
}
for(const kind of ['messages','drafts'])test(`M9 ${kind}: mutually exclusive scan categories, retries and exhausted`,async()=>{
  for(const [status,attempts]of[['PENDING',0],['SCANNING',6],['UNAVAILABLE',2],['FAILED',2],['FAILED',6],['CLEAN',6],['INFECTED',1],['UNAVAILABLE',6]])await attachment(status,attempts,kind);
  const h=await get(),c=h.scans?.[kind];
  assert.ok(c,'separate scan overview is required');
  assert.equal(c.pending,1);assert.equal(c.scanning,1);assert.equal(c.unavailable,1);assert.equal(c.retryScheduled,1);
  assert.equal(c.exhausted,2);assert.equal(c.clean,1);assert.equal(c.infected,1);
  assert.equal(c.total,8);assert.equal(Object.entries(c).filter(([k])=>k!=='total').reduce((s,[,v])=>s+v,0),8);
  assert.equal(kind==='messages'?h.queues.scanPending:h.queues.draftScanPending,1);
});
test('M9 failures without runnable source/schedule are not presented as retries',async()=>{
  await attachment('FAILED',1,'messages',{path:null});await attachment('FAILED',1,'messages',{next:null});
  assert.equal((await get()).scans.messages.failedUnscheduled,2);
});
test('M9 deleted/incomplete draft uploads are excluded from active scan inventory',async()=>{
  await attachment('PENDING',0,'drafts');await attachment('PENDING',0,'drafts');
  await db.exec("UPDATE mail_draft_attachments SET cleanup_status='deleted'");
  assert.equal((await get()).scans.drafts.total,0);
});
test('M9 490 mixed items are partitioned, exhausted rows never count as pending',async()=>{
  await db.query(`INSERT INTO mail_attachments SELECT $1,CASE WHEN n<=70 THEN 'PENDING' WHEN n<=140 THEN 'SCANNING' WHEN n<=210 THEN 'UNAVAILABLE' WHEN n<=350 THEN 'FAILED' WHEN n<=420 THEN 'CLEAN' ELSE 'INFECTED' END,CASE WHEN n>280 AND n<=350 THEN 6 ELSE 1 END,now(),'synthetic/path' FROM generate_series(1,490) n`,[org]);
  const h=await get();assert.equal(h.scans.messages.total,490);
  for(const key of['pending','scanning','unavailable','retryScheduled','exhausted','clean','infected'])assert.equal(h.scans.messages[key],70,key);
  assert.equal(h.queues.scanPending,70);
});
test('M9 organization isolation',async()=>{
  await attachment('FAILED',6,'messages',{org:'another-org'});assert.equal((await get()).scans.messages.total,0);
});
test('M9 unknown durable states remain visible',async()=>{
  await attachment('UNRECOGNIZED');assert.equal((await get()).scans.messages.unknown,1);
});
for(const [value,state]of[[{ok:true,status:'CLEAN'},'available'],[{ok:false,errorCode:'SCANNER_UNAVAILABLE'},'unavailable'],[{},'unknown'],[{ok:true,errorCode:'SCANNER_UNAVAILABLE'},'unavailable'],[{ok:true,provider:'disabled'},'disabled']])test(`M9 scanner state ${JSON.stringify(value)}`,async()=>{
  scanner=value;assert.equal((await get()).scanner.availability,state);
});
test('M9 scanner health exception is unavailable with diagnostic',async()=>{
  scanner=Object.assign(new Error('synthetic failure'),{code:'SCAN_TIMEOUT'});
  const h=await get();assert.equal(h.scanner.availability,'unavailable');assert.equal(h.scanner.errorCode,'SCAN_TIMEOUT');
});
test('M9 draft worker states running/succeeded and uppercase CONFLICT',async()=>{
  for(const status of['queued','retrying','running','succeeded','failed'])await db.query('INSERT INTO mail_draft_sync_jobs VALUES($1,$2)',[org,status]);
  await db.query("INSERT INTO mail_drafts VALUES($1,'CONFLICT'),($1,'SYNCED')",[org]);
  const h=await get();assert.equal(h.queues.draftJobsDepth,3);assert.equal(h.queues.draftConflicts,1);
  for(const key of['queued','retrying','running','completed','failed'])assert.equal(h.jobs.drafts[key],1,key);
});
test('M9 archive running and done have distinct counters',async()=>{
  for(const status of['pending','retrying','running','done','failed'])await db.query("INSERT INTO mail_outbox VALUES($1,'sent',$2,now())",[org,status]);
  const h=await get();assert.equal(h.jobs.sentArchive.running,1);assert.equal(h.jobs.sentArchive.completed,1);assert.equal(h.queues.sentArchivePending,2);
});
