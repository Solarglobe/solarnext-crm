/**
 * geometry_hash + layout_snapshot — cohérence après validate / save.
 *
 * Usage: cd backend && node tests/calpinage-geometry-hash-snapshot.test.js
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
import { computeCalpinageGeometryHash, persistGeometryHashForStudyVersion } from "../services/calpinage/calpinageGeometryHash.js";

const TEST_PREFIX = "CAL-GEOM-HASH";
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

function minimalGeometry(overrides = {}) {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: {
      pans: [{ id: "P1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 50 }],
      scale: 1,
      north: 0,
    },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [],
    shading: null,
    ...overrides,
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
     VALUES ($1, $2, 'Test', 'GeomHash', 'Test GeomHash', 'geomhash@test.local', $3) RETURNING id`,
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

async function readGeom(versionId) {
  const r = await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId]);
  return r.rows[0]?.geometry_json;
}

async function run() {
  console.log("\n=== Calpinage geometry_hash + layout_snapshot ===\n");

  // --- Test 5 (unit) : stabilité du hash ---
  console.log("--- Hash stable / sensible ---\n");
  const g1 = minimalGeometry();
  const g2 = minimalGeometry();
  const h1 = computeCalpinageGeometryHash(g1);
  const h2 = computeCalpinageGeometryHash(g2);
  if (h1 !== h2 || h1.length !== 64) {
    fail("Test5a: même géométrie → même hash (sha256 hex)", new Error(`${h1} vs ${h2}`));
  } else {
    ok("Test5a: même géométrie → même hash");
  }

  const g3 = minimalGeometry({
    validatedRoofData: {
      pans: [{ id: "P1", orientationDeg: 90, tiltDeg: 30, surfaceM2: 50 }],
      scale: 1,
      north: 0,
    },
  });
  const h3 = computeCalpinageGeometryHash(g3);
  if (h3 === h1) {
    fail("Test5b: géométrie différente → hash différent", new Error(h3));
  } else {
    ok("Test5b: géométrie différente → hash différent");
  }

  const gOrder = { frozenBlocks: [], validatedRoofData: g1.validatedRoofData, roofState: g1.roofState, gps: g1.gps, pvParams: g1.pvParams };
  if (computeCalpinageGeometryHash(gOrder) !== h1) {
    fail("Test5c: ordre des clés différent → même hash", new Error());
  } else {
    ok("Test5c: ordre des clés différent → même hash (normalisation)");
  }

  // --- Intégration ---
  let ids = null;
  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    const orgId =
      orgRes.rows[0]?.id ||
      (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`]))
        .rows[0].id;

    ids = await createTestStudy(orgId);
    const { studyId, versionId, orgId: org } = ids;

    const SNAP = "data:image/png;base64,VALIDATE_SNAP";
    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");

    // Test 1 — validate (simulé) : snapshot + hash
    const geom0 = minimalGeometry();
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [org, versionId, JSON.stringify(geom0)]
    );
    await pool.query(
      `UPDATE calpinage_data
       SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text))
       WHERE study_version_id = $2 AND organization_id = $3`,
      [SNAP, versionId, org]
    );
    await persistGeometryHashForStudyVersion(versionId, org);

    let g = await readGeom(versionId);
    if (!g?.layout_snapshot || g.layout_snapshot !== SNAP || !g.geometry_hash) {
      fail("Test1: après validate simulé → snapshot + geometry_hash présents", new Error(JSON.stringify(g)));
    } else {
      ok("Test1: après validate simulé → snapshot + geometry_hash présents");
    }

    // Test 2 — save sans modification : snapshot conservé
    const geomSave = { ...minimalGeometry(), note: "client-meta" };
    delete geomSave.layout_snapshot;
    const req = {
      params: { studyId, versionId: "1" },
      body: { geometry_json: geomSave, total_panels: 1 },
      user: { organizationId: org, organization_id: org },
    };
    await upsertCalpinage(req, mockRes());
    g = await readGeom(versionId);
    if (g?.layout_snapshot !== SNAP || !g.geometry_hash) {
      fail("Test2: save sans modif géométrique → snapshot + hash conservés", new Error(JSON.stringify(g)));
    } else {
      ok("Test2: save sans modif géométrique → snapshot + hash conservés");
    }

    // Test 3 — save avec modification géométrique : snapshot supprimé
    const geomChanged = minimalGeometry({
      validatedRoofData: {
        pans: [{ id: "P1", orientationDeg: 0, tiltDeg: 30, surfaceM2: 50 }],
        scale: 1,
        north: 0,
      },
    });
    const req3 = {
      params: { studyId, versionId: "1" },
      body: { geometry_json: geomChanged, total_panels: 1 },
      user: { organizationId: org, organization_id: org },
    };
    await upsertCalpinage(req3, mockRes());
    g = await readGeom(versionId);
    if (g?.layout_snapshot != null || g?.geometry_hash != null) {
      fail("Test3: save avec modif → snapshot et geometry_hash absents", new Error(JSON.stringify(g)));
    } else {
      ok("Test3: save avec modif → snapshot et geometry_hash supprimés");
    }

    // Test 4 — revalidate : nouveau snapshot + hash
    await pool.query(
      `UPDATE calpinage_data
       SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text))
       WHERE study_version_id = $2 AND organization_id = $3`,
      ["data:image/png;base64,REVALIDATE", versionId, org]
    );
    await persistGeometryHashForStudyVersion(versionId, org);
    g = await readGeom(versionId);
    if (g?.layout_snapshot !== "data:image/png;base64,REVALIDATE" || !g.geometry_hash) {
      fail("Test4: revalidate → nouveau snapshot + geometry_hash", new Error(JSON.stringify(g)));
    } else {
      ok("Test4: revalidate → nouveau snapshot + geometry_hash");
    }
  } catch (e) {
    console.error(e);
    fail("integration", e);
  } finally {
    await cleanup(ids);
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
