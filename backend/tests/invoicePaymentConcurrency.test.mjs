import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as balance from '../services/finance/invoiceBalance.js';
import * as money from '../services/finance/moneyRounding.js';
import { computeInvoiceCreditableAmount } from '../services/finance/creditNoteComputation.js';
import { withTx } from '../db/tx.js';

// TWO CLIENTS / transaction-lock SIMULATION, not a multi-session PostgreSQL test.
// Actual services/helpers execute with staged writes, committed reads and row
// locks. invoicePaymentBalance.test.mjs separately executes actual SQL/triggers.
function load(path,names,deps) {
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`,{...deps,console});
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({paid=0,credited=0,pause=/INSERT INTO payments/}={}) {
  const tables={
    invoices:new Map([['invoice',{id:'invoice',organization_id:'org',client_id:'client',status:paid||credited?'PARTIALLY_PAID':'ISSUED',
      total_ttc:1000,total_paid:paid,total_credited:credited,amount_due:1000-paid-credited,archived_at:null}]]),
    payments:new Map(paid?[['existing',{id:'existing',invoice_id:'invoice',organization_id:'org',amount:paid,status:'RECORDED'}]]:[]),
    credit_notes:new Map(credited?[['existing-credit',{id:'existing-credit',invoice_id:'invoice',organization_id:'org',total_ttc:credited,status:'ISSUED',archived_at:null}]]:[]),
  };
  let seq=0, paymentSeq=0, paused=false;
  const entered=deferred(),resume=deferred(),blocked=deferred();
  const locks=new Map(),events=[];
  async function acquire(owner,key){
    if(locks.get(key)?.owner===owner)return;
    if(locks.has(key)){
      const wait=deferred();locks.get(key).waiters.push({owner,...wait});
      events.push({event:'blocked',owner,key});blocked.resolve();await wait.promise;
    }else locks.set(key,{owner,waiters:[]});
    events.push({event:'lock',owner,key});
  }
  function release(owner){for(const [key,lock]of locks){if(lock.owner!==owner)continue;
    const next=lock.waiters.shift();if(next){lock.owner=next.owner;next.resolve();}else locks.delete(key);}}
  function client(){
    const owner=++seq;let transaction=false;let writes=[];
    function view(table){const map=new Map(tables[table]);for(const w of writes)if(w.table===table)map.set(w.row.id,w.row);return [...map.values()];}
    function save(table,row){if(transaction)writes.push({table,row:{...row}});else tables[table].set(row.id,{...row});}
    function financial(){const invoice=view('invoices')[0];return {...invoice,...balance.computeInvoiceBalance({ ...invoice,
      ...balance.summarizeInvoicePayments(view('payments')), ...balance.summarizeInvoiceCredits(view('credit_notes')) })};}
    function trigger(){save('invoices',financial());}
    return {release(){release(owner);},async query(raw,values=[]){
      const sql=raw.replace(/\s+/g,' ').trim();events.push({event:'query',owner,sql,transaction});
      if(sql==='BEGIN'){transaction=true;return {rows:[]};}
      if(sql==='COMMIT'||sql==='ROLLBACK'){
        if(sql==='COMMIT')for(const w of writes)tables[w.table].set(w.row.id,w.row);
        writes=[];transaction=false;release(owner);return {rows:[]};
      }
      const matches=(row,id,org)=>row.id===id&&(org==null||row.organization_id===org);
      const selectTable=/^SELECT/.test(sql)&&sql.match(/FROM (invoices|payments|credit_notes)(?:\s|$)/)?.[1];
      if(selectTable&&/FOR UPDATE/.test(sql)){
        const row=view(selectTable).find(r=>matches(r,values[0],values[1]));
        if(row)await acquire(owner,`${selectTable}:${row.id}`);
      }
      if(!paused&&pause?.test(sql)){paused=true;entered.resolve();await resume.promise;}
      if(/SELECT COALESCE\(SUM\(amount\)/.test(sql))return{rows:[{s:balance.summarizeInvoicePayments(view('payments')).total_paid}]};
      if(/recorded_payments_total/.test(sql)){
        const row=financial();return{rows:row.id===values[0]&&row.organization_id===values[1]?[{
          ...row,recorded_payments_total:row.total_paid,issued_credits_total:row.total_credited}]:[]};
      }
      if(selectTable)return{rows:view(selectTable).filter(row=>matches(row,values[0],values[1])).map(row=>({...row}))};
      if(/SELECT COUNT.*credit_note_lines/.test(sql))return{rows:[{n:1}]};
      if(/INSERT INTO payments/.test(sql)){
        const row={id:`payment-${++paymentSeq}`,organization_id:values[0],invoice_id:values[1],amount:values[2],payment_date:values[3],status:'RECORDED'};
        save('payments',row);trigger();return{rows:[{...row}]};
      }
      if(/UPDATE payments SET status = 'CANCELLED'/.test(sql)){
        const row=view('payments').find(r=>r.id===values[0]);const next={...row,status:'CANCELLED',cancelled_at:new Date(),cancelled_by:values[1]};
        save('payments',next);trigger();return{rows:[{...next}]};
      }
      if(/UPDATE credit_notes SET status = 'ISSUED'/.test(sql)){
        const row=view('credit_notes').find(r=>r.id===values[4]);const next={...row,status:'ISSUED',credit_note_number:values[0]};
        save('credit_notes',next);trigger();return{rows:[{...next}]};
      }
      if(/UPDATE invoices SET total_paid/.test(sql)){
        const row=view('invoices')[0];const next={...row,total_paid:values[2],total_credited:values[3],amount_due:values[4],status:values[5],paid_at:values[5]==='PAID'?new Date():null};
        save('invoices',next);return{rows:[{...next}]};
      }
      if(/UPDATE invoices SET status/.test(sql)){
        const row=view('invoices')[0];const next={...row,status:values[0],paid_at:values[0]==='PAID'?new Date():row.paid_at};save('invoices',next);return{rows:[]};
      }
      throw new Error(`Unsupported synthetic SQL: ${sql}`);
    }};
  }
  const pool={connect:async()=>client(),query:async(sql,values)=>{const c=client();try{return await c.query(sql,values);}finally{c.release();}}};
  const deps={pool,withTx,...balance,...money,computeInvoiceCreditableAmount};
  const payments=load('../services/payments.service.js',['recordPayment','cancelPayment'],deps);
  const credits=load('../services/creditNotes.service.js',['issueCreditNote'],{...deps,
    allocateNextDocumentNumber:async()=>({fullNumber:'SYNTHETIC'}),
    buildInvoiceIssuerRecipientSnapshots:async()=>({issuer_snapshot:{},recipient_snapshot:{}}),
    buildSourceInvoiceSnapshot:()=>({}),persistCreditNoteOfficialDocumentSnapshot:async()=>{},
  });
  const pay=amount=>payments.recordPayment('org','invoice',{amount,payment_date:'2026-09-24'});
  function addDraft(id,amount){tables.credit_notes.set(id,{id,invoice_id:'invoice',organization_id:'org',status:'DRAFT',total_ttc:amount,archived_at:null});}
  return{tables,events,entered,resume,blocked,pay,payments,credits,addDraft};
}

test('B2: two simultaneous payments cannot both consume the same balance',async()=>{
  const f=fixture({credited:400});
  const first=f.pay(400);await f.entered.promise;
  const second=f.pay(400);const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const refused=results.find(r=>r.status==='rejected');
  assert.equal(refused.reason.statusCode,400);
  assert.match(refused.reason.message,/dépasse le reste à payer/);
  assert.equal(f.tables.payments.size,1);
  const invoice=f.tables.invoices.get('invoice');
  assert.equal(invoice.total_paid,400);assert.equal(invoice.amount_due,200);
  assert.ok(f.events.some(e=>e.event==='blocked'&&e.key==='invoices:invoice'));
  await f.pay(200);
  const afterRetry=f.tables.invoices.get('invoice');
  assert.equal(afterRetry.total_paid,600);assert.equal(afterRetry.amount_due,0);assert.equal(afterRetry.status,'PAID');
});
test('B2: credit commits first; waiting payment rereads net payable and rejects excess',async()=>{
  const f=fixture({pause:/UPDATE credit_notes SET status = 'ISSUED'/});f.addDraft('credit',400);
  const first=f.credits.issueCreditNote('org','credit');await f.entered.promise;
  const second=f.pay(800);const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(results[1].reason.statusCode,400);
  assert.match(results[1].reason.message,/dépasse le reste à payer/);
  assert.equal(f.tables.payments.size,0);assert.equal(f.tables.invoices.get('invoice').amount_due,600);
});
test('B2: payment commits first; later credit preserves permitted accounting overpayment',async()=>{
  const f=fixture();f.addDraft('credit',400);
  const first=f.pay(800);await f.entered.promise;
  const second=f.credits.issueCreditNote('org','credit');const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled']);
  const row=f.tables.invoices.get('invoice');
  assert.equal(row.total_paid,800);assert.equal(row.total_credited,400);assert.equal(row.amount_due,0);assert.equal(row.status,'PAID');
});
test('B2: cancellation commits first; waiting payment uses freed net balance',async()=>{
  const f=fixture({paid:500,credited:400,pause:/UPDATE payments SET status = 'CANCELLED'/});
  const first=f.payments.cancelPayment('org','existing');await f.entered.promise;
  const second=f.pay(600);const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled']);
  const row=f.tables.invoices.get('invoice');
  assert.equal(row.total_paid,600);assert.equal(row.total_credited,400);assert.equal(row.amount_due,0);assert.equal(row.status,'PAID');
});
test('B2: concurrent credits share invoice lock and cannot exceed creditable gross',async()=>{
  const f=fixture({pause:/UPDATE credit_notes SET status = 'ISSUED'/});f.addDraft('credit-a',600);f.addDraft('credit-b',600);
  const first=f.credits.issueCreditNote('org','credit-a');await f.entered.promise;
  const second=f.credits.issueCreditNote('org','credit-b');const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const refused=results.find(r=>r.status==='rejected');
  assert.equal(refused.reason.statusCode,400);
  assert.match(refused.reason.message,/total encore créditable/);
  assert.equal(f.tables.invoices.get('invoice').total_credited,600);
});
test('B2: two simultaneous valid partial payments may exactly settle the net balance',async()=>{
  const f=fixture({credited:400});
  const first=f.pay(200);await f.entered.promise;
  const second=f.pay(400);const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled']);
  const row=f.tables.invoices.get('invoice');
  assert.equal(row.total_paid,600);assert.equal(row.total_credited,400);assert.equal(row.amount_due,0);assert.equal(row.status,'PAID');
});
test('B2: two simultaneous cancellations cannot cancel the same payment twice',async()=>{
  const f=fixture({paid:500,pause:/UPDATE payments SET status = 'CANCELLED'/});
  const first=f.payments.cancelPayment('org','existing');await f.entered.promise;
  const second=f.payments.cancelPayment('org','existing');const settled=Promise.allSettled([first,second]);await tick();f.resume.resolve();
  const results=await settled;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const refused=results.find(r=>r.status==='rejected');
  assert.equal(refused.reason.statusCode,400);
  assert.match(refused.reason.message,/Seul un paiement enregistré/);
  const row=f.tables.invoices.get('invoice');
  assert.equal(row.total_paid,0);assert.equal(row.amount_due,1000);assert.equal(row.status,'ISSUED');
  for(const [owner] of new Map(f.events.filter(e=>e.event==='lock').map(e=>[e.owner,true]))){
    const held=f.events.filter(e=>e.event==='lock'&&e.owner===owner).map(e=>e.key);
    assert.equal(held[0],'invoices:invoice');
  }
});
