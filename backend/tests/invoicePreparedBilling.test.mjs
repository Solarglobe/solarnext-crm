import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { withTx } from '../db/tx.js';
import { assertOrgEntity } from '../services/guards.service.js';
import { computeFinancialLineDbFields } from '../services/finance/financialLine.js';
import { isInvoiceEditable } from '../services/finance/financialImmutability.js';
import * as billingParty from '../services/finance/quoteBillingParty.js';
import * as invoiceBalance from '../services/finance/invoiceBalance.js';
import { normalizeInvoiceStatusInput } from '../utils/financialDocumentStatus.js';

// Production service bodies and SQL, with a fresh in-memory PostgreSQL engine.
// No production pool, environment loader, HTTP, PDF or external provider imports.
// Document rendering/snapshot adapters are deliberately synthetic boundaries.
const org = '10000000-0000-4000-8000-000000000001';
const customer = '20000000-0000-4000-8000-000000000001';
const quoteId = '30000000-0000-4000-8000-000000000001';
let db;
let statements;
let sequence;

function loadService(pool, overrides = {}) {
  const source = readFileSync(new URL('../services/invoices.service.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export\s+/gm, '');
  return vm.runInNewContext(`${source}
    getInvoiceDetail = async (id, organizationId) => {
      const row = (await pool.query('SELECT * FROM invoices WHERE id = $1 AND organization_id = $2', [id, organizationId])).rows[0];
      return row && { ...row, lines: (await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2', [id, organizationId])).rows };
    };
    ({ createInvoice, updateInvoice, patchInvoiceStatus, createInvoiceFromQuote,
       createPreparedStandardInvoiceFromQuote, recalculateInvoiceStatusFromAmounts, duplicateInvoice });`, {
    pool, withTx, assertOrgEntity, computeFinancialLineDbFields, isInvoiceEditable, isDeepStrictEqual,
    ...billingParty, ...invoiceBalance, normalizeInvoiceStatusInput, MONEY_EPSILON: 0.005,
    console: { info() {}, error() {} },
    readTrackedFields: async () => null, logMutationDiff: async () => {}, TRACKED_INVOICE_FIELDS: [],
    ensureClientForQuote: async (_client, quote) => quote.client_id,
    buildQuoteDepositFreeze: () => ({ deposit_display: null }),
    allocateNextDocumentNumber: async () => ({ fullNumber: `TEST-FACT-${++sequence}` }),
    buildInvoiceIssuerRecipientSnapshots: async () => ({ issuer_snapshot: {}, recipient_snapshot: {} }),
    buildSourceQuoteSnapshot: quote => ({ id: quote.id, total_ttc: quote.total_ttc }),
    computeSnapshotChecksum: snapshot => JSON.stringify(snapshot),
    persistInvoiceOfficialDocumentSnapshot: async (client, id, organizationId) => {
      await client.query(`UPDATE invoices SET document_snapshot_json = jsonb_build_object(
        'invoice_number', invoice_number, 'total_ttc', total_ttc) WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]);
    },
    ...overrides,
  }, { filename: 'invoices.service.js (isolated)' });
}

const query = async (sql, values = []) => {
  statements.push({ sql, values });
  return db.query(sql, values);
};
const pool = { query, connect: async () => ({ query, release() {} }) };
const service = loadService(pool);
const preparedLines = amount => [{ label: 'Preparation validee', quantity: 1, unit_price_ht: amount, vat_rate: 0 }];
const read = async id => (await db.query('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
const prepare = amount => service.createPreparedStandardInvoiceFromQuote(quoteId, org, { preparedLines: preparedLines(amount) });
const issue = id => service.patchInvoiceStatus(id, org, 'ISSUED');
const isBusinessError = code => error => error.code === code && error.statusCode === 409;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY, default_invoice_due_days int);
    CREATE TABLE clients (id uuid PRIMARY KEY, organization_id uuid, archived_at timestamptz);
    CREATE TABLE quotes (id uuid PRIMARY KEY, organization_id uuid, client_id uuid, lead_id uuid,
      status text, quote_number text, archived_at timestamptz, updated_at timestamptz,
      total_ht numeric DEFAULT 0, total_vat numeric DEFAULT 0, total_ttc numeric DEFAULT 0,
      total_installer_ht numeric, total_installer_vat numeric, total_installer_ttc numeric,
      billing_total_ht numeric, billing_total_vat numeric, billing_total_ttc numeric, billing_locked_at timestamptz,
      document_snapshot_json jsonb, metadata_json jsonb DEFAULT '{}', notes text, currency text DEFAULT 'EUR');
    CREATE TABLE quote_lines (id uuid DEFAULT gen_random_uuid(), organization_id uuid, quote_id uuid,
      total_line_ht numeric, total_line_vat numeric, total_line_ttc numeric, is_active boolean, billing_party text);
    CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      client_id uuid, lead_id uuid, quote_id uuid, invoice_number text, status text,
      total_ht numeric DEFAULT 0, total_vat numeric DEFAULT 0, total_ttc numeric DEFAULT 0,
      total_paid numeric DEFAULT 0, total_credited numeric DEFAULT 0, amount_due numeric DEFAULT 0,
      due_date date, issue_date date, notes text, payment_terms text, currency text DEFAULT 'EUR',
      metadata_json jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz,
      archived_at timestamptz, cancelled_at timestamptz, locked_at timestamptz, paid_at timestamptz,
      issuer_snapshot jsonb, recipient_snapshot jsonb, source_quote_snapshot jsonb,
      document_snapshot_json jsonb, snapshot_v1 jsonb, snapshot_hash text);
    CREATE TABLE invoice_lines (id uuid DEFAULT gen_random_uuid(), organization_id uuid, invoice_id uuid,
      description text, label text, quantity numeric, unit_price_ht numeric, discount_ht numeric, vat_rate numeric,
      total_line_ht numeric, total_line_vat numeric, total_line_ttc numeric, position int, snapshot_json jsonb);
    CREATE TABLE payments (id uuid DEFAULT gen_random_uuid(), invoice_id uuid, organization_id uuid,
      amount numeric, status text, cancelled_at timestamptz);
    CREATE TABLE credit_notes (id uuid DEFAULT gen_random_uuid(), invoice_id uuid, organization_id uuid,
      total_ttc numeric, status text, archived_at timestamptz);
    CREATE FUNCTION sg_recompute_invoice_total_paid(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
  `);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  statements = [];
  sequence = 0;
  await db.exec('TRUNCATE organizations, clients, quotes, quote_lines, invoices, invoice_lines, payments, credit_notes');
  await db.query('INSERT INTO organizations (id) VALUES ($1)', [org]);
  await db.query('INSERT INTO clients (id, organization_id) VALUES ($1, $2)', [customer, org]);
  await db.query(`INSERT INTO quotes (id, organization_id, client_id, status, quote_number, total_ht, total_vat, total_ttc)
    VALUES ($1, $2, $3, 'ACCEPTED', 'QUOTE-1', 1000, 0, 1000)`, [quoteId, org, customer]);
  await db.query(`INSERT INTO quote_lines (organization_id, quote_id, total_line_ht, total_line_vat, total_line_ttc)
    VALUES ($1, $2, 1000, 0, 1000)`, [org, quoteId]);
});

async function changeQuote(amount) {
  await db.query('UPDATE quotes SET total_ht = $1, total_ttc = $1 WHERE id = $2', [amount, quoteId]);
  await db.query('UPDATE quote_lines SET total_line_ht = $1, total_line_ttc = $1 WHERE quote_id = $2', [amount, quoteId]);
}

for (const [quoteTotal, prepared] of [[1000, 1200], [1200, 1000], [1000, 1000]]) {
  test(`quote ${quoteTotal}, prepared ${prepared}: unchanged preparation issues with its validated amount`, async () => {
    await changeQuote(quoteTotal);
    const invoice = await prepare(prepared);
    statements = [];
    const issued = await issue(invoice.id);
    assert.equal(issued.status, 'ISSUED');
    assert.equal(Number(issued.total_ttc), prepared);
    assert.equal(Number(issued.metadata_json.prepared_total_ttc_reference), prepared);
    assert.equal(sequence, 1);
    assert.equal(statements.some(({ sql }) => /UPDATE quotes\s+SET total_ht/.test(sql)), false,
      'issuing a prepared invoice must not recompute or rewrite quote totals');
  });
}

for (const changed of [600, 1600]) {
  test(`original quote changed to ${changed} after preparation: validated snapshot remains authoritative`, async () => {
    const invoice = await prepare(1000);
    await changeQuote(changed);
    assert.equal(Number((await issue(invoice.id)).total_ttc), 1000);
    assert.equal(Number((await db.query('SELECT billing_total_ttc FROM quotes')).rows[0].billing_total_ttc), 1000);
  });
}

test('prepared cap is strict to the cent, including other drafts, even when original quote is larger', async () => {
  await changeQuote(1200);
  const invoice = await prepare(1000);
  await db.query(`INSERT INTO invoices (organization_id, quote_id, status, total_ttc) VALUES ($1,$2,'DRAFT',0.01)`, [org, quoteId]);
  await assert.rejects(issue(invoice.id), isBusinessError('INVOICE_PREPARED_CAP_EXCEEDED'));
  assert.equal((await read(invoice.id)).status, 'DRAFT');
  assert.equal(sequence, 0);
});

test('changed frozen financial reference is an explicit preparation conflict, with no amount rewrite', async () => {
  const invoice = await prepare(1000);
  // Synthetic corrupt/legacy state: production's existing trigger normally forbids this change.
  await db.query('UPDATE quotes SET billing_total_ht = 1100, billing_total_ttc = 1100 WHERE id = $1', [quoteId]);
  await assert.rejects(issue(invoice.id), isBusinessError('INVOICE_PREPARATION_CHANGED'));
  assert.equal(Number((await read(invoice.id)).total_ttc), 1000);
  assert.equal(sequence, 0);
});

test('repeated issue never changes number or official snapshot and returns a stable business conflict', async () => {
  const invoice = await prepare(1000);
  const issued = await issue(invoice.id);
  await assert.rejects(issue(invoice.id), isBusinessError('INVOICE_STATUS_CONFLICT'));
  const current = await read(invoice.id);
  assert.equal(current.invoice_number, issued.invoice_number);
  assert.deepEqual(current.snapshot_v1, issued.snapshot_v1);
  assert.equal(sequence, 1);
});

test('prepared reference cannot be forged through metadata PATCH', async () => {
  const invoice = await prepare(1000);
  await assert.rejects(service.updateInvoice(invoice.id, org, { metadata_json: {
    ...invoice.metadata_json, prepared_total_ttc_reference: 1200,
  } }), isBusinessError('INVOICE_PREPARATION_CHANGED'));
  assert.equal((await read(invoice.id)).metadata_json.prepared_total_ttc_reference, 1000);
});

test('unrelated metadata PATCH preserves the backend preparation snapshot', async () => {
  const invoice = await prepare(1000);
  const updated = await service.updateInvoice(invoice.id, org, { metadata_json: { user_note: 'Note libre' } });
  assert.equal(updated.metadata_json.prepared_total_ttc_reference, 1000);
  assert.equal(updated.metadata_json.user_note, 'Note libre');
});

test('prepared invoice cannot detach from its quote', async () => {
  const invoice = await prepare(1000);
  await assert.rejects(service.updateInvoice(invoice.id, org, { quote_id: null }), isBusinessError('INVOICE_PREPARATION_CHANGED'));
  assert.equal((await read(invoice.id)).quote_id, quoteId);
});

test('changing a prepared amount requires re-preparation, even when below original quote', async () => {
  await changeQuote(1200);
  const invoice = await prepare(1000);
  await assert.rejects(service.updateInvoice(invoice.id, org, { lines: preparedLines(1100) }),
    isBusinessError('INVOICE_PREPARATION_CHANGED'));
  assert.equal(Number((await read(invoice.id)).total_ttc), 1000);
});

test('generic invoice creation cannot forge a backend preparation reference', async () => {
  await assert.rejects(service.createInvoice(org, { client_id: customer, quote_id: quoteId,
    lines: preparedLines(1000), metadata_json: { prepared_total_ttc_reference: 1000 } }),
  isBusinessError('INVOICE_PREPARATION_CHANGED'));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM invoices')).rows[0].n, 0);
});

test('deposit, interim deposit and final invoice share one validated base', async () => {
  const options = { billingRole: 'DEPOSIT', preparedTotalTtc: 1200, preparedTotalHt: 1200,
    preparedTotalVat: 0, billingAmountTtc: 300 };
  const first = await service.createInvoiceFromQuote(quoteId, org, options);
  await issue(first.id);
  const second = await service.createInvoiceFromQuote(quoteId, org, { ...options, billingAmountTtc: 200 });
  await issue(second.id);
  const final = await service.createInvoiceFromQuote(quoteId, org, { billingRole: 'BALANCE' });
  assert.equal(Number(final.total_ttc), 700);
  await issue(final.id);
  assert.equal(Number((await db.query('SELECT SUM(total_ttc) n FROM invoices')).rows[0].n), 1200);
});

for (const finalRole of ['DEPOSIT', 'BALANCE']) {
  test(`cent-exact final ${finalRole}: 100.08 + 899.94 fills validated base 1000.02`, async () => {
    const options = { billingRole: 'DEPOSIT', preparedTotalTtc: 1000.02, preparedTotalHt: 1000.02,
      preparedTotalVat: 0, billingAmountTtc: 100.08 };
    const deposit = await service.createInvoiceFromQuote(quoteId, org, options);
    await issue(deposit.id);
    const final = await service.createInvoiceFromQuote(quoteId, org,
      { ...options, billingRole: finalRole, billingAmountTtc: 899.94 });
    assert.equal(Number(final.total_ttc), 899.94);
    await issue(final.id);
    assert.equal(Number((await db.query('SELECT SUM(total_ttc) n FROM invoices')).rows[0].n), 1000.02);
  });
}

test('credit notes do not silently increase the gross prepared billing cap', async () => {
  const invoice = await prepare(1000);
  await issue(invoice.id);
  await db.query(`INSERT INTO credit_notes (invoice_id, organization_id, total_ttc, status)
    VALUES ($1,$2,200,'ISSUED')`, [invoice.id, org]);
  await db.query('UPDATE invoices SET total_credited = 200, amount_due = 800 WHERE id = $1', [invoice.id]);
  await assert.rejects(service.createInvoiceFromQuote(quoteId, org, { billingRole: 'BALANCE' }), /Rien à facturer/);
  assert.equal(Number((await read(invoice.id)).total_ttc), 1000);
});

test('UUID letter case cannot reverse the quote lock order during legacy reassignment', async () => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  for (const id of [a, b]) {
    await db.query(`INSERT INTO quotes (id, organization_id, client_id, status, total_ttc) VALUES ($1,$2,$3,'ACCEPTED',1000)`, [id, org, customer]);
    await db.query(`INSERT INTO quote_lines (organization_id, quote_id, total_line_ht, total_line_vat, total_line_ttc)
      VALUES ($1,$2,1000,0,1000)`, [org, id]);
  }
  const invoice = await service.createInvoice(org, { client_id: customer, quote_id: a, lines: preparedLines(1000) });
  statements = [];
  await service.updateInvoice(invoice.id, org, { quote_id: b.toUpperCase() });
  const quoteLocks = statements.filter(({ sql }) => /FROM quotes.*FOR UPDATE/.test(sql)).map(({ values }) => values[0]);
  assert.deepEqual(quoteLocks.slice(0, 2), [a, b]);
});

test('cancelled preparation can be replaced explicitly by a new validated preparation', async () => {
  const first = await prepare(1000);
  await service.patchInvoiceStatus(first.id, org, 'CANCELLED');
  const second = await prepare(1200);
  assert.equal(Number((await issue(second.id)).total_ttc), 1200);
  assert.equal(Number((await read(first.id)).total_ttc), 1000);
  assert.equal((await read(first.id)).status, 'CANCELLED');
});

test('duplicating a prepared invoice creates an independent draft without stale preparation references', async () => {
  const first = await prepare(1000);
  // Date serialization is outside B1: isolate the preparation metadata behavior.
  await db.query('UPDATE invoices SET due_date = NULL WHERE id = $1', [first.id]);
  const duplicate = await service.duplicateInvoice(first.id, org);
  assert.equal(duplicate.quote_id, null);
  assert.equal(duplicate.metadata_json.prepared_total_ttc_reference, undefined);
  assert.equal(duplicate.metadata_json.quote_billing, undefined);
  assert.equal(duplicate.metadata_json.duplicated_from_invoice_id, first.id);
  assert.equal(Number(duplicate.total_ttc), 1000);
  assert.equal((await issue(duplicate.id)).status, 'ISSUED');
});

test('same prepared amounts may retain their references while editing a description', async () => {
  const first = await prepare(1000);
  const edited = await service.updateInvoice(first.id, org, { lines: [{ ...preparedLines(1000)[0], label: 'Description corrigee' }] });
  assert.equal(Number(edited.total_ttc), 1000);
  assert.equal(edited.metadata_json.prepared_total_ttc_reference, 1000);
  assert.equal((await issue(first.id)).status, 'ISSUED');
});

test('invoice balance compatibility wrapper refreshes in the provided transaction, including valid credits/payments', async () => {
  const invoice = await prepare(1000);
  await issue(invoice.id);
  await db.query(`INSERT INTO payments (organization_id, invoice_id, amount, status) VALUES ($1,$2,300,'RECORDED'),($1,$2,20,'CANCELLED')`, [org, invoice.id]);
  await db.query(`INSERT INTO credit_notes (organization_id, invoice_id, total_ttc, status) VALUES ($1,$2,200,'ISSUED'),($1,$2,20,'DRAFT')`, [org, invoice.id]);
  statements = [];
  const balanced = await withTx(pool, client => service.recalculateInvoiceStatusFromAmounts(invoice.id, org, client));
  assert.equal(balanced.amount_due, 500);
  assert.equal(balanced.total_paid, 300);
  assert.equal(balanced.total_credited, 200);
  assert.equal(balanced.status, 'PARTIALLY_PAID');
  assert.equal(statements.filter(({ sql }) => sql === 'BEGIN').length, 1);
  assert.equal((await service.recalculateInvoiceStatusFromAmounts(invoice.id, org)).amount_due, 500);
});

test('controller exposes preparation conflicts as HTTP 409 with a stable code', async () => {
  const first = await prepare(1000);
  await db.query('UPDATE quotes SET billing_total_ttc = 1200 WHERE id = $1', [quoteId]);
  const controllerSource = readFileSync(new URL('../controllers/invoices.controller.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
    .replace(/^export\s+/gm, '');
  const controller = vm.runInNewContext(`${controllerSource}\n({ patchStatus });`, { invoiceService: service });
  const response = { status: null, body: null };
  const res = { status(code) { response.status = code; return this; }, json(body) { response.body = body; } };
  await controller.patchStatus({ user: { organizationId: org }, params: { id: first.id }, body: { status: 'ISSUED' } }, res);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'INVOICE_PREPARATION_CHANGED');
  assert.match(response.body.error, /nouvelle préparation/);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('concurrent issue: simulated SQL locks allow one issue and one conflict, never renumbering', async () => {
  // Two-client transport simulation (not two real PostgreSQL connections).
  // The preceding tests execute the actual SQL on PGlite. This test controls
  // the interleaving at the real service's invoice/sequence lock boundaries.
  let committed = { id: 'invoice-1', organization_id: org, quote_id: null, client_id: customer,
    status: 'DRAFT', total_ttc: 1000, total_paid: 0, total_credited: 0, metadata_json: {}, archived_at: null };
  const locks = new Map();
  const states = new Map();
  const blocked = deferred();
  const snapshotEntered = deferred();
  const continueSnapshot = deferred();
  let clientId = 0;
  let numbers = 0;
  let snapshotCalls = 0;
  async function acquire(id, key) {
    if (!locks.has(key)) locks.set(key, { owner: id, queue: [] });
    else if (locks.get(key).owner !== id) {
      const gate = deferred();
      locks.get(key).queue.push({ id, gate });
      blocked.resolve();
      await gate.promise;
    }
  }
  function release(id) {
    for (const [key, lock] of locks) {
      if (lock.owner !== id) continue;
      const next = lock.queue.shift();
      if (next) { lock.owner = next.id; next.gate.resolve(); }
      else locks.delete(key);
    }
  }
  const concurrentPool = {
    query: async () => ({ rows: [structuredClone(committed)] }),
    connect: async () => {
      const id = ++clientId;
      const state = { changed: null };
      states.set(id, state);
      return { id, release() {}, async query(raw, values = []) {
        const sql = raw.replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN') return { rows: [] };
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (sql === 'COMMIT' && state.changed) committed = structuredClone(state.changed);
          release(id);
          return { rows: [] };
        }
        if (/FROM invoices\b/.test(sql) && /^SELECT/.test(sql)) {
          if (/FOR UPDATE/.test(sql)) await acquire(id, 'invoice');
          return { rows: [structuredClone(state.changed ?? committed)] };
        }
        if (/COUNT\(\*\).*FROM invoice_lines/.test(sql)) return { rows: [{ n: 1 }] };
        if (/^UPDATE invoices SET status\s*=\s*'ISSUED'/.test(sql)) {
          await acquire(id, 'invoice');
          state.changed = { ...committed, invoice_number: values[0], status: 'ISSUED' };
          return { rows: [structuredClone(state.changed)], rowCount: 1 };
        }
        if (/^SELECT sg_recompute_invoice_total_paid/.test(sql)) return { rows: [] };
        throw new Error(`Unsupported concurrent transport SQL: ${sql}`);
      } };
    },
  };
  const concurrent = loadService(concurrentPool, {
    allocateNextDocumentNumber: async client => {
      await acquire(client.id, 'sequence');
      return { fullNumber: `TEST-FACT-${++numbers}` };
    },
    buildInvoiceIssuerRecipientSnapshots: async () => {
      if (++snapshotCalls === 1) { snapshotEntered.resolve(); await continueSnapshot.promise; }
      return { issuer_snapshot: {}, recipient_snapshot: {} };
    },
    persistInvoiceOfficialDocumentSnapshot: async () => {},
  });
  const first = concurrent.patchInvoiceStatus('invoice-1', org, 'ISSUED');
  await snapshotEntered.promise;
  const second = concurrent.patchInvoiceStatus('invoice-1', org, 'ISSUED');
  // Attach the rejection handler immediately, before opening the first commit.
  const outcomes = Promise.allSettled([first, second]);
  await blocked.promise;
  continueSnapshot.resolve();
  const results = await outcomes;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected?.reason.code, 'INVOICE_STATUS_CONFLICT');
  assert.equal(numbers, 1);
  assert.equal(committed.invoice_number, 'TEST-FACT-1');
});
