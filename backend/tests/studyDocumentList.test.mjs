import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let calculateFreshness;
mock.module(new URL('../config/db.js', import.meta.url).href, {
  namedExports: { pool: { query() { throw new Error('Test must supply its isolated reader'); } } },
});
mock.module(new URL('../services/studyCalculationFreshness.service.js', import.meta.url).href, {
  namedExports: { getStudyCalculationFreshness: (params) => calculateFreshness(params) },
});
const { getStudyPdfDocumentState, getStudyPdfDocumentStates } = await import('../services/shading/clientStudyDocumentGuard.service.js');
const document = (version) => ({
  entity_type: 'study_version', entity_id: version, document_type: 'study_pdf', created_at: '2025-01-01T12:00:00Z',
  metadata_json: { shading_export_receipt: { version: 'study-document-v2', input_fingerprint: `fp-${version}`, shadingIncluded: false, shadingApplied: false } },
});
const database = () => ({
  calls: [],
  async query(sql, params) {
    this.calls.push({ sql, params });
    if (sql.startsWith('SELECT v.study_id')) return { rows: [{ study_id: 'study', version_number: 1, current_version: 1 }] };
    if (sql.startsWith('SELECT entity_id')) return { rows: [{ entity_id: 'source', metadata_json: document('source').metadata_json }] };
    return { rows: [] };
  },
});

test('list classification retains single-document results, order, source receipts and archives', async () => {
  calculateFreshness = async ({ versionId }) => ({ needs_recompute: versionId === 'stale', current_input_fingerprint: `fp-${versionId}` });
  const docs = [document('current'), { document_type: 'invoice_pdf' }, document('stale'),
    { ...document('legacy'), metadata_json: {} },
    { ...document('mirror'), entity_type: 'lead', metadata_json: { source_study_version_document_id: 'source-document' } }];
  const original = structuredClone(docs);
  const expected = await Promise.all(docs.map(d => getStudyPdfDocumentState(d, 'org', database())));
  assert.deepEqual(await getStudyPdfDocumentStates(docs, 'org', database()), expected);
  assert.deepEqual(docs, original);
  assert.equal(expected[0].documentCurrent, true);
  assert.equal(expected[2].documentArchived, true);
  assert.equal(expected[3].documentVerification, 'historical_unverified');
  assert.ok(expected[3].documentWarning);
});

test('100 documents share version/reference reads and bound outstanding freshness checks', async () => {
  const db = database(); let calls = 0, active = 0, peak = 0;
  calculateFreshness = async ({ versionId, organizationId, db: reader }) => {
    calls++; peak = Math.max(peak, ++active);
    await reader.query('SELECT reference FROM local_reference WHERE organization_id=$1', [organizationId]);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { needs_recompute: false, current_input_fingerprint: `fp-${versionId}` };
  };
  const states = await getStudyPdfDocumentStates(Array.from({ length: 100 }, (_, i) => document(`version-${i % 10}`)), 'org', db);
  assert.equal(states.length, 100); assert.ok(states.every(s => s.documentCurrent));
  assert.equal(calls, 10); assert.ok(peak <= 2); assert.equal(active, 0);
  assert.equal(db.calls.filter(c => c.sql.startsWith('SELECT v.study_id')).length, 10);
  assert.equal(db.calls.filter(c => c.sql.startsWith('SELECT reference')).length, 1);
});

test('a subsequent response rechecks changed inputs and uses its own organization', async () => {
  let changed = false; const organizations = [];
  calculateFreshness = async ({ organizationId }) => {
    organizations.push(organizationId);
    return { needs_recompute: changed, current_input_fingerprint: 'fp-version' };
  };
  const db = database();
  assert.equal((await getStudyPdfDocumentStates([document('version')], 'org-a', db))[0].documentCurrent, true);
  changed = true;
  assert.equal((await getStudyPdfDocumentStates([document('version')], 'org-b', db))[0].documentArchived, true);
  assert.deepEqual(organizations, ['org-a', 'org-b']);
  assert.deepEqual(db.calls.map(c => c.params[1]), ['org-a', 'org-b']);
});

test('a failed read drains in-flight checks and stops scheduling remaining documents', async () => {
  let active = 0, calls = 0;
  calculateFreshness = async () => {
    calls++; active++;
    try { await new Promise(resolve => setTimeout(resolve, 2)); throw new Error('database unavailable'); }
    finally { active--; }
  };
  await assert.rejects(getStudyPdfDocumentStates(Array.from({ length: 100 }, (_, i) => document(`version-${i}`)), 'org', database()), /database unavailable/);
  assert.ok(calls <= 2); assert.equal(active, 0);
});

test('missing inputs retain historical delivery semantics; unexpected errors still fail', async () => {
  calculateFreshness = async () => { throw Object.assign(new Error('missing input'), { status: 404 }); };
  const [state] = await getStudyPdfDocumentStates([document('version')], 'org', database());
  assert.equal(state.documentVerification, 'archived_inputs_unavailable'); assert.equal(state.documentCurrent, false);
  calculateFreshness = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await assert.rejects(getStudyPdfDocumentStates([document('version')], 'org', database()), { status: 403 });
  assert.deepEqual(await getStudyPdfDocumentStates([], 'org', database()), []);
});
