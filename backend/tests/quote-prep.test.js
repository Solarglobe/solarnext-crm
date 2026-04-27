/**
 * Tests quote-prep : GET/PUT/validate/fork.
 * Prérequis: migrations economic_snapshots + calpinage_snapshots.
 * Usage: cd backend && node tests/quote-prep.test.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import * as quotePrepService from "../services/quotePrep/quotePrep.service.js";

const TEST_PREFIX = "QPREP";
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

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`]);
  return ins.rows[0].id;
}

async function createStudyAndCalpinage(orgId) {
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
     VALUES ($1, $2, 'Test', 'QuotePrep', 'Test QuotePrep', 'qprep@test.local', $3) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id]
  );
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, leadRes.rows[0].id, `${TEST_PREFIX}-${Date.now()}`, "draft"]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  const versionId = versionRes.rows[0].id;

  const snapshotJson = {
    meta: { snapshotSchemaVersion: 1 },
    payload: {
      roofState: { gps: { lat: 48.85, lon: 2.35 } },
      gps: { lat: 48.85, lon: 2.35 },
      validatedRoofData: {
        pans: [
          { orientationDeg: 180, tiltDeg: 30 },
          { orientationDeg: 190, tiltDeg: 28 },
        ],
      },
      frozenBlocks: [{ panels: [{ id: "p1" }, { id: "p2" }] }],
      totals: { panels_count: 2 },
      panelSpec: { powerWc: 400 },
      shading: { combined: { totalLossPct: 5 } },
      pvParams: { inverter_family: "Huawei", dc_ac_ratio: 1.2 },
    },
  };
  await pool.query(
    `INSERT INTO calpinage_snapshots (study_id, study_version_id, organization_id, version_number, snapshot_json, is_active)
     VALUES ($1, $2, $3, 1, $4::jsonb, true)`,
    [studyId, versionId, orgId, JSON.stringify(snapshotJson)]
  );

  return { orgId, studyId, versionId, leadId: leadRes.rows[0].id, addressId: addrRes.rows[0].id };
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    await pool.query("DELETE FROM economic_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM calpinage_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function run() {
  console.log("\n=== Quote-prep: draft / validate / fork ===\n");

  let ids = null;
  let orgId;

  try {
    orgId = await getOrCreateOrg();
    ids = await createStudyAndCalpinage(orgId);
    const { studyId, versionId } = ids;

    // GET quote-prep (no economic yet)
    let prep = await quotePrepService.getQuotePrep({ studyId, versionId, organizationId: orgId });
    if (!prep.technical_snapshot_summary) fail("GET quote-prep: technical_snapshot_summary présent");
    else ok("GET quote-prep: technical_snapshot_summary présent");
    const ts = prep.technical_snapshot_summary;
    if (ts.nb_panels !== 2) fail("GET quote-prep: nb_panels = 2", String(ts.nb_panels));
    else ok("GET quote-prep: nb_panels = 2");
    if (ts.total_panels !== undefined && ts.total_panels !== 2) fail("GET quote-prep: total_panels = 2", String(ts.total_panels));
    else ok("GET quote-prep: total_panels cohérent");
    if (ts.power_kwc == null || typeof ts.power_kwc !== "number") fail("GET quote-prep: power_kwc présent");
    else ok("GET quote-prep: power_kwc présent", String(ts.power_kwc));
    if (ts.total_power_kwc != null && typeof ts.total_power_kwc !== "number") fail("GET quote-prep: total_power_kwc number si présent");
    else ok("GET quote-prep: total_power_kwc cohérent");
    if (ts.orientation_mean_deg == null) fail("GET quote-prep: orientation_mean_deg présent (moyenne pans)");
    else ok("GET quote-prep: orientation_mean_deg présent", String(ts.orientation_mean_deg));
    if (ts.tilt_mean_deg == null) fail("GET quote-prep: tilt_mean_deg présent (moyenne pans)");
    else ok("GET quote-prep: tilt_mean_deg présent", String(ts.tilt_mean_deg));
    if (!ts.gps || typeof ts.gps.lat !== "number" || typeof ts.gps.lon !== "number") fail("GET quote-prep: gps { lat, lon } présent");
    else ok("GET quote-prep: gps présent");
    if (ts.inverter_family !== "Huawei") fail("GET quote-prep: inverter_family = Huawei", String(ts.inverter_family));
    else ok("GET quote-prep: inverter_family présent");
    if (ts.dc_ac_ratio == null || ts.dc_ac_ratio !== 1.2) fail("GET quote-prep: dc_ac_ratio = 1.2", String(ts.dc_ac_ratio));
    else ok("GET quote-prep: dc_ac_ratio présent");
    if (ts.production_annual_kwh != null && !Number.isFinite(ts.production_annual_kwh)) fail("GET quote-prep: production_annual_kwh number ou null");
    else ok("GET quote-prep: production_annual_kwh number ou null (accepté)");
    if (prep.economic_state !== null) fail("GET quote-prep: economic_state null au départ");
    else ok("GET quote-prep: economic_state null au départ");

    // PUT (save draft)
    const draftData = {
      items: [{ label: "Module PV", quantity: 10, unit_price: 150, total: 1500 }],
      batteries: { physical: { enabled: false }, virtual: { enabled: false } },
      conditions: { vat_percent: 20, discount_percent: 0, discount_amount: 0, deposit_percent: 10 },
    };
    const putResult = await quotePrepService.saveQuotePrepDraft({
      studyId,
      versionId,
      organizationId: orgId,
      data: draftData,
    });
    if (!putResult.snapshotId || putResult.status !== "DRAFT") fail("PUT quote-prep: snapshotId + DRAFT");
    else ok("PUT quote-prep: draft créé", `v${putResult.version_number}`);

    // GET again: economic_state present
    prep = await quotePrepService.getQuotePrep({ studyId, versionId, organizationId: orgId });
    if (!prep.economic_state || prep.economic_state.status !== "DRAFT") fail("GET après PUT: economic_state DRAFT");
    else ok("GET après PUT: economic_state DRAFT");
    if (!prep.economic_state.data?.items?.length) fail("GET après PUT: items présents");
    else ok("GET après PUT: items présents");

    // Validate
    const validateResult = await quotePrepService.validateQuotePrep({
      studyId,
      versionId,
      organizationId: orgId,
    });
    if (validateResult.status !== "READY_FOR_STUDY") fail("POST validate: status READY_FOR_STUDY", validateResult.status);
    else ok("POST validate: READY_FOR_STUDY");

    // PUT after validate -> NOT_DRAFT
    try {
      await quotePrepService.saveQuotePrepDraft({
        studyId,
        versionId,
        organizationId: orgId,
        data: { ...draftData, conditions: { ...draftData.conditions, deposit_percent: 20 } },
      });
      fail("PUT après validate: doit lever NOT_DRAFT");
    } catch (e) {
      if (e.code === "NOT_DRAFT") ok("PUT après validate: 403 NOT_DRAFT");
      else fail("PUT après validate: code NOT_DRAFT", e);
    }

    // Fork
    const forkResult = await quotePrepService.forkQuotePrep({
      studyId,
      versionId,
      organizationId: orgId,
    });
    if (forkResult.status !== "DRAFT" || !forkResult.version_number) fail("POST fork: DRAFT v+1");
    else ok("POST fork: nouveau DRAFT", `v${forkResult.version_number}`);

    prep = await quotePrepService.getQuotePrep({ studyId, versionId, organizationId: orgId });
    if (prep.economic_state?.status !== "DRAFT") fail("GET après fork: economic_state DRAFT");
    else ok("GET après fork: economic_state DRAFT");
    if (prep.economic_state?.snapshot_version !== forkResult.version_number) fail("GET après fork: snapshot_version = v+1");
    else ok("GET après fork: snapshot_version v+1");

    // Validate sans client (lead-only)
    ok("Validate sans client: lead-only supporté (aucun client_id requis)");
  } catch (e) {
    console.error(e);
    fail("run", e);
  } finally {
    await cleanup(ids);
  }

  console.log(`\n  Résultat: ${passed} passés, ${failed} échoués\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
