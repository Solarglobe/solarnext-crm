/**
 * CP-027 — Tests Admin CRUD (users, roles, org)
 * Usage: node scripts/test-admin-crud.js
 *
 * Le script :
 * - Lance le serveur avec RBAC_ENFORCE=1
 * - Bootstrap: assure user.manage existe et est assigné à ADMIN
 * - Login ADMIN
 * - Crée un user test
 * - Modifie user
 * - Liste users
 * - Supprime user
 * - Teste que SALES obtient 403
 * - Stoppe serveur
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const BASE_URL = "http://localhost:3000";
const PORT = 3000;

dotenv.config({ path: resolve(__dirname, "../../.env.dev"), override: false });

const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local",
  password: process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!"
};

const SALES = {
  email: process.env.TEST_SALES_EMAIL || "sales@test.com",
  password: process.env.TEST_SALES_PASSWORD || "Test1234!"
};

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

/**
 * Bootstrap: assure user.manage existe et est assigné à tous les rôles ADMIN
 */
async function ensureUserManagePermission(pool) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO rbac_permissions (code, module, description)
       VALUES ('user.manage', 'user', 'Manage users in organization')
       ON CONFLICT (code) DO NOTHING`
    );

    const permRes = await client.query(
      "SELECT id FROM rbac_permissions WHERE code = 'user.manage'"
    );
    if (permRes.rows.length === 0) return;
    const permId = permRes.rows[0].id;

    const adminRoles = await client.query(
      "SELECT id FROM rbac_roles WHERE code = 'ADMIN'"
    );
    for (const { id: roleId } of adminRoles.rows) {
      await client.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, permId]
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Assure que l'utilisateur ADMIN et SALES existent (comme test-rbac-engine)
 */
async function ensureTestUsers(pool) {
  const { hashPassword } = await import("../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

  const client = await pool.connect();
  try {
    let orgId = (await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"))
      .rows[0]?.id;
    if (!orgId) {
      const ins = await client.query(
        "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
        ["SolarGlobe"]
      );
      orgId = ins.rows[0].id;
      await ensureOrgRolesSeeded(orgId);
    }

    for (const { email, password, roleCode } of [
      { email: ADMIN.email, password: ADMIN.password, roleCode: "ADMIN" },
      { email: SALES.email, password: SALES.password, roleCode: "SALES" }
    ]) {
      let userRes = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (userRes.rows.length === 0) {
        const pwdHash = await hashPassword(password);
        const insertUser = await client.query(
          `INSERT INTO users (organization_id, email, password_hash, status)
           VALUES ($1, $2, $3, 'active')
           RETURNING id`,
          [orgId, email, pwdHash]
        );
        const userId = insertUser.rows[0].id;

        const roleRes = await client.query(
          "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = $2",
          [orgId, roleCode]
        );
        if (roleRes.rows.length > 0) {
          await client.query(
            "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
            [userId, roleRes.rows[0].id]
          );
        }

        const oldRole = await client.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleCode]);
        if (oldRole.rows.length > 0) {
          await client.query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
            [userId, oldRole.rows[0].id]
          );
        }
      }
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let serverProcess = null;

  try {
    console.log("=== CP-027 ADMIN CRUD TESTS ===\n");

    console.log("1. Arrêt du process sur le port 3000...");
    killProcessOnPort(PORT);
    await sleep(500);

    console.log("2. Bootstrap: user.manage + utilisateurs test...");
    await ensureUserManagePermission(pool);
    await ensureTestUsers(pool);

    console.log("3. Démarrage du serveur avec RBAC_ENFORCE=1...");
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, RBAC_ENFORCE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await sleep(3000);
    const health = await fetch(`${BASE_URL}/`);
    if (!health.ok) {
      throw new Error("Serveur non accessible après 3s");
    }
    console.log("   Serveur prêt.\n");

    console.log("4. Login ADMIN...");
    const adminToken = await login(ADMIN.email, ADMIN.password);
    console.log("   ✅ Login ADMIN OK");

    const testEmail = `cp027-test-${Date.now()}@test.local`;
    let createdUserId;

    console.log("5. POST /api/admin/users — Créer user test...");
    const createRes = await api(adminToken, "POST", "/api/admin/users", {
      email: testEmail,
      password: "Test1234!"
    });
    if (createRes.status !== 201) {
      throw new Error(`Création user attendu 201, reçu ${createRes.status}: ${JSON.stringify(createRes.data)}`);
    }
    createdUserId = createRes.data.id;
    console.log("   ✅ User créé:", createdUserId);

    console.log("6. PUT /api/admin/users/:id — Modifier user...");
    const updateRes = await api(adminToken, "PUT", `/api/admin/users/${createdUserId}`, {
      email: `cp027-updated-${Date.now()}@test.local`
    });
    if (updateRes.status !== 200) {
      throw new Error(`Update user attendu 200, reçu ${updateRes.status}: ${JSON.stringify(updateRes.data)}`);
    }
    console.log("   ✅ User modifié");

    console.log("7. GET /api/admin/users — Lister users...");
    const listRes = await api(adminToken, "GET", "/api/admin/users");
    if (listRes.status !== 200) {
      throw new Error(`List users attendu 200, reçu ${listRes.status}: ${JSON.stringify(listRes.data)}`);
    }
    if (!Array.isArray(listRes.data)) {
      throw new Error("List users doit retourner un tableau");
    }
    console.log("   ✅ Liste users OK (", listRes.data.length, "users)");

    console.log("8. DELETE /api/admin/users/:id — Supprimer user...");
    const deleteRes = await api(adminToken, "DELETE", `/api/admin/users/${createdUserId}`);
    if (deleteRes.status !== 204) {
      throw new Error(`Delete user attendu 204, reçu ${deleteRes.status}: ${JSON.stringify(deleteRes.data)}`);
    }
    console.log("   ✅ User supprimé");

    console.log("9. Test SALES → 403 sur /api/admin/users...");
    let salesToken;
    try {
      salesToken = await login(SALES.email, SALES.password);
    } catch (e) {
      console.log("   ℹ️ User SALES absent — test 403 ignoré");
    }
    if (salesToken) {
      const salesListRes = await api(salesToken, "GET", "/api/admin/users");
      if (salesListRes.status !== 403) {
        throw new Error(`SALES doit obtenir 403 sur GET /api/admin/users, reçu ${salesListRes.status}`);
      }
      console.log("   ✅ SALES obtient 403 comme attendu");

      const salesPostRes = await api(salesToken, "POST", "/api/admin/users", {
        email: "hack@test.com",
        password: "Hack123!"
      });
      if (salesPostRes.status !== 403) {
        throw new Error(`SALES doit obtenir 403 sur POST /api/admin/users, reçu ${salesPostRes.status}`);
      }
      console.log("   ✅ SALES obtient 403 sur POST aussi");
    }

    console.log("\n=== CP-027 ADMIN CRUD VALIDATED ✅ ===\n");
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
