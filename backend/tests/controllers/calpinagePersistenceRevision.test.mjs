import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withTx } from '../../db/tx.js';
import { V2_SCHEMA_VERSION } from '../../services/calpinage/calpinageShadingNormalizer.js';
import { adaptLegacyShadingToV2, getNormalizedShadingFromGeometry } from '../../services/calpinage/calpinageShadingLegacyAdapter.js';
import { getOfficialGlobalShadingLossPct } from '../../services/shading/officialShadingTruth.js';
import { mergeLayoutSnapshotForUpsert } from '../../services/calpinage/mergeGeometryLayoutSnapshot.js';
import { sanitizeCalpinageGeometryForPersistence } from '../../services/calpinage/calpinageCommercialIntegrity.js';
import { computeCalpinagePersistenceRevision } from '../../services/calpinage/calpinagePersistenceRevision.js';
import { lockCalpinageVersion } from '../../services/calpinage/calpinageDataConcurrency.js';
import { withPgRetryOnce } from '../../utils/pgRetry.js';
import { resolvePanelPowerWc, isInstalledKwcDivergent } from '../../utils/resolvePanelPowerWc.js';
import { AuditActions } from '../../services/audit/auditActions.js';

// Exercise the real controller, transaction and advisory-lock helpers. Only the
// SQL transport and unrelated external services are replaced; no database runs.
let database;
let beforePowerLookup;
let auditEvents;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function revisionOf(geometry) {
  return geometry == null ? null : createHash('sha256').update(stableJson(geometry)).digest('hex');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createDatabase() {
  const rows = new Map();
  const locks = new Map();
  const statements = [];
  let writes = 0;
  const keyOf = (version, org) => `${org}|${version}`;
  function read(sql, values) {
    assert.match(sql, /FROM calpinage_data/);
    assert.match(sql, /study_version_id = \$1 AND organization_id = \$2/);
    const row = rows.get(keyOf(values[0], values[1]));
    return { rows: row ? [structuredClone(row)] : [] };
  }
  return {
    rows, statements, keyOf,
    get writes() { return writes; },
    async query(sql, values) {
      statements.push(sql);
      return read(sql, values);
    },
    async connect() {
      let unlock;
      let lockKey;
      let pending;
      return {
        async query(sql, values = []) {
          statements.push(sql);
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (sql === 'COMMIT' && pending) {
              rows.set(pending.key, pending.row);
              writes++;
            }
            pending = null;
            unlock?.();
            unlock = null;
            return { rows: [] };
          }
          if (sql.includes('pg_advisory_xact_lock')) {
            lockKey = values[0];
            const previous = locks.get(lockKey) ?? Promise.resolve();
            const gate = deferred();
            locks.set(lockKey, previous.then(() => gate.promise));
            await previous;
            unlock = gate.resolve;
            return { rows: [] };
          }
          if (sql.includes('SELECT') && sql.includes('FROM calpinage_data')) {
            assert.equal(lockKey, `calpinage|${values[1]}|${values[0]}`);
            assert.match(sql, /FOR UPDATE/);
            return read(sql, values);
          }
          if (sql.includes('INSERT INTO calpinage_data')) {
            const [org, version, json, panels, power, annual, loss] = values;
            assert.equal(lockKey, `calpinage|${org}|${version}`);
            const key = keyOf(version, org);
            const existing = rows.get(key);
            const row = {
              id: existing?.id ?? `calpinage-${version}`,
              geometry_json: JSON.parse(json),
              total_panels: panels,
              total_power_kwc: power,
              annual_production_kwh: annual,
              total_loss_pct: loss,
              created_at: existing?.created_at ?? '2026-01-01T00:00:00.000Z',
            };
            pending = { key, row };
            return { rows: [structuredClone(row)] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() { assert.equal(unlock, null, 'Transaction must finish before release'); },
      };
    },
  };
}

// Node 20-compatible dependency injection: evaluate the unchanged function bodies
// with an explicit dependency map, so neither db.js nor any live service loads.
function loadFunctions(relativePath, exports, dependencies) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export (?=(?:async )?function\b)/gm, '');
  return vm.runInNewContext(`${source}\n({ ${exports.join(', ')} });`, dependencies, { filename: relativePath });
}

const pool = {
  query: (...args) => database.query(...args),
  connect: () => database.connect(),
};
const { computeCalpinageGeometryHash } = loadFunctions('../../services/calpinage/calpinageGeometryHash.js', ['computeCalpinageGeometryHash'], { crypto, pool });
const { getCalpinage, upsertCalpinage } = loadFunctions('../../controllers/calpinage.controller.js', ['getCalpinage', 'upsertCalpinage'], {
  pool, withTx, V2_SCHEMA_VERSION, adaptLegacyShadingToV2, getNormalizedShadingFromGeometry,
  getOfficialGlobalShadingLossPct, mergeLayoutSnapshotForUpsert, sanitizeCalpinageGeometryForPersistence,
  computeCalpinageGeometryHash, computeCalpinagePersistenceRevision, lockCalpinageVersion, withPgRetryOnce,
  resolvePanelPowerWc, isInstalledKwcDivergent, AuditActions, console,
  process: { env: {} },
  studiesService: {
    getVersion: async (study, version, org) => {
      if (!['study-a', 'study-b'].includes(study) || version !== 1 || org !== 'org') return null;
      return { id: `${study}-v1`, study_id: study, version_number: version, is_locked: false };
    },
  },
  logAuditEvent: async event => { auditEvents.push(event); },
  computeOfficialShading: async () => { throw new Error('Unexpected shading computation'); },
  fetchPvPanelRowById: async () => { throw new Error('Unexpected panel lookup'); },
  fetchPvInverterRowById: async () => { throw new Error('Unexpected inverter lookup'); },
  computeInstalledPowerFromGeometryWithCatalog: async (_pool, geometry) => {
    await beforePowerLookup?.(geometry);
    return null;
  },
});

beforeEach(() => {
  database = createDatabase();
  beforePowerLookup = null;
  auditEvents = [];
});

function request(body = {}, studyId = 'study-a') {
  const captured = { status: 200, body: null };
  return {
    req: { user: { organizationId: 'org' }, params: { studyId, versionId: '1' }, body },
    res: {
      status(status) { captured.status = status; return this; },
      json(body) { captured.body = body; return this; },
    },
    captured,
  };
}

async function save(geometry, options = {}, studyId = 'study-a') {
  const t = request({ geometry_json: geometry, ...options }, studyId);
  await upsertCalpinage(t.req, t.res);
  return t.captured;
}

async function load(studyId = 'study-a') {
  const t = request({}, studyId);
  await getCalpinage(t.req, t.res);
  return t.captured;
}

test('an older concurrent save is rejected under the lock and cannot overwrite the newer geometry', async () => {
  await save({ roofState: {}, view3DState: { zoom: 1 } });
  const initialRow = database.rows.get(database.keyOf('study-a-v1', 'org'));
  const initialRevision = revisionOf(initialRow.geometry_json);
  const started = deferred();
  const resume = deferred();
  beforePowerLookup = async geometry => {
    if (geometry.persistence?.edit === 'older') {
      started.resolve();
      await resume.promise;
    }
  };
  const older = save({ roofState: {}, view3DState: { zoom: 2 }, persistence: { edit: 'older' } }, { expectedRevision: initialRevision });
  await started.promise;
  let newer;
  try {
    newer = await save({ roofState: {}, view3DState: { zoom: 3 }, persistence: { edit: 'newer' } }, { expectedRevision: initialRevision });
  } finally {
    resume.resolve();
  }
  const stale = await older;
  assert.equal(newer.status, 200);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'CALPINAGE_REVISION_CONFLICT');
  assert.equal(stale.body.serverRevision, newer.body.serverRevision);
  assert.equal(database.writes, 2, 'Initial and newer save only');
  assert.equal(auditEvents.length, 2, 'A rejected save must not emit a success audit');
  const current = await load();
  assert.equal(current.body.calpinageData.geometry_json.view3DState.zoom, 3);
  assert.deepEqual(current.body.calpinageData.geometry_json.persistence, { edit: 'newer' });
  assert.equal(current.body.serverRevision, newer.body.serverRevision);
  assert.ok(database.statements.includes('ROLLBACK'));
});

test('expectedRevision null permits creation once and rejects a second concurrent creator', async () => {
  const firstRead = await load();
  assert.equal(firstRead.status, 404);
  assert.equal(firstRead.body.serverRevision, null);
  const results = await Promise.all([
    save({ persistence: { edit: 'a' } }, { expectedRevision: null }),
    save({ persistence: { edit: 'b' } }, { expectedRevision: null }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(database.writes, 1);
});

test('server revision covers the complete stored JSON, is key-order independent and survives reload', async () => {
  const first = await save({ roofState: {}, view3DState: { zoom: 1 }, persistence: { revision: 7, session: 'test' } });
  assert.equal(first.status, 200);
  assert.match(first.body.serverRevision ?? '', /^[a-f0-9]{64}$/);
  assert.equal(first.body.serverRevision, revisionOf(first.body.calpinageData.geometry_json));
  const current = database.rows.get(database.keyOf('study-a-v1', 'org'));
  current.geometry_json = Object.fromEntries(Object.entries(current.geometry_json).reverse());
  const reloaded = await load();
  assert.equal(reloaded.body.serverRevision, first.body.serverRevision);
  const changed = await save({ ...reloaded.body.calpinageData.geometry_json, view3DState: { zoom: 2 } }, { expectedRevision: first.body.serverRevision });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.body.serverRevision, first.body.serverRevision);
  assert.equal(changed.body.calpinageData.geometry_json.geometry_hash, first.body.calpinageData.geometry_json.geometry_hash, 'This edit is outside the old geometry hash');
  assert.deepEqual(changed.body.calpinageData.geometry_json.persistence, { revision: 7, session: 'test' });
  assert.equal((await load()).body.serverRevision, changed.body.serverRevision);
});

test('a different study document revision cannot overwrite the selected study', async () => {
  const studyA = await save({ persistence: { study: 'a' } });
  const studyB = await save({ persistence: { study: 'b' } }, {}, 'study-b');
  const wrongRevision = await save({ persistence: { study: 'wrong' } }, { expectedRevision: studyA.body.serverRevision }, 'study-b');
  assert.equal(wrongRevision.status, 409);
  assert.equal(wrongRevision.body.serverRevision, studyB.body.serverRevision);
  assert.deepEqual((await load('study-b')).body.calpinageData.geometry_json.persistence, { study: 'b' });
  assert.equal(database.writes, 2);
});

test('legacy clients without expectedRevision keep saving', async () => {
  assert.equal((await save({ persistence: { edit: 1 } })).status, 200);
  assert.equal((await save({ persistence: { edit: 2 } })).status, 200);
  assert.equal(database.writes, 2);
  assert.deepEqual((await load()).body.calpinageData.geometry_json.persistence, { edit: 2 });
});

test('GET revision identifies persisted JSON before legacy shading normalization', async () => {
  const saved = await save({ persistence: { revision: 1 } });
  const row = database.rows.get(database.keyOf('study-a-v1', 'org'));
  row.geometry_json.shading = { totalLossPct: 5, near: { totalLossPct: 5 } };
  const stored = structuredClone(row.geometry_json);
  const reloaded = await load();
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.serverRevision, revisionOf(stored));
  assert.notEqual(reloaded.body.serverRevision, saved.body.serverRevision);
  assert.notDeepEqual(reloaded.body.calpinageData.geometry_json.shading, stored.shading);
  assert.deepEqual(row.geometry_json, stored, 'GET must not rewrite persisted geometry');
});

test('a repeated unchanged save has the same server revision', async () => {
  const first = await save({ view3DState: { zoom: 1 }, persistence: { revision: 1 } });
  const second = await save(first.body.calpinageData.geometry_json, { expectedRevision: first.body.serverRevision });
  assert.equal(second.status, 200);
  assert.equal(second.body.serverRevision, first.body.serverRevision);
});

test('invalid revision types are rejected without writing, and flat legacy geometry keeps its persistence metadata', async () => {
  for (const expectedRevision of [42, {}, [], false]) {
    const invalid = await save({ persistence: { revision: 1 } }, { expectedRevision });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'CALPINAGE_INVALID_REVISION');
  }
  assert.equal(database.writes, 0);
  const t = request({ persistence: { revision: 1 }, expectedRevision: null });
  await upsertCalpinage(t.req, t.res);
  assert.equal(t.captured.status, 200);
  assert.deepEqual(t.captured.body.calpinageData.geometry_json.persistence, { revision: 1 });
  assert.equal(Object.hasOwn(t.captured.body.calpinageData.geometry_json, 'expectedRevision'), false);
});

test('the complete revision detects array order and sub-micro precision changes', () => {
  const geometry = { persistence: { revision: 1 }, values: [{ x: 1.00000001 }, { x: 2 }], empty: {} };
  const reorderedKeys = { empty: {}, values: [{ x: 1.00000001 }, { x: 2 }], persistence: { revision: 1 } };
  assert.equal(computeCalpinagePersistenceRevision(geometry), computeCalpinagePersistenceRevision(reorderedKeys));
  assert.notEqual(computeCalpinagePersistenceRevision(geometry), computeCalpinagePersistenceRevision({ ...geometry, values: [...geometry.values].reverse() }));
  assert.notEqual(computeCalpinagePersistenceRevision(geometry), computeCalpinagePersistenceRevision({ ...geometry, values: [{ x: 1.00000002 }, { x: 2 }] }));
  assert.equal(computeCalpinagePersistenceRevision(null), null);
  assert.notEqual(computeCalpinagePersistenceRevision({}), null);
});
