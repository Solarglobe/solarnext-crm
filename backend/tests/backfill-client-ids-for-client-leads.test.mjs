/**
 * Tests du script backfill CLIENT sans client_id.
 * cd backend && node --env-file=../.env.dev --test tests/backfill-client-ids-for-client-leads.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import "../config/register-local-env.js";
import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";

const execFileAsync = promisify(execFile);
const PREFIX = `BCL-${Date.now()}`;
let orgId;
let stageId;
let sourceId;
const toDelete = { quoteIds: [], leadIds: [], clientIds: [] };

async function runScript(args = []) {
  const scriptPath = "scripts/backfill-client-ids-for-client-leads.mjs";
  const backendCwd = resolve(process.cwd(), "backend");
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: backendCwd,
    env: process.env,
  });
  return { stdout, stderr };
}

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
  for (const qid of toDelete.quoteIds) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]).catch(() => {});
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]).catch(() => {});
  }
  for (const lid of toDelete.leadIds) {
    await pool.query("DELETE FROM leads WHERE id = $1", [lid]).catch(() => {});
  }
  for (const cid of toDelete.clientIds) {
    await pool.query("DELETE FROM clients WHERE id = $1", [cid]).catch(() => {});
  }
  await pool.end();
});

test("script dry-run: detecte les leads impactes sans ecriture", async () => {
  const email = `${PREFIX}-dry@test.local`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Backfill Dry', 'Backfill', 'Dry', $3, $4, 'PERSON') RETURNING id`,
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
  await pool.query(`UPDATE quotes SET client_id = NULL WHERE id = $1`, [quoteId]);

  const out = await runScript([]);
  assert.match(out.stdout, /mode=DRY_RUN/i);
  assert.match(out.stdout, /summary/i);

  const afterLead = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  const afterQuote = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [quoteId]);
  assert.equal(afterLead.rows[0]?.client_id, null);
  assert.equal(afterQuote.rows[0]?.client_id, null);
});

test("script apply: cree/rattache client, met lead.client_id et quotes.client_id, idempotent", async () => {
  const email = `${PREFIX}-apply@test.local`;
  const lr = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, first_name, last_name, email, source_id, customer_type)
     VALUES ($1, $2, 'CLIENT', 'Backfill Apply', 'Backfill', 'Apply', $3, $4, 'PERSON') RETURNING id`,
    [orgId, stageId, email, sourceId]
  );
  const leadId = lr.rows[0].id;
  toDelete.leadIds.push(leadId);

  const q = await quoteService.createQuote(orgId, {
    lead_id: leadId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 110, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  toDelete.quoteIds.push(quoteId);
  await pool.query(`UPDATE quotes SET client_id = NULL WHERE id = $1`, [quoteId]);

  const out1 = await runScript(["--apply"]);
  assert.match(out1.stdout, /mode=APPLY/i);

  const after1Lead = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  const after1Quote = await pool.query(`SELECT client_id FROM quotes WHERE id = $1`, [quoteId]);
  assert.ok(after1Lead.rows[0]?.client_id);
  assert.equal(String(after1Lead.rows[0].client_id), String(after1Quote.rows[0].client_id));
  toDelete.clientIds.push(after1Lead.rows[0].client_id);

  const firstClientId = String(after1Lead.rows[0].client_id);
  const out2 = await runScript(["--apply"]);
  assert.match(out2.stdout, /summary/i);
  const after2Lead = await pool.query(`SELECT client_id FROM leads WHERE id = $1`, [leadId]);
  assert.equal(String(after2Lead.rows[0].client_id), firstClientId);
});

