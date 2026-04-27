/**
 * Concurrence calpinage : transaction + advisory lock + SELECT FOR UPDATE (save / validate / hash).
 *
 * Usage: cd backend && node tests/calpinage-concurrency.integration.test.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { persistGeometryHashForStudyVersion } from "../services/calpinage/calpinageGeometryHash.js";
import { lockCalpinageVersion } from "../services/calpinage/calpinageDataConcurrency.js";
import { withPgRetryOnce } from "../utils/pgRetry.js";

const TEST_PREFIX = "CAL-CONC";
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
     VALUES ($1, $2, 'Test', 'Conc', 'Test Conc', 'conc@test.local', $3) RETURNING id`,
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

/** Simule la partie DB de validate (snapshot + hash) sans createCalpinageSnapshot — même verrou que le controller. */
async function simulateValidateGeometryWrites(studyVersionId, org, snapshotDataUrl) {
  await withPgRetryOnce(() =>
    withTx(pool, async (client) => {
      await lockCalpinageVersion(client, org, studyVersionId);
      const locked = await client.query(
        `SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 FOR UPDATE`,
        [studyVersionId, org]
      );
      if (locked.rows.length === 0) throw new Error("no row");
      await client.query(
        `UPDATE calpinage_data
         SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text))
         WHERE study_version_id = $2 AND organization_id = $3`,
        [snapshotDataUrl, studyVersionId, org]
      );
      await persistGeometryHashForStudyVersion(studyVersionId, org, client);
    })
  );
}

async function testTwoConcurrentSaves() {
  console.log("\n--- Test 1 : deux saves concurrents ---\n");
  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  const orgId =
    orgRes.rows[0]?.id ||
    (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-O1-${Date.now()}`])).rows[0].id;

  const ids = await createTestStudy(orgId);
  const { studyId, versionId, orgId: org } = ids;

  try {
    const SNAP = "data:image/png;base64,CONC1";
    const geom0 = minimalGeometry();
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [org, versionId, JSON.stringify(geom0)]
    );
    await pool.query(
      `UPDATE calpinage_data SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text)) WHERE study_version_id = $2 AND organization_id = $3`,
      [SNAP, versionId, org]
    );
    await persistGeometryHashForStudyVersion(versionId, org);

    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");
    const user = { organizationId: org, organization_id: org };
    const p1 = upsertCalpinage(
      { params: { studyId, versionId: "1" }, body: { geometry_json: { ...minimalGeometry(), tag: "a" }, total_panels: 1 }, user },
      mockRes()
    );
    const p2 = upsertCalpinage(
      { params: { studyId, versionId: "1" }, body: { geometry_json: { ...minimalGeometry(), tag: "b" }, total_panels: 1 }, user },
      mockRes()
    );
    await Promise.all([p1, p2]);

    const g = (await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])).rows[0]
      ?.geometry_json;
    if (!g?.layout_snapshot || g.layout_snapshot !== SNAP) {
      fail("Test1: snapshot préservé après 2 saves concurrents (géom inchangée)", new Error(JSON.stringify(g)));
    } else {
      ok("Test1: snapshot préservé après 2 saves concurrents");
    }
  } finally {
    await cleanup(ids);
  }
}

async function testSaveAndValidateConcurrent() {
  console.log("\n--- Test 2 : save + écriture type validate (snapshot+hash) concurrents ---\n");
  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  const orgId =
    orgRes.rows[0]?.id ||
    (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-O2-${Date.now()}`])).rows[0].id;

  const ids = await createTestStudy(orgId);
  const { studyId, versionId, orgId: org } = ids;

  try {
    const geom0 = minimalGeometry();
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [org, versionId, JSON.stringify(geom0)]
    );
    await persistGeometryHashForStudyVersion(versionId, org);

    const SNAP2 = "data:image/png;base64,CONC_VALIDATE_PARALLEL";
    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");
    const user = { organizationId: org, organization_id: org };

    await Promise.all([
      upsertCalpinage(
        {
          params: { studyId, versionId: "1" },
          body: { geometry_json: { ...minimalGeometry(), note: "save-parallel" }, total_panels: 1 },
          user,
        },
        mockRes()
      ),
      simulateValidateGeometryWrites(versionId, org, SNAP2),
    ]);

    const g = (await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])).rows[0]
      ?.geometry_json;
    const hasSnap = typeof g?.layout_snapshot === "string" && g.layout_snapshot.length > 0;
    const hasHash = typeof g?.geometry_hash === "string" && g.geometry_hash.length === 64;
    if (!hasSnap || !hasHash) {
      fail("Test2: layout_snapshot et geometry_hash présents après concurrence", new Error(JSON.stringify(g)));
    } else {
      ok("Test2: état final cohérent (snapshot + hash)");
    }
  } finally {
    await cleanup(ids);
  }
}

async function testGeometryChangeConcurrent() {
  console.log("\n--- Test 3 : modif géométrie + save concurrent ---\n");
  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  const orgId =
    orgRes.rows[0]?.id ||
    (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-O3-${Date.now()}`])).rows[0].id;

  const ids = await createTestStudy(orgId);
  const { studyId, versionId, orgId: org } = ids;

  try {
    const geom0 = minimalGeometry();
    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [org, versionId, JSON.stringify(geom0)]
    );
    await pool.query(
      `UPDATE calpinage_data SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{layout_snapshot}', to_jsonb($1::text)) WHERE study_version_id = $2 AND organization_id = $3`,
      ["data:image/png;base64,OLD", versionId, org]
    );
    await persistGeometryHashForStudyVersion(versionId, org);

    const geomChanged = minimalGeometry({
      validatedRoofData: {
        pans: [{ id: "P1", orientationDeg: 0, tiltDeg: 30, surfaceM2: 50 }],
        scale: 1,
        north: 0,
      },
    });
    const geomSame = { ...minimalGeometry(), clientTag: "merge" };

    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");
    const user = { organizationId: org, organization_id: org };

    await Promise.all([
      upsertCalpinage(
        { params: { studyId, versionId: "1" }, body: { geometry_json: geomChanged, total_panels: 1 }, user },
        mockRes()
      ),
      upsertCalpinage(
        { params: { studyId, versionId: "1" }, body: { geometry_json: geomSame, total_panels: 1 }, user },
        mockRes()
      ),
    ]);

    const g = (await pool.query(`SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`, [versionId])).rows[0]
      ?.geometry_json;
    if (g?.layout_snapshot != null) {
      fail("Test3: aucun vieux snapshot réinjecté après modif géométrique concurrente", new Error(JSON.stringify(g)));
    } else {
      ok("Test3: snapshot absent après concurrence (invalidation)");
    }
  } finally {
    await cleanup(ids);
  }
}

async function testFirstInsertConcurrent() {
  console.log("\n--- Test 4 : première insertion concurrente ---\n");
  const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  const orgId =
    orgRes.rows[0]?.id ||
    (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-O4-${Date.now()}`])).rows[0].id;

  const ids = await createTestStudy(orgId);
  const { studyId, versionId, orgId: org } = ids;

  try {
    const { upsertCalpinage } = await import("../controllers/calpinage.controller.js");
    const user = { organizationId: org, organization_id: org };
    const g1 = minimalGeometry({ fork: "x" });
    const g2 = minimalGeometry({ fork: "y" });

    await Promise.all([
      upsertCalpinage({ params: { studyId, versionId: "1" }, body: { geometry_json: g1, total_panels: 1 }, user }, mockRes()),
      upsertCalpinage({ params: { studyId, versionId: "1" }, body: { geometry_json: g2, total_panels: 1 }, user }, mockRes()),
    ]);

    const cnt = (
      await pool.query(`SELECT COUNT(*)::int AS c FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`, [
        versionId,
        org,
      ])
    ).rows[0]?.c;
    if (cnt !== 1) {
      fail("Test4: une seule ligne calpinage_data", new Error(String(cnt)));
    } else {
      ok("Test4: unicité de la ligne après inserts concurrents");
    }
  } finally {
    await cleanup(ids);
  }
}

async function testPgRetryOnce() {
  console.log("\n--- Test 5 : withPgRetryOnce (max 2 tentatives) ---\n");
  let attempts = 0;
  const out = await withPgRetryOnce(async () => {
    attempts++;
    if (attempts === 1) {
      const e = new Error("deadlock");
      e.code = "40P01";
      throw e;
    }
    return "ok";
  });
  if (out !== "ok" || attempts !== 2) {
    fail("Test5: retry une fois sur 40P01", new Error(`attempts=${attempts} out=${out}`));
  } else {
    ok("Test5: une retry puis succès");
  }

  let attempts2 = 0;
  try {
    await withPgRetryOnce(
      async () => {
        attempts2++;
        const e = new Error("deadlock");
        e.code = "40P01";
        throw e;
      },
      { maxAttempts: 2 }
    );
    fail("Test5b: doit échouer après 2 échecs", new Error());
  } catch (e) {
    if (e.code === "40P01" && attempts2 === 2) {
      ok("Test5b: pas de boucle infinie (2 échecs → throw)");
    } else {
      fail("Test5b: comportement attendu", e);
    }
  }
}

async function run() {
  console.log("\n=== Calpinage concurrence (intégration) ===\n");
  try {
    await testTwoConcurrentSaves();
    await testSaveAndValidateConcurrent();
    await testGeometryChangeConcurrent();
    await testFirstInsertConcurrent();
    await testPgRetryOnce();
  } catch (e) {
    console.error(e);
    fail("run", e);
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
