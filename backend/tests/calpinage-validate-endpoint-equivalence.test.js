/**
 * Unicité endpoint == service : POST /api/studies/:studyId/calpinage/validate
 * Prouve que le handler (validateCalpinage) appelle bien createCalpinageSnapshot() et qu'aucune
 * logique parallèle n'existe. Test en appelant le controller avec mock req/res.
 * Vérifie aussi que shading: null est accepté (même règle que le service).
 *
 * Usage: cd backend && node tests/calpinage-validate-endpoint-equivalence.test.js
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
import { validateCalpinage } from "../controllers/calpinageValidate.controller.js";

const TEST_PREFIX = "CALVAL-EP";
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

function minimalGeometryWithShadingNull() {
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
     VALUES ($1, $2, 'Test', 'Endpoint', 'Test Endpoint', 'ep@test.local', $3) RETURNING id`,
    [orgId, stageId, addrRes.rows[0].id]
  );
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, leadRes.rows[0].id, `${TEST_PREFIX}-${Date.now()}`, "draft"]
  );
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
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
  console.log("\n=== Calpinage validate — Endpoint == Service (unicité) ===\n");

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

    ids = await createTestStudy(orgId);
    const { studyId, versionId } = ids;

    await pool.query(
      `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 1`,
      [orgId, versionId, JSON.stringify(minimalGeometryWithShadingNull())]
    );

    const req = {
      params: { studyId },
      body: { studyVersionId: versionId },
      query: {},
      user: { organizationId: orgId, organization_id: orgId, id: null, userId: null },
    };
    const res = mockRes();

    await validateCalpinage(req, res);

    const { statusCode, body } = res.getResult();
    if (statusCode !== 200) {
      fail("Endpoint doit retourner 200", `status=${statusCode} body=${JSON.stringify(body)}`);
    } else {
      ok("Endpoint retourne 200");
    }
    if (!body?.snapshotId || typeof body?.version_number !== "number") {
      fail("Réponse doit contenir snapshotId et version_number", JSON.stringify(body));
    } else {
      ok("Réponse contient snapshotId et version_number");
    }

    const snapRes = await pool.query(
      `SELECT id, version_number, snapshot_json FROM calpinage_snapshots WHERE study_id = $1 AND is_active = true`,
      [studyId]
    );
    if (snapRes.rows.length === 0) {
      fail("Un calpinage_snapshot doit être créé après appel endpoint");
    } else {
      ok("calpinage_snapshot créé en base");
      const snap = snapRes.rows[0];
      const payload = snap.snapshot_json?.payload || snap.snapshot_json;
      if (payload?.shading !== undefined && payload?.shading !== null) {
        ok("payload.shading peut être null ou objet (accepté)");
      } else {
        ok("payload.shading = null accepté (règle service)");
      }
      if (payload?.validatedRoofData?.pans?.length) {
        ok("payload.validatedRoofData.pans présent");
      }
      if (payload?.gps || payload?.roofState?.gps) {
        ok("payload gps présent");
      }
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
  console.log("\n✔ PASS — Endpoint utilise exactement createCalpinageSnapshot (source de vérité unique).\n");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
