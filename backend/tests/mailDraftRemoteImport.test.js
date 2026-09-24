import test from "node:test";
import assert from "node:assert/strict";
import { importRemoteDraftMessage } from "../services/mail/mailDraftRemoteImport.service.js";
import { buildSimpleRfc822Mime } from "../services/mail/mailMimeBuilder.service.js";
import { simpleParser } from "mailparser";
import { PGlite } from "@electric-sql/pglite";
import { adoptRemoteDraftAttachments } from "../services/mail/mailDraftRemoteAttachments.service.js";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import * as policy from "../services/mail/mailAttachmentPolicy.service.js";
import { uploadMailAttachmentFile } from "../services/localStorage.service.js";

const input = {
  organizationId: "10000000-0000-0000-0000-000000000001", userId: "20000000-0000-0000-0000-000000000002", mailAccount: { id: "30000000-0000-0000-0000-000000000003" },
  folder: { id: "40000000-0000-0000-0000-000000000004" }, uidValidity: "1",
};
const bytes = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
function mime(attachments = [{ filename: "devis été.pdf", contentType: "application/pdf", content: bytes }]) {
  return buildSimpleRfc822Mime({ from: "a@example.test", to: "b@example.test", subject: "Draft", bodyText: "Bonjour", bodyHtml: '<p>Bonjour<img src="cid:logo@example.test"></p>', draftIdentity: "synthetic-identity", attachments });
}
async function harness(t) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE mail_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, mail_account_id uuid,
      to_recipients text, cc_recipients text, bcc_recipients text, subject text, body_text text, body_html text,
      attachments_json jsonb DEFAULT '[]', message_id text, draft_identity text, remote_folder_id uuid,
      remote_uid bigint, remote_uid_validity text, remote_modseq text, remote_version text,
      sync_status text, local_dirty boolean DEFAULT false, last_remote_saved_at timestamptz,
      conflict_of_draft_id uuid, conflict_reason text, sync_error text, updated_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_draft_identity ON mail_drafts(organization_id,draft_identity);
    CREATE TABLE mail_draft_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, mail_account_id uuid,
      draft_id uuid REFERENCES mail_drafts(id), file_name text, storage_path text, mime_type text,
      size_bytes bigint, content_sha256 text, upload_status text, is_inline boolean, content_id text,
      scan_status text, scan_checked_at timestamptz, scan_provider text, scan_error_code text,
      quarantine_reason text, cleanup_status text DEFAULT 'referenced', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_attachment_sha ON mail_draft_attachments(draft_id,content_sha256)
      WHERE draft_id IS NOT NULL AND cleanup_status <> 'deleted';
  `);
  await db.exec("BEGIN");
  t.after(async () => { await db.close(); });
  const uploads = [], queries = [], deleted = [], authorizations = [];
  const files = new Map();
  const client = { async query(sql, params = []) { queries.push({ sql, params }); return db.query(sql, params); } };
  const dependencies = {
    authorize: async (_client, scope, options) => { authorizations.push({ scope, options }); },
    upload: async (buffer, organizationId, fileName) => {
      uploads.push({ buffer: Buffer.from(buffer), organizationId, fileName });
      const storage_path = `synthetic/${uploads.length}`;
      files.set(storage_path, Buffer.from(buffer));
      return { storage_path };
    },
    remove: async path => { deleted.push(path); files.delete(path); },
    readBuffer: async path => {
      if (!files.has(path)) throw Object.assign(new Error("synthetic missing blob"), {code:"ENOENT"});
      return files.get(path);
    },
    scan: async () => ({ status: "CLEAN", provider: "synthetic", errorCode: null, quarantineReason: null }),
  };
  return { db, client, dependencies, uploads, queries, files, deleted, authorizations };
}

test("M4 actual remote draft import stores MIME bytes and attaches them to the created draft", async (t) => {
  const h = await harness(t);
  const result = await importRemoteDraftMessage(h.client, {}, { ...input, raw: { uid: 42, source: mime() } }, h.dependencies);
  assert.equal(result.imported, true);
  assert.equal(h.uploads.length, 1, "the MIME attachment must reach normal storage");
  assert.deepEqual(h.uploads[0], { buffer: bytes, organizationId: input.organizationId, fileName: "devis été.pdf" });
  assert.ok(h.queries.some(({ sql }) => /INSERT INTO mail_draft_attachments/.test(sql)));
  const [attachment] = (await h.db.query("SELECT * FROM mail_draft_attachments")).rows;
  const [draft] = (await h.db.query("SELECT * FROM mail_drafts")).rows;
  assert.equal(attachment.draft_id, draft.id);
  assert.equal(attachment.user_id, input.userId);
  assert.equal(attachment.mail_account_id, input.mailAccount.id);
  assert.equal(attachment.file_name, "devis été.pdf");
  assert.equal(attachment.mime_type, "application/pdf");
  assert.equal(Number(attachment.size_bytes), bytes.length);
  assert.equal(attachment.content_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(draft.attachments_json[0].id, attachment.id);
  assert.deepEqual(h.authorizations, [{scope: {organizationId: input.organizationId, userId: input.userId, mailAccountId: input.mailAccount.id}, options: {forSync: true}}]);
});

async function imported(h, source = mime(), uid = 42) {
  return importRemoteDraftMessage(h.client, {}, { ...input, raw: { uid, source } }, h.dependencies);
}

test("M4 resync reuses same rows and blobs, remote removal detaches obsolete references", async t => {
  const h = await harness(t), source = mime();
  const first = await imported(h, source);
  const second = await imported(h, source);
  assert.equal(second.draftId, first.draftId);
  assert.equal(h.uploads.length, 1);
  assert.equal((await h.db.query("SELECT * FROM mail_draft_attachments")).rows.length, 1);
  await imported(h, mime([]), 43);
  const [detached] = (await h.db.query("SELECT * FROM mail_draft_attachments")).rows;
  assert.equal(detached.draft_id, null);
  assert.equal(detached.cleanup_status, "orphaned");
  assert.deepEqual((await h.db.query("SELECT attachments_json FROM mail_drafts")).rows[0].attachments_json, []);
  assert.equal(h.deleted.length, 0, "existing files stay available for the normal orphan retention");
});

test("M4 concurrent imports of an Outlook draft without CRM header serialize before lookup", async t => {
  const h = await harness(t);
  const source = Buffer.from(mime().toString("utf8").replace(/^X-Solarglobe-Draft-ID:[^\r\n]+\r?\n/m, ""));
  const queues = new Map();
  function logicalClient() {
    const releases = [];
    return {
      async query(sql, params = []) {
        // One memory PostgreSQL connection; simulate transaction-bound advisory locks for two importers.
        if (/^(?:SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) return {rows:[]};
        if (sql.includes("pg_advisory_xact_lock")) {
          const previous = queues.get(params[0]) || Promise.resolve();
          let release;
          const current = new Promise(resolve => { release=resolve; });
          queues.set(params[0], current);
          await previous;
          releases.push(release);
          return {rows:[]};
        }
        const result = await h.client.query(sql, params);
        // Force the unlocked SELECT/INSERT gap to be observable by the other importer.
        if (sql.startsWith("SELECT * FROM mail_drafts")) await new Promise(resolve => setImmediate(resolve));
        return result;
      },
      release() { for (const release of releases.reverse()) release(); },
    };
  }
  const run = async () => {
    const client = logicalClient();
    try { return await importRemoteDraftMessage(client, {}, {...input, raw:{uid:42,source}}, h.dependencies); }
    finally { client.release(); }
  };
  const [a,b] = await Promise.all([run(), run()]);
  assert.equal(a.draftId, b.draftId);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 1);
  assert.equal(h.uploads.length, 1);
});

test("M4 same bytes renamed remotely reuse storage and refresh metadata", async t => {
  const h = await harness(t);
  await imported(h);
  let scans = 0;
  h.dependencies.scan = async () => { scans++; return {status: "CLEAN"}; };
  await imported(h, mime([{filename: "nouveau.pdf", contentType: "application/pdf", content: bytes}]), 43);
  assert.equal(h.uploads.length, 1);
  assert.equal(scans, 1, "a renamed part must be scanned again");
  assert.equal((await h.db.query("SELECT * FROM mail_draft_attachments")).rows[0].file_name, "nouveau.pdf");
});

for (const damaged of ["missing", "corrupt"]) test(`M4 resync repairs ${damaged} stored blob from verified MIME bytes`, async t => {
  const h = await harness(t), source = mime();
  await imported(h, source);
  if (damaged === "missing") h.files.delete("synthetic/1");
  else h.files.set("synthetic/1", Buffer.from("corrupt"));
  await imported(h, source);
  assert.equal(h.uploads.length, 2);
  const [row] = (await h.db.query("SELECT * FROM mail_draft_attachments")).rows;
  assert.equal(row.storage_path, "synthetic/2");
  assert.deepEqual(h.files.get(row.storage_path), bytes);
  assert.equal((await h.db.query("SELECT * FROM mail_draft_attachments")).rows.length, 1);
});

function loadAttachmentService(h, overrides = {}) {
  const source = readFileSync(new URL("../services/mail/mailDraftAttachments.service.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export\s+/gm, "");
  return vm.runInNewContext(`${source}\n;({loadDraftAttachmentBuffers,attachUploadedFileToDraft,deleteDraftAttachment})`, {
    Buffer, console, createHash, ...policy, MAIL_ATTACHMENT_SCAN_STATUSES: {CLEAN:"CLEAN",UNAVAILABLE:"UNAVAILABLE"},
    pool: {query: h.client.query, connect: async () => ({...h.client,release(){}})},
    getAbsolutePath: path => path,
    fs: {stat: async path => ({size: h.files.get(path).length}), readFile: async path => h.files.get(path)},
    ...overrides,
  });
}

test("M4 inline MIME survives real import, normal attachment loader and MIME re-emission", async t => {
  const h = await harness(t);
  const source = mime([{filename:"logo.png",contentType:"image/png",content:bytes,is_inline:true,content_id:"logo@example.test"}]);
  const result = await imported(h, source);
  const [draft] = (await h.db.query("SELECT * FROM mail_drafts")).rows;
  assert.match(draft.body_html, /src="cid:logo@example.test"/);
  const buffers = await loadAttachmentService(h).loadDraftAttachmentBuffers({organizationId:input.organizationId,draftId:result.draftId,expectedUserId:input.userId});
  const roundtrip = await simpleParser(mime(buffers), {skipImageLinks:true});
  assert.equal(roundtrip.attachments[0].filename, "logo.png");
  assert.equal(roundtrip.attachments[0].cid, "logo@example.test");
  assert.equal(roundtrip.attachments[0].contentDisposition, "inline");
  assert.deepEqual(roundtrip.attachments[0].content, bytes);
});

test("M4 unchanged remote version does not replace unsent local contents or attachments", async t => {
  const h = await harness(t), source = mime();
  const result = await imported(h, source);
  await h.db.query("UPDATE mail_drafts SET local_dirty=true,body_text='local edit',attachments_json='[{\"local\":true}]'::jsonb WHERE id=$1", [result.draftId]);
  const before = (await h.db.query("SELECT * FROM mail_drafts")).rows;
  const again = await imported(h, source);
  assert.equal(again.reason, "unchanged_remote_local_dirty");
  assert.deepEqual((await h.db.query("SELECT * FROM mail_drafts")).rows, before);
  assert.equal(h.uploads.length, 1);
});

for (const current of [{uid:99,modseq:"20"}, {uid:42,modseq:"9007199254740993"}]) {
  test(`M4 delayed raw cannot undo newer provider reference ${current.uid}/${current.modseq}`, async t => {
    const h = await harness(t), capturedSource = mime();
    const first = await imported(h, capturedSource);
    // The worker published a new version while the captured IMAP response was waiting for the row lock.
    await h.db.query("UPDATE mail_drafts SET remote_uid=$2, remote_modseq=$3, remote_version='newer-worker-version', body_text='newer worker body', attachments_json='[{\"fileName\":\"newer.pdf\"}]' WHERE id=$1", [first.draftId,current.uid,current.modseq]);
    await h.db.query("UPDATE mail_draft_attachments SET file_name='newer.pdf' WHERE draft_id=$1", [first.draftId]);
    const beforeDrafts = (await h.db.query("SELECT * FROM mail_drafts")).rows;
    const beforeAttachments = (await h.db.query("SELECT * FROM mail_draft_attachments")).rows;
    const result = await importRemoteDraftMessage(h.client, {}, {...input,raw:{uid:42,modseq:"9007199254740992",source:capturedSource}}, h.dependencies);
    assert.equal(result.reason, "stale_remote_reference");
    assert.equal(result.skipped, true);
    assert.deepEqual((await h.db.query("SELECT * FROM mail_drafts")).rows, beforeDrafts);
    assert.deepEqual((await h.db.query("SELECT * FROM mail_draft_attachments")).rows, beforeAttachments);
    assert.equal(h.uploads.length, 1);
  });
}

for (const differentScope of [
  {folder:{id:"40000000-0000-0000-0000-000000000099"}},
  {uidValidity:"2"},
  {uidValidity:null},
]) test(`M4 UID ordering is not compared across remote scope ${JSON.stringify(differentScope)}`, async t => {
  const h = await harness(t), source=mime();
  const first=await imported(h,source,99);
  const result=await importRemoteDraftMessage(h.client, {}, {...input,...differentScope,raw:{uid:42,source}}, h.dependencies);
  assert.equal(result.imported,true);
  assert.equal(result.draftId,first.draftId);
  assert.equal(Number((await h.db.query("SELECT remote_uid FROM mail_drafts WHERE id=$1",[first.draftId])).rows[0].remote_uid),42);
});

test("M4 modseq ordering is ignored when a value is missing or nonnumeric", async t => {
  const h = await harness(t), source=mime();
  const first=await imported(h,source);
  for (const modseq of [null,"invalid"]) {
    await h.db.query("UPDATE mail_drafts SET remote_modseq='999' WHERE id=$1",[first.draftId]);
    const result=await importRemoteDraftMessage(h.client, {}, {...input,raw:{uid:42,source,modseq}}, h.dependencies);
    assert.equal(result.imported,true);
  }
});

test("M4 modseq ordering is not compared across draft identity generations", async t => {
  const h = await harness(t), source=mime();
  const first=await imported(h,source);
  await h.db.query("UPDATE mail_drafts SET draft_identity='another-generation',remote_modseq='999' WHERE id=$1",[first.draftId]);
  const result=await importRemoteDraftMessage(h.client, {}, {...input,raw:{uid:42,source,modseq:"1"}}, h.dependencies);
  assert.equal(result.imported,true);
  assert.notEqual(result.reason,"stale_remote_reference");
});

async function conflictFixture(h) {
  const original = await imported(h);
  await h.db.query("UPDATE mail_drafts SET local_dirty=true,body_text='local edit' WHERE id=$1", [original.draftId]);
  const source = mime([{filename:"remote.pdf",contentType:"application/pdf",content:Buffer.from("remote bytes")}]);
  const copy = await imported(h, source, 43);
  return {original,copy,source};
}

test("M4 conflict copy gets its own attachments and resync is idempotent", async t => {
  const h = await harness(t);
  const {original,copy,source} = await conflictFixture(h);
  assert.equal(copy.conflict, true);
  const drafts = (await h.db.query("SELECT * FROM mail_drafts")).rows;
  const local = drafts.find(row => row.id === original.draftId), remote = drafts.find(row => row.id === copy.draftId);
  assert.equal(local.body_text, "local edit");
  assert.equal(local.attachments_json[0].fileName, "devis été.pdf");
  assert.equal(remote.conflict_of_draft_id, local.id);
  assert.ok(remote.draft_identity.startsWith(local.draft_identity + "-remote-"));
  assert.equal(remote.attachments_json[0].fileName, "remote.pdf");
  const again = await imported(h, source, 43);
  assert.equal(again.draftId, copy.draftId);
  assert.equal(again.reused, true);
  assert.equal(h.uploads.length, 2);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 2);
});

test("M4 resync never replaces a conflict copy edited locally", async t => {
  const h = await harness(t);
  const {copy,source} = await conflictFixture(h);
  await h.db.query("UPDATE mail_drafts SET local_dirty=true,body_text='copy local edit' WHERE id=$1", [copy.draftId]);
  await h.db.query("UPDATE mail_draft_attachments SET file_name='locally-renamed.pdf' WHERE draft_id=$1", [copy.draftId]);
  const before = (await h.db.query("SELECT * FROM mail_draft_attachments ORDER BY id")).rows;
  const result = await imported(h, source, 43);
  assert.equal(result.reason, "unchanged_remote_local_dirty");
  assert.deepEqual((await h.db.query("SELECT * FROM mail_draft_attachments ORDER BY id")).rows, before);
  assert.equal(h.uploads.length, 2);
});

test("M4 use_remote moves validated references without deleting blobs", async t => {
  const h = await harness(t);
  const {original,copy} = await conflictFixture(h);
  const manifest = await adoptRemoteDraftAttachments(h.client, {organizationId:input.organizationId,userId:input.userId,mailAccountId:input.mailAccount.id,sourceDraftId:copy.draftId,targetDraftId:original.draftId});
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].draftId, original.draftId);
  assert.equal(manifest[0].fileName, "remote.pdf");
  const attachments = (await h.db.query("SELECT * FROM mail_draft_attachments")).rows;
  assert.equal(attachments.find(row => row.file_name === "devis été.pdf").draft_id, null);
  assert.equal(attachments.find(row => row.file_name === "remote.pdf").draft_id, original.draftId);
  assert.deepEqual((await h.db.query("SELECT attachments_json FROM mail_drafts WHERE id=$1", [copy.draftId])).rows[0].attachments_json, []);
  assert.equal(h.files.size, 2);
  assert.equal(h.deleted.length, 0);
});

test("M4 use_remote rejects a former account generation without moving references", async t => {
  const h = await harness(t);
  const {original,copy} = await conflictFixture(h);
  await h.db.query("UPDATE mail_drafts SET draft_identity='new-generation' WHERE id=$1", [original.draftId]);
  const before = (await h.db.query("SELECT * FROM mail_draft_attachments ORDER BY id")).rows;
  await assert.rejects(adoptRemoteDraftAttachments(h.client, {organizationId:input.organizationId,userId:input.userId,mailAccountId:input.mailAccount.id,sourceDraftId:copy.draftId,targetDraftId:original.draftId}), {code:"MAIL_DRAFT_ATTACHMENT_SCOPE_CONFLICT"});
  assert.deepEqual((await h.db.query("SELECT * FROM mail_draft_attachments ORDER BY id")).rows, before);
});

test("M4 storage failure rolls back new draft and removes only already-created blobs", async t => {
  const h = await harness(t);
  h.files.set("unrelated-user-file", Buffer.from("keep"));
  const upload = h.dependencies.upload;
  h.dependencies.upload = async (...args) => { if (h.uploads.length === 1) throw new Error("synthetic disk failure"); return upload(...args); };
  const source = mime([{filename:"first.pdf",content:bytes}, {filename:"second.pdf",content:Buffer.from("second")}]);
  await assert.rejects(imported(h, source), /synthetic disk failure/);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 0);
  assert.equal((await h.db.query("SELECT * FROM mail_draft_attachments")).rows.length, 0);
  assert.deepEqual(h.deleted, ["synthetic/1"]);
  assert.deepEqual([...h.files.keys()], ["unrelated-user-file"]);
});

test("M4 SQL association failure rolls back changes and cleans new blob", async t => {
  const h = await harness(t), query = h.client.query;
  h.client.query = async (sql,params) => { if(sql.includes("remote-draft-attachments:upsert")) throw new Error("synthetic SQL failure"); return query(sql,params); };
  await assert.rejects(imported(h), /synthetic SQL failure/);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 0);
  assert.deepEqual(h.deleted, ["synthetic/1"]);
});

test("M4 caller rollback cleans new blobs; confirmed references protect a committed file", async t => {
  const h = await harness(t);
  const result = await imported(h);
  await h.client.query("COMMIT");
  await result.cleanupOnRollback(h.client);
  assert.equal(h.deleted.length, 0, "a referenced file must survive an uncertain COMMIT result");
  await h.client.query("BEGIN");
  const pending = await imported(h, mime([{filename:"new.pdf",content:Buffer.from("new")}]), 43);
  await h.client.query("ROLLBACK");
  await pending.cleanupOnRollback(h.client);
  assert.deepEqual(h.deleted, ["synthetic/2"]);
  assert.ok(h.files.has("synthetic/1"));
});

test("M4 refuses indistinguishable schema keys with distinct MIME metadata before upload", async t => {
  const h = await harness(t);
  const source = mime([{filename:"first.pdf",content:bytes}, {filename:"second.pdf",content:bytes}]);
  await assert.rejects(imported(h, source), {code:"MAIL_DRAFT_REMOTE_ATTACHMENT_DUPLICATE_CONTENT_METADATA"});
  assert.equal(h.uploads.length, 0);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 0);
});

test("M4 revoked incoming account access prevents all database mutations and uploads", async t => {
  const h = await harness(t);
  h.dependencies.authorize = async (_client,scope,options) => {
    assert.equal(scope.mailAccountId, input.mailAccount.id);
    assert.equal(options.forSync, true);
    throw Object.assign(new Error("revoked"), {statusCode:403});
  };
  await assert.rejects(imported(h), {statusCode:403});
  assert.equal(h.uploads.length, 0);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 0);
  assert.ok(!h.queries.some(({sql}) => /INSERT INTO|UPDATE mail_drafts/.test(sql)));
});

test("M4 truncated provider MIME is rejected before parsing or storing partial attachments", async t => {
  const h = await harness(t), complete = mime();
  const cut = complete.subarray(0, complete.length - 40);
  await assert.rejects(importRemoteDraftMessage(h.client, {}, {...input,raw:{uid:42,source:cut,size:complete.length}}, h.dependencies), {code:"MAIL_DRAFT_REMOTE_MIME_TRUNCATED"});
  assert.equal(h.uploads.length, 0);
  assert.equal((await h.db.query("SELECT * FROM mail_drafts")).rows.length, 0);
  const capped = Buffer.alloc(12_000_000, "x");
  await assert.rejects(imported(h, capped), {code:"MAIL_DRAFT_REMOTE_MIME_TRUNCATED"});
  assert.equal(h.uploads.length, 0);
});

test("M4 normal local storage cleans exclusively its new partial UUID file on write failure", async t => {
  let written;
  const unlinked = [];
  t.mock.method(fs, "mkdir", async () => {});
  t.mock.method(fs, "writeFile", async path => { written = path; throw Object.assign(new Error("disk full"), {code:"ENOSPC"}); });
  t.mock.method(fs, "unlink", async path => { unlinked.push(path); });
  await assert.rejects(uploadMailAttachmentFile(bytes, input.organizationId, "synthetic.pdf"), {code:"ENOSPC"});
  assert.match(written, /[a-f0-9-]{36}_synthetic\.pdf$/);
  assert.deepEqual(unlinked, [written]);
});

for (const action of ["attach", "delete"]) test(`M6/M5 ${action} attachment locks draft then checks fresh account before mutation`, async t => {
  const h = await harness(t), initial = await imported(h);
  await h.client.query("COMMIT");
  const events = [], query = h.client.query;
  h.client.query = async (...args) => { events.push(args[0].trim().startsWith("SELECT id, mail_account_id") ? "row-lock" : args[0]); return query(...args); };
  const service = loadAttachmentService(h, {
    lockDraftTransaction: async () => { events.push("advisory-lock"); },
    assertDraftMailAccountAccess: async (_client,scope) => { events.push("authorization"); assert.equal(scope.mailAccountId,input.mailAccount.id); throw Object.assign(new Error("revoked"),{statusCode:403}); },
    uploadMailAttachmentFile: async () => { throw new Error("must not upload"); },
    scanMailAttachmentBuffer: async () => { throw new Error("must not scan"); },
  });
  const args = {organizationId:input.organizationId,userId:input.userId,draftId:initial.draftId};
  await assert.rejects(action === "attach" ? service.attachUploadedFileToDraft({...args,file:{buffer:bytes,originalname:"test.pdf"}}) : service.deleteDraftAttachment({...args,attachmentId:initial.draftId}), {statusCode:403});
  assert.deepEqual(events.slice(0,4), ["BEGIN","advisory-lock","row-lock","authorization"]);
  assert.equal(events[4], "ROLLBACK");
  assert.equal(h.uploads.length, 1);
});

test("M4 actual MIME builder preserves inline disposition and CID on re-emission", async () => {
  const parsed = await simpleParser(mime([{ filename: "logo.png", contentType: "image/png", content: bytes, is_inline: true, content_id: "logo@example.test" }]), { skipImageLinks: true });
  assert.equal(parsed.attachments[0].contentDisposition, "inline");
  assert.equal(parsed.attachments[0].cid, "logo@example.test");
  assert.deepEqual(parsed.attachments[0].content, bytes);
});
