/**
 * CP-ADMIN-ARCH-01 — Tests Auth/RBAC verrouillage
 * Usage: npm run migrate:up && node scripts/test-cp-admin-arch-01.js
 *
 * 1) Boot serveur RBAC_ENFORCE=1
 * 2) Seed & permissions (user.manage, ADMIN SolarGlobe)
 * 3) Auth (SUPER_ADMIN, ADMIN)
 * 4) Non régression routes
 * 5) Legacy/JWT cohérence
 */

import "../config/register-local-env.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
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
        stdio: ["pipe", "pipe", "pipe"]
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
        stdio: ["pipe", "pipe", "pipe"]
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
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function api(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  };
  if (body && (method === "POST" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {}
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
  const createdUserIds = [];

  try {
    console.log("=== CP-ADMIN-ARCH-01 Auth/RBAC Tests ===\n");

    // 1) Boot
    console.log("1. Boot — Arrêt port 3000...");
    killProcessOnPort(PORT);
    await sleep(500);

    console.log("   Démarrage serveur RBAC_ENFORCE=1...");
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, RBAC_ENFORCE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await sleep(3000);
    const health = await fetch(`${BASE_URL}/`);
    assert(health.ok, "Serveur non accessible après 3s");
    console.log("   ✅ Serveur prêt\n");

    // 2) Seed & permissions
    console.log("2. Seed & permissions...");
    const permRes = await pool.query(
      "SELECT id FROM rbac_permissions WHERE code = 'user.manage'"
    );
    assert(permRes.rows.length > 0, "rbac_permissions doit contenir user.manage");

    const orgRes = await pool.query(
      "SELECT id FROM organizations WHERE name = 'SolarGlobe' LIMIT 1"
    );
    const orgId = orgRes.rows[0]?.id;
    assert(orgId, "Organisation SolarGlobe doit exister (run create-first-organization si besoin)");

    const adminRoleRes = await pool.query(
      `SELECT rr.id FROM rbac_roles rr
       WHERE rr.code = 'ADMIN' AND (rr.organization_id = $1 OR rr.organization_id IS NULL)
       LIMIT 1`,
      [orgId]
    );
    assert(adminRoleRes.rows.length > 0, "Rôle ADMIN doit exister pour SolarGlobe");

    const rpRes = await pool.query(
      `SELECT 1 FROM rbac_role_permissions rp
       JOIN rbac_roles r ON r.id = rp.role_id
       JOIN rbac_permissions p ON p.id = rp.permission_id
       WHERE p.code = 'user.manage' AND r.code = 'ADMIN'
         AND (r.organization_id = $1 OR r.organization_id IS NULL)`,
      [orgId]
    );
    assert(rpRes.rows.length > 0, "ADMIN doit posséder user.manage pour org SolarGlobe");
    console.log("   ✅ user.manage présent et assigné à ADMIN\n");

    // 3) Auth
    console.log("3. Auth...");
    const superAdminEmail = process.env.TEST_SUPER_ADMIN_EMAIL || "b.letren@solarglobe.fr";
    const superAdminPassword = process.env.TEST_SUPER_ADMIN_PASSWORD || "@Goofy29041997";
    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

    await ensureOrgRolesSeeded(orgId);

    const ensureUser = async (email, password, roleCode) => {
      let u = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (u.rows.length === 0) {
        const pwdHash = await hashPassword(password);
        const ins = await pool.query(
          `INSERT INTO users (organization_id, email, password_hash, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
          [orgId, email, pwdHash]
        );
        const userId = ins.rows[0].id;
        createdUserIds.push(userId);

        const roleRes = await pool.query(
          "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = $2",
          [orgId, roleCode]
        );
        if (roleRes.rows.length > 0) {
          await pool.query(
            "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
            [userId, roleRes.rows[0].id]
          );
        }
        const legRes = await pool.query("SELECT id FROM roles WHERE name = $1", [roleCode]);
        if (legRes.rows.length > 0) {
          await pool.query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
            [userId, legRes.rows[0].id]
          );
        }
      }
    };

    await ensureUser(adminEmail, adminPassword, "ADMIN");

    let loginRes = await login(superAdminEmail, superAdminPassword);
    if (loginRes.status !== 200) {
      console.log("   ℹ️ SUPER_ADMIN absent — test ignoré (utilisez TEST_SUPER_ADMIN_EMAIL/PASSWORD)");
    } else {
      const jwt = (await import("jsonwebtoken")).default;
      const decoded = jwt.decode(loginRes.data.token);
      assert(decoded.role, "JWT SUPER_ADMIN doit avoir role");
      const rbacRes = await fetch(`${BASE_URL}/api/rbac/me`, {
        headers: { Authorization: `Bearer ${loginRes.data.token}` }
      });
      const rbacData = await rbacRes.json();
      assert(rbacData.superAdmin === true || rbacData.permissions?.includes?.("*"), "SUPER_ADMIN doit avoir permissions *");
      console.log("   ✅ Login SUPER_ADMIN 200 + JWT + permissions *");
    }

    loginRes = await login(adminEmail, adminPassword);
    assert(loginRes.status === 200, `Login ADMIN attendu 200, reçu ${loginRes.status}: ${JSON.stringify(loginRes.data)}`);
    assert(loginRes.data.token, "ADMIN doit recevoir JWT");
    const jwt = await import("jsonwebtoken");
    const decoded = jwt.default.decode(loginRes.data.token);
    assert(decoded.role, "JWT ADMIN doit avoir role");

    const rbacRes = await fetch(`${BASE_URL}/api/rbac/me`, {
      headers: { Authorization: `Bearer ${loginRes.data.token}` }
    });
    const rbacData = await rbacRes.json();
    assert(
      Array.isArray(rbacData.permissions) && rbacData.permissions.includes("user.manage"),
      `ADMIN permissions doivent inclure user.manage: ${JSON.stringify(rbacData.permissions)}`
    );
    console.log("   ✅ Login ADMIN 200 + JWT + user.manage\n");

    // 4) Non régression routes
    console.log("4. Non régression routes...");
    const adminToken = loginRes.data.token;

    let r = await api(adminToken, "GET", "/api/admin/users");
    assert(r.status === 200, `GET /api/admin/users attendu 200, reçu ${r.status}`);

    const testEmail = `cp-arch01-${Date.now()}@test.local`;
    r = await api(adminToken, "POST", "/api/admin/users", {
      email: testEmail,
      password: "Test1234!",
      roleIds: []
    });
    assert(r.status === 201, `POST /api/admin/users attendu 201, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    const createdId = r.data.id;
    createdUserIds.push(createdId);

    r = await api(adminToken, "PUT", `/api/admin/users/${createdId}`, { email: `cp-arch01-upd-${Date.now()}@test.local` });
    assert(r.status === 200, `PUT /api/admin/users attendu 200, reçu ${r.status}`);

    r = await api(adminToken, "DELETE", `/api/admin/users/${createdId}`);
    assert(r.status === 204, `DELETE /api/admin/users attendu 204, reçu ${r.status}`);
    createdUserIds.pop();

    r = await api(adminToken, "GET", "/api/admin/roles");
    assert(r.status === 200, `GET /api/admin/roles attendu 200, reçu ${r.status}`);

    r = await api(adminToken, "GET", "/api/admin/org");
    assert(r.status === 200, `GET /api/admin/org attendu 200, reçu ${r.status}`);

    r = await api(adminToken, "GET", "/api/missions/meta");
    assert(r.status === 200, `GET /api/missions/meta attendu 200, reçu ${r.status}`);
    console.log("   ✅ Toutes routes OK\n");

    // 5) Legacy/JWT cohérence
    console.log("5. Legacy/JWT cohérence...");
    const salesEmail = `cp-arch01-sales-${Date.now()}@test.local`;
    const salesUser = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [orgId, salesEmail, await hashPassword("Test1234!")]
    );
    const salesUserId = salesUser.rows[0].id;
    createdUserIds.push(salesUserId);

    const salesRoleRes = await pool.query(
      "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'SALES'",
      [orgId]
    );
    const salesLegRes = await pool.query("SELECT id FROM roles WHERE name = 'SALES'");
    if (salesRoleRes.rows.length > 0) {
      await pool.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [salesUserId, salesRoleRes.rows[0].id]
      );
    }
    if (salesLegRes.rows.length > 0) {
      await pool.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [salesUserId, salesLegRes.rows[0].id]
      );
    }

    loginRes = await login(salesEmail, "Test1234!");
    assert(loginRes.status === 200, `Login SALES attendu 200, reçu ${loginRes.status}`);
    const salesDecoded = (await import("jsonwebtoken")).default.decode(loginRes.data.token);
    assert(salesDecoded.role && salesDecoded.role === "SALES", `JWT.role doit être SALES, reçu ${salesDecoded.role}`);
    console.log("   ✅ User SALES → login → JWT.role = SALES");

    console.log("\n=== CP-ADMIN-ARCH-01 VALIDATED ✅ ===\n");
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
    throw err;
  } finally {
    if (createdUserIds.length > 0) {
      await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [createdUserIds]);
      await pool.query("DELETE FROM rbac_user_roles WHERE user_id = ANY($1)", [createdUserIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
    }
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
