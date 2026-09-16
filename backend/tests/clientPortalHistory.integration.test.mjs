import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { getClientPortalHistory } from '../services/clientPortalHistory.service.js';

test('portal history: actual PostgreSQL pagination, selected scenario and tenant isolation', async () => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const makeDossier = async () => {
      const org = (await db.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`portal-history-${randomUUID()}`])).rows[0].id;
      const stage = (await db.query("INSERT INTO pipeline_stages(organization_id,name,position,is_closed) VALUES($1,'Fixture',0,false) RETURNING id", [org])).rows[0].id;
      const lead = (await db.query("INSERT INTO leads(organization_id,stage_id,full_name) VALUES($1,$2,'Fictional portal client') RETURNING id", [org, stage])).rows[0].id;
      const study = (await db.query("INSERT INTO studies(organization_id,lead_id,study_number,status,current_version) VALUES($1,$2,$3,'draft',1) RETURNING id", [org, lead, `PORTAL-${randomUUID()}`])).rows[0].id;
      const history = Array.from({ length: 21 }, (_, index) => ({
        computed_at: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        input_snapshot: { private_fixture: 'never publish' },
        scenarios: [
          { id: 'BASE', finance: { economie_year_1: -index, finance_meta: { horizon_years: 25 } } },
          { id: 'BATTERY_VIRTUAL', finance: { economie_year_1: 999999 } },
        ],
      }));
      const version = (await db.query("INSERT INTO study_versions(organization_id,study_id,version_number,data_json) VALUES($1,$2,1,$3) RETURNING id", [org, study, { calculation_history: history, portal_offer: { scenario_id: 'BASE' } }])).rows[0].id;
      return { org, lead, version };
    };
    const first = await makeDossier();
    const second = await makeDossier();
    const args = { organizationId: first.org, leadId: first.lead };
    const page1 = await getClientPortalHistory(db, args);
    const page2 = await getClientPortalHistory(db, { ...args, offset: page1.next_offset });
    const page3 = await getClientPortalHistory(db, { ...args, offset: page2.next_offset });
    assert.deepEqual([page1.items.length, page2.items.length, page3.items.length], [10, 10, 1]);
    assert.equal(page3.next_offset, null);
    const items = [...page1.items, ...page2.items, ...page3.items];
    assert.equal(new Set(items.map(item => item.id)).size, 21);
    assert.deepEqual(items.map(item => item.annual_savings_eur), Array.from({ length: 21 }, (_, i) => i - 20));
    assert.ok(items.every(item => item.id.startsWith(first.version) && item.export_blocked && item.scenario_label === 'BASE'));
    assert.equal(JSON.stringify(items).includes('private_fixture'), false);
    assert.deepEqual((await getClientPortalHistory(db, { organizationId: second.org, leadId: first.lead })).items, []);
    assert.deepEqual((await getClientPortalHistory(db, { organizationId: first.org, leadId: second.lead })).items, []);
    await db.query('UPDATE leads SET archived_at=now() WHERE id=$1', [first.lead]);
    assert.deepEqual((await getClientPortalHistory(db, args)).items, []);
    await db.query('UPDATE leads SET archived_at=NULL WHERE id=$1', [first.lead]);
    await db.query("UPDATE study_versions SET data_json=data_json - 'portal_offer' WHERE id=$1", [first.version]);
    assert.deepEqual((await getClientPortalHistory(db, args)).items, [], 'Unshared study results must not be exposed');
    await db.query("UPDATE study_versions SET data_json=jsonb_set(data_json,'{calculation_history}','null') WHERE id=$1", [first.version]);
    assert.deepEqual((await getClientPortalHistory(db, args)).items, [], 'Legacy null history is readable');
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
