/**
 * ensureClientForQuote + createInvoiceFromQuote (devis accepté sans client sur le devis).
 * cd backend && node --env-file=../.env.dev --test tests/ensure-client-from-quote.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const PREFIX = `ECFQ-${Date.now()}`;
let orgId;
let stageId;
let sourceId;
const toDelete = { invoiceIds: [], quoteIds: [], leadIds: [], clientIds: [] };

before(async () => {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  assert.ok(r.rows.length, "organization requise");
  orgId = r.rows[0].id;
  const st = await pool.query(
    `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1`,
    [orgId]
  );
  assert.ok(st.rows.length, "pipeline_stages requis");
  stageId = st.rows[0].id;
  const src = await pool.query(
    `SELECT id FROM lead_sources WHERE organization_id = $1 ORDER BY slug LIMIT 1`,
    [orgId]
  );
  assert.ok(src.rows.length, "lead_sources requis");
  sourceId = src.rows[0].id;
});

after(async () => {
  for (const id of toDelete.invoiceIds) {
    await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
    await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  }
  for (const qid of toDelete.quoteIds) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]);
  }
  for (const lid of toDelete.leadIds) {
    await pool.query("DELETE FROM leads WHERE id = $1", [lid]);
  }
  for (const cid of toDelete.clientIds) {
    await pool.query("DELETE FROM clients WHERE id = $1", [cid]);
  }
  await pool.end();
});

test("ACCEPTED : quote.client_id null + lead.client_id → facture OK + quote synchronisé", async () => {
  const email = `${PREFIX}-a@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Eco', 'ClientA', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-A`, email]
  );
  const clientA = cr.rows[0].id;
  toDelete.clientIds.push(clientA);

  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type, client_id)
     VALUES ($1, $2, 'CLIENT', 'Eco Lead', 'Eco', 'Lead', $3, $4, 'PERSON', $5) RETURNING id`,
    [orgId, stageId, email, sourceId, clientA]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 500, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  toDelete.quoteIds.push(qid);
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

  await pool.query(`UPDATE quotes SET client_id = NULL WHERE id = $1`, [qid]);

  const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
  toDelete.invoiceIds.push(inv.id);
  assert.equal(String(inv.client_id), String(clientA));

  const qr = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [qid]);
  assert.ok(qr.rows[0].client_id, "quote.client_id doit être renseigné après facturation");
  assert.equal(String(qr.rows[0].client_id), String(clientA));
});

test("ACCEPTED : lead sans client_id, email unique → création client + facture OK", async () => {
  const email = `${PREFIX}-b@ecfq.test`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Eco LeadB', 'Eco', 'LeadB', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 300, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  toDelete.quoteIds.push(qid);
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

  const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
  toDelete.invoiceIds.push(inv.id);
  assert.ok(inv.client_id, "facture doit avoir client_id");

  const qr = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [qid]);
  const qCid = qr.rows[0].client_id;
  assert.ok(qCid);
  toDelete.clientIds.push(qCid);
  assert.equal(String(inv.client_id), String(qCid));

  const lr2 = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  assert.ok(lr2.rows[0].client_id);
  assert.equal(String(lr2.rows[0].client_id), String(qCid));
});

test("ACCEPTED : lead sans client mais email déjà client existant → rattachement sans doublon", async () => {
  const email = `${PREFIX}-c@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Dup', 'ClientC', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-C`, email]
  );
  const existingC = cr.rows[0].id;
  toDelete.clientIds.push(existingC);

  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'LEAD', 'Dup Lead', 'Dup', 'LeadC', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  toDelete.quoteIds.push(qid);
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

  const inv = await invoiceService.createInvoiceFromQuote(qid, orgId, { billingRole: "STANDARD" });
  toDelete.invoiceIds.push(inv.id);
  assert.equal(String(inv.client_id), String(existingC));

  const cnt = await pool.query(
    `SELECT count(*)::int AS c FROM clients WHERE organization_id = $1 AND LOWER(TRIM(email)) = $2`,
    [orgId, email.toLowerCase()]
  );
  assert.equal(cnt.rows[0].c, 1, "un seul client pour cet email");
});
