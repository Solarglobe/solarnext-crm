import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

// Execute the real service bodies without importing db.js, environment files or a provider.
function loadService(file, dependencies, names) {
  const source = readFileSync(new URL(`../services/mail/${file}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
    .replace(/^export\s+/gm, "");
  return vm.runInNewContext(`${source}\n;({${names.join(",")}})`, {
    process: { env: {} }, Date, Math, Number, String, Set, Error, JSON, ...dependencies,
  });
}

const scope = { organizationId: "org", mailAccountId: "account", folderId: "folder" };
async function fixture(t, options = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TYPE mail_flag_mutation_status AS ENUM ('PENDING','PROCESSING','RETRYING','SUCCEEDED','CANCELLED');
    CREATE TABLE mail_accounts(id text, organization_id text, email text, is_active boolean,
      lifecycle_state text, sync_enabled boolean, reconnect_required boolean, imap_host text,
      imap_port integer, imap_secure boolean, encrypted_credentials text);
    INSERT INTO mail_accounts VALUES ('account','org','test@example.test',true,'CONNECTED',true,false,'synthetic',993,true,'synthetic');
    CREATE TABLE mail_folders(id text PRIMARY KEY, organization_id text, mail_account_id text,
      type text, name text, external_id text, uid_validity text, highest_modseq text,
      selectable boolean DEFAULT true, is_active boolean DEFAULT true,
      history_backfill_cursor_uid bigint, oldest_imported_uid bigint, oldest_imported_at timestamptz,
      history_backfill_status text DEFAULT 'PARTIAL', history_sync_status text DEFAULT 'PARTIAL',
      history_backfill_started_at timestamptz, history_backfill_last_error text,
      history_backfill_has_more boolean, history_backfill_last_success_at timestamptz,
      history_backfill_completed_at timestamptz, remote_total_count integer, local_imported_count integer,
      message_sync_status text, last_message_sync_error_at timestamptz,
      last_message_sync_error_code text, last_message_sync_error_message text,
      last_flag_sync_at timestamptz, flag_sync_error_code text, flag_sync_error_message text,
      flag_sync_error_at timestamptz, updated_at timestamptz);
    INSERT INTO mail_folders(id,organization_id,mail_account_id,type,name,external_id,uid_validity,highest_modseq,history_backfill_cursor_uid)
      VALUES ('folder','org','account','INBOX','INBOX','INBOX','10','10',10);
    CREATE TABLE mail_messages(id text PRIMARY KEY,organization_id text,mail_account_id text,folder_id text,
      external_uid bigint, external_uid_validity text, external_modseq text, external_flags jsonb,
      is_read boolean DEFAULT false,read_intent_version integer DEFAULT 1,mail_thread_id text,
      read_sync_status text,read_sync_error text,read_synced_at timestamptz,updated_at timestamptz,
      sent_at timestamptz,received_at timestamptz,external_internal_date timestamptz,
      remote_missing_at timestamptz,remote_deleted_at timestamptz);
    CREATE TABLE mail_flag_mutations(id text,organization_id text,mail_account_id text,folder_id text,
      external_uid bigint,external_uid_validity text,status mail_flag_mutation_status,
      succeeded_at timestamptz,last_error_code text,last_error_message text,updated_at timestamptz);
  `);
  const queries = [], releases = [], imported = [], imapCalls = [], held = new Map(), rebuilt = [];
  let connection = 0, onLock = options.onLock;
  if (options.heldFolderLock) held.set("mail-folder-sync:folder", "other-connection");
  async function query(sql, params = [], owner = "pool") {
    queries.push({ sql, params, owner });
    if (/pg_try_advisory_lock/.test(sql)) {
      if (onLock) { const hook = onLock; onLock = null; await hook(db); }
      if (held.has(params[0])) return { rows: [{ locked: false }] };
      held.set(params[0], owner);
      if (options.lockResponseLost) throw new Error("synthetic acquisition response lost");
      return { rows: [{ locked: true }] };
    }
    if (/pg_advisory_unlock/.test(sql)) {
      if (options.unlockFailure) throw new Error("synthetic unlock failure");
      if (options.unlockUnconfirmed) return { rows: [{ pg_advisory_unlock: false }] };
      const unlocked = held.get(params[0]) === owner;
      if (unlocked) held.delete(params[0]);
      return { rows: [{ pg_advisory_unlock: unlocked }] };
    }
    return db.query(sql, params);
  }
  const pool = {
    query,
    async connect() {
      const owner = `connection-${++connection}`;
      return { query: (sql, params) => query(sql, params, owner), release(error) {
        releases.push({ owner, error });
        if (error) for (const [key, holder] of held) if (holder === owner) held.delete(key);
      } };
    },
  };
  const imap = {
    async mailboxOpen(path) { imapCalls.push(["open", path]); if (options.onOpen) await options.onOpen(); return { uidValidity: options.remoteValidity ?? "10" }; },
    async search() { imapCalls.push(["search"]); return options.remoteUids ?? [1, 2, 3, 4, 5, 6, 7, 8, 9]; },
    async logout() { imapCalls.push(["logout"]); },
  };
  const backfill = loadService("mailHistoryBackfill.service.js", {
    pool, createImapClient: async () => { imapCalls.push(["connect"]); return imap; },
    decryptJson: () => ({}), resolveImapCredentials: () => ({ user: "synthetic", password: "synthetic" }),
    assertMailAccountCapability: () => {},
    importImapMessage: async (_client, _imap, p) => {
      imported.push(p.uid);
      await db.query(`INSERT INTO mail_messages(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity)
        VALUES ($1,'org','account','folder',$2,$3)`, [`message-${p.uid}`,p.uid,p.uidValidity]);
      return { imported: true };
    },
  }, ["backfillMailFolderHistory"]);
  const flags = loadService("mailFlagMutation.service.js", {
    pool, rebuildThreadMetadata: async ({threadId}) => rebuilt.push(threadId),
  }, ["finalizeFlagMutationSuccess", "applyRemoteReadObservationInTransaction"]);
  return { db, pool, backfill, flags, queries, releases, imported, imapCalls, held, rebuilt,
    folder: async () => (await db.query("SELECT * FROM mail_folders")).rows[0] };
}

test("M1 backfill contends with regular folder sync and leaves the winner's state and lock untouched", async t => {
  const f = await fixture(t, { heldFolderLock: true });
  const result = await f.backfill.backfillMailFolderHistory(scope);
  assert.equal(result.status, "LOCKED");
  assert.equal(f.imapCalls.length, 0);
  assert.equal((await f.folder()).history_backfill_status, "PARTIAL");
  assert.equal(f.held.get("mail-folder-sync:folder"), "other-connection");
  assert.equal(f.queries.filter(q => /pg_advisory_unlock/.test(q.sql)).length, 0);
});

test("M1 backfill rereads cursors after its lock instead of replaying a stale pre-lock snapshot", async t => {
  const f = await fixture(t, { onLock: db => db.exec("UPDATE mail_folders SET history_backfill_cursor_uid=4") });
  await f.backfill.backfillMailFolderHistory({ ...scope, batchSize: 2 });
  assert.deepEqual(f.imported, [3, 2]);
  assert.equal(Number((await f.folder()).history_backfill_cursor_uid), 2);
});

test("M1 backfill cannot confirm a changed UIDVALIDITY or import into its new namespace", async t => {
  const f = await fixture(t, { remoteValidity: "20" });
  const result = await f.backfill.backfillMailFolderHistory(scope);
  assert.equal(result.status, "ACTION_REQUIRED");
  assert.equal(result.error, "UIDVALIDITY_CHANGED");
  assert.equal((await f.folder()).uid_validity, "10");
  assert.equal((await f.folder()).highest_modseq, "10");
  assert.equal(Number((await f.folder()).history_backfill_cursor_uid), 10);
  assert.equal(f.imported.length, 0);
  assert.equal(f.imapCalls.filter(c => c[0] === "search").length, 0);
});

test("M1 uninitialized UID namespace is left for a complete folder sync", async t => {
  const f = await fixture(t);
  await f.db.exec("UPDATE mail_folders SET uid_validity=NULL");
  const result = await f.backfill.backfillMailFolderHistory(scope);
  assert.equal(result.status, "ACTION_REQUIRED");
  assert.equal((await f.folder()).uid_validity, null);
  assert.equal(f.imported.length, 0);
});

test("M1 failed session unlock destroys its dedicated connection instead of pooling a held lock", async t => {
  const f = await fixture(t, { unlockFailure: true });
  await f.backfill.backfillMailFolderHistory({ ...scope, batchSize: 1 });
  assert.equal(f.held.size, 0);
  assert.ok(f.releases.find(r => r.owner === "connection-1")?.error);
});

test("M1 lost acquisition response destroys the possibly locked backfill connection without changing folder state", async t => {
  const f = await fixture(t, { lockResponseLost: true });
  await assert.rejects(f.backfill.backfillMailFolderHistory(scope), /acquisition response lost/);
  assert.equal(f.held.size, 0);
  assert.ok(f.releases.find(r => r.owner === "connection-1")?.error);
  assert.equal((await f.folder()).history_backfill_status, "PARTIAL");
  assert.equal(f.imapCalls.length, 0);
});

test("M1 unconfirmed unlock never returns a possibly locked backfill connection to the pool", async t => {
  const f = await fixture(t, { unlockUnconfirmed: true });
  await f.backfill.backfillMailFolderHistory({ ...scope, batchSize: 1 });
  assert.equal(f.held.size, 0);
  assert.ok(f.releases.find(r => r.owner === "connection-1")?.error);
});

test("M1 two logical backfill connections share the folder lock", async t => {
  let entered, resume;
  const open = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const f = await fixture(t, { onOpen: async () => { entered(); await gate; } });
  const first = f.backfill.backfillMailFolderHistory({ ...scope, batchSize: 1 });
  await open;
  const second = await f.backfill.backfillMailFolderHistory(scope);
  resume();
  await first;
  assert.equal(second.status, "LOCKED");
  assert.equal(f.imported.length, 1);
  assert.equal(f.held.size, 0);
});

test("M1 confirming a single flag mutation never advances or clears the folder synchronization checkpoint", async t => {
  const f = await fixture(t);
  await f.db.exec(`INSERT INTO mail_messages(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity,mail_thread_id)
      VALUES ('message','org','account','folder',1,'10','thread');
    INSERT INTO mail_flag_mutations(id,status) VALUES ('job','PROCESSING');
    UPDATE mail_folders SET flag_sync_error_code='PREVIOUS_FOLDER_ERROR';`);
  await f.flags.finalizeFlagMutationSuccess({id:"job",mail_message_id:"message",organization_id:"org",folder_id:"folder",intent_version:1,desired_is_read:true},
    {mailbox:{uidValidity:"10",highestModseq:"99"},confirmed:{flags:["\\Seen"],modseq:"99"}});
  const folder = await f.folder();
  assert.equal(folder.highest_modseq, "10");
  assert.equal(folder.last_flag_sync_at, null);
  assert.equal(folder.flag_sync_error_code, "PREVIOUS_FOLDER_ERROR");
  assert.equal((await f.db.query("SELECT is_read FROM mail_messages")).rows[0].is_read, true);
  assert.equal((await f.db.query("SELECT status FROM mail_flag_mutations")).rows[0].status, "SUCCEEDED");
});

const observation = { ...scope, uid: 1, uidValidity: "20",modseq:"11",flags:["\\Seen"],isRead:true };
test("M1 a new-namespace flag observation does not adopt legacy null or previous UIDVALIDITY messages", async t => {
  const f = await fixture(t);
  await f.db.exec(`INSERT INTO mail_messages(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity)
    VALUES ('legacy','org','account','folder',1,NULL),('old','org','account','folder',1,'10'),('new','org','account','folder',1,'20');`);
  await f.flags.applyRemoteReadObservationInTransaction(f.pool, observation);
  const messages = (await f.db.query("SELECT id,is_read,external_uid_validity FROM mail_messages ORDER BY id")).rows;
  assert.deepEqual(messages, [{id:"legacy",is_read:false,external_uid_validity:null},{id:"new",is_read:true,external_uid_validity:"20"},{id:"old",is_read:false,external_uid_validity:"10"}]);
});

test("M1 an old-namespace pending intent cannot block observation of a reused UID", async t => {
  const f = await fixture(t);
  await f.db.exec(`INSERT INTO mail_messages(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity)
      VALUES ('new','org','account','folder',1,'20');
    INSERT INTO mail_flag_mutations(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity,status)
      VALUES ('old-job','org','account','folder',1,'10','PENDING');`);
  const result = await f.flags.applyRemoteReadObservationInTransaction(f.pool, observation);
  assert.equal(result.applied, true);
  assert.equal((await f.db.query("SELECT is_read FROM mail_messages")).rows[0].is_read, true);
});

test("M1 a matching-namespace pending intent still protects the local read state", async t => {
  const f = await fixture(t);
  await f.db.exec(`INSERT INTO mail_messages(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity)
      VALUES ('new','org','account','folder',1,'20');
    INSERT INTO mail_flag_mutations(id,organization_id,mail_account_id,folder_id,external_uid,external_uid_validity,status)
      VALUES ('new-job','org','account','folder',1,'20','PENDING');`);
  const result = await f.flags.applyRemoteReadObservationInTransaction(f.pool, observation);
  assert.equal(result.reason, "LOCAL_INTENT_PENDING");
  assert.equal((await f.db.query("SELECT is_read FROM mail_messages")).rows[0].is_read, false);
});
