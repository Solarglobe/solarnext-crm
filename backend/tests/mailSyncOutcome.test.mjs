import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicMailAccount } from '../services/mail/mailAccountState.service.js';
import { summarizeMailSyncOutcome, parseMailSyncOutcome } from '../services/mail/mailSyncOutcome.service.js';

// No environment loader, production pool, HTTP client or actual mail account.
const timestamp = '2026-09-24T17:00:00.000Z';

function loadRoutes(singleResult, allResult) {
  const handlers = new Map();
  const router = { post(path, ...args) { handlers.set(`POST ${path}`, args.at(-1)); }, get() {} };
  const source = readFileSync(new URL('../routes/mailSync.routes.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export default router;?\r?$/gm, '');
  vm.runInNewContext(source, {
    express: { Router: () => router }, verifyJWT() {},
    requireMailUseStrict: () => () => {}, requireMailAccountsManageStrict: () => () => {},
    syncMailAccount: async () => { if (singleResult instanceof Error) throw singleResult; return singleResult; },
    syncAllMailAccounts: async () => allResult, console: { error() {} }, Error,
  });
  return handlers;
}

async function runRoute(body, singleResult, allResult) {
  const response = { status: 200, body: null };
  const res = { status(code) { response.status = code; return this; }, json(value) { response.body = value; return this; } };
  await loadRoutes(singleResult, allResult).get('POST /sync/run')({ user: { organizationId: 'org-test' }, body }, res);
  return response;
}

test('public health does not invent a full success from a legacy folder/connection timestamp', () => {
  const account = publicMailAccount({ lifecycle_state: 'CONNECTED', sync_status: 'ERROR',
    last_successful_sync_at: null, last_imap_sync_at: timestamp, last_sync_at: timestamp,
    last_sync_attempt_at: timestamp, last_error_code: 'SYNC_PARTIAL', last_error_message: 'Archives: timeout' });
  assert.equal(account.health.lastSuccessfulSyncAt, null);
  assert.equal(account.health.lastSyncAttemptAt, timestamp);
  assert.equal(account.health.lastErrorMessage, 'Archives: timeout');
});

test('single-account API response never marks a partial result successful', async () => {
  const response = await runRoute({ mailAccountId: 'account-test' }, { ok: false, outcome: 'PARTIAL',
    code: 'SYNC_PARTIAL', message: 'Un dossier en erreur', summary: { failed: 1 } });
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, 'SYNC_PARTIAL');
});

test('all-accounts API response never marks failed accounts successful', async () => {
  const response = await runRoute({}, null, { total: 2, ok: 1, failed: 1, results: [], errors: [{ code: 'SYNC_PARTIAL' }] });
  assert.equal(response.body.success, false);
});

test('fatal synchronization API failure retains structured folder details', async () => {
  const error = new Error('Synthetic connection timeout');
  error.code = 'CONNECTION_TIMEOUT';
  error.summary = { outcome: 'FAILED', errors: [{ folderId: null, stage: 'connection', code: error.code, at: timestamp }] };
  const response = await runRoute({ mailAccountId: 'account-test' }, error);
  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.deepEqual(response.body.summary, error.summary);
});

test('all folders successful: only this outcome confirms complete account success', () => {
  const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox', imported: 4 }, { folderId: 'sent', skipped: 20 }], at: timestamp });
  assert.equal(result.fullSuccess, true);
  assert.equal(result.outcome, 'SUCCESS');
  assert.equal(result.code, null);
  assert.equal(result.counts.succeeded, 2);
  assert.equal(result.counts.ignored, 0);
});

for (const code of ['CONNECTION_TIMEOUT', 'AUTH_FAILED', 'SYNC_FAILED']) {
  test(`one successful folder and one ${code}: partial outcome retains actionable details`, () => {
    const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox' }, {
      folderId: 'archive', folderName: 'Archives', error: code, message: 'Synthetic failure', stage: 'import_messages', imported: 3,
    }], at: timestamp });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'PARTIAL');
    assert.equal(result.code, 'SYNC_PARTIAL');
    assert.equal(result.counts.succeeded, 1);
    assert.equal(result.counts.failed, 1);
    assert.deepEqual(result.errors, [{ folderId: 'archive', folderName: 'Archives', stage: 'import_messages', code, message: 'Synthetic failure', at: timestamp }]);
  });
}

test('all folders failed is failure even if some messages were committed before the error', () => {
  const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox', imported: 2, error: 'CONNECTION_TIMEOUT' }] });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.code, 'FOLDER_SYNC_FAILED');
  assert.equal(result.fullSuccess, false);
});

test('explicit NOSELECT may be ignored alongside successfully synchronized folders', () => {
  const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox' }, { folderId: 'parent', ignored: true, reason: 'NOSELECT' }] });
  assert.equal(result.fullSuccess, true);
  assert.equal(result.counts.ignored, 1);
});

for (const options of [
  { folders: [] },
  { folders: [{ folderId: 'parent', ignored: true, reason: 'NOSELECT' }] },
  { folders: [{ folderId: 'inbox' }], expectedFolderCount: 3 },
  { folders: [{ folderId: 'inbox' }], targeted: true },
]) {
  test(`incomplete scope never advances full success: ${JSON.stringify(options)}`, () => {
    const result = summarizeMailSyncOutcome(options);
    assert.equal(result.fullSuccess, false);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SYNC_NOT_COMPLETE');
  });
}

test('a busy/locked folder is not a voluntarily ignored folder', () => {
  const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox', error: 'locked' }] });
  assert.equal(result.fullSuccess, false);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.ignored, 0);
});

test('a contradictory error cannot be hidden by ignored:true', () => {
  const result = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox', error: 'AUTH_FAILED', ignored: true, reason: 'NOSELECT' }] });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.errors[0].code, 'AUTH_FAILED');
});

test('structured stored diagnostics expose a human message and preserve folder details', () => {
  const outcome = summarizeMailSyncOutcome({ folders: [{ folderId: 'inbox', error: 'CONNECTION_TIMEOUT' }], at: timestamp });
  const stored = JSON.stringify({ kind: 'mail_sync_outcome_v1', ...outcome });
  const account = publicMailAccount({ last_error_message: stored, last_successful_sync_at: '2026-09-01', last_sync_attempt_at: timestamp });
  assert.equal(account.health.lastErrorMessage, outcome.message);
  assert.equal(account.last_error_message, outcome.message);
  assert.deepEqual(account.health.syncSummary.errors, outcome.errors);
  assert.equal(account.health.lastSuccessfulSyncAt, '2026-09-01');
  assert.equal(account.health.lastSyncAttemptAt, timestamp);
  assert.equal(parseMailSyncOutcome('{malformed'), null);
  assert.equal(parseMailSyncOutcome('{"kind":"unknown"}'), null);
});
