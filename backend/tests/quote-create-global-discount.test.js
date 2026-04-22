/**
 * createQuote + metadata global_discount_* : totaux alignés applyDocumentDiscountHt.
 * Usage: cd backend && node tests/quote-create-global-discount.test.js
 */

import "../config/load-env.js";
import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import { applyDocumentDiscountHt } from "../services/finance/financialLine.js";
import { computeFinancialLineDbFields } from "../services/finance/financialLine.js";

const TEST_PREFIX = "QGDISC";
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
     VALUES ($1, $2, 'G', 'Disc', 'G Disc', 'gdisc@test.local', $3, $4) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id, sourceId]
  );
  return { leadId: leadRes.rows[0].id, addressId: addrRes.rows[0].id };
}

async function run() {
  console.log("\n=== createQuote + remise document (metadata) ===\n");
  let quoteId = null;
  let leadId = null;
  let addressId = null;
  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgRes.rows.length === 0) {
      fail("Aucune organisation en base");
      process.exit(1);
    }
    const orgId = orgRes.rows[0].id;
    const lead = await createLead(orgId);
    leadId = lead.leadId;
    addressId = lead.addressId;

    const qty = 1;
    const unit = 100;
    const vat = 20;
    const { total_line_ht: th, total_line_vat: tv, total_line_ttc: tt } = computeFinancialLineDbFields({
      quantity: qty,
      unit_price_ht: unit,
      discount_ht: 0,
      vat_rate: vat,
    });
    const sub = { total_ht: th, total_vat: tv, total_ttc: tt };

    // % seul
    const dataPct = await quoteService.createQuote(orgId, {
      lead_id: leadId,
      items: [{ label: "L1", description: "", quantity: qty, unit_price_ht: unit, tva_rate: vat }],
      metadata: {
        global_discount_percent: 10,
        global_discount_amount_ht: 0,
      },
    });
    quoteId = dataPct.quote.id;
    const expPct = applyDocumentDiscountHt(sub, sub.total_ht * 0.1);
    if (
      Math.abs(Number(dataPct.quote.total_ht) - expPct.total_ht) > 0.02 ||
      Math.abs(Number(dataPct.quote.discount_ht) - expPct.applied_document_discount_ht) > 0.02
    ) {
      fail("remise % : totaux ou discount_ht incorrects", new Error(JSON.stringify(dataPct.quote)));
    } else {
      ok("createQuote + 10 % HT : total_ht / discount_ht cohérents");
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    quoteId = null;

    // montant fixe
    const dataAmt = await quoteService.createQuote(orgId, {
      lead_id: leadId,
      items: [{ label: "L1", description: "", quantity: qty, unit_price_ht: unit, tva_rate: vat }],
      metadata: {
        global_discount_percent: 0,
        global_discount_amount_ht: 25,
      },
    });
    quoteId = dataAmt.quote.id;
    const expAmt = applyDocumentDiscountHt(sub, 25);
    if (
      Math.abs(Number(dataAmt.quote.total_ht) - expAmt.total_ht) > 0.02 ||
      Math.abs(Number(dataAmt.quote.discount_ht) - expAmt.applied_document_discount_ht) > 0.02
    ) {
      fail("remise montant HT : totaux incorrects");
    } else {
      ok("createQuote + 25 € HT fixe : totaux cohérents");
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    quoteId = null;

    // % + montant
    const dataBoth = await quoteService.createQuote(orgId, {
      lead_id: leadId,
      items: [{ label: "L1", description: "", quantity: qty, unit_price_ht: unit, tva_rate: vat }],
      metadata: {
        global_discount_percent: 5,
        global_discount_amount_ht: 10,
      },
    });
    quoteId = dataBoth.quote.id;
    const docDisc = Math.round((sub.total_ht * 0.05 + 10) * 100) / 100;
    const expBoth = applyDocumentDiscountHt(sub, docDisc);
    if (
      Math.abs(Number(dataBoth.quote.total_ht) - expBoth.total_ht) > 0.02 ||
      Math.abs(Number(dataBoth.quote.discount_ht) - expBoth.applied_document_discount_ht) > 0.02
    ) {
      fail("remise % + montant : totaux incorrects");
    } else {
      ok("createQuote + 5 % + 10 € HT : totaux cohérents");
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
