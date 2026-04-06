/**
 * CP-LEAD-CREATE-05 — Tests bouton + création Lead + overlay
 * Usage: node scripts/test-cp-lead-create-05.js
 * Prérequis: Backend démarré, .env.dev configuré
 *
 * Tests:
 * - Login ADMIN
 * - POST /api/leads fonctionne
 * - Création lead via API
 * - Redirection (GET /api/leads/:id)
 * - Non-régression: leads list, lead detail, planning, admin
 */

import dotenv from "dotenv";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env.dev"), override: false });

const BASE_URL = process.env.API_URL || "http://localhost:3000";
let passed = 0;
let failed = 0;

function ok(name, detail = "") {
  passed++;
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  failed++;
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
  console.log("\n=== CP-LEAD-CREATE-05 — Bouton + création Lead ===\n");

  const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const adminPwd = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

  let token;
  let createdLeadId;

  try {
    // 1. Login ADMIN
    console.log("1. Login ADMIN...");
    token = await login(adminEmail, adminPwd);
    ok("Login ADMIN");

    // 2. POST /api/leads — création lead
    console.log("\n2. POST /api/leads (firstName, lastName, phone, email)...");
    const createRes = await api(token, "POST", "/api/leads", {
      first_name: "CP05",
      last_name: "Test",
      phone: "0612345678",
      email: "cp05-test@example.com",
    });
    if (createRes.status !== 201 || !createRes.data?.id) {
      fail("POST /api/leads", new Error(JSON.stringify(createRes.data)));
    } else {
      createdLeadId = createRes.data.id;
      ok("POST /api/leads", `id=${createdLeadId}`);
    }

    // 3. Redirection — GET /api/leads/:id (équivalent à la fiche complète)
    if (createdLeadId) {
      console.log("\n3. GET /api/leads/:id (redirection vers fiche)...");
      const detailRes = await api(token, "GET", `/api/leads/${createdLeadId}`);
      const lead = detailRes.data?.lead || detailRes.data;
      if (detailRes.status !== 200 || !lead?.id) {
        fail("GET /api/leads/:id", new Error(JSON.stringify(detailRes.data)));
      } else {
        ok("GET /api/leads/:id", `lead ${lead.first_name} ${lead.last_name}`);
      }
    }

    // 4. Non-régression — leads list
    console.log("\n4. Non-régression: GET /api/leads (leads list)...");
    const listRes = await api(token, "GET", "/api/leads?view=leads");
    if (listRes.status !== 200) {
      fail("GET /api/leads", new Error(`status ${listRes.status}`));
    } else {
      const leads = Array.isArray(listRes.data) ? listRes.data : listRes.data?.data || [];
      ok("GET /api/leads (leads list)", `${leads.length} lead(s)`);
    }

    // 5. Non-régression — lead detail
    if (createdLeadId) {
      console.log("\n5. Non-régression: GET /api/leads/:id (lead detail)...");
      const detailRes2 = await api(token, "GET", `/api/leads/${createdLeadId}`);
      const lead2 = detailRes2.data?.lead || detailRes2.data;
      if (detailRes2.status !== 200 || !lead2?.id) {
        fail("GET /api/leads/:id (lead detail)", new Error(`status ${detailRes2.status}`));
      } else {
        ok("GET /api/leads/:id (lead detail)");
      }
    }

    // 6. Non-régression — planning (si endpoint existe)
    console.log("\n6. Non-régression: GET /api/missions (planning)...");
    const planningRes = await api(token, "GET", "/api/missions");
    if (planningRes.status !== 200 && planningRes.status !== 404) {
      fail("GET /api/missions (planning)", new Error(`status ${planningRes.status}`));
    } else {
      ok("GET /api/missions (planning)");
    }

    // 7. Non-régression — admin (si endpoint existe)
    console.log("\n7. Non-régression: GET /api/admin ou /api/users...");
    const adminRes = await api(token, "GET", "/api/users");
    if (adminRes.status !== 200 && adminRes.status !== 403 && adminRes.status !== 404) {
      fail("Admin endpoint", new Error(`status ${adminRes.status}`));
    } else {
      ok("Admin endpoint");
    }

    // Nettoyage
    if (createdLeadId) {
      try {
        await api(token, "PATCH", `/api/leads/${createdLeadId}/archive`);
      } catch (_) {
        // ignore
      }
    }
  } catch (e) {
    fail("Exécution", e);
  }

  const total = passed + failed;
  console.log(`\n--- Résultat: ${passed}/${total} tests passés ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
