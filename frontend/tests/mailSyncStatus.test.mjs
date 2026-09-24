import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Compile only the tested TypeScript source in memory, bypassing Vite hooks and
// environment loading. HTTP is a synthetic function; no network is permitted.
function compile(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function loadFrontendStatus() {
  const exports = {};
  vm.runInNewContext(compile('../src/pages/mail/mailSyncStatus.ts'), { exports });
  return exports;
}
function loadFrontendApi(response, httpOk = true) {
  const exports = {};
  vm.runInNewContext(compile('../src/services/mailApi.ts'), {
    exports, require: name => {
      if (name.endsWith('mailSyncStatus')) return loadFrontendStatus();
      return { apiFetch: async () => ({ ok: httpOk, status: httpOk ? 200 : 500, text: async () => response }), getCrmApiBase: () => 'https://synthetic.invalid' };
    }, URLSearchParams,
  });
  return exports;
}

test('frontend API rejects a partial HTTP 200 result', async () => {
  const api = loadFrontendApi(JSON.stringify({ success: false, ok: false, outcome: 'PARTIAL', message: 'Archives: timeout' }));
  await assert.rejects(api.runMailSync(), /Archives: timeout/);
});
test('frontend API rejects malformed success payloads', async () => {
  await assert.rejects(loadFrontendApi('not-json').runMailSync(), /réponse|invalide/i);
});
test('frontend API accepts a complete successful account result', async () => {
  const result = await loadFrontendApi(JSON.stringify({ success: true, ok: true, outcome: 'SUCCESS' })).runMailSync();
  assert.equal(result.success, true);
});
test('frontend rejects inconsistent aggregate success and HTTP failure', async () => {
  await assert.rejects(loadFrontendApi(JSON.stringify({ success: true, summary: { total: 2, ok: 1, failed: 1 } })).runMailSync(), /incomplète/);
  await assert.rejects(loadFrontendApi(JSON.stringify({ success: true }), false).runMailSync(), /incomplète/);
});

const { mailAccountSyncLabel } = loadFrontendStatus();
for (const [row, expected] of [
  [{ lifecycle_state: 'CONNECTED' }, 'Jamais synchronisé'],
  [{ lifecycle_state: 'CONNECTED', last_imap_sync_at: '2026-09-24' }, 'Jamais synchronisé'],
  [{ sync_status: 'SYNCING', last_successful_sync_at: '2026-09-24' }, 'Synchronisation…'],
  [{ sync_status: 'ERROR', last_error_code: 'SYNC_PARTIAL', last_successful_sync_at: '2026-09-24' }, 'Synchronisation partielle'],
  [{ sync_status: 'ERROR', last_error_code: 'CONNECTION_TIMEOUT', last_successful_sync_at: '2026-09-24' }, 'Erreur de synchronisation'],
  [{ sync_status: 'ERROR', last_error_code: 'SYNC_NOT_COMPLETE' }, 'Synchronisation incomplète'],
  [{ lifecycle_state: 'AUTH_REQUIRED' }, 'Reconnexion requise'],
  [{ sync_enabled: false }, 'Synchronisation désactivée'],
  [{ sync_status: 'IDLE', imap_status: 'OK', last_successful_sync_at: '2026-09-24' }, 'Synchronisé'],
]) {
  test(`account label reflects actual sync outcome: ${expected} (${JSON.stringify(row)})`, () => {
    assert.equal(mailAccountSyncLabel(row), expected);
  });
}

test('inbox account status does not announce synchronized after a partial attempt', () => {
  const source = readFileSync(new URL('../src/pages/mail/MailInboxPage.tsx', import.meta.url), 'utf8');
  const body = source.match(/const accountStatusLabel = useCallback\(\(accountId: string\) => \{([\s\S]+?)\}, \[accountById\]\);/)?.[1];
  assert.ok(body, 'inbox account label callback must exist');
  const accountById = new Map([['test', { lifecycle_state: 'CONNECTED', sync_status: 'ERROR',
    last_error_code: 'SYNC_PARTIAL', last_successful_sync_at: '2026-09-01' }]]);
  const label = vm.runInNewContext(`(function (accountId) { ${body} })('test')`, { accountById, mailAccountSyncLabel });
  assert.equal(label, 'Synchronisation partielle');
});

test('expanded account status uses freshly reloaded health after a partial synchronization', () => {
  const source = readFileSync(new URL('../src/pages/settings/mail/MailAccountsTab.tsx', import.meta.url), 'utf8');
  const expression = source.match(/<dt>Statut<\/dt>\s*<dd>\{([^}]+)\}/)?.[1];
  assert.ok(expression, 'settings status rendering expression must exist');
  const detail = { sync_status: 'IDLE', last_successful_sync_at: '2026-09-01', connection_status: 'ok' };
  const acc = { ...detail, sync_status: 'ERROR', last_error_code: 'SYNC_PARTIAL', connection_status: 'error' };
  const label = vm.runInNewContext(expression, { detail, acc, statusLabel: (_connection, row) => mailAccountSyncLabel(row) });
  assert.equal(label, 'Synchronisation partielle');
});
