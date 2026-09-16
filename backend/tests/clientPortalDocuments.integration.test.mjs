import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { findExistingLeadCommercialProposalForStudyScenario } from '../services/documents.service.js';

test('a recalculated PDF cannot reuse the stale lead copy of an earlier source document', async () => {
  const db = await pool.connect();
  const originalQuery = pool.query;
  try {
    await db.query('BEGIN');
    const org = (await db.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`portal-doc-${randomUUID()}`])).rows[0].id;
    const lead = randomUUID(), study = randomUUID(), version = randomUUID();
    const oldSource = randomUUID(), newSource = randomUUID();
    const oldMetadata = { study_id: study, study_version_id: version, scenario_key: 'BASE', source_study_version_document_id: oldSource };
    const old = (await db.query("INSERT INTO entity_documents(organization_id,entity_type,entity_id,file_name,file_size,mime_type,storage_key,url,document_type,metadata_json) VALUES($1,'lead',$2,'fixture.pdf',1,'application/pdf','fixture-no-file','local','study_pdf',$3) RETURNING id", [org, lead, oldMetadata])).rows[0].id;
    pool.query = db.query.bind(db);
    assert.equal((await findExistingLeadCommercialProposalForStudyScenario(org, lead, study, version, 'BASE', oldSource)).id, old);
    assert.equal(await findExistingLeadCommercialProposalForStudyScenario(org, lead, study, version, 'BASE', newSource), null);
    assert.equal(await findExistingLeadCommercialProposalForStudyScenario(randomUUID(), lead, study, version, 'BASE', oldSource), null);
    assert.deepEqual((await db.query('SELECT metadata_json FROM entity_documents WHERE id=$1', [old])).rows[0].metadata_json, oldMetadata);
  } finally {
    pool.query = originalQuery;
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
