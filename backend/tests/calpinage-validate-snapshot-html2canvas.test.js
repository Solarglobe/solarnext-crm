/**
 * Test : validation avec layout_snapshot_base64 (html2canvas frontend).
 * Vérifie que le snapshot est stocké dans geometry_json.layout_snapshot.
 * Playwright n'est plus utilisé pour la validation.
 *
 * Usage: cd backend && node tests/calpinage-validate-snapshot-html2canvas.test.js
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

const TEST_PREFIX = "CALVAL-HTML2CANVAS";
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
     VALUES ($1, $2, 'Test', 'Html2Canvas', 'Test Html2Canvas', 'html2canvas@test.local', $3) RETURNING id`,
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

async function run() {
  console.log("\n=== Calpinage validate — layout_snapshot_base64 (html2canvas) ===\n");

  let ids = null;

  try {
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    const orgId =
      orgRes.rows[0]?.id ||
      (await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${TEST_PREFIX}-Org-${Date.now()}`])).rows[0].id;

    ids = await createTestStudy(orgId);
    const { studyId, versionId } = ids;

    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [orgId, versionId, JSON.stringify(minimalGeometry())]
    );

    const layoutSnapshotBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const req = {
      params: { studyId },
      body: { studyVersionId: versionId, layout_snapshot_base64: layoutSnapshotBase64 },
      query: {},
      user: { organizationId: orgId, organization_id: orgId, id: null, userId: null },
    };
    const res = mockRes();

    const { validateCalpinage } = await import("../controllers/calpinageValidate.controller.js");
    await validateCalpinage(req, res);

    const { statusCode, body } = res.getResult();

    if (statusCode !== 200) {
      fail("Doit retourner 200", new Error(`status=${statusCode} body=${JSON.stringify(body)}`));
    } else {
      ok("200 retourné");
    }

    const calpinageRes = await pool.query(
      `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`,
      [versionId]
    );
    const layoutSnapshot = calpinageRes.rows[0]?.geometry_json?.layout_snapshot;

    if (!layoutSnapshot || !layoutSnapshot.startsWith("data:image/png;base64,")) {
      fail("layout_snapshot doit être présent dans geometry_json", new Error(JSON.stringify(calpinageRes.rows[0])));
    } else {
      ok("layout_snapshot stocké dans geometry_json");
    }

    const snapRes = await pool.query("SELECT id FROM calpinage_snapshots WHERE study_id = $1", [studyId]);
    if (snapRes.rows.length === 0) {
      fail("calpinage_snapshot doit être créé");
    } else {
      ok("calpinage_snapshot créé");
    }
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
  console.log("\n✔ PASS — Validation avec html2canvas, Playwright non utilisé.\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
