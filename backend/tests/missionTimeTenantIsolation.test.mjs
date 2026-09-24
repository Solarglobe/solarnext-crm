import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL statements against a fresh, in-memory engine only. Importing
// the production db/auth config or opening HTTP connections is prohibited here.
const ids = {
  orgA: '10000000-0000-4000-8000-000000000001',
  orgB: '10000000-0000-4000-8000-000000000002',
  missionA: '20000000-0000-4000-8000-000000000001',
  missionB: '20000000-0000-4000-8000-000000000002',
  missing: '20000000-0000-4000-8000-000000000009',
  conflict: '20000000-0000-4000-8000-000000000003',
  userA: '30000000-0000-4000-8000-000000000001',
  userB: '30000000-0000-4000-8000-000000000002',
  superAdmin: '30000000-0000-4000-8000-000000000009',
};
const originalStart = '2026-09-24T09:00:00.000Z';
const originalEnd = '2026-09-24T10:00:00.000Z';
const nextStart = '2026-09-25T11:00:00.000Z';
const nextEnd = '2026-09-25T12:00:00.000Z';
let db;
let statements;
let permissions;
let released;
let claims;

const query = async (sql, values = []) => {
  statements.push({ sql, values });
  return db.query(sql, values);
};
const pool = {
  query,
  connect: async () => ({ query, release() { released++; } }),
};

function loadFunctions(relativePath, exportedNames, dependencies) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export (?=(?:async )?function\b)/gm, '');
  return vm.runInNewContext(`${source}\n({ ${exportedNames.join(', ')} });`, dependencies, { filename: relativePath });
}

const missionService = loadFunctions('../services/missionService.js', ['updateMissionTime'], { pool });
const { canAccessMissionUpdate } = loadFunctions('../middleware/mission.middleware.js', ['canAccessMissionUpdate'], {
  pool, getUserPermissions: async () => new Set(permissions),
});
const { updateTime } = loadFunctions('../controllers/missions.controller.js', ['updateTime'], {
  pool, missionService,
  assertClientApiAccess: () => { throw new Error('Unexpected client access lookup'); },
});
const { verifyJWT } = loadFunctions('../middleware/auth.middleware.js', ['verifyJWT'], {
  pool,
  jwt: { verify: () => ({ ...claims }) },
  JWT_SECRET: 'synthetic-only',
  logAuditEvent: async () => {},
  AuditActions: {},
  userIsLiveSuperAdminByDb: async () => true,
  sendSuperAdminJwtStale: () => { throw new Error('Unexpected stale super-admin token'); },
  console,
});

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE missions (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      title text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE mission_assignments (
      mission_id uuid NOT NULL REFERENCES missions(id), user_id uuid NOT NULL,
      PRIMARY KEY (mission_id, user_id)
    );
  `);
});

after(async () => { await db?.close(); });

beforeEach(async () => {
  statements = [];
  permissions = ['mission.update.all'];
  released = 0;
  claims = { userId: ids.userA, organizationId: ids.orgA, role: 'ADMIN' };
  await db.exec('TRUNCATE mission_assignments, missions, organizations CASCADE');
  await db.query('INSERT INTO organizations (id) VALUES ($1), ($2)', [ids.orgA, ids.orgB]);
  await db.query(`INSERT INTO missions (id, organization_id, title, start_at, end_at)
    VALUES ($1, $2, 'Only A', $5, $6), ($3, $4, 'Confidential B', $5, $6)`,
  [ids.missionA, ids.orgA, ids.missionB, ids.orgB, originalStart, originalEnd]);
  await db.query('INSERT INTO mission_assignments (mission_id, user_id) VALUES ($1, $2), ($3, $4)',
    [ids.missionA, ids.userA, ids.missionB, ids.userB]);
});

function context(missionId, user = claims) {
  const response = { status: 200, body: undefined };
  return {
    req: {
      user: { ...user }, params: { id: missionId }, body: { start_at: nextStart, end_at: nextEnd },
      method: 'PATCH', originalUrl: `/api/missions/${missionId}/time`, headers: {},
    },
    res: {
      status(code) { response.status = code; return this; },
      json(body) { response.body = body; return this; },
    },
    response,
  };
}

async function authorize(t) {
  let allowed = false;
  await canAccessMissionUpdate(t.req, t.res, () => { allowed = true; });
  return allowed;
}

async function move(t) {
  if (await authorize(t)) await updateTime(t.req, t.res);
  return t.response;
}

async function stored(missionId) {
  return (await db.query('SELECT * FROM missions WHERE id = $1', [missionId])).rows[0];
}

test('S1: mission.update.all in organization A cannot move or receive a mission from B', async () => {
  const before = await stored(ids.missionB);
  const result = await move(context(ids.missionB));
  assert.equal(result.status, 404);
  assert.equal(result.body?.organization_id, undefined);
  assert.equal(JSON.stringify(result.body).includes('Confidential B'), false);
  assert.deepEqual(await stored(ids.missionB), before);
});

test('the real service rejects a foreign organization even without the HTTP middleware', async () => {
  const before = await stored(ids.missionB);
  await assert.rejects(missionService.updateMissionTime({
    missionId: ids.missionB, organizationId: ids.orgA, actorUserId: ids.userA,
    canUpdateAll: true, startAt: nextStart, endAt: nextEnd,
  }), error => error.code === 'NOT_FOUND');
  assert.deepEqual(await stored(ids.missionB), before);
});

test('an organization-wide editor can move its mission in a scoped transaction without changing assignments', async () => {
  const result = await move(context(ids.missionA));
  assert.equal(result.status, 200);
  assert.equal(result.body.organization_id, ids.orgA);
  assert.equal(result.body.start_at.toISOString(), nextStart);
  assert.equal(result.body.end_at.toISOString(), nextEnd);
  assert.ok(statements.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(statements.some(({ sql }) => /FROM missions/i.test(sql) && /FOR UPDATE/i.test(sql)));
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
  const dataStatements = statements.filter(({ sql }) => /(?:FROM|UPDATE) (?:missions|mission_assignments)/i.test(sql));
  assert.ok(dataStatements.length >= 3);
  for (const { sql, values } of dataStatements) {
    assert.ok(values.includes(ids.orgA), `Missing tenant parameter in ${sql}`);
    assert.match(sql, /organization_id\s*=\s*\$/);
  }
  assert.equal(released, 1);
  assert.deepEqual((await db.query('SELECT * FROM mission_assignments ORDER BY mission_id')).rows,
    [{ mission_id: ids.missionA, user_id: ids.userA }, { mission_id: ids.missionB, user_id: ids.userB }]);
});

test('a self-scoped assigned user can move its own mission', async () => {
  permissions = ['mission.update.self'];
  const result = await move(context(ids.missionA));
  assert.equal(result.status, 200);
  assert.equal(result.body.start_at.toISOString(), nextStart);
});

test('self authorization is revalidated when assignment disappears after middleware approval', async () => {
  permissions = ['mission.update.self'];
  const t = context(ids.missionA);
  assert.equal(await authorize(t), true);
  await db.query('DELETE FROM mission_assignments WHERE mission_id = $1 AND user_id = $2', [ids.missionA, ids.userA]);
  const before = await stored(ids.missionA);
  await updateTime(t.req, t.res);
  assert.ok([403, 404].includes(t.response.status), `Unexpected status ${t.response.status}`);
  assert.deepEqual(await stored(ids.missionA), before);
  assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
});

test('body-supplied tenant, actor and all-access flags never override the authenticated scope', async () => {
  permissions = ['mission.update.self'];
  const t = context(ids.missionB);
  Object.assign(t.req.body, {
    organizationId: ids.orgB, organization_id: ids.orgB, actorUserId: ids.userB,
    canUpdateAll: true, role: 'SUPER_ADMIN',
    missionUpdateAccess: { organizationId: ids.orgB, userId: ids.userB, canUpdateAll: true },
  });
  const before = await stored(ids.missionB);
  const result = await move(t);
  assert.equal(result.status, 403);
  assert.deepEqual(await stored(ids.missionB), before);
});

test('missing mission UUID returns 404 and never reads assignments or updates another mission', async () => {
  const before = await stored(ids.missionA);
  const result = await move(context(ids.missing));
  assert.equal(result.status, 404);
  assert.equal(statements.some(({ sql }) => /UPDATE missions SET/i.test(sql)), false);
  assert.deepEqual(await stored(ids.missionA), before);
});

test('missing tenant context never falls back to an unscoped service write', async () => {
  await assert.rejects(missionService.updateMissionTime({
    missionId: ids.missionA, actorUserId: ids.userA, canUpdateAll: true,
    startAt: nextStart, endAt: nextEnd,
  }), error => ['NOT_FOUND', 'INVALID_USER_CONTEXT', 'FORBIDDEN'].includes(error.code));
  assert.equal((await stored(ids.missionA)).start_at.toISOString(), originalStart);
});

test('an existing same-organization schedule conflict rolls back the move', async () => {
  await db.query(`INSERT INTO missions (id, organization_id, title, start_at, end_at)
    VALUES ($1, $2, 'Existing appointment', $3, $4)`, [ids.conflict, ids.orgA, nextStart, nextEnd]);
  await db.query('INSERT INTO mission_assignments (mission_id, user_id) VALUES ($1, $2)', [ids.conflict, ids.userA]);
  const result = await move(context(ids.missionA));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'SCHEDULE_CONFLICT');
  assert.equal((await stored(ids.missionA)).start_at.toISOString(), originalStart);
  assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
});

test('the scoped conflict query does not expose a foreign appointment through a cross-tenant assignment', async () => {
  await db.query('INSERT INTO mission_assignments (mission_id, user_id) VALUES ($1, $2)', [ids.missionB, ids.userA]);
  await db.query('UPDATE missions SET start_at = $1, end_at = $2 WHERE id = $3', [nextStart, nextEnd, ids.missionB]);
  const foreignBefore = await stored(ids.missionB);
  const result = await move(context(ids.missionA));
  assert.equal(result.status, 200);
  assert.deepEqual(await stored(ids.missionB), foreignBefore);
});

test('SUPER_ADMIN edit mode without selecting B cannot move a B mission from organization A', async () => {
  claims = { userId: ids.superAdmin, organizationId: ids.orgA, role: 'SUPER_ADMIN' };
  const t = context(ids.missionB);
  t.req.headers = { authorization: 'Bearer synthetic', 'x-super-admin-edit': '1' };
  let authenticated = false;
  await verifyJWT(t.req, t.res, () => { authenticated = true; });
  assert.equal(authenticated, true);
  await move(t);
  assert.equal(t.response.status, 404);
  assert.equal((await stored(ids.missionB)).start_at.toISOString(), originalStart);
});

test('SUPER_ADMIN can move B after explicitly selecting B and enabling edit mode', async () => {
  claims = { userId: ids.superAdmin, organizationId: ids.orgA, role: 'SUPER_ADMIN' };
  const t = context(ids.missionB);
  t.req.headers = { authorization: 'Bearer synthetic', 'x-organization-id': ids.orgB, 'x-super-admin-edit': '1' };
  let authenticated = false;
  await verifyJWT(t.req, t.res, () => { authenticated = true; });
  assert.equal(authenticated, true);
  assert.equal(t.req.user.organizationId, ids.orgB);
  await move(t);
  assert.equal(t.response.status, 200);
  assert.equal(t.response.body.organization_id, ids.orgB);
  assert.equal((await stored(ids.missionB)).start_at.toISOString(), nextStart);
});

test('SUPER_ADMIN still requires explicit edit mode even after selecting the target organization', async () => {
  claims = { userId: ids.superAdmin, organizationId: ids.orgA, role: 'SUPER_ADMIN' };
  const t = context(ids.missionB);
  t.req.headers = { authorization: 'Bearer synthetic', 'x-organization-id': ids.orgB };
  let authenticated = false;
  await verifyJWT(t.req, t.res, () => { authenticated = true; });
  assert.equal(authenticated, false);
  assert.equal(t.response.status, 403);
  assert.equal(t.response.body.code, 'SUPER_ADMIN_READ_ONLY');
  assert.equal((await stored(ids.missionB)).start_at.toISOString(), originalStart);
});
