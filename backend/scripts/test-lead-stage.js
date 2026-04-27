/**
 * CP-028 Phase 2 — Tests Lead détail + changement stage
 *
 * Tester :
 * - Création lead
 * - Changement stage (PATCH)
 * - Vérification historique inséré
 * - Tentative cross-org → doit échouer
 *
 * Usage: node scripts/test-lead-stage.js
 * Prérequis: Backend lancé (port 3000), DATABASE_URL et JWT_SECRET dans .env.dev
 * Autonome : pas de dépendance à /auth/login — token généré localement.
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = "http://localhost:3000";

let token = null;
let leadId = null;
let orgA = null;
let orgB = null;
let stageA1 = null;
let stageA2 = null;
let stageB1 = null;

function generateTestToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role || "SUPER_ADMIN"
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  };
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { res, data: await res.json().catch(() => ({})) };
}

function ok(label, detail = "") {
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, err) {
  console.log(`❌ ${label}`);
  console.log(`   ${err}`);
}

async function run() {
  console.log("\n=== CP-028 Phase 2 — Tests Lead Stage ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const userResult = await client.query(`
      SELECT u.id, u.organization_id,
        (SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = u.id LIMIT 1) as role
      FROM users u
      WHERE u.status = 'active'
      LIMIT 1
    `);
    const testUser = userResult.rows[0];
    if (!testUser) throw new Error("Aucun utilisateur actif en base. Exécutez create-founder-admin.js.");
    token = generateTestToken(testUser);
    ok("Token généré localement (sans login HTTP)");

    orgA = (await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1")).rows[0]?.id;
    if (!orgA) throw new Error("Aucune organisation. Exécutez les migrations.");

    const stagesA = await client.query(
      "SELECT id, name FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 2",
      [orgA]
    );
    if (stagesA.rows.length < 2) throw new Error("Au moins 2 stages requis pour l'org A.");
    stageA1 = stagesA.rows[0].id;
    stageA2 = stagesA.rows[1].id;

    orgB = (await client.query(
      "SELECT id FROM organizations WHERE id != $1 ORDER BY created_at ASC LIMIT 1",
      [orgA]
    )).rows[0]?.id;
    if (orgB) {
      const sb = await client.query(
        "SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1",
        [orgB]
      );
      stageB1 = sb.rows[0]?.id;
    }

    // --- TEST 1: Création lead ---
    const createRes = await api("POST", "/api/leads", {
      first_name: "Test",
      last_name: "LeadStage",
      email: "test-lead-stage@test.local",
      stage_id: stageA1
    });
    if (!createRes.res.ok) {
      fail("TEST 1: Création lead", createRes.data.error || createRes.res.status);
    } else {
      leadId = createRes.data.id;
      ok("TEST 1: Création lead", `id=${leadId}`);
    }

    if (!leadId) {
      console.log("\n⚠️ Impossible de continuer sans lead. Vérifiez les permissions.");
      return;
    }

    // --- TEST 2: GET détail lead ---
    const detailRes = await api("GET", `/api/leads/${leadId}`);
    if (!detailRes.res.ok) {
      fail("TEST 2: GET détail lead", detailRes.data.error || detailRes.res.status);
    } else {
      const { lead, stage, history } = detailRes.data;
      if (!lead || !stage) fail("TEST 2: GET détail", "lead ou stage manquant");
      else ok("TEST 2: GET détail lead", `stage=${stage.name}, history=${history?.length ?? 0}`);
    }

    // --- TEST 3: Changement stage (PATCH) ---
    const patchRes = await api("PATCH", `/api/leads/${leadId}/stage`, { stageId: stageA2 });
    if (!patchRes.res.ok) {
      fail("TEST 3: PATCH stage", patchRes.data.error || patchRes.res.status);
    } else {
      ok("TEST 3: Changement stage", patchRes.data.stage?.name);
    }

    // --- TEST 4: Vérification historique inséré ---
    const detailAfter = await api("GET", `/api/leads/${leadId}`);
    if (!detailAfter.res.ok) {
      fail("TEST 4: Vérification historique", "GET échoué");
    } else {
      const history = detailAfter.data.history || [];
      const hasEntry = history.some((h) => h.to_stage_id === stageA2);
      if (hasEntry) ok("TEST 4: Historique inséré", `${history.length} entrée(s)`);
      else fail("TEST 4: Historique inséré", "Aucune entrée pour le nouveau stage");
    }

    // --- TEST 5: Tentative cross-org (stage d'une autre org) → doit échouer ---
    if (orgB && stageB1) {
      const crossRes = await api("PATCH", `/api/leads/${leadId}/stage`, { stageId: stageB1 });
      if (crossRes.res.ok) {
        fail("TEST 5: Cross-org", "Devrait échouer (403/400)");
      } else {
        ok("TEST 5: Cross-org rejeté", `status=${crossRes.res.status}`);
      }
    } else {
      ok("TEST 5: Cross-org", "Skip (une seule org)");
    }

    console.log("\n=== Fin des tests ===\n");
  } finally {
    if (leadId) {
      await client.query("DELETE FROM leads WHERE id = $1", [leadId]);
    }
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error("Erreur:", e.message);
  process.exit(1);
});
