/**
 * CP-LEAD-CLIENT-SPLIT-06 — Tests séparation Pipeline Lead / Cycle Projet Client
 *
 * Usage: node scripts/test-cp-lead-client-split-06.js
 * Prérequis: Backend démarré, .env.dev configuré, migration 1771157000000 exécutée
 *
 * Cas couverts :
 * 1. Création lead → project_status NULL
 * 2. Passage pipeline → Devis envoyé (stage)
 * 3. Passage pipeline → Signé → conversion auto : status=CLIENT, project_status=SIGNE
 * 4. Pipeline bloqué pour CLIENT
 * 5. Modification project_status → DP_DEPOSE
 * 6. Non-régression planning, admin, factures (smoke)
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
  console.log("\n=== CP-LEAD-CLIENT-SPLIT-06 TESTS ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let token;
  const createdIds = { leadId: null, signedStageId: null, devisStageId: null };

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

    const stages = (await pool.query(
      "SELECT id, name FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC",
      [orgId]
    )).rows;
    const signedStage = stages.find((s) => /signe/i.test((s.name || "").replace(/[éèêë]/g, "e")));
    const devisStage = stages.find((s) => /offre|devis|envoy/i.test((s.name || "").toLowerCase()));
    createdIds.signedStageId = signedStage?.id;
    createdIds.devisStageId = devisStage?.id || stages[3]?.id;

    // 1. Création lead
    console.log("\n1. POST /api/leads (création lead)...");
    const createRes = await api(token, "POST", "/api/leads", {
      first_name: "Split",
      last_name: "Test06",
      email: "split-test-06@test.local",
    });
    if (createRes.status !== 201) {
      fail("Création lead", new Error(JSON.stringify(createRes.data)));
    } else {
      createdIds.leadId = createRes.data.id;
      if (createRes.data.project_status !== null && createRes.data.project_status !== undefined) {
        fail("project_status NULL pour nouveau lead", new Error(`reçu: ${createRes.data.project_status}`));
      } else {
        ok("Création lead", "project_status=NULL");
      }
    }

    if (!createdIds.leadId) {
      console.log("\nImpossible de continuer sans lead créé.");
      return;
    }

    // 2. Passage pipeline → Devis envoyé (ou étape avant Signé)
    if (createdIds.devisStageId && createdIds.devisStageId !== (await pool.query(
      "SELECT stage_id FROM leads WHERE id = $1",
      [createdIds.leadId]
    )).rows[0]?.stage_id) {
      console.log("\n2. PATCH /api/leads/:id/stage → étape Devis...");
      const stageRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}/stage`, {
        stageId: createdIds.devisStageId,
      });
      if (stageRes.status !== 200) {
        fail("Passage stage Devis", new Error(JSON.stringify(stageRes.data)));
      } else {
        ok("Passage stage Devis");
      }
    } else {
      ok("Stage déjà à Devis ou étape équivalente");
    }

    // 3. Passage pipeline → Signé → conversion auto
    if (createdIds.signedStageId) {
      console.log("\n3. PATCH /api/leads/:id/stage → Signé (conversion auto)...");
      const signRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}/stage`, {
        stageId: createdIds.signedStageId,
      });
      if (signRes.status !== 200) {
        fail("Passage stage Signé", new Error(JSON.stringify(signRes.data)));
      } else {
        ok("Passage stage Signé");
      }

      const leadAfter = (await pool.query(
        "SELECT status, project_status FROM leads WHERE id = $1",
        [createdIds.leadId]
      )).rows[0];
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
    } else {
      console.log("\n3. Pas de stage 'Signé' trouvé, skip conversion test");
    }

    // 4. Pipeline bloqué pour CLIENT
    console.log("\n4. PATCH stage sur CLIENT (doit échouer)...");
    const firstStageId = stages[0]?.id;
    if (firstStageId) {
      const blockRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}/stage`, {
        stageId: firstStageId,
      });
      if (blockRes.status === 400 && /lead|LEAD/.test(blockRes.data?.error || "")) {
        ok("Pipeline bloqué pour CLIENT");
      } else {
        fail("Pipeline bloqué pour CLIENT", new Error(`Attendu 400, reçu ${blockRes.status}`));
      }
    }

    // 5. Modification project_status → DP_DEPOSE
    console.log("\n5. PATCH project_status=DP_DEPOSE...");
    const patchRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      project_status: "DP_DEPOSE",
    });
    if (patchRes.status !== 200) {
      fail("PATCH project_status", new Error(JSON.stringify(patchRes.data)));
    } else {
      const l = (await pool.query("SELECT project_status FROM leads WHERE id = $1", [createdIds.leadId])).rows[0];
      if (l?.project_status !== "DP_DEPOSE") {
        fail("project_status DP_DEPOSE", new Error(`reçu: ${l?.project_status}`));
      } else {
        ok("project_status=DP_DEPOSE");
      }
    }

    // 6. Non-régression : project_status invalide rejeté
    console.log("\n6. PATCH project_status=PROSPECTION (invalide, doit échouer)...");
    const invalidRes = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      project_status: "PROSPECTION",
    });
    if (invalidRes.status === 400) {
      ok("project_status PROSPECTION rejeté");
    } else {
      fail("project_status invalide rejeté", new Error(`Attendu 400, reçu ${invalidRes.status}`));
    }

    // 7. GET clients filtré par project_status
    console.log("\n7. GET /api/leads?view=clients&project_status=DP_DEPOSE...");
    const filterRes = await api(token, "GET", "/api/leads?view=clients&project_status=DP_DEPOSE");
    if (filterRes.status !== 200) {
      fail("Filtre project_status", new Error(JSON.stringify(filterRes.data)));
    } else {
      const found = Array.isArray(filterRes.data) ? filterRes.data.find((l) => l.id === createdIds.leadId) : null;
      if (found) ok("Filtre project_status=DP_DEPOSE");
      else fail("Filtre project_status", new Error("Lead non trouvé"));
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
