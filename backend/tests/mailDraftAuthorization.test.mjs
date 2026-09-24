import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as sync from '../services/mail/mailDraftSync.service.js';
import * as states from '../services/mail/mailAccountState.service.js';

// Real service bodies and PostgreSQL SQL, with an ephemeral in-memory engine.
// db.js, environment loaders, storage and network providers are never imported.
function load(relative, dependencies, exports) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  return vm.runInNewContext(`${source}\n;({${exports.join(',')}})`, { ...dependencies, console, Buffer });
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE rbac_permissions (id text PRIMARY KEY, code text);
    CREATE TABLE rbac_roles (id text PRIMARY KEY, organization_id text);
    CREATE TABLE rbac_role_permissions (role_id text, permission_id text);
    CREATE TABLE rbac_user_roles (user_id text, role_id text);
    INSERT INTO rbac_permissions VALUES ('p-use','mail.use'),('p-all','mail.view.all');
    INSERT INTO rbac_roles VALUES ('role-a','org-a');
    INSERT INTO rbac_role_permissions VALUES ('role-a','p-use');
    INSERT INTO rbac_user_roles VALUES ('user-a','role-a');
    CREATE TABLE mail_accounts (id text PRIMARY KEY, organization_id text, user_id text,
      is_active boolean DEFAULT true, lifecycle_state text DEFAULT 'CONNECTED',
      sync_enabled boolean DEFAULT true, reconnect_required boolean DEFAULT false);
    INSERT INTO mail_accounts (id,organization_id,user_id) VALUES
      ('owned','org-a','user-a'),('allowed-b','org-a','user-a'),
      ('forbidden','org-a','user-b'),('foreign','org-b','user-a'),('delegated','org-a','user-b');
    CREATE TABLE mail_account_permissions (mail_account_id text, organization_id text, user_id text,
      can_read boolean, can_send boolean, can_manage boolean);
    INSERT INTO mail_account_permissions VALUES ('delegated','org-a','user-a',true,true,false);
    CREATE TABLE mail_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id text, user_id text, mail_account_id text,
      to_recipients text, cc_recipients text, bcc_recipients text, subject text,
      body_text text, body_html text, attachments_json jsonb DEFAULT '[]',
      message_id text, draft_identity text, remote_folder_id text, remote_uid bigint,
      remote_uid_validity text, remote_modseq text, local_version integer DEFAULT 1,
      remote_version text, sync_status text, local_dirty boolean,
      last_local_saved_at timestamptz, last_remote_saved_at timestamptz, sync_error text,
      conflict_of_draft_id uuid, conflict_reason text, abandoned_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE mail_draft_sync_jobs (id text DEFAULT gen_random_uuid()::text,
      organization_id text, mail_account_id text, draft_id text, action text, status text,
      idempotency_key text, payload_json jsonb, next_attempt_at timestamptz, updated_at timestamptz,
      UNIQUE(organization_id,idempotency_key));
    CREATE TABLE mail_folders (id text, organization_id text, mail_account_id text, path text, type text);
    CREATE TABLE mail_draft_attachments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id text,user_id text,mail_account_id text,draft_id uuid,file_name text,
      storage_path text,mime_type text,size_bytes integer,content_sha256 text,upload_status text,
      scan_status text,is_inline boolean,content_id text,cleanup_status text DEFAULT 'referenced',
      updated_at timestamptz DEFAULT now());
  `);
  const statements = [];
  const client = { async query(sql, values) { statements.push(sql); return db.query(sql, values); }, release() {} };
  const pool = { ...client, async connect() { return client; } };
  const access = load('../services/mailAccess.service.js', { ...states }, ['resolveMailAccountAccess']);
  const helperUrl = new URL('../services/mail/mailDraftAccess.service.js', import.meta.url);
  const auth = existsSync(helperUrl) ? load('../services/mail/mailDraftAccess.service.js', { ...access, ...states }, ['assertDraftMailAccountAccess']) : {};
  const fenceUrl = new URL('../services/mail/mailDraftFence.service.js', import.meta.url);
  const fence = existsSync(fenceUrl) ? load('../services/mail/mailDraftFence.service.js', {}, ['lockDraftTransaction', 'draftJobFence']) : {};
  const attachmentsUrl = new URL('../services/mail/mailDraftRemoteAttachments.service.js', import.meta.url);
  const noExternalEffects = () => { throw new Error('Unexpected storage access'); };
  const attachments = existsSync(attachmentsUrl) ? load('../services/mail/mailDraftRemoteAttachments.service.js', {
    uploadMailAttachmentFile:noExternalEffects,deleteFile:noExternalEffects,scanMailAttachmentBuffer:noExternalEffects,
  }, ['adoptRemoteDraftAttachments']) : {};
  const service = load('../services/mail/mailDraft.service.js', { pool, randomUUID, ...sync, ...auth, ...fence, ...attachments },
    ['createDraft','updateDraft','deleteDraft','resolveDraftConflict','normalizeDraftPayload']);
  const ctx = { userId:'user-a', organizationId:'org-a' };
  const draft = account => service.normalizeDraftPayload({ mailAccountId:account, subject:'Synthetic draft', bodyText:'test only' });
  return { db, client, statements, service, auth, ctx, draft, close:()=>db.close() };
}

for (const account of ['owned','delegated']) test(`M6 create allowed ${account}`, async () => {
  const f=await fixture(); try {
    const result=await f.service.createDraft({...f.ctx,draft:f.draft(account)});
    assert.equal(result.mail_account_id,account);
    assert.equal((await f.db.query('SELECT * FROM mail_draft_sync_jobs')).rows.length,1);
  } finally { await f.close(); }
});
for (const account of ['forbidden','foreign','unknown']) test(`M6 reject ${account} without draft or job`, async () => {
  const f=await fixture(); try {
    await assert.rejects(f.service.createDraft({...f.ctx,draft:f.draft(account)}), e=>e.statusCode===403);
    assert.equal((await f.db.query('SELECT * FROM mail_drafts')).rows.length,0);
    assert.equal((await f.db.query('SELECT * FROM mail_draft_sync_jobs')).rows.length,0);
  } finally { await f.close(); }
});
for (const [label,sql] of [
  ['inactive', "UPDATE mail_accounts SET is_active=false WHERE id='owned'"],
  ['revoked send', "UPDATE mail_account_permissions SET can_send=false WHERE mail_account_id='delegated'"],
  ['no mail.use', 'DELETE FROM rbac_user_roles'],
  ['foreign role', "UPDATE rbac_roles SET organization_id='org-b'"],
]) test(`M6 rejects ${label}`,async()=>{
  const f=await fixture();try{
    await f.db.exec(sql);
    await assert.rejects(f.service.createDraft({...f.ctx,draft:f.draft(label==='revoked send'?'delegated':'owned')}),e=>e.statusCode===403);
    assert.equal((await f.db.query('SELECT * FROM mail_draft_sync_jobs')).rows.length,0);
  }finally{await f.close();}
});
test('M6 forbidden account switch preserves current draft and creates no job',async()=>{
  const f=await fixture();try{
    const initial=await f.service.createDraft({...f.ctx,draft:f.draft('owned')});
    const before=(await f.db.query('SELECT * FROM mail_drafts')).rows;
    await assert.rejects(f.service.updateDraft({...f.ctx,id:initial.id,draft:f.draft('forbidden')}),e=>e.statusCode===403);
    assert.deepEqual((await f.db.query('SELECT * FROM mail_drafts')).rows,before);
    assert.equal((await f.db.query('SELECT * FROM mail_draft_sync_jobs')).rows.length,1);
  }finally{await f.close();}
});
test('M6 fresh delegation is rechecked on edit and authorization rows locked until commit',async()=>{
  const f=await fixture();try{
    const initial=await f.service.createDraft({...f.ctx,draft:f.draft('delegated')});
    assert.ok(f.statements.some(s=>s.includes('rbac_user_roles') && /FOR SHARE/.test(s)));
    assert.ok(f.statements.some(s=>s.includes('FROM mail_accounts') && /FOR SHARE/.test(s)));
    assert.ok(f.statements.some(s=>s.includes('FROM mail_account_permissions') && /FOR SHARE/.test(s)));
    await f.db.exec('DELETE FROM mail_account_permissions');
    await assert.rejects(f.service.updateDraft({...f.ctx,id:initial.id,draft:f.draft('delegated')}),e=>e.statusCode===403);
  }finally{await f.close();}
});
test('M6 fresh worker authorization blocks disabled sync and reconnect',async()=>{
  const f=await fixture();try{
    assert.equal(typeof f.auth.assertDraftMailAccountAccess,'function');
    for(const change of ['sync_enabled=false','sync_enabled=true,reconnect_required=true']) {
      await f.db.exec(`UPDATE mail_accounts SET ${change} WHERE id='owned'`);
      await assert.rejects(f.auth.assertDraftMailAccountAccess(f.client,{...f.ctx,mailAccountId:'owned'},{forSync:true}),e=>e.statusCode===403);
    }
  }finally{await f.close();}
});
test('M6 organization-wide mail permission authorizes only the effective organization',async()=>{
  const f=await fixture();try{
    await f.db.exec("INSERT INTO rbac_role_permissions VALUES ('role-a','p-all')");
    await f.service.createDraft({...f.ctx,draft:f.draft('forbidden')});
    await assert.rejects(f.service.createDraft({...f.ctx,draft:f.draft('foreign')}),e=>e.statusCode===403);
  }finally{await f.close();}
});
test('M5 real SQL clears every remote reference and rotates generation for A -> B -> A',async()=>{
  const f=await fixture();try{
    const a=await f.service.createDraft({...f.ctx,draft:f.draft('owned')});
    await f.db.query(`INSERT INTO mail_draft_attachments
      (organization_id,user_id,mail_account_id,draft_id,file_name,storage_path,upload_status)
      VALUES ('org-a','user-a','owned',$1,'keep.pdf','private/keep','uploaded')`,[a.id]);
    await f.db.query(`UPDATE mail_drafts SET remote_folder_id='folder-a',remote_uid=42,
      remote_uid_validity='a-validity',remote_modseq='old-modseq',remote_version='old-version',
      last_remote_saved_at=now(),sync_error='old-error',conflict_reason='old-conflict'
      WHERE id=$1`,[a.id]);
    const b=await f.service.updateDraft({...f.ctx,id:a.id,draft:f.draft('allowed-b')});
    for(const key of ['remote_folder_id','remote_uid','remote_uid_validity','remote_modseq','remote_version','last_remote_saved_at','sync_error','conflict_reason']) assert.equal(b[key],null,key);
    assert.notEqual(b.draft_identity,a.draft_identity);
    assert.notEqual(b.message_id,a.message_id);
    assert.equal((await f.db.query('SELECT mail_account_id FROM mail_draft_attachments WHERE draft_id=$1',[a.id])).rows[0].mail_account_id,'allowed-b');
    const again=await f.service.updateDraft({...f.ctx,id:a.id,draft:f.draft('owned')});
    assert.notEqual(again.draft_identity,a.draft_identity);
    assert.notEqual(again.draft_identity,b.draft_identity);
    assert.equal(again.local_version,3);
    assert.equal((await f.db.query('SELECT mail_account_id FROM mail_draft_attachments WHERE draft_id=$1',[a.id])).rows[0].mail_account_id,'owned');
    const jobs=(await f.db.query('SELECT * FROM mail_draft_sync_jobs ORDER BY payload_json->>\'localVersion\'')).rows;
    assert.equal(jobs.length,3);
    assert.equal(jobs[1].payload_json.remote.uid,null);
    assert.equal(jobs[1].payload_json.remote.accountId,'allowed-b');
    assert.equal(jobs[2].payload_json.generation,again.draft_identity);
    assert.equal(await f.service.deleteDraft({...f.ctx,id:a.id}),true);
    assert.equal((await f.db.query('SELECT * FROM mail_drafts')).rows.length,0);
    assert.equal((await f.db.query("SELECT * FROM mail_draft_sync_jobs WHERE action='delete'")).rows.length,0);
  }finally{await f.close();}
});
test('M5 stale conflict from an earlier account generation cannot overwrite the current draft',async()=>{
  const f=await fixture();try{
    const a=await f.service.createDraft({...f.ctx,draft:f.draft('owned')});
    await f.db.query(`INSERT INTO mail_drafts (id,organization_id,user_id,mail_account_id,
      draft_identity,conflict_of_draft_id,sync_status,local_version)
      VALUES ('00000000-0000-4000-8000-000000000042','org-a','user-a','owned',$1,$2,'CONFLICT',1)`,[`${a.draft_identity}-remote-42`,a.id]);
    await f.service.updateDraft({...f.ctx,id:a.id,draft:f.draft('allowed-b')});
    const current=await f.service.updateDraft({...f.ctx,id:a.id,draft:f.draft('owned')});
    await assert.rejects(f.service.resolveDraftConflict({...f.ctx,id:'00000000-0000-4000-8000-000000000042',resolution:'use_remote'}),e=>e.statusCode===409);
    assert.equal((await f.db.query('SELECT draft_identity FROM mail_drafts WHERE id=$1',[a.id])).rows[0].draft_identity,current.draft_identity);
    assert.equal((await f.db.query('SELECT * FROM mail_drafts')).rows.length,2);
  }finally{await f.close();}
});
for(const editedCopy of [false,true]) test(`M4/M5 conflict resolution adopts attachments and preserves edited=${editedCopy}`,async()=>{
  const f=await fixture();try{
    const parent=await f.service.createDraft({...f.ctx,draft:f.draft('owned')});
    const copy=randomUUID();
    await f.db.query(`INSERT INTO mail_drafts (id,organization_id,user_id,mail_account_id,
      draft_identity,conflict_of_draft_id,sync_status,local_version,subject,remote_uid,remote_uid_validity,remote_folder_id,message_id)
      VALUES ($1,'org-a','user-a','owned',$2,$3,'CONFLICT',1,'Remote body',42,'valid','folder','<remote@test>')`,[copy,`${parent.draft_identity}-remote-42`,parent.id]);
    if(editedCopy) await f.db.query('UPDATE mail_drafts SET local_dirty=true,last_local_saved_at=now() WHERE id=$1',[copy]);
    await f.db.query(`INSERT INTO mail_draft_attachments (organization_id,user_id,mail_account_id,draft_id,
      file_name,storage_path,mime_type,size_bytes,content_sha256,upload_status,scan_status,is_inline,content_id)
      VALUES ('org-a','user-a','owned',$1,'old.txt','private/old','text/plain',3,'old','uploaded','CLEAN',false,null),
      ('org-a','user-a','owned',$2,'image.png','private/remote','image/png',7,'remote','uploaded','CLEAN',true,'logo')`,[parent.id,copy]);
    const result=await f.service.resolveDraftConflict({...f.ctx,id:copy,resolution:'use_remote'});
    assert.equal(result.id,parent.id);
    assert.equal(result.subject,'Remote body');
    assert.equal(result.remote_uid,42);
    assert.equal(result.remote_folder_id,'folder');
    assert.equal(result.local_version,2);
    assert.equal(result.local_dirty,editedCopy);
    assert.equal(result.sync_status,editedCopy?'QUEUED':'SYNCED');
    assert.equal((await f.db.query('SELECT * FROM mail_draft_sync_jobs')).rows.length,editedCopy?2:1);
    assert.equal(result.attachments_json.length,1);
    assert.equal(result.attachments_json[0].contentId,'logo');
    assert.equal(result.attachments_json[0].draftId,parent.id);
    const rows=(await f.db.query('SELECT * FROM mail_draft_attachments ORDER BY file_name')).rows;
    assert.equal(rows[0].draft_id,parent.id);
    assert.equal(rows[0].storage_path,'private/remote');
    assert.equal(rows[1].draft_id,null);
    assert.equal(rows[1].cleanup_status,'orphaned');
    assert.equal((await f.db.query('SELECT * FROM mail_drafts WHERE id=$1',[copy])).rows.length,0);
  }finally{await f.close();}
});
for(const choice of ['use_local','keep_both']) test(`M5 ${choice} increments version and fences the new save`,async()=>{
  const f=await fixture();try{
    const initial=await f.service.createDraft({...f.ctx,draft:f.draft('owned')});
    const result=await f.service.resolveDraftConflict({...f.ctx,id:initial.id,resolution:choice});
    assert.equal(result.local_version,2);
    const jobs=(await f.db.query('SELECT payload_json FROM mail_draft_sync_jobs ORDER BY payload_json->>\'localVersion\'')).rows;
    assert.equal(jobs.length,2);
    assert.equal(jobs[1].payload_json.localVersion,2);
    assert.equal(jobs[1].payload_json.generation,result.draft_identity);
  }finally{await f.close();}
});
