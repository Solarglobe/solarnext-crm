/**
 * Remise document multi-TVA : une ligne de remise par taux, somme HT remise = cible.
 * cd backend && node tests/quote-discount-multi-vat.test.js
 */

import "../config/load-env.js";
import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";

const TEST_PREFIX = "QMULTIVAT";
let passed = 0;
let failed = 0;

function ok(msg) {
  passed++;
  console.log(`  ✔ ${msg}`);
}
function fail(msg, err) {
  failed++;
  console.log(`  ✖ ${msg}`);
  if (err) console.log(`    ${err?.message || err}`);
}

async function getOrCreateLeadSourceId(orgId) {
  const r = await pool.query("SELECT id FROM lead_sources WHERE organization_id = $1 LIMIT 1", [orgId]);
  if (r.rows[0]?.id) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO lead_sources (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `${TEST_PREFIX}-src`]
  );
  return ins.rows[0].id;
}

async function createLead(orgId) {
  const stageRes = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  );
  let stageId = stageRes.rows[0]?.id;
  if (!stageId) {
    const ins = await pool.query(
      `INSERT INTO pipeline_stages (organization_id, name, position, is_closed) VALUES ($1, 'Qualification', 0, false) RETURNING id`,
      [orgId]
    );
    stageId = ins.rows[0].id;
  }
  const sourceId = await getOrCreateLeadSourceId(orgId);
  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Paris', 48.8566, 2.3522, 'FR') RETURNING id`,
    [orgId]
  );
  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id, source_id)
     VALUES ($1, $2, 'M', 'Vat', 'M Vat', 'mvat@test.local', $3, $4) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id, sourceId]
  );
  return { leadId: leadRes.rows[0].id, addressId: addrRes.rows[0].id };
}

async function assertDiscountLinesSumToTarget(quoteId, targetDiscountHt) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_line_ht), 0)::float8 AS s
     FROM quote_lines
     WHERE quote_id = $1 AND (snapshot_json::jsonb->>'line_kind') = 'DOCUMENT_DISCOUNT'`,
    [quoteId]
  );
  const sumNeg = Number(r.rows[0]?.s) || 0;
  const applied = -sumNeg;
  if (Math.abs(applied - targetDiscountHt) > 0.02) {
    throw new Error(`Somme remises HT ${applied} != cible ${targetDiscountHt}`);
  }
}

async function run() {
  console.log("\n=== createQuote remise multi-TVA ===\n");
  let quoteId = null;
  let leadId = null;
  let addressId = null;
  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgRes.rows.length === 0) {
      fail("Aucune organisation");
      process.exit(1);
    }
    const orgId = orgRes.rows[0].id;
    const lead = await createLead(orgId);
    leadId = lead.leadId;
    addressId = lead.addressId;

    const items = [
      { label: "A20", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 },
      { label: "B10", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 10 },
    ];
    let subHt = 0;
    for (const it of items) {
      const a = computeFinancialLineDbFields({
        quantity: 1,
        unit_price_ht: it.unit_price_ht,
        discount_ht: 0,
        vat_rate: it.tva_rate,
      });
      subHt += a.total_line_ht;
    }
    const pct = 10;
    const targetDisc = Math.round(subHt * (pct / 100) * 100) / 100;

    const data = await quoteService.createQuote(orgId, {
      lead_id: leadId,
      items,
      metadata: { global_discount_percent: pct, global_discount_amount_ht: 0 },
    });
    quoteId = data.quote.id;
    const discLines = (data.items || []).filter((row) => {
      const s = row.snapshot_json;
      const o = typeof s === "string" ? JSON.parse(s) : s;
      return o?.line_kind === "DOCUMENT_DISCOUNT";
    });
    if (discLines.length !== 2) {
      fail(`attend 2 lignes remise, obtenu ${discLines.length}`);
    } else {
      await assertDiscountLinesSumToTarget(quoteId, targetDisc);
      ok("2 lignes remise (20 % et 10 %), somme HT remise = cible");
    }
  } catch (e) {
    fail("exception", e);
  } finally {
    if (quoteId) {
      await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]).catch(() => {});
      await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]).catch(() => {});
    }
    if (leadId) await pool.query("DELETE FROM leads WHERE id = $1", [leadId]).catch(() => {});
    if (addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [addressId]).catch(() => {});
  }

  console.log(`\n${passed} ok, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
