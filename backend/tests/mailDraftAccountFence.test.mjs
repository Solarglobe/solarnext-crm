import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { DRAFT_SYNC_STATUSES, planDraftRemoteDelete, planDraftRemoteSave, stableDraftMessageId } from '../services/mail/mailDraftSync.service.js';
import { draftFenceError, draftJobFence, hasDraftJobFence, lockDraftTransaction, matchesDraftJobFence } from '../services/mail/mailDraftFence.service.js';
import { buildSimpleRfc822Mime } from '../services/mail/mailMimeBuilder.service.js';

// Real service/provider bodies; only SQL and IMAP transports are in memory.
// In particular no db.js, dotenv, socket, live worker or server is imported.
function load(relativePath, names, dependencies) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export (?=(?:async )?function\b)/gm, '');
  return vm.runInNewContext(`${source}\n({${names.join(',')}})`, { Error, Date, Buffer, console, ...dependencies }, { filename: relativePath });
}
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const context = { id: 'draft-1', userId: 'user-1', organizationId: 'org-1' };

function harness() {
  let row = { id: context.id, organization_id: context.organizationId, user_id: context.userId, mail_account_id: 'A',
    local_version: 1, remote_uid: 42, remote_uid_validity: 'uv-A', remote_folder_id: 'folder-A', remote_modseq: 'm1', remote_version: 'uv-A:42:m1',
    draft_identity: 'generation-A', message_id: '<original-A@test>', attachments_json: [], local_dirty: true,
    sync_status: 'QUEUED', abandoned_at: null, subject: 'Draft', to_recipients: 'recipient@test' };
  const jobs = new Map(), boxes = new Map(), operations = [], statements = [], authorizations = [], locks = new Map();
  const allowed = new Set(['A', 'B']);
  let appendGate = null, appendStarted = null, deleteGate = null, deleteStarted = null;
  let onClaim = null, deleteFailure = false, appendFailure = false, remoteFolderMissing = false;
  let nextJob = 0, nextUid = 100, nextClient = 0;
  const path = account => `${account} Drafts`;
  for (const account of ['A', 'B']) boxes.set(account, new Map([[42, buildSimpleRfc822Mime({
    messageId: account === 'A' ? row.message_id : '<unrelated-B@test>',
    draftIdentity: account === 'A' ? row.draft_identity : 'unrelated-B', subject: 'seed',
  })]]));
  function matches(sql, values, current) {
    if (!current) return false;
    const where = sql.split(/\bWHERE\b/)[1] || '';
    for (const match of where.matchAll(/\b(?:d\.)?(id|organization_id|user_id|mail_account_id|draft_identity|local_version)\s*=\s*\$(\d+)/g)) {
      if (String(current[match[1]]) !== String(values[Number(match[2]) - 1])) return false;
    }
    if (where.includes('abandoned_at IS NULL') && current.abandoned_at != null) return false;
    if (where.includes('abandoned_at IS NOT NULL') && current.abandoned_at == null) return false;
    if (where.includes("sync_status = 'DELETE_QUEUED'") && current.sync_status !== 'DELETE_QUEUED') return false;
    if (where.includes("sync_status NOT IN ('DELETE_QUEUED', 'SENT')") && ['DELETE_QUEUED', 'SENT'].includes(current.sync_status)) return false;
    if (where.includes('local_dirty = true') && !current.local_dirty) return false;
    return true;
  }
  function assignments(sql, values, current) {
    const set = sql.split(/\bSET\b/)[1]?.split(/\bWHERE\b/)[0] || '';
    const result = { ...current };
    for (const clause of set.split(/,\s*(?=[a-z_]+\s*=)/)) {
      const match = clause.trim().match(/^([a-z_]+)\s*=\s*([\s\S]+)$/);
      if (!match) continue;
      const [, key, expression] = match;
      const direct = expression.match(/^\$(\d+)/);
      const conditional = expression.match(/^CASE WHEN \$(\d+) THEN (NULL|\$(\d+)) ELSE ([a-z_]+) END/);
      if (conditional) result[key] = values[Number(conditional[1]) - 1] ? (conditional[2] === 'NULL' ? null : values[Number(conditional[3]) - 1]) : current[conditional[4]];
      else if (direct) result[key] = values[Number(direct[1]) - 1];
      else if (/^NULL\b/.test(expression)) result[key] = null;
      else if (/^true\b/.test(expression)) result[key] = true;
      else if (/^false\b/.test(expression)) result[key] = false;
      else if (/^now\(\)/.test(expression)) result[key] = new Date().toISOString();
      else if (/^'[^']*'$/.test(expression.trim())) result[key] = expression.trim().slice(1, -1);
      else throw new Error(`Unhandled SET expression: ${expression}`);
    }
    if (typeof result.attachments_json === 'string') result.attachments_json = JSON.parse(result.attachments_json);
    return result;
  }
  async function connect() {
    const id = ++nextClient;
    let pendingRow, pendingJobs = new Map(), unlock = null, lockedKey = null, transaction = false;
    const current = () => pendingRow === undefined ? row : pendingRow;
    const getJob = id => pendingJobs.get(id) || jobs.get(id);
    return {
      async query(sql, values = []) {
        statements.push({ client: id, sql, values: copy(values), transaction });
        if (sql === 'BEGIN') { transaction = true; return { rows: [] }; }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (sql === 'COMMIT') { if (pendingRow !== undefined) row = pendingRow; for (const [key, job] of pendingJobs) jobs.set(key, job); }
          pendingRow = undefined; pendingJobs = new Map(); transaction = false; unlock?.(); unlock = null; lockedKey = null;
          return { rows: [] };
        }
        assert.equal(transaction, true, 'Every query uses a dedicated transaction');
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = locks.get(values[0]) || Promise.resolve();
          const gate = deferred(); locks.set(values[0], previous.then(() => gate.promise));
          await previous; unlock = gate.resolve; lockedKey = values[0]; return { rows: [] };
        }
        if (sql.includes('WITH cte AS')) {
          const claimed = [...jobs.values()].filter(job => ['queued', 'retrying'].includes(job.status)).slice(0, values[0]).map(job => ({ ...job, status: 'running' }));
          for (const job of claimed) pendingJobs.set(job.id, job);
          onClaim?.(); onClaim = null;
          return { rows: copy(claimed) };
        }
        if (sql.includes('SELECT id, status FROM mail_draft_sync_jobs')) {
          const job = getJob(values[0]); return { rows: job ? [copy(job)] : [] };
        }
        if (sql.includes('FROM mail_drafts') && sql.trim().startsWith('SELECT')) {
          assert.equal(lockedKey, `mail-draft|${context.organizationId}|${context.id}`);
          if (!matches(sql, values, current())) return { rows: [] };
          const draft = copy(current());
          return { rows: [{ ...draft, account_email: `${draft.mail_account_id}@test`,
            draft_folder_id: `folder-${draft.mail_account_id}`, draft_folder_path: path(draft.mail_account_id),
            remote_folder_account_id: remoteFolderMissing ? null : draft.remote_folder_id?.replace('folder-', '') ?? null,
            remote_folder_path: !remoteFolderMissing && draft.remote_folder_id ? path(draft.remote_folder_id.replace('folder-', '')) : null }] };
        }
        if (sql.includes('UPDATE mail_draft_attachments SET mail_account_id')) {
          assert.match(sql, /draft_id = \$1 AND organization_id = \$2 AND user_id = \$3/);
          assert.deepEqual(Array.from(values).slice(0, 3), [context.id, context.organizationId, context.userId]);
          assert.equal(values[3], current().mail_account_id);
          return { rows: [], rowCount: 0 }; // attachments themselves are covered by the shared PGlite suite
        }
        if (sql.includes('UPDATE mail_drafts')) {
          if (!matches(sql, values, current())) return { rows: [], rowCount: 0 };
          pendingRow = assignments(sql, values, current());
          return { rows: [copy(pendingRow)], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM mail_drafts')) {
          if (!matches(sql, values, current())) return { rows: [], rowCount: 0 };
          pendingRow = null; return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO mail_draft_sync_jobs')) {
          const cleanup = sql.includes("'cleanup_old_version'");
          const job = { id: `job-${++nextJob}`, organization_id: values[0], mail_account_id: values[1], draft_id: values[2],
            action: cleanup ? 'cleanup_old_version' : values[3], status: cleanup ? values[3] : 'queued',
            idempotency_key: values[4], payload_json: JSON.parse(values[5]), attempt_count: 0, max_attempts: 8 };
          pendingJobs.set(job.id, job); return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE mail_draft_sync_jobs')) {
          const job = getJob(values[0]);
          if (!job || (sql.includes("AND status = 'running'") && job.status !== 'running')) return { rows: [], rowCount: 0 };
          pendingJobs.set(job.id, assignments(sql, values, job)); return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release() { assert.equal(transaction, false); assert.equal(unlock, null, 'Lock released on its owning connection'); },
    };
  }
  const pool = { connect, query: async () => { throw new Error('Shared pool.query is forbidden for draft locks and mutations'); } };
  const assertDraftMailAccountAccess = async (_client, scope, options = {}) => {
    authorizations.push({ ...scope, ...options });
    if (scope.mailAccountId && !allowed.has(scope.mailAccountId)) { const error = new Error('Permission removed'); error.statusCode = 403; throw error; }
  };
  const provider = load('../services/mail/mailImapDraftProvider.service.js', ['appendDraftWithClient', 'deleteDraftWithClient'], { simpleParser });
  const imapFor = account => ({
    mailbox: { uidValidity: `uv-${account}` },
    async mailboxOpen(folderPath) { this.folderPath = folderPath; return { uidValidity: `uv-${account}`, highestModseq: 'm2' }; },
    async append(folderPath, mime) {
      const uid = ++nextUid; appendStarted?.resolve(); if (appendGate) await appendGate.promise;
      if (appendFailure) { appendFailure = false; throw new Error('synthetic delayed APPEND failure'); }
      boxes.get(account).set(uid, Buffer.from(mime)); operations.push({ action: 'APPEND', account, uid, folderPath });
      return { uid, uidValidity: `uv-${account}` };
    },
    async *fetch(uid) { const source = boxes.get(account).get(Number(uid)); if (source) yield { uid: Number(uid), source }; },
    async messageDelete(uid) {
      if (deleteFailure) { deleteFailure = false; throw new Error('synthetic temporary IMAP failure'); }
      deleteStarted?.resolve(); if (deleteGate) await deleteGate.promise;
      boxes.get(account).delete(Number(uid)); operations.push({ action: 'DELETE', account, uid: Number(uid), folderPath: this.folderPath });
    },
  });
  const shared = { pool, randomUUID, DRAFT_SYNC_STATUSES, planDraftRemoteDelete, planDraftRemoteSave, stableDraftMessageId,
    draftJobFence, draftFenceError, hasDraftJobFence, lockDraftTransaction, matchesDraftJobFence, assertDraftMailAccountAccess,
    process: { env: {} } };
  const service = load('../services/mail/mailDraft.service.js', ['updateDraft', 'deleteDraft', 'normalizeDraftPayload'], shared);
  const processor = load('../services/mail/mailDraftSync.processor.js', ['processMailDraftSyncBatch'], {
    ...shared, logger: { warn() {} }, delayMsAfterFailedAttempt: () => 1, loadDraftAttachmentBuffers: async () => [], buildSimpleRfc822Mime,
    withDraftImapClient: async (_db, scope, fn) => fn(imapFor(scope.mailAccountId)), ...provider,
  });
  function enqueue(action = 'save', payload = draftJobFence(row)) {
    const job = { id: `job-${++nextJob}`, organization_id: row.organization_id, mail_account_id: row.mail_account_id,
      draft_id: row.id, action, status: 'queued', payload_json: copy(payload), attempt_count: 0, max_attempts: 8 };
    jobs.set(job.id, job); return job;
  }
  return { service, jobs, operations, boxes, statements, authorizations, allowed, enqueue,
    run: processor.processMailDraftSyncBatch,
    get row() { return copy(row); },
    replaceRow(value) { row = copy(value); },
    update: account => service.updateDraft({ ...context, draft: service.normalizeDraftPayload({ mailAccountId: account, subject: 'updated' }) }),
    delete: () => service.deleteDraft(context),
    afterClaim(fn) { onClaim = fn; },
    failNextDelete() { deleteFailure = true; },
    failNextAppend() { appendFailure = true; },
    hideRemoteFolder() { remoteFolderMissing = true; },
    holdAppend() { appendStarted = deferred(); appendGate = deferred(); return { started: appendStarted.promise, finish: () => { appendGate.resolve(); appendGate = null; } }; },
    holdDelete() { deleteStarted = deferred(); deleteGate = deferred(); return { started: deleteStarted.promise, finish: () => { deleteGate.resolve(); deleteGate = null; } }; },
  };
}

test('switch A UID42 to B never deletes B UID42 (real CRUD, processor and provider)', async () => {
  const h = harness(); const original = h.row;
  await h.update('B');
  assert.equal(h.row.remote_uid, null);
  assert.equal(h.row.remote_folder_id, null);
  assert.equal(h.row.remote_uid_validity, null);
  assert.notEqual(h.row.draft_identity, original.draft_identity);
  assert.notEqual(h.row.message_id, original.message_id);
  await h.run();
  assert.deepEqual(h.operations.map(op => [op.action, op.account]), [['APPEND', 'B']]);
  assert.ok(h.boxes.get('B').has(42), 'Unrelated B UID42 survives');
  assert.equal(h.row.sync_status, 'SYNCED');
  assert.equal(h.row.mail_account_id, 'B');
});

test('A to B to A fences old A and B jobs even when the account matches again', async () => {
  const h = harness(); const old = h.enqueue();
  await h.update('B'); await h.update('A');
  const generation = h.row.draft_identity;
  await h.run();
  assert.deepEqual(h.operations.map(op => [op.action, op.account]), [['APPEND', 'A']]);
  assert.equal(h.jobs.get(old.id).status, 'failed');
  assert.match(h.jobs.get(old.id).last_error, /SUPERSEDED/);
  assert.equal(h.row.draft_identity, generation);
  assert.ok(h.boxes.get('A').has(42), 'Remote draft from previous generation is preserved');
});

test('account change waits for in-flight APPEND and then invalidates its references', async () => {
  const h = harness(); h.enqueue(); const gate = h.holdAppend(); const running = h.run();
  await gate.started;
  let changed = false; const change = h.update('B').then(() => { changed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(changed, false, 'CRUD shares the worker advisory lock');
  gate.finish(); await running; await change;
  assert.equal(h.row.mail_account_id, 'B'); assert.equal(h.row.remote_uid, null);
  assert.deepEqual(h.operations.map(op => [op.action, op.account]), [['APPEND', 'A'], ['DELETE', 'A']]);
  await h.run();
  assert.ok(h.boxes.get('B').has(42)); assert.equal(h.row.sync_status, 'SYNCED');
});

test('a late old-generation APPEND receipt cannot overwrite A after an A-B-A transition', async () => {
  const h = harness(); h.enqueue(); const gate = h.holdAppend(); const running = h.run(); await gate.started;
  // An out-of-band writer bypassing the new lock tests the final SQL CAS itself.
  const replacement = { ...h.row, draft_identity: 'new-A-generation', local_version: 3, remote_uid: 77, message_id: '<new-A@test>' };
  h.replaceRow(replacement); gate.finish(); await running;
  assert.equal(h.row.remote_uid, 77); assert.equal(h.row.draft_identity, 'new-A-generation');
  assert.equal(h.operations.filter(op => op.action === 'DELETE').length, 0);
  assert.match([...h.jobs.values()][0].last_error, /ancienne génération/);
});

test('delete immediately after account change stays local and never deletes B UID42', async () => {
  const h = harness(); await h.update('B'); await h.delete(); await h.run();
  assert.equal(h.row, null); assert.deepEqual(h.operations, []); assert.ok(h.boxes.get('B').has(42));
});

test('a delayed old APPEND error does not mark the replacement generation offline', async () => {
  const h = harness(); h.enqueue(); h.failNextAppend(); const gate = h.holdAppend(); const running = h.run(); await gate.started;
  h.replaceRow({ ...h.row, mail_account_id: 'B', draft_identity: 'new-B-generation', local_version: 2, remote_uid: null, sync_status: 'QUEUED', sync_error: null });
  gate.finish(); await running;
  assert.equal(h.row.mail_account_id, 'B'); assert.equal(h.row.sync_status, 'QUEUED'); assert.equal(h.row.sync_error, null);
  assert.deepEqual(h.operations, []);
});

test('DELETE uses the authoritative folder and the captured account/UID/UIDVALIDITY', async () => {
  const h = harness(); await h.delete(); await h.run();
  assert.equal(h.row, null);
  assert.deepEqual(h.operations, [{ action: 'DELETE', account: 'A', uid: 42, folderPath: 'A Drafts' }]);
  assert.ok(h.boxes.get('B').has(42));
});

test('a delayed old DELETE receipt cannot remove a replacement local draft', async () => {
  const h = harness(); await h.delete(); const gate = h.holdDelete(); const running = h.run(); await gate.started;
  h.replaceRow({ ...h.row, mail_account_id: 'B', draft_identity: 'new-B-generation', local_version: 2, remote_uid: null, abandoned_at: null, sync_status: 'QUEUED' });
  gate.finish(); await running;
  assert.equal(h.row.mail_account_id, 'B'); assert.equal(h.row.draft_identity, 'new-B-generation');
  assert.ok(h.boxes.get('B').has(42));
});

test('legacy unfenced jobs are explicitly failed without touching IMAP', async () => {
  const h = harness(); const job = h.enqueue('save', { steps: [] }); await h.run();
  assert.deepEqual(h.operations, []); assert.equal(h.jobs.get(job.id).status, 'failed');
  assert.match(h.jobs.get(job.id).last_error, /LEGACY_JOB_UNVERIFIED/);
  assert.equal(h.row.sync_status, 'ERROR'); assert.match(h.row.sync_error, /réenregistrez/);
});

test('an unresolved stored folder ID cannot fall back to Drafts for a remote mutation', async () => {
  const h = harness(); const job = h.enqueue(); h.hideRemoteFolder(); await h.run();
  assert.deepEqual(h.operations, []); assert.ok(h.boxes.get('A').has(42));
  assert.equal(h.jobs.get(job.id).status, 'failed');
  assert.match(h.jobs.get(job.id).last_error, /DRAFT_REFERENCE_CHANGED/);
});

test('permissions are rechecked before network access and after a delayed APPEND', async () => {
  const h = harness(); const job = h.enqueue(); h.afterClaim(() => h.allowed.delete('A')); await h.run();
  assert.deepEqual(h.operations, []); assert.equal(h.jobs.get(job.id).status, 'failed');
  const next = harness(); next.enqueue(); const gate = next.holdAppend(); const running = next.run(); await gate.started;
  next.allowed.delete('A'); gate.finish(); await running;
  assert.equal(next.operations.filter(op => op.action === 'DELETE').length, 0);
  assert.equal(next.row.remote_uid, 42); assert.equal(next.row.sync_status, 'ERROR');
  assert.ok(next.authorizations.filter(call => call.forSync).length >= 3);
});

test('permission removal after claiming a DELETE prevents the remote deletion', async () => {
  const h = harness(); await h.delete(); h.afterClaim(() => h.allowed.delete('A')); await h.run();
  assert.deepEqual(h.operations, []); assert.ok(h.boxes.get('A').has(42));
  assert.equal([...h.jobs.values()][0].status, 'failed');
});

test('a transient DELETE failure remains safely retryable with the same immutable reference', async () => {
  const h = harness(); await h.delete(); h.failNextDelete(); await h.run();
  assert.equal([...h.jobs.values()][0].status, 'retrying'); assert.ok(h.row.abandoned_at);
  await h.run();
  assert.equal(h.row, null); assert.equal(h.boxes.get('A').has(42), false); assert.ok(h.boxes.get('B').has(42));
});

test('cleanup from an old account generation never uses the current UID', async () => {
  const h = harness(); const cleanup = h.enqueue('cleanup_old_version'); await h.update('B'); await h.update('A'); await h.run();
  assert.equal(h.jobs.get(cleanup.id).status, 'failed');
  assert.equal(h.operations.filter(op => op.action === 'DELETE').length, 0);
});
