import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as states from '../services/mail/mailAccountState.service.js';
import * as sync from '../services/mail/mailDraftSync.service.js';
import { draftJobFence } from '../services/mail/mailDraftFence.service.js';

// Concurrency SIMULATION, not a multi-connection PostgreSQL test. Production
// service/helper/resolver bodies run unchanged. This transport interprets their
// SELECT/FOR SHARE, UPDATE/DELETE and transaction boundaries with two clients.
// Real SQL syntax and semantics are covered by mailDraftAuthorization.test.mjs.
function load(relative, names, dependencies) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export\s+/gm, '');
  return vm.runInNewContext(`${source}\n({ ${names.join(', ')} });`, { ...dependencies, console, Buffer });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function memoryTransport({ delegated = false, pauseJob = false } = {}) {
  const tables = {
    rbac_permissions: [{ id: 'permission-use', code: 'mail.use' }],
    rbac_roles: [{ id: 'role-a', organization_id: 'org-a' }],
    rbac_role_permissions: [{ role_id: 'role-a', permission_id: 'permission-use' }],
    rbac_user_roles: [{ user_id: 'user-a', role_id: 'role-a' }],
    mail_accounts: [{ id: 'account-a', organization_id: 'org-a', user_id: delegated ? 'owner-b' : 'user-a',
      is_active: true, lifecycle_state: 'CONNECTED', sync_enabled: true, reconnect_required: false }],
    mail_account_permissions: delegated ? [{ id: 'grant-a', mail_account_id: 'account-a', organization_id: 'org-a',
      user_id: 'user-a', can_read: true, can_send: true, can_manage: false }] : [],
    mail_drafts: [],
    mail_draft_sync_jobs: [],
  };
  const events = [];
  const locks = new Map();
  const blocked = deferred();
  const jobEntered = deferred();
  const resumeJob = deferred();
  let clientSequence = 0;

  function rowKey(table, row) {
    const id = row.id ?? [row.user_id, row.role_id, row.permission_id].filter(Boolean).join('|');
    return `${table}:${id}`;
  }

  function canAcquire(lock, client, mode) {
    return (!lock.writer || lock.writer === client) &&
      (mode === 'share' || [...lock.readers].every(reader => reader === client));
  }

  function grant(lock, client, mode) {
    if (mode === 'share') lock.readers.add(client);
    else lock.writer = client;
  }

  async function acquire(client, key, mode) {
    if (!locks.has(key)) locks.set(key, { readers: new Set(), writer: null, waiters: [] });
    const lock = locks.get(key);
    if (canAcquire(lock, client, mode)) grant(lock, client, mode);
    else {
      const gate = deferred();
      lock.waiters.push({ client, mode, resolve: gate.resolve });
      events.push({ type: 'blocked', client, key, mode });
      blocked.resolve({ client, key, mode });
      await gate.promise;
    }
    events.push({ type: 'locked', client, key, mode });
  }

  function release(client) {
    for (const lock of locks.values()) {
      lock.readers.delete(client);
      if (lock.writer === client) lock.writer = null;
      while (lock.waiters.length) {
        const next = lock.waiters[0];
        if (!canAcquire(lock, next.client, next.mode)) break;
        lock.waiters.shift();
        grant(lock, next.client, next.mode);
        next.resolve();
      }
    }
  }

  function permissionJoin(userId, organizationId) {
    const rows = [];
    for (const ur of tables.rbac_user_roles.filter(row => row.user_id === userId)) {
      for (const r of tables.rbac_roles.filter(row => row.id === ur.role_id && (row.organization_id === organizationId || row.organization_id == null))) {
        for (const rp of tables.rbac_role_permissions.filter(row => row.role_id === r.id)) {
          for (const p of tables.rbac_permissions.filter(row => row.id === rp.permission_id)) rows.push({ ur, r, rp, p });
        }
      }
    }
    return rows;
  }

  function matchesWhere(row, expression, values) {
    return expression.split(/\s+AND\s+/i).every(part => {
      const match = part.trim().match(/^(\w+)\s*=\s*\$(\d+)$/);
      assert.ok(match, `Unsupported synthetic WHERE: ${part}`);
      return row[match[1]] === values[Number(match[2]) - 1];
    });
  }

  function client(name = `save-${++clientSequence}`) {
    let transaction = false;
    let writes = [];
    return {
      name,
      async query(sql, values = []) {
        const statement = sql.trim();
        events.push({ type: 'query', client: name, sql: statement });
        if (statement === 'BEGIN') {
          assert.equal(transaction, false);
          transaction = true;
          return { rows: [] };
        }
        assert.equal(transaction, true, `${statement} must be transactional`);
        if (statement === 'COMMIT' || statement === 'ROLLBACK') {
          if (statement === 'COMMIT') for (const write of writes) write();
          writes = [];
          transaction = false;
          events.push({ type: statement.toLowerCase(), client: name });
          release(name);
          return { rows: [] };
        }
        if (/FROM rbac_permissions p/.test(statement)) {
          const joined = permissionJoin(values[0], values[1]);
          const lockClause = statement.match(/FOR SHARE OF ([\w, ]+)/i);
          if (lockClause) {
            const aliases = new Set(lockClause[1].split(',').map(alias => alias.trim()));
            const names = { ur: 'rbac_user_roles', r: 'rbac_roles', rp: 'rbac_role_permissions', p: 'rbac_permissions' };
            for (const row of joined) for (const [alias, table] of Object.entries(names)) {
              if (aliases.has(alias)) await acquire(name, rowKey(table, row[alias]), 'share');
            }
          }
          return { rows: permissionJoin(values[0], values[1]).map(row => ({ code: row.p.code })) };
        }
        if (/FROM mail_accounts WHERE/.test(statement)) {
          const select = () => tables.mail_accounts.filter(row => row.id === values[0] && row.organization_id === values[1]);
          if (/FOR SHARE\b/.test(statement)) for (const row of select()) await acquire(name, rowKey('mail_accounts', row), 'share');
          return { rows: structuredClone(select()) };
        }
        if (/FROM mail_account_permissions/.test(statement) && /^SELECT\b/.test(statement)) {
          const select = () => tables.mail_account_permissions.filter(row =>
            row.mail_account_id === values[0] && row.organization_id === values[1] && row.user_id === values[2]);
          if (/FOR SHARE\b/.test(statement)) for (const row of select()) await acquire(name, rowKey('mail_account_permissions', row), 'share');
          return { rows: structuredClone(select()) };
        }
        const update = statement.match(/^UPDATE (\w+) SET (\w+)\s*=\s*\$1 WHERE (.+)$/i);
        const deletion = statement.match(/^DELETE FROM (\w+) WHERE (.+)$/i);
        if (update || deletion) {
          const table = (update || deletion)[1];
          const where = update ? update[3] : deletion[2];
          const targets = tables[table].filter(row => matchesWhere(row, where, values));
          for (const row of targets) await acquire(name, rowKey(table, row), 'exclusive');
          writes.push(() => {
            if (update) for (const row of targets) row[update[2]] = values[0];
            else tables[table] = tables[table].filter(row => !targets.includes(row));
            events.push({ type: 'mutation-visible', client: name, table });
          });
          return { rows: [], rowCount: targets.length };
        }
        if (/^INSERT INTO mail_drafts\b/.test(statement)) {
          const columns = statement.match(/INSERT INTO mail_drafts\s*\(([^)]+)\)/)[1].split(',').map(column => column.trim());
          const row = { id: randomUUID(), local_version: 1, local_dirty: true, sync_status: 'QUEUED' };
          values.forEach((value, index) => { row[columns[index]] = columns[index] === 'attachments_json' ? JSON.parse(value) : value; });
          writes.push(() => tables.mail_drafts.push(row));
          return { rows: [structuredClone(row)] };
        }
        if (/^INSERT INTO mail_draft_sync_jobs\b/.test(statement)) {
          jobEntered.resolve();
          if (pauseJob) await resumeJob.promise;
          const row = { organization_id: values[0], mail_account_id: values[1], draft_id: values[2], action: values[3],
            idempotency_key: values[4], payload_json: JSON.parse(values[5]) };
          writes.push(() => tables.mail_draft_sync_jobs.push(row));
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected synthetic SQL: ${statement}`);
      },
      release() { assert.equal(transaction, false, 'Client released before transaction completion'); },
    };
  }

  return { tables, events, blocked, jobEntered, resumeJob, client, pool: { connect: async () => client() } };
}

function fixture(options) {
  const transport = memoryTransport(options);
  const access = load('../services/mailAccess.service.js', ['resolveMailAccountAccess'], states);
  const authorization = load('../services/mail/mailDraftAccess.service.js', ['assertDraftMailAccountAccess'], { ...states, ...access });
  const service = load('../services/mail/mailDraft.service.js', ['createDraft', 'normalizeDraftPayload'], {
    ...sync, ...authorization, pool: transport.pool, randomUUID, draftJobFence,
  });
  const create = () => service.createDraft({
    userId: 'user-a', organizationId: 'org-a',
    draft: service.normalizeDraftPayload({ mailAccountId: 'account-a', subject: 'Synthetic only', bodyText: 'No IMAP or SMTP call' }),
  });
  return { ...transport, create };
}

const revocations = [
  { name: 'delegation can_send', delegated: true,
    sql: 'UPDATE mail_account_permissions SET can_send = $1 WHERE id = $2', values: [false, 'grant-a'] },
  { name: 'account ownership', sql: 'UPDATE mail_accounts SET user_id = $1 WHERE id = $2', values: ['owner-b', 'account-a'] },
  { name: 'account activity', sql: 'UPDATE mail_accounts SET is_active = $1 WHERE id = $2', values: [false, 'account-a'] },
  { name: 'RBAC user role', sql: 'DELETE FROM rbac_user_roles WHERE user_id = $1 AND role_id = $2', values: ['user-a', 'role-a'] },
  { name: 'RBAC role organization', sql: 'UPDATE rbac_roles SET organization_id = $1 WHERE id = $2', values: ['org-b', 'role-a'] },
  { name: 'RBAC role permission', sql: 'DELETE FROM rbac_role_permissions WHERE role_id = $1 AND permission_id = $2', values: ['role-a', 'permission-use'] },
  { name: 'RBAC permission code', sql: 'UPDATE rbac_permissions SET code = $1 WHERE id = $2', values: ['mail.other', 'permission-use'] },
];

async function revoke(f, change) {
  const client = f.client('revoker');
  await client.query('BEGIN');
  await client.query(change.sql, change.values);
  await client.query('COMMIT');
  client.release();
}

for (const change of revocations) {
  test(`M6 simulated clients: ${change.name} revocation waits for authorized createDraft COMMIT`, async () => {
    const f = fixture({ delegated: change.delegated, pauseJob: true });
    const saving = f.create();
    await f.jobEntered.promise;
    const revoking = revoke(f, change);
    try {
      const outcome = await Promise.race([
        f.blocked.promise.then(event => ({ blocked: true, event })),
        revoking.then(() => ({ blocked: false })),
      ]);
      assert.equal(outcome.blocked, true, 'A revocation must wait on the actual helper FOR SHARE locks');
      assert.equal(outcome.event.client, 'revoker');
      assert.equal(outcome.event.mode, 'exclusive');
      assert.equal(f.events.some(event => event.type === 'commit' && event.client === 'revoker'), false);
      assert.equal(f.tables.mail_drafts.length, 0, 'The paused draft transaction is not committed yet');
      assert.equal(f.tables.mail_draft_sync_jobs.length, 0);
      f.resumeJob.resolve();
      const result = await saving;
      await revoking;
      assert.equal(result.mail_account_id, 'account-a');
      assert.equal(f.tables.mail_drafts.length, 1);
      assert.equal(f.tables.mail_draft_sync_jobs.length, 1);
      const saveCommit = f.events.findIndex(event => event.type === 'commit' && event.client === 'save-1');
      const revokeVisible = f.events.findIndex(event => event.type === 'mutation-visible' && event.client === 'revoker');
      assert.ok(saveCommit >= 0 && revokeVisible > saveCommit, 'Revocation becomes visible only after the authorized write commits');
      await assert.rejects(f.create(), error => error.code === 'MAIL_ACCOUNT_FORBIDDEN' && error.statusCode === 403);
      assert.equal(f.tables.mail_drafts.length, 1, 'A later request cannot reuse the old authorization');
      assert.equal(f.tables.mail_draft_sync_jobs.length, 1);
    } finally {
      f.resumeJob.resolve();
      await Promise.allSettled([saving, revoking]);
    }
  });

  test(`M6 simulated clients: committed ${change.name} revocation prevents any draft or job`, async () => {
    const f = fixture({ delegated: change.delegated });
    await revoke(f, change);
    await assert.rejects(f.create(), error => error.code === 'MAIL_ACCOUNT_FORBIDDEN' && error.statusCode === 403);
    assert.equal(f.tables.mail_drafts.length, 0);
    assert.equal(f.tables.mail_draft_sync_jobs.length, 0);
    assert.ok(f.events.some(event => event.type === 'rollback' && event.client === 'save-1'));
  });
}

test('simulation control: a SELECT without FOR SHARE does not block an UPDATE', async () => {
  const f = memoryTransport();
  const reader = f.client('reader');
  await reader.query('BEGIN');
  await reader.query('SELECT id FROM mail_accounts WHERE id = $1 AND organization_id = $2', ['account-a', 'org-a']);
  await revoke(f, revocations.find(change => change.name === 'account activity'));
  assert.equal(f.tables.mail_accounts[0].is_active, false);
  assert.equal(f.events.some(event => event.type === 'blocked'), false);
  await reader.query('COMMIT');
  reader.release();
});
