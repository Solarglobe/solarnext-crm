/**
 * CP-LEAD-CLIENT-SPLIT-06-LOCK — Tests sécurisation conversion + nettoyage statuts
 *
 * Usage: node scripts/test-cp-lead-client-split-06-lock.js
 * Prérequis: Backend démarré, .env.dev configuré, migrations 1771157000000 et 1771157500000 exécutées
 *
 * Cas couverts :
 * 1. Conversion stage SIGNED → CLIENT, project_status = SIGNE
 * 2. Impossible de remettre CLIENT → LEAD
 * 3. Impossible de modifier pipeline après conversion
 * 4. Impossible de mettre statut projet invalide
 * 5. Non-régression planning (smoke)
 * 6. Non-régression factures (smoke)
 */

import dotenv from "dotenv";
import fetch from "node-fetch";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env.dev"), override: false });

const BASE_URL = process.env.API_URL || "http://localhost:3000";
const results = { passed: 0, failed: 0, total: 0 };

function ok(name, detail = "") {
  results.passed++;
  results.total++;
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  results.failed++;
  results.total++;
  console.log(`❌ ${name}`);
  console.log(`   Erreur: ${error?.message || error}`);
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function api(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {},
  };
}

async function main() {
  console.log("\n=== CP-LEAD-CLIENT-SPLIT-06-LOCK TESTS ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let token;
  const createdIds = { leadId: null, signedStageId: null };

  try {
    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPwd = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";
    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    let orgId = (await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1")).rows[0]?.id;
    if (!orgId) {
      const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", ["SolarGlobe"]);
      orgId = ins.rows[0].id;
      await ensureOrgRolesSeeded(orgId);
    }
    let userId = (await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail])).rows[0]?.id;
    if (!userId) {
      const pwdHash = await hashPassword(adminPwd);
      const ins = await pool.query(
        `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
        [orgId, adminEmail, pwdHash]
      );
      userId = ins.rows[0].id;
    }
    token = await login(adminEmail, adminPwd);

    // Stage avec code=SIGNED (migration 1771157500000)
    const stages = (
      await pool.query(
        "SELECT id, name, code FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC",
        [orgId]
      )
    ).rows;
    const signedStage = stages.find((s) => s.code === "SIGNED" || /signe/i.test((s.name || "").replace(/[éèêë]/g, "e")));
    createdIds.signedStageId = signedStage?.id;

    if (!createdIds.signedStageId) {
      console.log("⚠ Stage SIGNED non trouvé. Exécuter la migration 1771157500000.");
    }

    // 1. Création lead
    console.log("\n1. POST /api/leads (création lead)...");
    const createRes = await api(token, "POST", "/api/leads", {
      first_name: "Lock",
      last_name: "Test06",
      email: "lock-test-06@test.local",
    });
    if (createRes.status !== 201) {
      fail("Création lead", new Error(JSON.stringify(createRes.data)));
    } else {
      createdIds.leadId = createRes.data.id;
      if (createRes.data.project_status != null) {
        fail("project_status NULL pour nouveau lead", new Error(`reçu: ${createRes.data.project_status}`));
      } else {
        ok("Création lead", "project_status=NULL");
      }
    }

    if (!createdIds.leadId) {
      console.log("\nImpossible de continuer sans lead créé.");
      return;
    }

    // 2. Conversion stage SIGNED → CLIENT, project_status = SIGNE
    if (createdIds.signedStageId) {
      console.log("\n2. PATCH /api/leads/:id/stage → Signé (conversion via code)...");
      const signRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}/stage`, {
        stageId: createdIds.signedStageId,
      });
      if (signRes.status !== 200) {
        fail("Passage stage Signé", new Error(JSON.stringify(signRes.data)));
      } else {
        ok("Passage stage Signé");
      }

      const leadAfter = (
        await pool.query("SELECT status, project_status FROM leads WHERE id = $1", [createdIds.leadId])
      ).rows[0];
      if (leadAfter?.status !== "CLIENT") {
        fail("status=CLIENT après Signé", new Error(`reçu: ${leadAfter?.status}`));
      } else {
        ok("status=CLIENT");
      }
      if (leadAfter?.project_status !== "SIGNE") {
        fail("project_status=SIGNE après Signé", new Error(`reçu: ${leadAfter?.project_status}`));
      } else {
        ok("project_status=SIGNE");
      }
    }

    // 3. Impossible de remettre CLIENT → LEAD
    console.log("\n3. PATCH status=LEAD sur CLIENT (doit échouer)...");
    const revertRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, { status: "LEAD" });
    if (revertRes.status === 400 && /remettre|client|lead/i.test(revertRes.data?.error || "")) {
      ok("Impossible de remettre CLIENT → LEAD");
    } else {
      fail("Impossible de remettre CLIENT → LEAD", new Error(`Attendu 400, reçu ${revertRes.status}: ${JSON.stringify(revertRes.data)}`));
    }

    // 4. Impossible de modifier pipeline après conversion
    console.log("\n4. PATCH stage_id sur CLIENT (doit échouer)...");
    const firstStageId = stages[0]?.id;
    if (firstStageId) {
      const stagePatchRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, { stage_id: firstStageId });
      if (stagePatchRes.status === 400 && /pipeline|conversion/i.test(stagePatchRes.data?.error || "")) {
        ok("Impossible de modifier pipeline après conversion");
      } else {
        fail("Impossible de modifier pipeline", new Error(`Attendu 400, reçu ${stagePatchRes.status}: ${JSON.stringify(stagePatchRes.data)}`));
      }
    }

    // 5. Impossible de mettre statut projet invalide
    console.log("\n5. PATCH project_status=PROSPECTION (invalide, doit échouer)...");
    const invalidRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      project_status: "PROSPECTION",
    });
    if (invalidRes.status === 400) {
      ok("project_status invalide rejeté");
    } else {
      fail("project_status invalide rejeté", new Error(`Attendu 400, reçu ${invalidRes.status}`));
    }

    // 6. PATCH project_status=null sur CLIENT (doit échouer)
    console.log("\n6. PATCH project_status=null sur CLIENT (doit échouer)...");
    const nullStatusRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      project_status: null,
    });
    if (nullStatusRes.status === 400 && /obligatoire/i.test(nullStatusRes.data?.error || "")) {
      ok("project_status null rejeté pour CLIENT");
    } else {
      fail("project_status null rejeté", new Error(`Attendu 400, reçu ${nullStatusRes.status}: ${JSON.stringify(nullStatusRes.data)}`));
    }

    // 7. Non-régression planning (smoke)
    console.log("\n7. GET /api/planning/missions (smoke)...");
    const planRes = await api(token, "GET", "/api/planning/missions");
    if (planRes.status === 200 || planRes.status === 404) {
      ok("Non-régression planning");
    } else {
      fail("Planning", new Error(`Status ${planRes.status}`));
    }

    // 8. Non-régression factures (smoke)
    console.log("\n8. GET /api/invoices (smoke)...");
    const invRes = await api(token, "GET", "/api/invoices");
    if (invRes.status === 200 || invRes.status === 404) {
      ok("Non-régression factures");
    } else {
      fail("Factures", new Error(`Status ${invRes.status}`));
    }
  } catch (e) {
    fail("Exception", e);
  } finally {
    if (createdIds.leadId) {
      await pool.query("DELETE FROM lead_activities WHERE lead_id = $1", [createdIds.leadId]);
      await pool.query("DELETE FROM lead_stage_history WHERE lead_id = $1", [createdIds.leadId]);
      await pool.query("DELETE FROM leads WHERE id = $1", [createdIds.leadId]);
    }
    await pool.end();
  }

  console.log(`\n=== Résultat: ${results.passed}/${results.total} passés, ${results.failed} échoués ===\n`);
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
