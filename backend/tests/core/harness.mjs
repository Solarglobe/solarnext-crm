/**
 * CP-077 — Contexte d’intégration (API + DB) pour tests core.
 * Prérequis : backend démarré, DATABASE_URL, préférence base dédiée (solarnext_test).
 * Désactiver : CP077_SKIP_INTEGRATION=1
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "../..");
const ROOT = resolve(BACKEND_DIR, "..");

dotenv.config({ path: resolve(ROOT, ".env.dev"), override: false });
dotenv.config({ path: resolve(BACKEND_DIR, ".env"), override: false });

export const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || "http://localhost:3000";

/** @type {import("pg").Pool | null} */
let _pool = null;

export function getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export async function integrationAvailable() {
  if (process.env.CP077_SKIP_INTEGRATION === "1") return false;
  if (!process.env.DATABASE_URL) return false;
  const h = await fetch(`${BASE_URL}/`).catch(() => null);
  return Boolean(h?.ok);
}

/**
 * @returns {Promise<{ token: string, orgId: string, adminEmail: string, adminPassword: string } | null>}
 */
export async function ensureAdminContext() {
  const pool = getPool();
  if (!pool) return null;

  const adminEmail = process.env.CP077_ADMIN_EMAIL || process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const adminPassword = process.env.CP077_ADMIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

  const orgRes = await pool.query("SELECT id FROM organizations WHERE name = 'SolarGlobe' LIMIT 1");
  const orgId = orgRes.rows[0]?.id;
  if (!orgId) throw new Error("CP-077: organisation SolarGlobe introuvable (migrations / seed)");

  const { hashPassword } = await import("../../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../../rbac/rbac.service.js");
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

  const permCodes = ["org.settings.manage", "lead.create", "lead.read.all", "lead.update.all", "quote.manage"];
  for (const code of permCodes) {
    const permRes = await pool.query("SELECT id FROM rbac_permissions WHERE code = $1", [code]);
    if (permRes.rows.length === 0) continue;
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

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  if (loginRes.status !== 200 || !loginData.token) {
    throw new Error(`CP-077: login fixture échoué: ${loginRes.status} ${JSON.stringify(loginData)}`);
  }

  return {
    token: loginData.token,
    orgId,
    adminEmail,
    adminPassword,
  };
}

/**
 * @param {string} token
 * @param {string} method
 * @param {string} path
 * @param {object | null} [body]
 */
export async function api(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body != null && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data, headers: res.headers };
}

export async function loginJson(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
