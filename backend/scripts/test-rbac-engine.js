/**
 * CP-026 — Tests du moteur RBAC
 * Usage: node scripts/test-rbac-engine.js
 * Prérequis: serveur démarré (npm run dev), DATABASE_URL dans .env.dev
 *
 * Pour tester RBAC_ENFORCE=1 (403 sur route protégée):
 *   RBAC_ENFORCE=1 npm run dev  (dans un terminal)
 *   node scripts/test-rbac-engine.js  (dans un autre)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


import fetch from "node-fetch";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SUPER_ADMIN_EMAIL = process.env.TEST_SUPER_ADMIN_EMAIL || "b.letren@solarglobe.fr";
const SUPER_ADMIN_PASSWORD = process.env.TEST_SUPER_ADMIN_PASSWORD || "@Goofy29041997";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function ok(name, detail = "") {
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  console.error(`❌ ${name}`);
  console.error(`   ${err.message || err}`);
  throw err;
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function getRbacMe(token) {
  const res = await fetch(`${BASE_URL}/api/rbac/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, data: await res.json() };
}

async function run() {
  process.env.RBAC_ENFORCE = "1";

  const { hashPassword } = await import("../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

  console.log("=== CP-026 RBAC Engine Tests ===\n");

  // 1) Login SUPER_ADMIN -> /api/rbac/me -> 200
  let token;
  try {
    token = await login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    ok("1. Login SUPER_ADMIN");
  } catch (e) {
    fail("1. Login SUPER_ADMIN", e);
  }

  const rbacMe1 = await getRbacMe(token);
  if (rbacMe1.status !== 200) {
    fail("2. GET /api/rbac/me (SUPER_ADMIN)", new Error(`Status ${rbacMe1.status}: ${JSON.stringify(rbacMe1.data)}`));
  }
  ok("2. GET /api/rbac/me (SUPER_ADMIN)", `status=${rbacMe1.status}, permissions=${JSON.stringify(rbacMe1.data.permissions)}`);

  // 3) Org + user ADMIN + ensureOrgRolesSeeded + rbac_user_roles
  const client = await pool.connect();
  let orgId;
  let adminUserId;

  try {
    const orgRes = await client.query(
      "SELECT id FROM organizations WHERE name = $1 LIMIT 1",
      ["SolarGlobe"]
    );
    if (orgRes.rows.length === 0) {
      const insert = await client.query(
        "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
        ["SolarGlobe"]
      );
      orgId = insert.rows[0].id;
      await ensureOrgRolesSeeded(orgId);
      ok("3a. Organisation créée + ensureOrgRolesSeeded");
    } else {
      orgId = orgRes.rows[0].id;
      await ensureOrgRolesSeeded(orgId);
      ok("3a. Organisation existante + ensureOrgRolesSeeded");
    }

    const adminEmail = "rbac-test-admin@test.local";
    let userRes = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [adminEmail]
    );

    if (userRes.rows.length === 0) {
      const pwdHash = await hashPassword("TestAdmin123!");
      const insertUser = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [orgId, adminEmail, pwdHash]
      );
      adminUserId = insertUser.rows[0].id;

      const adminRoleId = (
        await client.query(
          "SELECT id FROM rbac_roles WHERE organization_id = $1 AND code = $2",
          [orgId, "ADMIN"]
        )
      ).rows[0]?.id;

      if (!adminRoleId) {
        throw new Error("Rôle ADMIN org introuvable après ensureOrgRolesSeeded");
      }

      await client.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [adminUserId, adminRoleId]
      );

      const oldAdminRole = await client.query(
        "SELECT id FROM roles WHERE name = $1 LIMIT 1",
        ["ADMIN"]
      );
      if (oldAdminRole.rows.length > 0) {
        await client.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [adminUserId, oldAdminRole.rows[0].id]
        );
      }

      ok("3b. User ADMIN créé + rbac_user_roles");
    } else {
      adminUserId = userRes.rows[0].id;
      ok("3b. User ADMIN existant");
    }
  } finally {
    client.release();
  }

  // 4) Login ADMIN -> /api/rbac/me -> 200 + permissions non vides
  const adminToken = await login("rbac-test-admin@test.local", "TestAdmin123!");
  const rbacMe2 = await getRbacMe(adminToken);

  if (rbacMe2.status !== 200) {
    fail("4. GET /api/rbac/me (ADMIN)", new Error(`Status ${rbacMe2.status}`));
  }

  const perms = rbacMe2.data.permissions || [];
  const hasOrgSettings = perms.includes("org.settings.manage");
  const hasLeadCreate = perms.includes("lead.create");

  if (!hasOrgSettings || !hasLeadCreate) {
    fail(
      "4. Permissions ADMIN",
      new Error(`Attendu org.settings.manage et lead.create, reçu: ${JSON.stringify(perms)}`)
    );
  }
  ok("4. GET /api/rbac/me (ADMIN)", `permissions=${perms.length}, org.settings.manage=${hasOrgSettings}, lead.create=${hasLeadCreate}`);

  // 5) RBAC_ENFORCE=1 : user SALES sans rbac.manage -> 403
  console.log("\n🔒 Test enforcement RBAC (RBAC_ENFORCE=1)");
  const salesLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales@test.com",
      password: "Test1234!"
    })
  });

  if (salesLogin.status === 200) {
    const salesData = await salesLogin.json();
    const salesToken = salesData.token;

    const r = await fetch(`${BASE_URL}/api/rbac/me`, {
      headers: { Authorization: `Bearer ${salesToken}` }
    });

    if (r.status === 403) {
      console.log("✅ 403 correctement retourné pour user sans permission rbac.manage");
    } else {
      throw new Error("RBAC_ENFORCE=1 n'a pas bloqué correctement");
    }
  } else {
    console.log("ℹ️ User sales@test.com absent — test enforcement ignoré");
  }

  console.log("\n=== Tous les tests RBAC passés ✅ ===");
  process.exit(0);
}

run().catch((e) => {
  console.error("\nErreur fatale:", e);
  process.exit(1);
});
