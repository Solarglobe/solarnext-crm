import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { up, down } from '../migrations/1790400200000_monthly_consumption_meter_scope.js';

test('monthly meter migration backfills without altering kWh, isolates meters and owners, and reruns safely', async () => {
  const db = await pool.connect();
  const schema = `v21_monthly_${randomUUID().replaceAll('-', '')}`;
  const statements = [];
  up({ sql: statement => statements.push(statement) });
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}", public`);
    // Exact real columns, isolated tables; no production or existing fixture row is changed.
    await db.query('CREATE TABLE leads (LIKE public.leads INCLUDING DEFAULTS)');
    await db.query('CREATE TABLE lead_meters (LIKE public.lead_meters INCLUDING DEFAULTS)');
    await db.query(`CREATE TABLE lead_consumption_monthly (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
      lead_id uuid NOT NULL, year integer NOT NULL, month integer NOT NULL, kwh integer NOT NULL,
      CONSTRAINT lcm_lead_year_month_unique UNIQUE(lead_id, year, month)
    )`);
    const org = randomUUID(), otherOrg = randomUUID(), lead = randomUUID(), otherLead = randomUUID();
    await db.query(`INSERT INTO leads(id,organization_id,full_name,stage_id,source_id,hp_hc,
      consumption_mode,consumption_annual_kwh,electricity_annual_bill_ttc)
      VALUES($1,$2,'Synthetic monthly migration', $3, $4,true,'MONTHLY',1200,500)`,
    [lead,org,randomUUID(),randomUUID()]);
    await db.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,year,month,kwh) VALUES($1,$2,2026,1,123)',[org,lead]);
    for (const statement of statements) await db.query(statement);
    const principal=(await db.query('SELECT * FROM lead_meters WHERE lead_id=$1',[lead])).rows[0];
    assert.equal(principal.is_default,true);
    assert.equal(Number(principal.electricity_annual_bill_ttc),500);
    assert.equal(principal.hp_hc,true);
    const monthly=(await db.query('SELECT * FROM lead_consumption_monthly')).rows[0];
    assert.equal(monthly.meter_id,principal.id);
    assert.equal(monthly.kwh,123);

    const second=(await db.query(`INSERT INTO lead_meters(organization_id,lead_id,name,is_default)
      VALUES($1,$2,'Synthetic second meter',false) RETURNING id`,[org,lead])).rows[0].id;
    await db.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,meter_id,year,month,kwh) VALUES($1,$2,$3,2026,1,456)',[org,lead,second]);
    assert.equal(Number((await db.query('SELECT SUM(kwh) total FROM lead_consumption_monthly')).rows[0].total),579);
    for(const params of [[otherOrg,lead,second,2],[org,otherLead,second,3]]) {
      await db.query('SAVEPOINT invalid_owner');
      await assert.rejects(db.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,meter_id,year,month,kwh) VALUES($1,$2,$3,2026,$4,1)',params),{code:'23503'});
      await db.query('ROLLBACK TO SAVEPOINT invalid_owner');
    }
    await db.query('SAVEPOINT duplicate_month');
    await assert.rejects(db.query('INSERT INTO lead_consumption_monthly(organization_id,lead_id,meter_id,year,month,kwh) VALUES($1,$2,$3,2026,1,1)',[org,lead,second]),{code:'23505'});
    await db.query('ROLLBACK TO SAVEPOINT duplicate_month');
    for(const statement of statements) await db.query(statement);
    assert.equal(Number((await db.query('SELECT count(*) count FROM lead_meters')).rows[0].count),2);
    const rollback=[];down({sql:statement=>rollback.push(statement)});
    for(const statement of rollback) await db.query(statement);
    assert.equal(Number((await db.query('SELECT SUM(kwh) total FROM lead_consumption_monthly')).rows[0].total),579);
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
