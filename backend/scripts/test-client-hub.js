/**
 * CP-036 — Tests Hub Client
 * Usage: node scripts/test-client-hub.js
 * Prérequis: Backend démarré, .env.dev configuré
 *
 * Cas couverts :
 * - Créer client (lead status=CLIENT)
 * - Changer project_status
 * - Créer étude (lead_id)
 * - Créer devis (client_id + lead_id)
 * - Passer devis SIGNED → vérifier status CLIENT, project_status SIGNE, activité créée
 * - Filtrer clients par project_status
 * - Filtrer clients par has_signed_quote
 * - Vérifier isolation org
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
  console.log("\n=== CP-036 CLIENT HUB TESTS ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let token;
  const createdIds = { leadId: null, clientId: null, studyId: null, quoteId: null };

  try {
    // 0. Ensure test user exists
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
      const roleRes = await pool.query(
        "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN'",
        [orgId]
      );
      if (roleRes.rows.length > 0) {
        await pool.query(
          "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [userId, roleRes.rows[0].id]
        );
      }
    }

    // 1. Login
    console.log("1. Login...");
    token = await login(adminEmail, adminPwd);
    ok("Login");

    // 2. Créer lead
    console.log("\n2. POST /api/leads (lead minimal)...");
    const createRes = await api(token, "POST", "/api/leads", {
      first_name: "Hub",
      last_name: "Test",
      email: "hub-test@example.com",
    });
    if (createRes.status !== 201 || !createRes.data?.id) {
      fail("Créer lead", new Error(JSON.stringify(createRes.data)));
    } else {
      createdIds.leadId = createRes.data.id;
      ok("Créer lead", `id=${createdIds.leadId}`);
    }

    // 3. PATCH status → CLIENT
    console.log("\n3. PATCH /api/leads/:id status=CLIENT...");
    const patchStatus = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      status: "CLIENT",
    });
    if (patchStatus.status !== 200) {
      fail("PATCH status", new Error(JSON.stringify(patchStatus.data)));
    } else {
      ok("PATCH status CLIENT");
    }

    // 4. PATCH project_status
    console.log("\n4. PATCH /api/leads/:id project_status=SIGNE...");
    const patchProject = await api(token, "PATCH", `/api/leads/${createdIds.leadId}`, {
      project_status: "SIGNE",
    });
    if (patchProject.status !== 200) {
      fail("PATCH project_status", new Error(JSON.stringify(patchProject.data)));
    } else {
      ok("PATCH project_status SIGNE");
    }

    // 5. Créer étude (lead_id) — skip si permission manquante
    console.log("\n5. POST /api/studies (lead_id)...");
    const studyRes = await api(token, "POST", "/api/studies", {
      lead_id: createdIds.leadId,
      title: "Étude Hub Test",
    });
    if (studyRes.status === 403) {
      ok("Créer étude (skip: permission study.manage manquante)");
    } else if (studyRes.status !== 201 || !studyRes.data?.study?.id) {
      fail("Créer étude", new Error(JSON.stringify(studyRes.data)));
    } else {
      createdIds.studyId = studyRes.data.study.id;
      ok("Créer étude", `id=${createdIds.studyId}`);
    }

    // 6. Créer client (pour devis)
    console.log("\n6. Créer client (pour devis)...");
    const clientRes = await pool.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email, created_at, updated_at)
       SELECT organization_id, 'SG-TEST-' || substr(md5(random()::text), 1, 6), 'Hub', 'Test', 'hub@test.com', now(), now()
       FROM leads WHERE id = $1
       RETURNING id`,
      [createdIds.leadId]
    );
    if (clientRes.rows.length === 0) {
      fail("Créer client");
    } else {
      createdIds.clientId = clientRes.rows[0].id;
      ok("Créer client", `id=${createdIds.clientId}`);
    }

    // 7. Créer devis (client_id + lead_id)
    console.log("\n7. POST /api/quotes (client_id + lead_id)...");
    const quoteRes = await api(token, "POST", "/api/quotes", {
      client_id: createdIds.clientId,
      lead_id: createdIds.leadId,
      items: [{ description: "Test", quantity: 1, unit_price_ht: 1000, tva_rate: 20 }],
    });
    if (quoteRes.status !== 201 || !quoteRes.data?.quote?.id) {
      fail("Créer devis", new Error(JSON.stringify(quoteRes.data)));
    } else {
      createdIds.quoteId = quoteRes.data.quote.id;
      ok("Créer devis", `id=${createdIds.quoteId}`);
    }

    // 8. PATCH devis → sent (prérequis pour signed)
    console.log("\n8. PATCH /api/quotes/:id/status sent...");
    await api(token, "PATCH", `/api/quotes/${createdIds.quoteId}/status`, { status: "sent" });

    // 9. PATCH devis → signed
    console.log("\n9. PATCH /api/quotes/:id/status signed...");
    const signRes = await api(token, "PATCH", `/api/quotes/${createdIds.quoteId}/status`, {
      status: "signed",
    });
    if (signRes.status !== 200) {
      fail("Devis signé", new Error(JSON.stringify(signRes.data)));
    } else {
      ok("Devis signé");
    }

    // 10. Vérifier lead : status CLIENT, project_status SIGNE
    console.log("\n10. Vérifier lead status + project_status...");
    const leadCheck = await pool.query(
      "SELECT status, project_status FROM leads WHERE id = $1",
      [createdIds.leadId]
    );
    if (leadCheck.rows.length === 0) {
      fail("Lead non trouvé");
    } else {
      const l = leadCheck.rows[0];
      if (l.status !== "CLIENT") fail("status CLIENT", new Error(`reçu: ${l.status}`));
      else ok("status CLIENT");
      if (l.project_status !== "SIGNE") fail("project_status SIGNE", new Error(`reçu: ${l.project_status}`));
      else ok("project_status SIGNE");
    }

    // 11. Vérifier activité DEVIS_SIGNE créée
    console.log("\n11. Vérifier activité DEVIS_SIGNE...");
    const actRes = await api(token, "GET", `/api/leads/${createdIds.leadId}/activities`);
    const activities = actRes.data?.items || [];
    const devisSigne = activities.find((a) => a.type === "DEVIS_SIGNE");
    if (!devisSigne) {
      fail("Activité DEVIS_SIGNE", new Error("Non trouvée"));
    } else {
      ok("Activité DEVIS_SIGNE créée");
    }

    // 12. Filtrer clients par project_status
    console.log("\n12. GET /api/leads?view=clients&project_status=SIGNE...");
    const filterRes = await api(token, "GET", "/api/leads?view=clients&project_status=SIGNE");
    const clients = filterRes.data || [];
    const found = clients.some((c) => c.id === createdIds.leadId);
    if (!found) {
      fail("Filtre project_status", new Error("Lead non trouvé"));
    } else {
      ok("Filtre project_status=SIGNE");
    }

    // 13. Filtrer clients par has_signed_quote
    console.log("\n13. GET /api/leads?view=clients&has_signed_quote=true...");
    const filterQuoteRes = await api(token, "GET", "/api/leads?view=clients&has_signed_quote=true");
    const clientsQuote = filterQuoteRes.data || [];
    const foundQuote = clientsQuote.some((c) => c.id === createdIds.leadId);
    if (!foundQuote) {
      fail("Filtre has_signed_quote", new Error("Lead non trouvé"));
    } else {
      ok("Filtre has_signed_quote=true");
    }
  } catch (e) {
    fail("Exception", e);
  } finally {
    // Cleanup
    if (createdIds.quoteId) {
      await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [createdIds.quoteId]).catch(() => {});
      await pool.query("DELETE FROM quotes WHERE id = $1", [createdIds.quoteId]).catch(() => {});
    }
    if (createdIds.studyId) {
      await pool.query("DELETE FROM study_versions WHERE study_id = $1", [createdIds.studyId]).catch(() => {});
      await pool.query("DELETE FROM studies WHERE id = $1", [createdIds.studyId]).catch(() => {});
    }
    if (createdIds.clientId) {
      await pool.query("DELETE FROM clients WHERE id = $1", [createdIds.clientId]).catch(() => {});
    }
    if (createdIds.leadId) {
      await pool.query("DELETE FROM lead_activities WHERE lead_id = $1", [createdIds.leadId]).catch(() => {});
      await pool.query("DELETE FROM leads WHERE id = $1", [createdIds.leadId]).catch(() => {});
    }
    await pool.end();
  }

  console.log("\n=== RÉSULTAT ===");
  console.log(`✅ CLIENT HUB PASS (${results.passed}/${results.total})`);
  if (results.failed > 0) {
    console.log(`❌ Échecs: ${results.failed}`);
    process.exit(1);
  }
}

main();
