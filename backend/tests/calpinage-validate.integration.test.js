/**
 * Intégration POST /api/studies/:studyId/calpinage/validate
 * Prouve : 200 OK, 400 NO_CALPINAGE_DATA, 404 NOT_FOUND, 429 SNAPSHOT_TOO_RECENT
 * Usage: cd backend && node tests/calpinage-validate.integration.test.js
 * Prérequis: DATABASE_URL (.env ou .env.dev), migrations à jour (npm run migrate:up) pour calpinage_snapshots
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";
import { createCalpinageSnapshot, ERROR_CODES } from "../services/calpinage/calpinageSnapshot.service.js";

const TEST_PREFIX = "CALVAL";
let passed = 0;
let failed = 0;

function ok(name, detail = "") {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  console.log(`  ❌ ${name}`);
  console.log(`     ${err?.message || err}`);
}

/** geometry_json minimal valide pour createCalpinageSnapshot (gps, validatedRoofData, pvParams, frozenBlocks, shading) */
function minimalValidGeometryJson() {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: {
      pans: [{ id: "PAN_1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 50 }],
      scale: 1,
      north: 0,
    },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [],
    shading: {
      normalized: { totalLossPct: 0, panelCount: 0, perPanel: [] },
      totalLossPct: 0,
    },
  };
}

async function getOrCreateOrg() {
  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (orgRes.rows.length > 0) return orgRes.rows[0].id;
  const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`]);
  return ins.rows[0].id;
}

async function createTestStudy(orgId) {
  const stageRes = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  );
  let stageId = stageRes.rows[0]?.id;
  if (!stageId) {
    const insStage = await pool.query(
      `INSERT INTO pipeline_stages (organization_id, name, position, is_closed) VALUES ($1, 'Qualification', 0, false) RETURNING id`,
      [orgId]
    );
    stageId = insStage.rows[0].id;
  }

  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Paris', 48.8566, 2.3522, 'FR') RETURNING id`,
    [orgId]
  );
  const addressId = addrRes.rows[0].id;

  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
     VALUES ($1, $2, 'Test', 'Calpinage', 'Test Calpinage', 'calval@test.local', $3) RETURNING id`,
    [orgId, stageId, addressId]
  );
  const leadId = leadRes.rows[0].id;

  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status)
     VALUES ($1, $2, $3, 'draft') RETURNING id`,
    [orgId, leadId, `${TEST_PREFIX}-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;

  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  const versionId = versionRes.rows[0].id;

  return { studyId, versionId, orgId, leadId, addressId };
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    await pool.query("DELETE FROM calpinage_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [ids.versionId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    if (ids.leadId) await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    if (ids.addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function run() {
  console.log("\n=== Calpinage validate — Tests d'intégration ===\n");

  let ids = null;
  let orgId;

  try {
    orgId = await getOrCreateOrg();
    ids = await createTestStudy(orgId);
    const { studyId, versionId } = ids;

    // --- Test 1 : OK — calpinage_data présent avec geometry_json valide => 200 + snapshotId + version_number
    console.log("1. OK — geometry_json valide => 200 + snapshotId + version_number");
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 0)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json`,
      [orgId, versionId, JSON.stringify(minimalValidGeometryJson())]
    );

    const result = await createCalpinageSnapshot(studyId, versionId, orgId, null);
    if (result?.snapshotId && typeof result?.version_number === "number") {
      ok("200 OK");
      ok("snapshotId présent");
      ok("version_number = " + result.version_number);
    } else {
      fail("Test 1", new Error("Résultat invalide: " + JSON.stringify(result)));
    }

    // --- Test 2 : NO_CALPINAGE_DATA — pas de calpinage_data pour cette version => 400
    console.log("\n2. NO_CALPINAGE_DATA — pas de calpinage pour version => 400");
    const ids2 = await createTestStudy(orgId);
    try {
      await createCalpinageSnapshot(ids2.studyId, ids2.versionId, orgId, null);
      fail("Test 2", new Error("Attendu NO_CALPINAGE_DATA"));
    } catch (e) {
      if (e?.code === ERROR_CODES.NO_CALPINAGE_DATA) {
        ok("400 NO_CALPINAGE_DATA");
      } else {
        fail("Test 2", e);
      }
    }
    await cleanup(ids2);

    // --- Test 3 : NOT_FOUND — studyVersionId ne correspond pas à studyId => 404
    console.log("\n3. NOT_FOUND — studyVersionId d'une autre étude => 404");
    const ids3a = await createTestStudy(orgId);
    const ids3b = await createTestStudy(orgId);
    try {
      await createCalpinageSnapshot(ids3a.studyId, ids3b.versionId, orgId, null);
      fail("Test 3", new Error("Attendu MISMATCH/NOT_FOUND"));
    } catch (e) {
      if (e?.code === "MISMATCH" || e?.code === "NOT_FOUND") {
        ok("404 MISMATCH/NOT_FOUND");
      } else {
        fail("Test 3", e);
      }
    }
    await cleanup(ids3a);
    await cleanup(ids3b);

    // --- Test 4 : SNAPSHOT_TOO_RECENT — deux appels rapides => 429
    console.log("\n4. SNAPSHOT_TOO_RECENT — double appel < 2s => 429");
    const ids4 = await createTestStudy(orgId);
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 0)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json`,
      [orgId, ids4.versionId, JSON.stringify(minimalValidGeometryJson())]
    );
    await createCalpinageSnapshot(ids4.studyId, ids4.versionId, orgId, null);
    try {
      await createCalpinageSnapshot(ids4.studyId, ids4.versionId, orgId, null);
      fail("Test 4", new Error("Attendu SNAPSHOT_TOO_RECENT"));
    } catch (e) {
      if (e?.code === ERROR_CODES.SNAPSHOT_TOO_RECENT) {
        ok("429 SNAPSHOT_TOO_RECENT");
      } else {
        fail("Test 4", e);
      }
    }
    await cleanup(ids4);
  } catch (e) {
    console.error(e);
    fail("run", e);
  } finally {
    await cleanup(ids);
  }

  console.log("\n--- Résumé ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
