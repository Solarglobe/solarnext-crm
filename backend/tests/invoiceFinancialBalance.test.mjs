import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import * as financialBalance from "../services/finance/invoiceBalance.js";

const scope={invoiceId:"invoice-a",organizationId:"org-a"};
async function fixture(t) {
  const db=new PGlite();
  await db.exec(`
    CREATE TABLE invoices(id text PRIMARY KEY, organization_id text, status varchar(50),
      total_ttc numeric, total_paid numeric DEFAULT 999, total_credited numeric DEFAULT 999,
      amount_due numeric DEFAULT 999, archived_at timestamptz, paid_at timestamptz, updated_at timestamptz);
    CREATE TABLE payments(id text PRIMARY KEY,organization_id text,invoice_id text,amount numeric,status text);
    CREATE TABLE credit_notes(id text PRIMARY KEY,organization_id text,invoice_id text,total_ttc numeric,status text,archived_at timestamptz);
    INSERT INTO invoices(id,organization_id,status,total_ttc) VALUES('invoice-a','org-a','ISSUED',1000);
  `);
  await db.exec("BEGIN");
  t.after(()=>db.close());
  const queries=[];
  const client={async query(sql,values){queries.push(sql);return db.query(sql,values);}};
  return {db,client,queries};
}

test("financial balance reads live, tenant-scoped payments and issued unarchived credits",async t=>{
  const f=await fixture(t);
  await f.db.exec(`
    INSERT INTO payments VALUES ('p1','org-a','invoice-a',100,'RECORDED'),('p2','org-a','invoice-a',50,NULL),
      ('p3','org-a','invoice-a',900,'CANCELLED'),('p4','org-b','invoice-a',800,'RECORDED');
    INSERT INTO credit_notes VALUES ('c1','org-a','invoice-a',400,'ISSUED',NULL),('c2','org-a','invoice-a',700,'DRAFT',NULL),
      ('c3','org-a','invoice-a',800,'ISSUED',now()),('c4','org-b','invoice-a',900,'ISSUED',NULL);
  `);
  const row=await financialBalance.readInvoiceFinancialBalance(f.client,scope);
  assert.equal(row.id,scope.invoiceId);
  assert.equal(row.status,"ISSUED");
  assert.equal(row.total_ttc,1000);
  assert.equal(row.total_paid,150);
  assert.equal(row.total_credited,400);
  assert.equal(row.amount_due,450);
  assert.ok(!f.queries.some(sql=>/FOR UPDATE|UPDATE invoices/.test(sql)),"read helper never mutates or implicitly locks");
  assert.equal(Number((await f.db.query("SELECT amount_due FROM invoices")).rows[0].amount_due),999);
});

test("financial refresh locks before live aggregates and atomically stores balance and status",async t=>{
  const f=await fixture(t);
  await f.db.exec("INSERT INTO payments VALUES('p1','org-a','invoice-a',250,'RECORDED')");
  const row=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(row.total_paid,250);
  assert.equal(row.total_credited,0);
  assert.equal(row.amount_due,750);
  assert.equal(row.status,"PARTIALLY_PAID");
  assert.match(f.queries[0],/FOR UPDATE/);
  assert.doesNotMatch(f.queries[0],/SUM\(/i,"do not aggregate on the row-lock statement's stale snapshot");
  assert.match(f.queries[1],/SUM\(/i);
  const stored=(await f.db.query("SELECT * FROM invoices")).rows[0];
  assert.equal(Number(stored.amount_due),750);
  assert.equal(stored.status,"PARTIALLY_PAID");
  assert.ok(stored.updated_at);
  await f.db.exec("ROLLBACK");
  assert.equal((await f.db.query("SELECT status FROM invoices")).rows[0].status,"ISSUED");
});

test("financial refresh includes movements committed by another logical transaction while waiting for its lock",async t=>{
  const f=await fixture(t);
  let releaseOther, enteredLock;
  const otherHasLock=new Promise(resolve=>{releaseOther=resolve;});
  const attemptedLock=new Promise(resolve=>{enteredLock=resolve;});
  const waitingClient={async query(sql,values){
    if(/FOR UPDATE/.test(sql)) {enteredLock();await otherHasLock;}
    return f.client.query(sql,values);
  }};
  const pending=financialBalance.refreshInvoiceFinancialBalance(waitingClient,scope);
  await attemptedLock;
  await f.db.exec("INSERT INTO payments VALUES('p1','org-a','invoice-a',600,'RECORDED'); INSERT INTO credit_notes VALUES('c1','org-a','invoice-a',400,'ISSUED',NULL)");
  releaseOther();
  const row=await pending;
  assert.equal(row.total_paid,600);
  assert.equal(row.total_credited,400);
  assert.equal(row.amount_due,0);
  assert.equal(row.status,"PAID");
});

test("financial refresh handles total credits, cancelled payments and reopening paid status",async t=>{
  const f=await fixture(t);
  await f.db.exec("INSERT INTO payments VALUES('p1','org-a','invoice-a',600,'RECORDED'); INSERT INTO credit_notes VALUES('c1','org-a','invoice-a',400,'ISSUED',NULL)");
  const paid=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(paid.status,"PAID");
  assert.ok(paid.paid_at);
  await f.db.exec("UPDATE payments SET status='CANCELLED' WHERE id='p1'");
  const reopened=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(reopened.total_paid,0);
  assert.equal(reopened.amount_due,600);
  assert.equal(reopened.status,"PARTIALLY_PAID");
  assert.equal(reopened.paid_at,null);
  await f.db.exec("UPDATE credit_notes SET total_ttc=1000 WHERE id='c1'");
  const credited=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(credited.total_paid,0);
  assert.equal(credited.amount_due,0);
  assert.equal(credited.status,"PAID");
});

for(const status of ["DRAFT","CANCELLED"]) test(`financial refresh preserves ${status} lifecycle status`,async t=>{
  const f=await fixture(t);
  await f.db.query("UPDATE invoices SET status=$1",[status]);
  const row=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(row.status,status);
  assert.equal(row.amount_due,1000);
});

test("financial balance returns null for missing, foreign or archived invoices",async t=>{
  const f=await fixture(t);
  for(const badScope of [{...scope,invoiceId:"missing"},{...scope,organizationId:"org-b"}]) {
    assert.equal(await financialBalance.readInvoiceFinancialBalance(f.client,badScope),null);
    assert.equal(await financialBalance.refreshInvoiceFinancialBalance(f.client,badScope),null);
  }
  await f.db.exec("UPDATE invoices SET archived_at=now()");
  assert.equal(await financialBalance.readInvoiceFinancialBalance(f.client,scope),null);
  assert.equal(await financialBalance.refreshInvoiceFinancialBalance(f.client,scope),null);
  assert.ok(!f.queries.some(sql=>/UPDATE invoices/.test(sql)));
});

test("financial balance uses shared centime rounding and permits crediting an already paid invoice",async t=>{
  const f=await fixture(t);
  await f.db.exec("UPDATE invoices SET total_ttc=10.03; INSERT INTO payments VALUES('p1','org-a','invoice-a',0.01,'RECORDED'); INSERT INTO credit_notes VALUES('c1','org-a','invoice-a',0.02,'ISSUED',NULL)");
  assert.equal((await financialBalance.readInvoiceFinancialBalance(f.client,scope)).amount_due,10);
  await f.db.exec("UPDATE payments SET amount=10.03; UPDATE credit_notes SET total_ttc=10.03");
  const row=await financialBalance.refreshInvoiceFinancialBalance(f.client,scope);
  assert.equal(row.total_ttc,10.03);
  assert.equal(row.total_paid,10.03);
  assert.equal(row.total_credited,10.03);
  assert.equal(row.amount_due,0);
  assert.equal(row.status,"PAID");
  assert.equal(financialBalance.computeInvoiceAmountDue(row),financialBalance.computeInvoiceBalance(row).amount_due);
});
