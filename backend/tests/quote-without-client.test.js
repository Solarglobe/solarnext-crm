/**
 * Test : création d'un devis sans client (lead-only).
 * Vérifie que createQuote accepte lead_id + study_id sans client_id,
 * et lead_id seul sans étude (study_id null).
 *
 * Usage: cd backend && node tests/quote-without-client.test.js
 * Prérequis: migration 1771160700000 (quotes.client_id nullable) appliquée.
 */

import "../config/load-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";

const TEST_PREFIX = "QNOCLI";
let passed = 0;
let failed = 0;

function ok(msg, detail = "") {
  passed++;
  console.log(`  ✔ ${msg}${detail ? ` — ${detail}` : ""}`);
}

function fail(msg, err) {
  failed++;
  console.log(`  ✖ ${msg}`);
  if (err) console.log(`    ${err?.message || err}`);
}

async function createLeadAndStudy(orgId) {
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
  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Paris', 48.8566, 2.3522, 'FR') RETURNING id`,
    [orgId]
  );
  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
     VALUES ($1, $2, 'Test', 'NoClient', 'Test NoClient', 'noclient@test.local', $3) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id]
  );
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, leadRes.rows[0].id, `${TEST_PREFIX}-${Date.now()}`, "draft"]
  );
  return {
    leadId: leadRes.rows[0].id,
    studyId: studyRes.rows[0].id,
    addressId: addrRes.rows[0].id,
  };
}

async function createLeadOnly(orgId) {
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
  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Lyon', 45.764, 4.8357, 'FR') RETURNING id`,
    [orgId]
  );
  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
     VALUES ($1, $2, 'Lead', 'Seul', 'Lead Seul', 'leadseul@test.local', $3) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id]
  );
  return {
    leadId: leadRes.rows[0].id,
    addressId: addrRes.rows[0].id,
  };
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    if (ids.quoteId) {
      await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [ids.quoteId]);
      await pool.query("DELETE FROM quotes WHERE id = $1", [ids.quoteId]);
    }
    if (ids.studyId) {
      await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    }
    if (ids.leadId) await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    if (ids.addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function run() {
  console.log("\n=== Create quote without client (lead-only) ===\n");

  let ids = null;
  let orgId;

  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgRes.rows.length === 0) {
      const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`]);
      orgId = ins.rows[0].id;
    } else {
      orgId = orgRes.rows[0].id;
    }

    ids = await createLeadAndStudy(orgId);
    const { leadId, studyId } = ids;

    const data = await quoteService.createQuote(orgId, {
      lead_id: leadId,
      study_id: studyId,
      items: [
        { label: "Panneau", description: "1 panneau", quantity: 1, unit_price_ht: 200, tva_rate: 10 },
      ],
    });

    if (!data?.quote?.id) {
      fail("createQuote doit retourner quote.id");
    } else {
      ok("createQuote retourne quote avec id");
    }
    ids.quoteId = data.quote.id;

    if (data.quote.client_id != null) {
      fail("Devis lead-only : client_id doit être null", new Error(`client_id=${data.quote.client_id}`));
    } else {
      ok("quote.client_id est null (lead-only)");
    }
    if (data.quote.lead_id !== leadId) {
      fail("quote.lead_id doit être le lead créé", new Error(`lead_id=${data.quote.lead_id}`));
    } else {
      ok("quote.lead_id renseigné");
    }
    if (data.quote.study_id !== studyId) {
      fail("quote.study_id doit être l'étude créée");
    } else {
      ok("quote.study_id renseigné");
    }
    if (!data.items || data.items.length === 0) {
      fail("createQuote doit retourner au moins une ligne");
    } else {
      ok("lignes devis présentes", String(data.items.length));
    }

    const getQuote = await quoteService.getQuoteById(data.quote.id, orgId);
    if (!getQuote) {
      fail("getQuoteById doit retourner le devis");
    } else {
      ok("getQuoteById retourne le devis sans client");
    }
    if (getQuote && getQuote.quote.client_id != null) {
      fail("Devis récupéré : client_id doit rester null");
    } else if (getQuote) {
      ok("Devis récupéré : client_id null (affichage PDF possible via customer_snapshot)");
    }

    // --- Test 2 : lead_id seul, sans étude (devis autonome) ---
    const ids2 = await createLeadOnly(orgId);
    const data2 = await quoteService.createQuote(orgId, {
      lead_id: ids2.leadId,
      items: [{ label: "Ligne seule", description: "", quantity: 1, unit_price_ht: 50, tva_rate: 20 }],
    });
    if (!data2?.quote?.id) {
      fail("createQuote lead seul doit retourner quote.id");
    } else {
      ok("createQuote avec lead_id seul (sans study_id)");
    }
    if (data2.quote.study_id != null) {
      fail("lead seul : study_id doit être null", new Error(`study_id=${data2.quote.study_id}`));
    } else {
      ok("quote.study_id est null (pas d'étude requise)");
    }
    if (data2.quote.lead_id !== ids2.leadId) {
      fail("quote.lead_id doit correspondre");
    }
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [data2.quote.id]);
    await pool.query("DELETE FROM quotes WHERE id = $1", [data2.quote.id]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids2.leadId]);
    await pool.query("DELETE FROM addresses WHERE id = $1", [ids2.addressId]);
  } catch (e) {
    console.error(e);
    fail("run", e);
  } finally {
    await cleanup(ids);
  }

  console.log("\n--- Résumé ---");
  console.log("Passed:", passed, "Failed:", failed);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("\n✔ PASS — Create quote without client (lead-only).\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
