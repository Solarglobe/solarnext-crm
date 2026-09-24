import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { buildSimpleRfc822Mime } from '../services/mail/mailMimeBuilder.service.js';
import * as archiveService from '../services/mail/mailSentArchive.service.js';
const sourceBase=process.env.MAIL_TEST_SOURCE_ROOT ? pathToFileURL(process.env.MAIL_TEST_SOURCE_ROOT+'/backend/tests/').href : import.meta.url;
const strip=rel=>readFileSync(new URL(rel,sourceBase),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
const provider=vm.runInNewContext(strip('../services/mail/mailSentArchiveProvider.service.js')+'\n({ensureSentMessageWithClient,findSentMessageWithClient})',{simpleParser,Buffer,Date});
const identityUrl=new URL('../services/mail/mailSentIdentity.service.js',import.meta.url);
const identities=existsSync(identityUrl)?await import(identityUrl.href):{};
let db,pool,api,archive,imap,wire,smtpCalls,providerId,smtpFail,blockSmtp,locks,finalizeFail;
const org='org',account='account',msg='message',jobId='job',thread='conversation';
const noop=()=>{},logger={info:noop,warn:noop,error:noop};
const current=async()=> {const row=(await db.query('SELECT * FROM mail_outbox WHERE id=$1',[jobId])).rows[0];
  if(row.smtp_mime_rfc822)row.smtp_mime_rfc822=Buffer.from(row.smtp_mime_rfc822);return row;};
const deliver=async()=>api.deliverOutboxJob(await current());
const archiveIt=async()=>archive.processSentJob(await current());
before(async()=>{
  db=new PGlite();await db.exec(`
    CREATE TYPE mail_message_status AS ENUM ('SENT','SENDING','QUEUED','FAILED');
    CREATE TABLE mail_outbox(id text PRIMARY KEY,organization_id text,mail_account_id text,mail_message_id text,mail_thread_id text,
      status text,stable_message_id text,provider_message_id text,smtp_mime_rfc822 bytea,smtp_completed_at timestamptz,
      sent_archive_status text,sent_archive_next_attempt_at timestamptz,sent_archive_attempt_count int DEFAULT 0,sent_archive_error text,
      sent_at timestamptz,last_error text,updated_at timestamptz,last_attempt_at timestamptz,attempt_count int,max_attempts int,
      from_name text,reply_to text,created_by text,sent_folder_id text,sent_remote_uid int,sent_remote_uid_validity text,next_attempt_at timestamptz);
    CREATE TABLE mail_messages(id text,organization_id text,mail_account_id text,mail_thread_id text,body_text text,body_html text,subject text,
      in_reply_to text,references_ids text[],message_id text,status mail_message_status,sent_at timestamptz,folder_id text,
      failure_code text,failure_reason text,provider_response text,external_uid int,external_uid_validity text,sync_source text,received_at timestamptz,external_internal_date timestamptz,created_at timestamptz);
    CREATE TABLE mail_participants(mail_message_id text,type text,email text);
    CREATE TABLE mail_attachments(mail_message_id text,organization_id text,file_name text,mime_type text,storage_path text,size_bytes int,scan_status text);
    CREATE TABLE mail_accounts(id text,organization_id text,email text,display_name text,is_active boolean,lifecycle_state text,sync_enabled boolean,reconnect_required boolean);
    CREATE TABLE mail_folders(id text,mail_account_id text,organization_id text,type text,is_active boolean,external_id text,name text);
  `);
});
after(()=>db.close());
beforeEach(async()=>{
  wire=[];smtpCalls=0;providerId=null;smtpFail=false;blockSmtp=null;locks=new Set();finalizeFail=false;
  await db.exec('TRUNCATE mail_outbox,mail_messages,mail_participants,mail_attachments,mail_accounts,mail_folders');
  await db.query("INSERT INTO mail_outbox(id,organization_id,mail_account_id,mail_message_id,mail_thread_id,status,attempt_count,max_attempts,sent_archive_status,last_attempt_at) VALUES($1,$2,$3,$4,$5,'sending',0,4,'not_started',now())",[jobId,org,account,msg,thread]);
  await db.query("INSERT INTO mail_messages(id,organization_id,mail_account_id,mail_thread_id,subject,body_text,in_reply_to,references_ids,status) VALUES($1,$2,$3,$4,'Synthetic','Body','<parent@example.invalid>',ARRAY['<parent@example.invalid>'],'SENDING')",[msg,org,account,thread]);
  await db.query("INSERT INTO mail_participants VALUES($1,'TO','to@example.invalid'),($1,'BCC','hidden@example.invalid')",[msg]);
  await db.query("INSERT INTO mail_accounts VALUES($1,$2,'from@example.invalid','Synthetic',true,'CONNECTED',true,false)",[account,org]);
  await db.query("INSERT INTO mail_folders VALUES('sent',$1,$2,'SENT',true,'Sent','Sent')",[account,org]);
  pool={query:(s,p)=>db.query(s,p),async connect(){let held=null;return{async query(s,p){
    if(s.includes('pg_try_advisory_lock')){const locked=!locks.has(p[0]);if(locked){locks.add(p[0]);held=p[0];}return{rows:[{locked}]};}
    if(s.includes('pg_advisory_unlock')){const owned=held===p[0];if(owned)locks.delete(held);held=null;return{rows:[{unlocked:owned,pg_advisory_unlock:owned}]};}
    return db.query(s,p);},release(error){if(error&&held)locks.delete(held);}};}};
  const smtpSource=strip('../services/mail/smtp.service.js');
  const smtpFn=smtpSource.slice(smtpSource.indexOf('async function sendMailNodemailerOnly('),smtpSource.indexOf('async function sendMailViaSmtp('));
  const smtpOnly=vm.runInNewContext(smtpFn+'\nsendMailNodemailerOnly',{
    assertSafeMailEndpoint:async()=>{},createSmtpTransport:()=>({close:noop,async sendMail(options){
      smtpCalls++;if(blockSmtp)await blockSmtp();if(smtpFail)throw new Error('Synthetic SMTP failure before acceptance');
      const built=await nodemailer.createTransport({name:'synthetic',version:'1',send(mail,done){
        assert.ok(mail.message.getEnvelope().to.includes('hidden@example.invalid'));
        mail.message.build((error,message)=>done(error,{message,messageId:mail.message.messageId()}));
      }}).sendMail(options);wire.push(built.message);
      return{messageId:providerId||built.messageId,response:'synthetic accepted'};
    }}),
  });
  const finalizer=vm.runInNewContext(strip('../services/mail/mailSendFinalize.service.js')+'\nfinalizeOutboundSentInTransaction',{
    getSentFolderId:async()=> 'sent',rebuildThreadMetadata:async()=>{if(finalizeFail)throw new Error('Synthetic metadata failure');},
  });
  api=vm.runInNewContext(strip('../services/mail/mailOutbox.processor.js')+'\n({deliverOutboxJob,handleOutboxDeliveryFailure})',{
    pool,process:{env:{}},Date,Buffer,console,randomUUID,logger,...archiveService,...identities,buildSimpleRfc822Mime,
    OUTBOUND_ATTACHMENT_LIMITS:{totalBytes:1000000,perFileBytes:1000000},emitEventAsync:noop,
    loadActiveMailAccountWithSmtpCredentials:async()=>({acc:{email:'from@example.invalid',smtp_host:'synthetic.invalid',smtp_port:465}}),
    sendMailNodemailerOnly:smtpOnly,finalizeOutboundSentInTransaction:finalizer,delayMsAfterFailedAttempt:()=>1000,
  });
  imap=new FakeImap();
  archive=vm.runInNewContext(strip('../services/mail/mailSentArchive.processor.js')+'\n({processSentJob,processMailSentArchiveBatch})',{
    pool,process:{env:{}},Date,Buffer,logger,...identities,buildSimpleRfc822Mime,
    withDraftImapClient:async(_pool,_p,fn)=>fn(imap),...provider,rebuildThreadMetadata:async()=>{},delayMsAfterFailedAttempt:()=>1,
  });
});
class FakeImap {
  constructor(){this.messages=[];this.appends=0;this.failBefore=false;this.loseResponse=false;this.searches=[];}
  async mailboxOpen(){return{uidValidity:'42',highestModseq:'5'};}
  async search(q){this.searches.push(q);return this.messages.map(m=>m.uid);}
  async *fetch(range){const m=this.messages.find(x=>x.uid===Number(range));if(m)yield m;}
  async append(_path,mime){if(this.failBefore)throw new Error('Synthetic before APPEND');this.appends++;
    const uid=this.messages.length+1;this.messages.push({uid,source:Buffer.from(mime),modseq:'6'});
    if(this.loseResponse){this.loseResponse=false;throw new Error('Synthetic APPEND response lost');}return{uid,uidValidity:'42'};}
  async messageFlagsAdd(){}
}
for(const initial of [null,'<application@example.invalid>'])test(`M7 one identity through actual SMTP MIME and archive, initial=${initial}`,async()=>{
  if(initial)await db.query('UPDATE mail_outbox SET stable_message_id=$1',[initial]);
  await deliver();const row=await current(),sent=await simpleParser(wire[0]),copy=await simpleParser(row.smtp_mime_rfc822);
  assert.equal(sent.messageId,copy.messageId);assert.equal(row.stable_message_id,sent.messageId);
  if(initial)assert.equal(sent.messageId,initial);assert.equal(row.provider_message_id,sent.messageId);
  assert.equal(sent.bcc,undefined,'BCC must not leak into the transmitted MIME');
  assert.equal(sent.inReplyTo,'<parent@example.invalid>');
  const stored=(await db.query('SELECT * FROM mail_messages')).rows[0];assert.equal(stored.message_id,sent.messageId);assert.equal(stored.mail_thread_id,thread);
});
test('M7 reported replacement ID is source of truth for archive and threading',async()=>{
  providerId='<provider@example.invalid>';await deliver();const row=await current();
  assert.equal(row.stable_message_id,providerId);assert.equal((await simpleParser(row.smtp_mime_rfc822)).messageId,providerId);
  const find=vm.runInNewContext(strip('../services/mail/mailThreading.service.js')+'\nfindThreadByMessageId',{});
  assert.equal(await find(pool,{organizationId:org,mailAccountId:account,messageId:providerId}),thread);
});
test('M7 retry before SMTP acceptance preserves reserved ID',async()=>{
  smtpFail=true;await assert.rejects(deliver());const failed=await current();assert.ok(failed.stable_message_id);
  smtpFail=false;await deliver();assert.equal((await current()).stable_message_id,failed.stable_message_id);
});
test('M7 concurrent delivery attempts send once and accepted retry never resends',async()=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  blockSmtp=async()=>{entered();await gate;};const first=deliver();await started;
  const second=deliver();await new Promise(r=>setTimeout(r,30));release();await Promise.all([first,second]);
  assert.equal(smtpCalls,1);blockSmtp=null;await deliver();assert.equal(smtpCalls,1);
});
test('M7 provider-created sent copy is reconciled without APPEND',async()=>{
  await deliver();const row=await current();imap.messages.push({uid:15,source:row.smtp_mime_rfc822});
  await archiveIt();assert.equal(imap.appends,0);assert.equal((await current()).sent_archive_status,'done');
});
test('M7 manual APPEND retry after pre-append error does not resend SMTP',async()=>{
  await deliver();imap.failBefore=true;await assert.rejects(archiveIt());imap.failBefore=false;
  await archiveIt();assert.equal(imap.appends,1);assert.equal(smtpCalls,1);
});
test('M7 lost APPEND response retry reconciles without duplicate',async()=>{
  await deliver();imap.loseResponse=true;await assert.rejects(archiveIt());await archiveIt();
  assert.equal(imap.appends,1);assert.equal(smtpCalls,1);assert.equal((await current()).sent_archive_status,'done');
});
test('M7 existing copy older than 500 messages is still found',async()=>{
  await deliver();const row=await current();imap.messages.push({uid:1,source:row.smtp_mime_rfc822});
  for(let uid=2;uid<=502;uid++)imap.messages.push({uid,source:Buffer.from(`Message-ID: <other-${uid}@example.invalid>\r\n\r\nBody`)});
  await archiveIt();assert.equal(imap.appends,0);assert.ok(imap.searches[0].header);
});
test('M7 concurrent archive attempts create one copy',async()=>{
  await deliver();await Promise.all([archiveIt(),archiveIt()]);assert.equal(imap.appends,1);
});
test('M7 after durable SMTP acceptance, metadata failure cannot cause SMTP retry',async()=>{
  finalizeFail=true;const job=await current();let failure;
  try{await deliver();}catch(e){failure=e;}
  assert.ok(failure);assert.ok((await current()).smtp_completed_at);
  finalizeFail=false;await api.handleOutboxDeliveryFailure(job,failure);await deliver();assert.equal(smtpCalls,1);
});

test('M7 opaque SMTP queue token does not replace an RFC Message-ID',async()=>{
  providerId='queue-12345';await deliver();const row=await current();
  assert.equal(row.stable_message_id,(await simpleParser(wire[0])).messageId);
  assert.equal(row.stable_message_id,(await simpleParser(row.smtp_mime_rfc822)).messageId);
});
test('M7 MIME identity replacement preserves exact body bytes and a single folded header',()=>{
  const original=Buffer.concat([Buffer.from('From: a@example.invalid\r\nMessage-ID: <old@\r\n example.invalid>\r\nSubject: Synthetic\r\n\r\n'),Buffer.from([0,255,128,42])]);
  const aligned=identities.alignSentMimeIdentity(original,'<new@example.invalid>');
  assert.deepEqual(aligned.subarray(aligned.indexOf('\r\n\r\n')+4),Buffer.from([0,255,128,42]));
  assert.equal((aligned.toString('latin1').match(/^Message-ID:/gm)||[]).length,1);
});
test('M7 malformed initial ID is refused before SMTP',async()=>{
  await db.query('UPDATE mail_outbox SET stable_message_id=$1',['<id@example.invalid>\r\nInjected: yes']);
  await assert.rejects(deliver(),/Message-ID/);assert.equal(smtpCalls,0);
});
test('M7 missing historical MIME is explicit and never rebuilt without attachments',async()=>{
  await deliver();await db.exec('UPDATE mail_outbox SET smtp_mime_rfc822=NULL');
  await assert.rejects(archiveIt(),e=>e.code==='SENT_MIME_MISSING');assert.equal(imap.appends,0);
});
test('M7 unconfirmed APPEND never becomes done; subsequent search can reconcile',async()=>{
  await deliver();const append=imap.append.bind(imap);let hide=true;
  imap.search=async()=>hide?[]:imap.messages.map(m=>m.uid);
  imap.append=append;await assert.rejects(archiveIt(),e=>e.code==='SENT_ARCHIVE_PENDING');
  assert.notEqual((await current()).sent_archive_status,'done');hide=false;await archiveIt();assert.equal(imap.appends,1);
});
test('M7 incomplete search fails closed before APPEND',async()=>{
  await deliver();imap.search=async()=>false;await assert.rejects(archiveIt(),/incomplète/);assert.equal(imap.appends,0);
});
test('M7 stale running archive is recovered after interruption',async()=>{
  await deliver();await db.exec("UPDATE mail_outbox SET sent_archive_status='running',updated_at=now()-interval '11 minutes'");
  const result=await archive.processMailSentArchiveBatch();assert.equal(result.processed,1);
  assert.equal((await current()).sent_archive_status,'done');assert.equal(imap.appends,1);
});
test('M7 recent running archive is not reclaimed',async()=>{
  await deliver();await db.exec("UPDATE mail_outbox SET sent_archive_status='running',updated_at=now()");
  assert.equal((await archive.processMailSentArchiveBatch()).processed,0);assert.equal(imap.appends,0);
});

test('M7 legacy mismatched frozen header is aligned to the accepted provider ID',async()=>{
  await deliver();const accepted=(await current()).provider_message_id;
  const wrong=buildSimpleRfc822Mime({from:'from@example.invalid',to:'to@example.invalid',messageId:'<old-archive@example.invalid>',bodyText:'Original body'});
  await db.query('UPDATE mail_outbox SET stable_message_id=$1,smtp_mime_rfc822=$2',['<old-archive@example.invalid>',wrong]);
  await archiveIt();assert.equal((await simpleParser(imap.messages[0].source)).messageId,accepted);
  assert.equal((await current()).stable_message_id,accepted);
});
test('M7 replacement accepted ID matches a provider-created copy',async()=>{
  providerId='<replaced@example.invalid>';await deliver();
  imap.messages.push({uid:9,source:buildSimpleRfc822Mime({messageId:providerId,bodyText:'Provider copy'})});
  await archiveIt();assert.equal(imap.appends,0);
});
test('M7 temporary checkpoint failure can persist acceptance without SMTP retry',async()=>{
  const query=pool.query;let once=true;
  pool.query=async(s,p)=>{if(once&&s.includes("status = 'sent', smtp_completed_at")){once=false;throw new Error('Synthetic checkpoint failure');}return query(s,p);};
  await assert.rejects(api.deliverOutboxJob(await current(),true));
  const row=await current();assert.ok(row.smtp_completed_at);assert.equal(row.sent_archive_status,'retrying');
  await deliver();assert.equal(smtpCalls,1);await archiveIt();assert.equal(imap.appends,1);
});

test('M7 actual archive batch records retry after lost APPEND response then deduplicates',async()=>{
  await deliver();imap.loseResponse=true;
  await archive.processMailSentArchiveBatch();let row=await current();
  assert.equal(row.sent_archive_status,'retrying');assert.equal(row.sent_archive_attempt_count,1);
  await db.exec('UPDATE mail_outbox SET sent_archive_next_attempt_at=now()');
  await archive.processMailSentArchiveBatch();row=await current();
  assert.equal(row.sent_archive_status,'done');assert.equal(imap.appends,1);assert.equal(smtpCalls,1);
});

test('M7 connection failure after accepted checkpoint stays an archive-only retry',async()=>{
  const connect=pool.connect;let count=0;
  pool.connect=async()=>{if(++count===2)throw new Error('Synthetic finalization connection failure');return connect();};
  await assert.rejects(api.deliverOutboxJob(await current(),true),e=>e.code==='SENT_ARCHIVE_FAILED');
  assert.ok((await current()).smtp_completed_at);assert.equal((await current()).sent_archive_status,'retrying');
  await deliver();await archiveIt();assert.equal(smtpCalls,1);assert.equal(imap.appends,1);
});
