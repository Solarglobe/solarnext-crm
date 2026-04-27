/**
 * CP-075 — Test E2E RGPD (HTTP + DB) : client test, export JSON, anonymisation, audit_logs.
 * Prérequis : API sur BASE_URL (défaut http://localhost:3000), DATABASE_URL dans .env.dev.
 * Usage : node --env-file=../.env.dev scripts/test-rgpd-e2e.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = resolve(__dirname, "..");
const ROOT = resolve(BACKEND_DIR, "..");


const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("✔", msg);
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function api(token, method, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL manquant (.env.dev)");
  }

  const health = await fetch(`${BASE_URL}/`).catch(() => null);
  if (!health?.ok) {
    fail(`Serveur non joignable (${BASE_URL}). Lancez le backend (npm run dev).`);
  }
  ok(`Serveur ${BASE_URL} OK`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

  const orgRes = await pool.query("SELECT id FROM organizations WHERE name = 'SolarGlobe' LIMIT 1");
  const orgId = orgRes.rows[0]?.id;
  if (!orgId) fail("Organisation SolarGlobe introuvable");

  const { hashPassword } = await import("../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
  await ensureOrgRolesSeeded(orgId);

  let userRes = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
  if (userRes.rows.length === 0) {
    const pwdHash = await hashPassword(adminPassword);
    await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active')`,
      [orgId, adminEmail, pwdHash]
    );
    userRes = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
    const adminRole = await pool.query(
      "SELECT id FROM rbac_roles WHERE code = 'ADMIN' AND (organization_id = $1 OR organization_id IS NULL) LIMIT 1",
      [orgId]
    );
    if (adminRole.rows.length > 0) {
      await pool.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [userRes.rows[0].id, adminRole.rows[0].id]
      );
    }
  }

  const permRes = await pool.query("SELECT id FROM rbac_permissions WHERE code = 'org.settings.manage'");
  if (permRes.rows.length > 0) {
    const adminRole = await pool.query(
      "SELECT id FROM rbac_roles WHERE code = 'ADMIN' AND (organization_id = $1 OR organization_id IS NULL) LIMIT 1",
      [orgId]
    );
    if (adminRole.rows.length > 0) {
      await pool.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [adminRole.rows[0].id, permRes.rows[0].id]
      );
    }
  }

  const suffix = Date.now();
  const clientNumber = `RGPD-E2E-${suffix}`;
  const testEmail = `rgpd-e2e-${suffix}@example.test`;
  const ins = await pool.query(
    `INSERT INTO clients (
      organization_id, client_number, company_name, first_name, last_name, email, phone, city
    ) VALUES ($1, $2, 'RGPD Test Co', 'PrénomTest', 'NomTest', $3, '0612345678', 'Lyon')
    RETURNING id`,
    [orgId, clientNumber, testEmail]
  );
  const clientId = ins.rows[0].id;
  ok(`Client test créé ${clientId} (${testEmail})`);

  const { status: stLogin, data: loginData } = await login(adminEmail, adminPassword);
  if (stLogin !== 200 || !loginData.token) {
    fail(`Login admin échoué: ${stLogin} ${JSON.stringify(loginData)}`);
  }
  const token = loginData.token;

  const exp = await api(token, "GET", `/api/rgpd/export/client/${clientId}`);
  if (exp.status !== 200) {
    fail(`Export HTTP ${exp.status}: ${JSON.stringify(exp.data)}`);
  }
  if (exp.data?.entity?.email !== testEmail) {
    fail(`Export: email attendu ${testEmail}, reçu ${exp.data?.entity?.email}`);
  }
  if (!exp.data?.exported_at || exp.data?.organization_id !== orgId) {
    fail("Export: champs exported_at / organization_id invalides");
  }
  ok("Export JSON OK (email + métadonnées)");

  const del = await api(token, "DELETE", `/api/rgpd/delete/client/${clientId}`);
  if (del.status !== 200) {
    fail(`DELETE anonymisation HTTP ${del.status}: ${JSON.stringify(del.data)}`);
  }
  ok("DELETE / anonymisation HTTP OK");

  const row = await pool.query(
    `SELECT company_name, first_name, email, phone, city FROM clients WHERE id = $1`,
    [clientId]
  );
  const c = row.rows[0];
  if (!c || c.email !== "anonymized@invalid.local" || c.first_name !== "ANONYMIZED") {
    fail(`DB après anonymisation: ${JSON.stringify(c)}`);
  }
  ok("DB: client anonymisé (email + noms)");

  const audits = await pool.query(
    `SELECT action, entity_type, entity_id::text, user_id::text
     FROM audit_logs
     WHERE organization_id = $1
       AND entity_id = $2::uuid
       AND action IN ('RGPD_EXPORT_REQUESTED', 'RGPD_DELETE_REQUESTED')
     ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  const actions = audits.rows.map((r) => r.action);
  if (!actions.includes("RGPD_EXPORT_REQUESTED") || !actions.includes("RGPD_DELETE_REQUESTED")) {
    fail(`audit_logs manquants ou incomplets: ${JSON.stringify(audits.rows)}`);
  }
  ok("audit_logs: RGPD_EXPORT_REQUESTED + RGPD_DELETE_REQUESTED");

  console.log("\n--- Exemple extrait export (entity) ---");
  console.log(JSON.stringify(exp.data.entity, null, 2));

  await pool.end();
  console.log("\n=== CP-075 RGPD : verdict RGPD OK (flux testé) ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
