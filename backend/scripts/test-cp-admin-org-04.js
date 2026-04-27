/**
 * CP-ADMIN-ORG-04 — Tests structuration Organisation
 * Usage: npm run migrate:up && node scripts/test-cp-admin-org-04.js
 *
 * Prérequis : serveur déjà lancé (npm run dev) ou le script le démarre.
 * 1) Migration OK
 * 2) GET org retourne nouveaux champs
 * 3) PUT met à jour champs
 * 4) Upload logo fonctionne
 * 5) Non-régression login
 * 6) Non-régression admin page
 * 7) Non-régression missions/meta
 */

import "../config/register-local-env.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import { createReadStream } from "fs";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const BASE_URL = "http://localhost:3000";
const PORT = 3000;


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killProcessOnPort(port) {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const lines = out.trim().split("\n").filter((l) => l.includes("LISTENING"));
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pids = out.trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      }
    }
  } catch (_) {}
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return { status: res.status, data };
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
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {},
  };
}

async function apiFormData(token, path, formData) {
  const opts = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...formData.getHeaders(),
    },
    body: formData,
  };
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {},
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let serverProcess = null;

  try {
    console.log("=== CP-ADMIN-ORG-04 Organisation Structure Tests ===\n");

    // 1) Migration OK
    console.log("1. Migration...");
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organizations' AND column_name IN ('legal_name', 'logo_url', 'siret', 'iban')
    `);
    assert(colRes.rows.length >= 4, `Colonnes manquantes après migration: ${JSON.stringify(colRes.rows)}`);
    const settingsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organizations' AND column_name = 'settings_json'
    `);
    assert(settingsRes.rows.length === 1, "settings_json doit être présent");
    console.log("   ✅ Migration OK\n");

    // Boot serveur si besoin
    let health = await fetch(`${BASE_URL}/`).catch(() => null);
    if (!health?.ok) {
      console.log("   Démarrage serveur...");
      killProcessOnPort(PORT);
      await sleep(500);
      serverProcess = spawn("node", ["bootstrap.js"], {
        cwd: BACKEND_DIR,
        env: { ...process.env, RBAC_ENFORCE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await sleep(3000);
      health = await fetch(`${BASE_URL}/`);
      assert(health.ok, "Serveur non accessible");
    }
    console.log("   ✅ Serveur prêt\n");

    // Auth
    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";
    const orgRes = await pool.query("SELECT id FROM organizations WHERE name = 'SolarGlobe' LIMIT 1");
    const orgId = orgRes.rows[0]?.id;
    assert(orgId, "Organisation SolarGlobe doit exister");

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    await ensureOrgRolesSeeded(orgId);

    const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
    if (userRes.rows.length === 0) {
      const pwdHash = await hashPassword(adminPassword);
      await pool.query(
        `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active')`,
        [orgId, adminEmail, pwdHash]
      );
      const newUser = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
      const adminRole = await pool.query(
        "SELECT id FROM rbac_roles WHERE code = 'ADMIN' AND (organization_id = $1 OR organization_id IS NULL) LIMIT 1",
        [orgId]
      );
      if (adminRole.rows.length > 0) {
        await pool.query(
          "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [newUser.rows[0].id, adminRole.rows[0].id]
        );
      }
    }

    const permRes = await pool.query(
      "SELECT id FROM rbac_permissions WHERE code = 'org.settings.manage'"
    );
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

    const loginRes = await login(adminEmail, adminPassword);
    assert(loginRes.status === 200, `Login attendu 200, reçu ${loginRes.status}`);
    const adminToken = loginRes.data.token;
    assert(adminToken, "Token manquant");

    // 5) Non-régression login
    console.log("5. Non-régression login...");
    assert(loginRes.status === 200, "Login doit fonctionner");
    console.log("   ✅ Login OK\n");

    // 2) GET org retourne nouveaux champs
    console.log("2. GET /api/admin/org...");
    let r = await api(adminToken, "GET", "/api/admin/org");
    assert(r.status === 200, `GET /api/admin/org attendu 200, reçu ${r.status}`);
    const org = r.data;
    assert(org.id, "org.id manquant");
    assert(org.name !== undefined, "org.name manquant");
    assert(org.settings_json !== undefined, "org.settings_json manquant");
    assert("legal_name" in org, "legal_name manquant");
    assert("siret" in org, "siret manquant");
    assert("iban" in org, "iban manquant");
    assert("logo_url" in org, "logo_url manquant");
    console.log("   ✅ GET org retourne tous les champs\n");

    // 3) PUT met à jour champs
    console.log("3. PUT /api/admin/org...");
    const updatePayload = {
      legal_name: "Test Legal SARL",
      trade_name: "Test Trade",
      siret: "12345678901234",
      city: "Paris",
      default_quote_validity_days: 45,
      quote_prefix: "DEV",
    };
    r = await api(adminToken, "PUT", "/api/admin/org", updatePayload);
    assert(r.status === 200, `PUT /api/admin/org attendu 200, reçu ${r.status}`);
    assert(r.data.legal_name === "Test Legal SARL", "legal_name non mis à jour");
    assert(r.data.city === "Paris", "city non mis à jour");
    assert(r.data.default_quote_validity_days === 45, "default_quote_validity_days non mis à jour");
    assert(r.data.settings_json !== undefined, "settings_json écrasé (ne doit pas l'être)");
    console.log("   ✅ PUT met à jour les champs\n");

    // 4) Upload logo
    console.log("4. POST /api/admin/org/logo...");
    const tmpPath = join(tmpdir(), `org-logo-test-${Date.now()}.png`);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fakePng = Buffer.alloc(100, 0);
    pngHeader.copy(fakePng);
    writeFileSync(tmpPath, fakePng);

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", createReadStream(tmpPath), { filename: "logo.png", contentType: "image/png" });

    const uploadRes = await apiFormData(adminToken, "/api/admin/org/logo", form);
    unlinkSync(tmpPath);

    assert(uploadRes.status === 200, `POST /api/admin/org/logo attendu 200, reçu ${uploadRes.status}`);
    assert(uploadRes.data.logo_url, "logo_url manquant dans la réponse");
    console.log("   ✅ Upload logo OK\n");

    // 6) Non-régression admin page (GET org)
    console.log("6. Non-régression admin page...");
    r = await api(adminToken, "GET", "/api/admin/org");
    assert(r.status === 200, `GET /api/admin/org attendu 200, reçu ${r.status}`);
    console.log("   ✅ Admin page OK\n");

    // 7) Non-régression missions/meta
    console.log("7. Non-régression missions/meta...");
    r = await api(adminToken, "GET", "/api/missions/meta");
    assert(r.status === 200, `GET /api/missions/meta attendu 200, reçu ${r.status}`);
    console.log("   ✅ missions/meta OK\n");

    console.log("=== CP-ADMIN-ORG-04 VALIDATED ✅ ===\n");
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
    throw err;
  } finally {
    await pool.end();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
