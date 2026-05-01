/**
 * ensureClientForQuote + createInvoiceFromQuote (devis accepté sans client sur le devis).
 * cd backend && node --env-file=../.env.dev --test tests/ensure-client-from-quote.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "../config/register-local-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";
import { ensureClientForQuote } from "../services/ensureClientForQuote.service.js";

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

  const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
    preparedLines: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 500, discount_ht: 0, vat_rate: 20 }],
  });
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

  const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
    preparedLines: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 300, discount_ht: 0, vat_rate: 20 }],
  });
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

test("ACCEPTED seul (sans createInvoice) : lead sans client_id → clients + lead.client_id + lead.status CLIENT + quote.client_id", async () => {
  const email = `${PREFIX}-accept-inline@ecfq.test`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'LEAD', 'Kim Girard', 'Kim', 'Girard', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 200, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  toDelete.quoteIds.push(qid);
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

  const qr = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [qid]);
  const qCid = qr.rows[0].client_id;
  assert.ok(qCid, "quote.client_id après ACCEPTED");
  toDelete.clientIds.push(qCid);

  const lr2 = await pool.query(`SELECT client_id, status FROM leads WHERE id = $1`, [leadId]);
  assert.ok(lr2.rows[0].client_id);
  assert.equal(String(lr2.rows[0].client_id), String(qCid));
  assert.equal(String(lr2.rows[0].status).toUpperCase(), "CLIENT");

  const cnt = await pool.query(
    `SELECT count(*)::int AS c FROM clients WHERE organization_id = $1 AND id = $2`,
    [orgId, qCid]
  );
  assert.equal(cnt.rows[0].c, 1);
});

test("ACCEPTED seul : lead déjà lié à un client → un seul client pour l’email, pas de doublon", async () => {
  const email = `${PREFIX}-accept-dup@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Exi', 'Sting', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-EX`, email]
  );
  const existingId = cr.rows[0].id;
  toDelete.clientIds.push(existingId);

  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type, client_id)
     VALUES ($1, $2, 'LEAD', 'Exi Lead', 'Exi', 'Lead', $3, $4, 'PERSON', $5) RETURNING id`,
    [orgId, stageId, email, sourceId, existingId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 50, tva_rate: 20 }],
  });
  const qid = q.quote.id;
  toDelete.quoteIds.push(qid);
  await quoteService.patchQuoteStatus(qid, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(qid, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(qid, orgId, "ACCEPTED", null);

  const cnt = await pool.query(
    `SELECT count(*)::int AS c FROM clients WHERE organization_id = $1 AND LOWER(TRIM(email)) = $2`,
    [orgId, email.toLowerCase()]
  );
  assert.equal(cnt.rows[0].c, 1);

  const qr = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [qid]);
  assert.equal(String(qr.rows[0].client_id), String(existingId));

  const lrSt = await pool.query(`SELECT status FROM leads WHERE id = $1`, [leadId]);
  assert.equal(String(lrSt.rows[0].status).toUpperCase(), "CLIENT");
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

  const inv = await invoiceService.createPreparedStandardInvoiceFromQuote(qid, orgId, {
    preparedLines: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, discount_ht: 0, vat_rate: 20 }],
  });
  toDelete.invoiceIds.push(inv.id);
  assert.equal(String(inv.client_id), String(existingC));

  const cnt = await pool.query(
    `SELECT count(*)::int AS c FROM clients WHERE organization_id = $1 AND LOWER(TRIM(email)) = $2`,
    [orgId, email.toLowerCase()]
  );
  assert.equal(cnt.rows[0].c, 1, "un seul client pour cet email");
});

test("ensureClientForQuote: quote.client_id + quote.lead_id => lead.status passe CLIENT", async () => {
  const email = `${PREFIX}-lead-client-1@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Lead', 'Client', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-LC1`, email]
  );
  const clientId = cr.rows[0].id;
  toDelete.clientIds.push(clientId);

  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'PROSPECT', 'Lead Client', 'Lead', 'Client', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);
  await pool.query(`UPDATE quotes SET client_id = $1 WHERE id = $2`, [clientId, quoteId]);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const quoteRowRes = await dbClient.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [quoteId, orgId]);
    const resolved = await ensureClientForQuote(dbClient, quoteRowRes.rows[0], orgId);
    assert.equal(String(resolved), String(clientId));
    await dbClient.query("COMMIT");
  } catch (e) {
    await dbClient.query("ROLLBACK");
    throw e;
  } finally {
    dbClient.release();
  }

  const leadAfter = await pool.query(`SELECT status FROM leads WHERE id = $1`, [leadId]);
  assert.equal(String(leadAfter.rows[0]?.status || "").toUpperCase(), "CLIENT");
});

test("ensureClientForQuote: quote.client_id seul => pas de crash", async () => {
  const email = `${PREFIX}-client-only@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Client', 'Only', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-CO`, email]
  );
  const clientId = cr.rows[0].id;
  toDelete.clientIds.push(clientId);

  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 80, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const quoteRowRes = await dbClient.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [quoteId, orgId]);
    const resolved = await ensureClientForQuote(dbClient, quoteRowRes.rows[0], orgId);
    assert.equal(String(resolved), String(clientId));
    await dbClient.query("COMMIT");
  } catch (e) {
    await dbClient.query("ROLLBACK");
    throw e;
  } finally {
    dbClient.release();
  }
});

test("ensureClientForQuote: lead deja CLIENT => idempotent", async () => {
  const email = `${PREFIX}-lead-already-client@ecfq.test`;
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Lead', 'Already', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}-LAC`, email]
  );
  const clientId = cr.rows[0].id;
  toDelete.clientIds.push(clientId);

  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Lead Already Client', 'Lead', 'Already', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 60, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);
  await pool.query(`UPDATE quotes SET client_id = $1 WHERE id = $2`, [clientId, quoteId]);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const quoteRowRes = await dbClient.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [quoteId, orgId]);
    const resolved = await ensureClientForQuote(dbClient, quoteRowRes.rows[0], orgId);
    assert.equal(String(resolved), String(clientId));
    await dbClient.query("COMMIT");
  } catch (e) {
    await dbClient.query("ROLLBACK");
    throw e;
  } finally {
    dbClient.release();
  }

  const leadAfter = await pool.query(`SELECT status FROM leads WHERE id = $1`, [leadId]);
  assert.equal(String(leadAfter.rows[0]?.status || "").toUpperCase(), "CLIENT");
});

test("getQuoteInvoiceBillingContext: ACCEPTED sans client_id rattache/cree client", async () => {
  const email = `${PREFIX}-ctx-accepted@ecfq.test`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Ctx Accepted', 'Ctx', 'Accepted', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);
  await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
  await quoteService.patchQuoteStatus(quoteId, orgId, "ACCEPTED", null);
  await pool.query(`UPDATE quotes SET client_id = NULL WHERE id = $1`, [quoteId]);
  await pool.query(`UPDATE leads SET client_id = NULL WHERE id = $1`, [leadId]);

  const ctx = await invoiceService.getQuoteInvoiceBillingContext(quoteId, orgId);
  assert.ok(ctx);
  assert.equal(ctx.can_create_standard_full, true);

  const qAfter = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [quoteId]);
  const lAfter = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  assert.ok(qAfter.rows[0]?.client_id, "quote.client_id doit etre renseigne");
  assert.ok(lAfter.rows[0]?.client_id, "lead.client_id doit etre renseigne");
  assert.equal(String(qAfter.rows[0].client_id), String(lAfter.rows[0].client_id));
  toDelete.clientIds.push(qAfter.rows[0].client_id);
});

test("getQuoteInvoiceBillingContext: DRAFT sans client_id ne cree pas de client", async () => {
  const email = `${PREFIX}-ctx-draft@ecfq.test`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Ctx Draft', 'Ctx', 'Draft', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 90, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);
  await pool.query(`UPDATE quotes SET client_id = NULL WHERE id = $1`, [quoteId]);
  await pool.query(`UPDATE leads SET client_id = NULL WHERE id = $1`, [leadId]);

  const ctx = await invoiceService.getQuoteInvoiceBillingContext(quoteId, orgId);
  assert.ok(ctx);
  assert.equal(ctx.can_create_standard_full, false);

  const qAfter = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [quoteId]);
  const lAfter = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  assert.equal(qAfter.rows[0]?.client_id, null);
  assert.equal(lAfter.rows[0]?.client_id, null);
});
