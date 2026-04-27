/**
 * PDF V2 — Tests GET /api/studies/:studyId/versions/:versionId/selected-scenario-snapshot
 * 1) Snapshot présent → 200, ok=true, snapshot objet non vide
 * 2) Snapshot absent → 404 SNAPSHOT_NOT_FOUND
 * 3) Étude/version inexistante → 404 STUDY_VERSION_NOT_FOUND
 * 4) Cross organisation → 403 FORBIDDEN_CROSS_ORG
 *
 * Usage: cd backend && node scripts/test-read-selected-snapshot.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { getSelectedScenarioSnapshot } from "../controllers/getSelectedScenarioSnapshot.controller.js";

function mockReq(studyId, versionId, orgId) {
  return {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };
}

function mockRes() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    res: {
      status(code) {
        captured.statusCode = code;
        return this;
      },
      json(data) {
        captured.body = data;
        return this;
      },
    },
  };
}

async function getOrCreateOrg(label = "A") {
  const r = await pool.query(
    "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"
  );
  if (r.rows.length > 0 && label === "A") return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [`Test Read Snapshot ${label}-${Date.now()}`]
  );
  return ins.rows[0].id;
}

async function createStudyWithVersion(orgId, withSnapshot = true) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `READ-SNAP-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const snapshotJson = withSnapshot
    ? JSON.stringify({
        scenario_type: "BASE",
        created_at: new Date().toISOString(),
        client: { nom: "Test", prenom: "User" },
        site: {},
        installation: {},
        equipment: {},
        shading: {},
        energy: {},
        finance: {},
        production: {},
        cashflows: [],
        assumptions: {},
      })
    : null;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked)
     VALUES ($1, $2, 1, '{}'::jsonb, $3, $4::jsonb, $5) RETURNING id`,
    [orgId, studyId, withSnapshot ? "BASE" : null, snapshotJson, withSnapshot]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env ou .env.dev)");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  let studyIdWithSnapshot, versionIdWithSnapshot, studyIdNoSnapshot, versionIdNoSnapshot;
  let orgIdA, orgIdB, studyIdB, versionIdB;

  try {
    orgIdA = await getOrCreateOrg("A");
    const createdWith = await createStudyWithVersion(orgIdA, true);
    studyIdWithSnapshot = createdWith.studyId;
    versionIdWithSnapshot = createdWith.versionId;

    const createdWithout = await createStudyWithVersion(orgIdA, false);
    studyIdNoSnapshot = createdWithout.studyId;
    versionIdNoSnapshot = createdWithout.versionId;

    orgIdB = await getOrCreateOrg("B");
    const createdB = await createStudyWithVersion(orgIdB, true);
    studyIdB = createdB.studyId;
    versionIdB = createdB.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— 1) Snapshot présent ———
  try {
    const { res, captured } = mockRes();
    await getSelectedScenarioSnapshot(
      mockReq(studyIdWithSnapshot, versionIdWithSnapshot, orgIdA),
      res
    );
    if (
      captured.statusCode === 200 &&
      captured.body?.ok === true &&
      typeof captured.body?.snapshot === "object" &&
      captured.body.snapshot !== null &&
      Object.keys(captured.body.snapshot).length > 0
    ) {
      passed++;
      console.log("TEST PASSED — 1) Snapshot présent : 200, ok=true, snapshot objet non vide");
    } else {
      failed++;
      console.log("TEST FAILED — 1) Snapshot présent. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — 1) Snapshot présent:", e.message);
  }

  // ——— 2) Snapshot absent ———
  try {
    const { res, captured } = mockRes();
    await getSelectedScenarioSnapshot(mockReq(studyIdNoSnapshot, versionIdNoSnapshot, orgIdA), res);
    if (
      captured.statusCode === 404 &&
      captured.body?.ok === false &&
      captured.body?.error === "SNAPSHOT_NOT_FOUND"
    ) {
      passed++;
      console.log("TEST PASSED — 2) Snapshot absent : 404 SNAPSHOT_NOT_FOUND");
    } else {
      failed++;
      console.log("TEST FAILED — 2) Snapshot absent. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — 2) Snapshot absent:", e.message);
  }

  // ——— 3) Étude/version inexistante ———
  try {
    const fakeId = randomUUID();
    const { res, captured } = mockRes();
    await getSelectedScenarioSnapshot(mockReq(fakeId, fakeId, orgIdA), res);
    if (
      captured.statusCode === 404 &&
      captured.body?.ok === false &&
      captured.body?.error === "STUDY_VERSION_NOT_FOUND"
    ) {
      passed++;
      console.log("TEST PASSED — 3) Version inexistante : 404 STUDY_VERSION_NOT_FOUND");
    } else {
      failed++;
      console.log("TEST FAILED — 3) Version inexistante. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — 3) Version inexistante:", e.message);
  }

  // ——— 4) Cross organisation ———
  try {
    const { res, captured } = mockRes();
    await getSelectedScenarioSnapshot(
      mockReq(studyIdB, versionIdB, orgIdA),
      res
    );
    if (
      captured.statusCode === 403 &&
      captured.body?.ok === false &&
      captured.body?.error === "FORBIDDEN_CROSS_ORG"
    ) {
      passed++;
      console.log("TEST PASSED — 4) Cross organisation : 403 FORBIDDEN_CROSS_ORG");
    } else {
      failed++;
      console.log("TEST FAILED — 4) Cross organisation. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — 4) Cross organisation:", e.message);
  }

  // Nettoyage
  try {
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdWithSnapshot]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdWithSnapshot]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdNoSnapshot]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdNoSnapshot]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdB]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdB]);
  } catch (_) {}

  console.log("\nRésultat :", passed, "passés,", failed, "échoués");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
