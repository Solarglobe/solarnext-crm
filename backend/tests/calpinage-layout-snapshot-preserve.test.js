/**
 * Préservation de geometry_json.layout_snapshot lors des POST calpinage (upsert).
 *
 * Usage: cd backend && node tests/calpinage-layout-snapshot-preserve.test.js
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
import { mergeLayoutSnapshotForUpsert } from "../services/calpinage/mergeGeometryLayoutSnapshot.js";
import { persistGeometryHashForStudyVersion } from "../services/calpinage/calpinageGeometryHash.js";

const TEST_PREFIX = "CAL-LAYOUT-PRESERVE";
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

function minimalGeometry() {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: { pans: [{ id: "P1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 50 }], scale: 1, north: 0 },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [],
    shading: null,
  };
}

async function createTestStudy(orgId) {
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
     VALUES ($1, $2, 'Test', 'LayoutSnap', 'Test LayoutSnap', 'layoutsnap@test.local', $3) RETURNING id`,
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
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [ids.versionId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    getResult: () => out,
  };
}

function testMergeUnit() {
  console.log("\n--- mergeLayoutSnapshotForUpsert (unit) ---\n");

  const OLD = "data:image/png;base64,OLD";
  const NEW = "data:image/png;base64,NEW";

  let m = mergeLayoutSnapshotForUpsert({ a: 1 }, { layout_snapshot: OLD });
  if (m.layout_snapshot !== OLD) fail("préserve OLD si pas de nouveau", new Error(JSON.stringify(m)));
  else ok("préserve OLD si payload sans layout_snapshot");

  m = mergeLayoutSnapshotForUpsert({ a: 1, layout_snapshot: NEW }, { layout_snapshot: OLD });
  if (m.layout_snapshot !== NEW) fail("remplace par NEW si fourni", new Error(JSON.stringify(m)));
  else ok("remplace par NEW si fourni explicitement");

  m = mergeLayoutSnapshotForUpsert({ a: 1 }, null);
  if (m.layout_snapshot != null) fail("n'invente pas sans existant", new Error(JSON.stringify(m)));
  else ok("n'invente pas sans existant");

  m = mergeLayoutSnapshotForUpsert({ a: 1, layout_snapshot: "" }, { layout_snapshot: OLD });
  if (m.layout_snapshot !== OLD) fail("chaîne vide → préserve existant", new Error(JSON.stringify(m)));
  else ok("chaîne vide → préserve existant");
}

async function testIntegration() {
  console.log("\n--- Intégration upsertCalpinage + lecture PDF (même source que pdfViewModel.service) ---\n");

  let ids = null;
  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    const orgId =
      orgRes.rows[0]?.id ||
      (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`]))
        .rows[0].id;

    ids = await createTestStudy(orgId);
    const { studyId, versionId, orgId: org } = ids;

    const SNAP_VALIDATE = "data:image/png;base64,FROM_VALIDATE";

    // 1) calpinage initial en base
    const geom0 = minimalGeometry();
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [org, versionId, JSON.stringify(geom0)]
    );

    // 2) validate : écrit layout_snapshot (comme prod)
    await pool.query(
      `UPDATE calpinage_data
       SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text))
       WHERE study_version_id = $2 AND organization_id = $3`,
      [SNAP_VALIDATE, versionId, org]
    );
    await persistGeometryHashForStudyVersion(versionId, org);

    // 3) save ultérieur SANS snapshot (upsert)
    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");
    const geomSave = { ...minimalGeometry(), note: "after-save" };
    delete geomSave.layout_snapshot;
    const req = {
      params: { studyId, versionId: "1" },
      body: { geometry_json: geomSave, total_panels: 1 },
      user: { organizationId: org, organization_id: org },
    };
    const res = mockRes();
    await upsertCalpinage(req, res);
    const { statusCode, body } = res.getResult();
    if (statusCode !== 200 && !body?.ok) {
      fail("upsert doit réussir", new Error(JSON.stringify({ statusCode, body })));
    } else {
      ok("upsert après validate → 200");
    }

    const after = await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId]);
    const snap = after.rows[0]?.geometry_json?.layout_snapshot;
    if (snap !== SNAP_VALIDATE) {
      fail("Test1: layout_snapshot toujours présent après save sans snapshot", new Error(String(snap)));
    } else {
      ok("Test1: layout_snapshot préservé après save sans snapshot");
    }

    // Test2 : remplacement explicite
    const SNAP_NEW = "data:image/png;base64,BRAND_NEW";
    const req2 = {
      params: { studyId, versionId: "1" },
      body: {
        geometry_json: { ...minimalGeometry(), layout_snapshot: SNAP_NEW },
        total_panels: 1,
      },
      user: { organizationId: org, organization_id: org },
    };
    const res2 = mockRes();
    await upsertCalpinage(req2, res2);
    const snap2 = (
      await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])
    ).rows[0]?.geometry_json?.layout_snapshot;
    if (snap2 !== SNAP_NEW) {
      fail("Test2: nouveau layout_snapshot doit remplacer", new Error(String(snap2)));
    } else {
      ok("Test2: remplacement explicite de layout_snapshot");
    }

    // Test3 : même colonne que pdfViewModel.service (geometry_json.layout_snapshot)
    const g = (
      await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])
    ).rows[0]?.geometry_json;
    if (!g?.layout_snapshot || g.layout_snapshot !== SNAP_NEW) {
      fail("Test3: colonne geometry_json lisible comme PDF", new Error(JSON.stringify(g)));
    } else {
      ok("Test3: geometry_json.layout_snapshot toujours renseigné (source PDF)");
    }

    // Test4 : pas de snapshot initial — autre version / reset
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [versionId]);
    const geomNoSnap = minimalGeometry();
    const req4 = {
      params: { studyId, versionId: "1" },
      body: { geometry_json: geomNoSnap, total_panels: 1 },
      user: { organizationId: org, organization_id: org },
    };
    const res4 = mockRes();
    await upsertCalpinage(req4, res4);
    const g4 = (
      await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])
    ).rows[0]?.geometry_json;
    if (g4?.layout_snapshot) {
      fail("Test4: ne pas inventer layout_snapshot sans existant", new Error(JSON.stringify(g4)));
    } else {
      ok("Test4: pas de layout_snapshot inventé sur première insert sans historique");
    }
  } catch (e) {
    console.error(e);
    fail("integration", e);
  } finally {
    await cleanup(ids);
  }
}

async function run() {
  console.log("\n=== Calpinage layout_snapshot — préservation upsert ===\n");
  testMergeUnit();
  await testIntegration();
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
