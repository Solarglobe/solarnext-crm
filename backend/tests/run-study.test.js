/**
 * Tests run-study : validation (erreurs explicites) et appel calc.
 * POST /api/studies/:studyId/versions/:versionId/run-study
 * Usage: cd backend && node tests/run-study.test.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { runStudy } from "../controllers/runStudy.controller.js";

const TEST_PREFIX = "RUNSTUDY";
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

function mockReqRes(studyId, versionId, orgId) {
  const captured = { statusCode: null, body: null };
  const req = {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(data) {
      captured.body = data;
      return res;
    },
  };
  return { req, res, captured };
}

async function createMinimalStudyNoLead(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status) VALUES ($1, $2, 'draft') RETURNING id`,
    [orgId, `${TEST_PREFIX}-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json) VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

async function createStudyWithLeadNoAddress(orgId) {
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
  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, full_name, email, consumption_mode, consumption_annual_kwh)
     VALUES ($1, $2, 'Test', 't@test.local', 'ANNUAL', 5000) RETURNING id`,
    [orgId, stageId]
  );
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
    [orgId, leadRes.rows[0].id, `${TEST_PREFIX}-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json) VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  return { studyId, versionId: versionRes.rows[0].id, leadId: leadRes.rows[0].id };
}

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
    [`${TEST_PREFIX}-Org-${Date.now()}`]
  );
  return ins.rows[0].id;
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    if (ids.leadId) await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    if (ids.addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function run() {
  console.log("\n=== Run-study: validation (cas d'erreur) ===\n");

  const orgId = await getOrCreateOrg();

  try {
    // ——— Erreur: étude sans lead ———
    const noLead = await createMinimalStudyNoLead(orgId);
    const { req: req1, res: res1, captured: cap1 } = mockReqRes(noLead.studyId, noLead.versionId, orgId);
    await runStudy(req1, res1);
    if (cap1.statusCode !== 400) fail("Sans lead: 400", `got ${cap1.statusCode}`);
    else ok("Sans lead: 400");
    if (!cap1.body?.error?.includes("lead")) fail("Sans lead: message explicite", cap1.body?.error);
    else ok("Sans lead: message explicite");
    await cleanup(noLead);

    // ——— Erreur: lead sans adresse / lat-lon ———
    const noAddr = await createStudyWithLeadNoAddress(orgId);
    const { req: req2, res: res2, captured: cap2 } = mockReqRes(noAddr.studyId, noAddr.versionId, orgId);
    await runStudy(req2, res2);
    if (cap2.statusCode !== 400) fail("Lead sans adresse: 400", `got ${cap2.statusCode}`);
    else ok("Lead sans adresse: 400");
    if (!cap2.body?.error) fail("Lead sans adresse: error dans body", JSON.stringify(cap2.body));
    else ok("Lead sans adresse: message explicite");
    await cleanup(noAddr);

    // ——— Erreur: version inexistante ———
    const for404 = await createMinimalStudyNoLead(orgId);
    const fakeVersionId = "00000000-0000-0000-0000-000000000000";
    const { req: req3, res: res3, captured: cap3 } = mockReqRes(for404.studyId, fakeVersionId, orgId);
    await runStudy(req3, res3);
    if (cap3.statusCode !== 404) fail("Version inexistante: 404", `got ${cap3.statusCode}`);
    else ok("Version inexistante: 404");
    await cleanup(for404);
  } catch (e) {
    console.error(e);
    fail("run", e);
  }

  console.log(`\n  Résultat: ${passed} passés, ${failed} échoués\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
