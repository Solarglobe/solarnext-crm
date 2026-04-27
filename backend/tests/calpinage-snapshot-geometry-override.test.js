/**
 * Snapshot versionné : geometryJson override (pas de relecture post-commit du JSON calpinage pour le payload).
 *
 * Usage: cd backend && node tests/calpinage-snapshot-geometry-override.test.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { createCalpinageSnapshot } from "../services/calpinage/calpinageSnapshot.service.js";
import { computeCalpinageGeometryHash } from "../services/calpinage/calpinageGeometryHash.js";
import { persistGeometryHashForStudyVersion } from "../services/calpinage/calpinageGeometryHash.js";

const TEST_PREFIX = "CAL-SNAP-OVERRIDE";
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
  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
     VALUES ($1, $2, 'Test', 'SnapOv', 'Test SnapOv', 'snapov@test.local', $3) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id]
  );
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
    [orgId, leadRes.rows[0].id, `${TEST_PREFIX}-${Date.now()}`]
  );
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json) VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyRes.rows[0].id]
  );
  return {
    studyId: studyRes.rows[0].id,
    versionId: versionRes.rows[0].id,
    orgId,
    leadId: leadRes.rows[0].id,
    addressId: addrRes.rows[0].id,
  };
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    await pool.query("DELETE FROM calpinage_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [ids.versionId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function seedCalpinage(org, versionId) {
  const g = minimalValidGeometryJson();
  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
     VALUES ($1, $2, $3::jsonb, 1)
     ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
    [org, versionId, JSON.stringify(g)]
  );
  await pool.query(
    `UPDATE calpinage_data SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text))
     WHERE study_version_id = $2 AND organization_id = $3`,
    ["data:image/png;base64,VALIDATED", versionId, org]
  );
  await persistGeometryHashForStudyVersion(versionId, org);
  const row = await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`, [
    versionId,
    org,
  ]);
  let committedGeometryJson = row.rows[0].geometry_json;
  if (typeof committedGeometryJson === "string") committedGeometryJson = JSON.parse(committedGeometryJson);
  return committedGeometryJson;
}

async function run() {
  console.log("\n=== Calpinage snapshot geometryJson override ===\n");

  const orgId = await getOrCreateOrg();
  const idsA = await createTestStudy(orgId);
  const idsB = await createTestStudy(orgId);

  try {
    const { studyId: studyIdA, versionId: versionIdA, orgId: orgA } = idsA;
    const { studyId: studyIdB, versionId: versionIdB, orgId: orgB } = idsB;

    const committedGeometryJson = await seedCalpinage(orgA, versionIdA);

    // --- Test 1 : après snapshot versionné avec override, modifier calpinage_data → le payload versionné reste l’état validé
    const result = await createCalpinageSnapshot(studyIdA, versionIdA, orgA, null, { geometryJson: committedGeometryJson });
    if (!result?.snapshotId) {
      fail("Test1: snapshot créé avec override", new Error(JSON.stringify(result)));
    }

    const gMutated = {
      ...minimalValidGeometryJson(),
      validatedRoofData: {
        pans: [{ id: "PAN_X", orientationDeg: 0, tiltDeg: 30, surfaceM2: 99 }],
        scale: 1,
        north: 0,
      },
    };
    await pool.query(`UPDATE calpinage_data SET geometry_json = $1::jsonb WHERE study_version_id = $2 AND organization_id = $3`, [
      JSON.stringify(gMutated),
      versionIdA,
      orgA,
    ]);

    const snapRow = await pool.query(`SELECT snapshot_json FROM calpinage_snapshots WHERE id = $1`, [result.snapshotId]);
    const payload = snapRow.rows[0]?.snapshot_json?.payload;
    const hashPayload = computeCalpinageGeometryHash(payload);
    const hashCommitted = computeCalpinageGeometryHash(committedGeometryJson);
    if (hashPayload !== hashCommitted || payload?.validatedRoofData?.pans?.[0]?.id !== "PAN_1") {
      fail("Test1: payload versionné = géométrie au moment validate (pas la DB mutée après)", new Error(JSON.stringify(payload)));
    } else {
      ok("Test1: snapshot versionné figé sur la géométrie validée (ignore drift DB ultérieur)");
    }

    // --- Test 2 : geometry_hash du payload = hash recalculé (cohérence)
    const storedHash = committedGeometryJson.geometry_hash;
    if (storedHash !== computeCalpinageGeometryHash(committedGeometryJson)) {
      fail("Test2: hash stocké cohérent", new Error());
    } else {
      ok("Test2: geometry_hash cohérent avec le payload validé");
    }

    // --- Test 3 & 4 : autre étude — pas de SNAPSHOT_TOO_RECENT ; legacy sans override
    const committedB = await seedCalpinage(orgB, versionIdB);
    const resultLegacy = await createCalpinageSnapshot(studyIdB, versionIdB, orgB, null);
    if (!resultLegacy?.snapshotId) {
      fail("Test3: legacy sans options", new Error());
    } else {
      ok("Test3: createCalpinageSnapshot sans geometryJson → lecture DB (compat)");
    }

    const snap2 = await pool.query(`SELECT snapshot_json FROM calpinage_snapshots WHERE id = $1`, [resultLegacy.snapshotId]);
    const storedPayload = snap2.rows[0]?.snapshot_json?.payload;
    const expectedRoundTrip = JSON.parse(JSON.stringify(committedB));
    if (JSON.stringify(storedPayload) !== JSON.stringify(expectedRoundTrip)) {
      fail("Test4: payload stocké = copie profonde attendue", new Error());
    } else {
      ok("Test4: payload snapshot_json aligné sur geometry_json lu en base (legacy)");
    }
  } catch (e) {
    console.error(e);
    fail("run", e);
  } finally {
    await cleanup(idsA);
    await cleanup(idsB);
  }

  console.log("\n--- Résumé ---");
  console.log("Passed:", passed, "Failed:", failed);
  if (failed > 0) process.exit(1);
  console.log("\n✔ PASS\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
