import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import * as balance from '../services/finance/invoiceBalance.js';
import * as money from '../services/finance/moneyRounding.js';
import * as lines from '../services/finance/financialLine.js';
import * as credits from '../services/finance/creditNoteComputation.js';
import { withTx } from '../db/tx.js';

// Actual service bodies and migration triggers on ephemeral PostgreSQL (PGlite).
// No db.js, dotenv, application, network, PDF renderer or production data loaded.
function load(relative, dependencies, names) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { ...dependencies, console });
}

const invoiceId = '00000000-0000-0000-0000-000000000001';
const org = 'synthetic-org';
let db, service, creditService;
let queries = [];
let failOn = null;
let failSnapshot = false;
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE invoices (id uuid PRIMARY KEY, organization_id text, client_id text,
      status text, total_ttc numeric(14,2), total_paid numeric(14,2) DEFAULT 0,
      total_credited numeric(14,2) DEFAULT 0, amount_due numeric(14,2), currency text,
      archived_at timestamptz, paid_at timestamptz, updated_at timestamptz);
    CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id text, invoice_id uuid REFERENCES invoices(id), amount numeric(14,2) CHECK(amount>0),
      payment_date date, payment_method text, reference text, notes text, status text,
      created_at timestamptz, updated_at timestamptz, cancelled_at timestamptz, cancelled_by text);
    CREATE TABLE credit_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id text, client_id text, invoice_id uuid REFERENCES invoices(id),
      credit_note_number text, status text, currency text,
      total_ht numeric(14,2), total_vat numeric(14,2), total_ttc numeric(14,2),
      reason_code text, reason_text text, issuer_snapshot jsonb, recipient_snapshot jsonb,
      source_invoice_snapshot jsonb, metadata_json jsonb, issue_date date,
      archived_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz);
    CREATE TABLE credit_note_lines (organization_id text, credit_note_id uuid,
      description text, label text, quantity numeric, unit_price_ht numeric, discount_ht numeric,
      vat_rate numeric, total_line_ht numeric, total_line_vat numeric, total_line_ttc numeric,
      position integer, snapshot_json jsonb);
  `);
  for (const path of ['1771077957498_cp-026-integrity-triggers-and-indexes.js','1771180000000_cp-financial-pole-schema.js']) {
    const source = readFileSync(new URL(`../migrations/${path}`, import.meta.url), 'utf8').split('export const down')[0];
    for (const [,sql] of source.matchAll(/pgm\.sql\(`([\s\S]*?)`\);/g)) {
      if (/CREATE OR REPLACE FUNCTION sg_(recompute_invoice_total_paid|payments_sync_total_paid|credit_notes_sync_invoice_totals)\(/.test(sql)
        || /CREATE TRIGGER (payments_sync_total_paid|credit_notes_sync_invoice_totals)/.test(sql)) await db.exec(sql);
    }
  }
  const query = async (sql, values) => {
    queries.push(sql);
    if (failOn?.test(sql)) throw new Error('Synthetic persistence failure');
    return db.query(sql, values);
  };
  const client = { query, release() {} };
  const pool = { query, async connect() { return client; } };
  const deps = { pool, withTx, ...balance, ...money, ...lines, ...credits };
  service = load('../services/payments.service.js', deps, ['recordPayment','cancelPayment','listPaymentsForInvoice']);
  creditService = load('../services/creditNotes.service.js', {
    ...deps,
    allocateNextDocumentNumber: async () => ({ fullNumber: 'SYNTHETIC-CREDIT-1' }),
    buildInvoiceIssuerRecipientSnapshots: async () => ({ issuer_snapshot:{},recipient_snapshot:{} }),
    buildSourceInvoiceSnapshot: () => ({}),
    persistCreditNoteOfficialDocumentSnapshot: async () => {
      if (failSnapshot) throw new Error('Synthetic snapshot failure');
    },
  }, ['createDraftCreditNote','issueCreditNote']);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  failOn = null;
  failSnapshot = false;
  await db.exec('TRUNCATE credit_note_lines, credit_notes, payments, invoices CASCADE');
  await db.query(`INSERT INTO invoices(id,organization_id,client_id,status,total_ttc,amount_due,currency)
    VALUES($1,$2,'synthetic-client','ISSUED',1000,1000,'EUR')`,[invoiceId,org]);
  queries = [];
});
const pay = amount => service.recordPayment(org,invoiceId,{ amount,payment_date:'2026-09-24' });
async function invoice() { return (await db.query('SELECT * FROM invoices WHERE id=$1',[invoiceId])).rows[0]; }
async function credit(amount, status='ISSUED', archived=false) {
  const row = (await db.query(`INSERT INTO credit_notes(organization_id,invoice_id,status,total_ttc,archived_at)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[org,invoiceId,status,amount,archived?'2026-09-01':null])).rows[0];
  return row;
}
async function assertBalance(expected) {
  const row = await invoice();
  assert.deepEqual(balance.computeInvoiceBalance(row),{total_ttc:1000,...expected});
  assert.equal(row.status,balance.suggestInvoiceStatusFromAmounts(row));
  return row;
}

test('B2: credit 400 on invoice 1000 rejects payment 800, leaving no payment', async () => {
  await credit(400);
  await assert.rejects(pay(800), /dépasse|reste|solde/i);
  assert.equal((await db.query('SELECT * FROM payments')).rows.length,0);
  assert.equal(Number((await invoice()).amount_due),600);
});
test('B2: no credit accepts 1000 and invoice is paid', async () => {
  await pay(1000);
  const row=await assertBalance({total_paid:1000,total_credited:0,amount_due:0});
  assert.equal(row.status,'PAID');
  assert.ok(row.paid_at);
});
test('B2: credit 400 accepts exactly 600; full retry cannot create a second payment', async () => {
  await credit(400);
  await pay(600);
  await assert.rejects(pay(600));
  assert.equal((await db.query('SELECT * FROM payments')).rows.length,1);
  await assertBalance({total_paid:600,total_credited:400,amount_due:0});
});
test('B2: successive partial payments use the remaining net balance', async () => {
  await credit(400);
  await pay(200);
  await assertBalance({total_paid:200,total_credited:400,amount_due:400});
  await assert.rejects(pay(401));
  await pay(400);
  await assertBalance({total_paid:600,total_credited:400,amount_due:0});
});
test('B2: only issued and non-archived credits reduce payable', async () => {
  await credit(400,'DRAFT');
  await credit(400,'CANCELLED');
  await credit(400,'ISSUED',true);
  await pay(1000);
  await assertBalance({total_paid:1000,total_credited:0,amount_due:0});
});
test('B2: 100% credit rejects every positive payment even with stale invoice status', async () => {
  await credit(1000);
  await assert.rejects(pay(0.01));
  assert.equal((await db.query('SELECT * FROM payments')).rows.length,0);
});
for (const amount of [0,-1,0.004,'bad',Infinity]) test(`B2: invalid or rounded-zero amount ${amount} rejected before INSERT`,async()=>{
  await assert.rejects(pay(amount));
  assert.equal(queries.some(sql=>/INSERT INTO payments/.test(sql)),false);
});
test('B2: cents after credit respect the rounded remaining amount',async()=>{
  await credit(999.97);
  await pay(0.01);
  await assert.rejects(pay(0.03));
  await pay(0.02);
  await assertBalance({total_paid:0.03,total_credited:999.97,amount_due:0});
});
test('B2: floating point 0.1 + 0.2 records exactly 30 cents',async()=>{
  await credit(999.70);
  const row=await pay(0.1+0.2);
  assert.equal(Number(row.amount),0.30);
  await assertBalance({total_paid:0.30,total_credited:999.70,amount_due:0});
});
test('B2: cancellation updates totals/status/paid_at and permits a new net payment',async()=>{
  await credit(400);
  const paid=await pay(600);
  await service.cancelPayment(org,paid.id,'synthetic-user');
  const row=await assertBalance({total_paid:0,total_credited:400,amount_due:600});
  assert.equal(row.status,'PARTIALLY_PAID');
  assert.equal(row.paid_at,null);
  await assert.rejects(service.cancelPayment(org,paid.id));
  await pay(600);
  await assertBalance({total_paid:600,total_credited:400,amount_due:0});
});
test('B2: failed status persistence rolls back the payment and trigger totals',async()=>{
  failOn=/UPDATE invoices SET/;
  await assert.rejects(pay(1000),/Synthetic persistence failure/);
  assert.equal((await db.query('SELECT * FROM payments')).rows.length,0);
  assert.equal(Number((await invoice()).total_paid),0);
});
test('B2: failed status persistence rolls back cancellation and preserves paid invoice',async()=>{
  const row=await pay(1000);
  failOn=/UPDATE invoices SET/;
  await assert.rejects(service.cancelPayment(org,row.id),/Synthetic persistence failure/);
  assert.equal((await db.query('SELECT status FROM payments WHERE id=$1',[row.id])).rows[0].status,'RECORDED');
  await assertBalance({total_paid:1000,total_credited:0,amount_due:0});
});
test('B2: failed status persistence rolls back credit issuance and trigger totals',async()=>{
  const draft=await creditService.createDraftCreditNote(org,invoiceId,{lines:[{quantity:1,unit_price_ht:400,vat_rate:0}]});
  failOn=/UPDATE invoices SET/;
  await assert.rejects(creditService.issueCreditNote(org,draft.id),/Synthetic persistence failure/);
  assert.equal((await db.query('SELECT status FROM credit_notes WHERE id=$1',[draft.id])).rows[0].status,'DRAFT');
  await assertBalance({total_paid:0,total_credited:0,amount_due:1000});
});
test('B2: failed credit snapshot rolls back issued credit and invoice status together',async()=>{
  const draft=await creditService.createDraftCreditNote(org,invoiceId,{lines:[{quantity:1,unit_price_ht:1000,vat_rate:0}]});
  failSnapshot=true;
  await assert.rejects(creditService.issueCreditNote(org,draft.id),/Synthetic snapshot failure/);
  assert.equal((await db.query('SELECT status FROM credit_notes WHERE id=$1',[draft.id])).rows[0].status,'DRAFT');
  await assertBalance({total_paid:0,total_credited:0,amount_due:1000});
});
test('B2: credit issued after partial payment keeps gross/credited/paid/due coherent',async()=>{
  await pay(200);
  const draft=await creditService.createDraftCreditNote(org,invoiceId,{lines:[{quantity:1,unit_price_ht:400,vat_rate:0}]});
  assert.equal(draft.status,'DRAFT');
  await creditService.issueCreditNote(org,draft.id);
  await assertBalance({total_paid:200,total_credited:400,amount_due:400});
  await assert.rejects(pay(401));
  await pay(400);
  await assertBalance({total_paid:600,total_credited:400,amount_due:0});
});
test('B2: credit on already paid invoice preserves the existing accounting rule',async()=>{
  await pay(1000);
  const draft=await creditService.createDraftCreditNote(org,invoiceId,{lines:[{quantity:1,unit_price_ht:400,vat_rate:0}]});
  await creditService.issueCreditNote(org,draft.id);
  await assertBalance({total_paid:1000,total_credited:400,amount_due:0});
  await assert.rejects(pay(1));
});
test('B2: payment and cancellation remain organization-scoped',async()=>{
  await assert.rejects(service.recordPayment('other-org',invoiceId,{amount:1,payment_date:'2026-09-24'}),e=>e.statusCode===404);
  const row=await pay(100);
  await assert.rejects(service.cancelPayment('other-org',row.id),e=>e.statusCode===404);
  await assertBalance({total_paid:100,total_credited:0,amount_due:900});
});
test('B2: mutation, invoice aggregate refresh and status occur on one transaction client',async()=>{
  await pay(1000);
  const begin=queries.indexOf('BEGIN');
  const lock=queries.findIndex(sql=>/FROM invoices.*FOR UPDATE/.test(sql));
  const aggregate=queries.findIndex(sql=>/recorded_payments_total/.test(sql));
  const insert=queries.findIndex(sql=>/INSERT INTO payments/.test(sql));
  const refresh=queries.findIndex(sql=>/UPDATE invoices SET/.test(sql));
  const commit=queries.indexOf('COMMIT');
  assert.ok(begin<lock&&lock<aggregate&&aggregate<insert&&insert<refresh&&refresh<commit);
});
