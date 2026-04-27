/**
 * Tests rapides — API Batteries virtuelles (sécurisation avant intégration devis)
 *
 * 1) Création OK
 * 2) Update OK
 * 3) Refus capacity_table invalide (per_capacity sans tableau valide)
 * 4) Refus provider_code duplicate (409)
 * 5) Isolation multi-org (org B ne voit pas/modifie pas les données org A)
 *
 * Usage: node scripts/test-virtual-batteries-validation.js
 * Prérequis: serveur lancé, .env.dev (DATABASE_URL, JWT_SECRET), 2 orgs avec users admin.
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && (method === "POST" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("=== Tests validation batteries virtuelles ===\n");

    const health = await fetch(`${BASE_URL}/`).catch(() => null);
    if (!health?.ok) {
      console.error("❌ Serveur non accessible. Lancez le backend.");
      process.exit(1);
    }

    const orgs = await pool.query("SELECT id FROM organizations ORDER BY created_at LIMIT 2");
    assert(orgs.rows.length >= 2, "Il faut au moins 2 organisations pour le test d'isolation");
    const [orgA, orgB] = orgs.rows.map((r) => r.id);

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    await ensureOrgRolesSeeded(orgA);
    await ensureOrgRolesSeeded(orgB);

    const adminRoleA = await pool.query(
      "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1",
      [orgA]
    );
    const adminRoleB = await pool.query(
      "SELECT id FROM rbac_roles WHERE (organization_id = $2 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1",
      [orgB, orgB]
    );
    assert(adminRoleA.rows[0]?.id && adminRoleB.rows[0]?.id, "Rôles ADMIN requis");

    const permRes = await pool.query(
      "SELECT id FROM rbac_permissions WHERE code = 'org.settings.manage' LIMIT 1"
    );
    if (permRes.rows.length > 0) {
      await pool.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2), ($3, $2) ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [adminRoleA.rows[0].id, permRes.rows[0].id, adminRoleB.rows[0].id]
      );
    }

    const ts = Date.now();
    const emailA = `vb-test-a-${ts}@test.local`;
    const emailB = `vb-test-b-${ts}@test.local`;
    const pwd = "TestVirtualBatt123!";
    const pwdHash = await hashPassword(pwd);

    await pool.query(
      "INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
      [orgA, emailA, pwdHash]
    );
    await pool.query(
      "INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
      [orgB, emailB, pwdHash]
    );
    const userA = (await pool.query("SELECT id FROM users WHERE email = $1", [emailA])).rows[0].id;
    const userB = (await pool.query("SELECT id FROM users WHERE email = $1", [emailB])).rows[0].id;
    await pool.query(
      "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2)",
      [userA, adminRoleA.rows[0].id]
    );
    await pool.query(
      "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2)",
      [userB, adminRoleB.rows[0].id]
    );

    const { generateJWT } = await import("../auth/auth.service.js");
    const tokenA = generateJWT({
      id: userA,
      organization_id: orgA,
      role: "ADMIN",
    });
    const tokenB = generateJWT({
      id: userB,
      organization_id: orgB,
      role: "ADMIN",
    });

    const providerCode = `VB-TEST-${ts}`;

    // 1) Création OK
    console.log("1. Création OK (per_kwc)...");
    let r = await api(tokenA, "POST", "/api/admin/pv/virtual-batteries", {
      name: "Test UrbanSolar",
      provider_code: providerCode,
      pricing_model: "per_kwc",
      monthly_subscription_ht: 9.99,
      activation_fee_ht: 50,
      is_active: true,
    });
    assert(r.status === 201, `Attendu 201, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    const idA = r.data.id;
    assert(idA, "id manquant dans la réponse");
    console.log("   OK\n");

    // 2) Update OK
    console.log("2. Update OK...");
    r = await api(tokenA, "PUT", `/api/admin/pv/virtual-batteries/${idA}`, {
      name: "Test UrbanSolar (modifié)",
      monthly_subscription_ht: 12.5,
    });
    assert(r.status === 200, `Attendu 200, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.name === "Test UrbanSolar (modifié)", "Nom non mis à jour");
    assert(Number(r.data.monthly_subscription_ht) === 12.5, "monthly_subscription_ht non mis à jour");
    assert(r.data.updated_at != null, "updated_at doit être rafraîchi");
    console.log("   OK\n");

    // 3) Refus capacity_table invalide
    console.log("3. Refus capacity_table invalide (per_capacity sans tableau valide)...");
    r = await api(tokenA, "POST", "/api/admin/pv/virtual-batteries", {
      name: "Test PerCapacity",
      provider_code: `VB-PERCAP-${ts}`,
      pricing_model: "per_capacity",
      capacity_table: [],
      is_active: true,
    });
    assert(r.status === 400, `Attendu 400, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    console.log("   OK (400 reçu)\n");

    r = await api(tokenA, "POST", "/api/admin/pv/virtual-batteries", {
      name: "Test PerCapacity 2",
      provider_code: `VB-PERCAP2-${ts}`,
      pricing_model: "per_capacity",
      capacity_table: [{ capacity_kwh: 0, monthly_subscription_ht: 10 }],
      is_active: true,
    });
    assert(r.status === 400, `Attendu 400 (capacity_kwh > 0), reçu ${r.status}`);
    console.log("   OK (400 reçu)\n");

    // 4) Refus provider_code duplicate
    console.log("4. Refus provider_code duplicate (409)...");
    r = await api(tokenA, "POST", "/api/admin/pv/virtual-batteries", {
      name: "Autre nom",
      provider_code,
      pricing_model: "per_kwc",
      is_active: true,
    });
    assert(r.status === 409, `Attendu 409, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    console.log("   OK (409 reçu)\n");

    // 5) Isolation multi-org
    console.log("5. Isolation multi-org...");
    r = await api(tokenB, "POST", "/api/admin/pv/virtual-batteries", {
      name: "Test Org B",
      provider_code,
      pricing_model: "per_kwc",
      is_active: true,
    });
    assert(r.status === 201, `Org B peut créer avec même provider_code (autre org): ${r.status}`);
    const idB = r.data.id;

    r = await api(tokenB, "GET", "/api/admin/pv/virtual-batteries");
    assert(r.status === 200 && Array.isArray(r.data), "Liste org B doit être un tableau");
    assert(r.data.length === 1 && r.data[0].id === idB, "Org B ne doit voir que sa batterie");

    r = await api(tokenA, "PUT", `/api/admin/pv/virtual-batteries/${idB}`, { name: "Hack" });
    assert(r.status === 404, `Org A ne doit pas modifier la batterie de l'org B: ${r.status}`);

    r = await api(tokenB, "PUT", `/api/admin/pv/virtual-batteries/${idA}`, { name: "Hack" });
    assert(r.status === 404, `Org B ne doit pas modifier la batterie de l'org A: ${r.status}`);
    console.log("   OK\n");

    console.log("=== Tous les tests passés ===\n");
  } finally {
    await pool.query(
      "DELETE FROM pv_virtual_batteries WHERE provider_code LIKE 'VB-TEST-%' OR provider_code LIKE 'VB-PERCAP%'"
    );
    await pool.query(
      "DELETE FROM rbac_user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'vb-test-%@test.local')"
    );
    await pool.query("DELETE FROM users WHERE email LIKE 'vb-test-%@test.local'");
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
