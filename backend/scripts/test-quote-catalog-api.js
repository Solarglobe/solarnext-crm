/**
 * CP-QUOTE-002 — Tests API Catalogue devis
 * Crée orgs/users en DB, démarre le serveur, exécute les cas de test, cleanup.
 *
 * Usage: node scripts/test-quote-catalog-api.js
 * Option: USE_EXISTING_SERVER=1 ou SERVER_URL=http://localhost:3000 pour utiliser un serveur déjà lancé.
 * Prérequis: DATABASE_URL, JWT_SECRET, migrations (quote_catalog + RBAC permissions).
 * Les JWT sont générés en local (generateJWT) pour ne pas dépendre du login serveur / même DB.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

function getConnectionString() {
  const url = process.env.DATABASE_URL;
  const hostOverride = process.env.PGHOST;
  if (!hostOverride || !url) return url;
  try {
    const u = new URL(url);
    u.hostname = hostOverride;
    return u.toString();
  } catch {
    return url;
  }
}

const BACKEND_DIR = resolve(__dirname, "..");
const PORT = Number(process.env.TEST_PORT) || 5055;
const USE_EXISTING_SERVER = process.env.USE_EXISTING_SERVER === "1" || process.env.SERVER_URL != null;
const BASE_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

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

async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function api(token, method, path, body = null, baseUrl = BASE_URL) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => ({})) : {}
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error("❌ JWT_SECRET manquant");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  let serverProcess = null;
  const created = { orgA: null, orgB: null, adminA: null, adminB: null, userA: null, itemA: null, itemB: null };

  try {
    console.log("=== CP-QUOTE-002 API Tests ===\n");

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

    console.log("1. Création org A, org B...");
    const orgARes = await pool.query(
      `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-QUOTE-002 Org A') RETURNING id`
    );
    created.orgA = orgARes.rows[0].id;
    const orgBRes = await pool.query(
      `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-QUOTE-002 Org B') RETURNING id`
    );
    created.orgB = orgBRes.rows[0].id;
    await ensureOrgRolesSeeded(created.orgA);
    await ensureOrgRolesSeeded(created.orgB);
    console.log("   ✅ Org A, Org B créées\n");

    console.log("2. Création users adminA (orgA), adminB (orgB), userA (orgA, SALES)...");
    const pwd = "TestQuote002!";
    const pwdHash = await hashPassword(pwd);
    const adminAEmail = `cp-quote002-adminA-${Date.now()}@test.local`;
    const adminBEmail = `cp-quote002-adminB-${Date.now()}@test.local`;
    const userAEmail = `cp-quote002-userA-${Date.now()}@test.local`;

    let r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [created.orgA, adminAEmail, pwdHash]
    );
    created.adminA = { id: r.rows[0].id, email: adminAEmail, password: pwd };
    r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [created.orgB, adminBEmail, pwdHash]
    );
    created.adminB = { id: r.rows[0].id, email: adminBEmail, password: pwd };
    r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [created.orgA, userAEmail, pwdHash]
    );
    created.userA = { id: r.rows[0].id, email: userAEmail, password: pwd };

    const adminRoleA = await pool.query(
      `SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1`,
      [created.orgA]
    );
    const adminRoleB = await pool.query(
      `SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1`,
      [created.orgB]
    );
    const salesRole = await pool.query(
      `SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'SALES' LIMIT 1`,
      [created.orgA]
    );

    await pool.query(
      `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
      [created.adminA.id, adminRoleA.rows[0].id]
    );
    await pool.query(
      `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
      [created.adminB.id, adminRoleB.rows[0].id]
    );
    if (salesRole.rows[0]) {
      await pool.query(
        `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [created.userA.id, salesRole.rows[0].id]
      );
    }

    const legAdmin = await pool.query("SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1");
    const legSales = await pool.query("SELECT id FROM roles WHERE name = 'SALES' LIMIT 1");
    if (legAdmin.rows[0]) {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [created.adminA.id, legAdmin.rows[0].id]
      );
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [created.adminB.id, legAdmin.rows[0].id]
      );
    }
    if (legSales.rows[0]) {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [created.userA.id, legSales.rows[0].id]
      );
    }
    const loginCheck = await pool.query(
      `SELECT u.id, u.email, u.organization_id, r.name as role FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.id = $1`,
      [created.adminA.id]
    );
    assert(loginCheck.rows.length > 0, "adminA doit avoir un rôle (user_roles + roles)");
    console.log("   ✅ adminA, adminB, userA créés\n");

    const { generateJWT } = await import("../auth/auth.service.js");
    const getTokenForUser = (userId) =>
      pool
        .query(
          `SELECT u.id, u.organization_id, r.name as role
           FROM users u
           JOIN user_roles ur ON u.id = ur.user_id
           JOIN roles r ON ur.role_id = r.id
           WHERE u.id = $1
           ORDER BY CASE r.name WHEN 'SUPER_ADMIN' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'SALES' THEN 4 ELSE 99 END
           LIMIT 1`,
          [userId]
        )
        .then((r) => {
          if (r.rows.length === 0) throw new Error("User role not found");
          const row = r.rows[0];
          return generateJWT({
            id: row.id,
            organization_id: row.organization_id,
            role: row.role
          });
        });

    if (!USE_EXISTING_SERVER) {
      console.log("3. Démarrage serveur port " + PORT + "...");
      killProcessOnPort(PORT);
      await sleep(500);
      serverProcess = spawn("node", ["bootstrap.js"], {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          PORT: String(PORT),
          RBAC_ENFORCE: "1",
          DATABASE_URL: connectionString
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      await sleep(3500);
    } else {
      console.log("3. Utilisation du serveur existant (" + BASE_URL + ")...");
    }
    const health = await fetch(`${BASE_URL}/`);
    assert(health.ok, "Serveur non accessible: " + BASE_URL);
    console.log("   ✅ Serveur prêt\n");

    const tokenAdminA = await getTokenForUser(created.adminA.id);
    const tokenAdminB = await getTokenForUser(created.adminB.id);
    const tokenUserA = await getTokenForUser(created.userA.id);

    // a) Non-auth => 401
    console.log("a) GET sans auth => 401");
    let res = await fetch(`${BASE_URL}/api/admin/quote-catalog`);
    assert(res.status === 401, `Attendu 401, reçu ${res.status}`);
    console.log("   ✅ 401\n");

    // b) Non-admin => 403
    console.log("b) GET avec userA (SALES) => 403");
    res = await api(tokenUserA, "GET", "/api/admin/quote-catalog");
    assert(res.status === 403, `Attendu 403, reçu ${res.status}`);
    console.log("   ✅ 403\n");

    // c) AdminA POST create => 201
    console.log("c) AdminA POST create => 201");
    res = await api(tokenAdminA, "POST", "/api/admin/quote-catalog", {
      name: "Pack Standard",
      category: "PANEL",
      pricing_mode: "FIXED",
      sale_price_ht_cents: 100000,
      purchase_price_ht_cents: 70000,
      default_vat_rate_bps: 2000
    });
    assert(res.status === 201, `Attendu 201, reçu ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.item && res.data.item.id, "item retourné avec id");
    assert(res.data.item.name === "Pack Standard", "item.name Pack Standard");
    created.itemA = res.data.item.id;
    console.log("   ✅ 201 + item\n");

    // d) AdminA POST duplicate name => 409
    console.log("d) AdminA POST même name => 409");
    res = await api(tokenAdminA, "POST", "/api/admin/quote-catalog", {
      name: "Pack Standard",
      category: "INVERTER"
    });
    assert(res.status === 409, `Attendu 409, reçu ${res.status}`);
    assert(
      (res.data.error || "").includes("already exists"),
      "Message 409 doit mentionner already exists"
    );
    console.log("   ✅ 409\n");

    // e) AdminB POST same name (org B) => 201
    console.log("e) AdminB POST même name (org B) => 201");
    res = await api(tokenAdminB, "POST", "/api/admin/quote-catalog", {
      name: "Pack Standard",
      category: "SERVICE"
    });
    assert(res.status === 201, `Attendu 201, reçu ${res.status}`);
    created.itemB = res.data.item.id;
    console.log("   ✅ 201 (scoping OK)\n");

    // f) AdminA GET list => only orgA
    console.log("f) AdminA GET list => seulement org A");
    res = await api(tokenAdminA, "GET", "/api/admin/quote-catalog");
    assert(res.status === 200, `Attendu 200, reçu ${res.status}`);
    assert(Array.isArray(res.data.items), "items array");
    assert(res.data.items.length === 1, "AdminA ne voit qu'un item (org A)");
    assert(res.data.items[0].organization_id === created.orgA, "item org A");
    console.log("   ✅ 1 item org A\n");

    // g) AdminA PATCH item => updated
    console.log("g) AdminA PATCH item => updated");
    res = await api(tokenAdminA, "PATCH", `/api/admin/quote-catalog/${created.itemA}`, {
      description: "Description mise à jour",
      sale_price_ht_cents: 120000
    });
    assert(res.status === 200, `Attendu 200, reçu ${res.status}`);
    assert(res.data.item.description === "Description mise à jour", "description updated");
    assert(res.data.item.sale_price_ht_cents === 120000, "sale_price_ht_cents 120000");
    console.log("   ✅ PATCH OK\n");

    // h) AdminA deactivate => is_active false
    console.log("h) AdminA deactivate => is_active false");
    res = await api(tokenAdminA, "POST", `/api/admin/quote-catalog/${created.itemA}/deactivate`);
    assert(res.status === 200, `Attendu 200, reçu ${res.status}`);
    assert(res.data.item.is_active === false, "is_active false");
    console.log("   ✅ deactivate OK\n");

    // i) AdminA GET list default => item absent
    console.log("i) AdminA GET list (default) => item absent");
    res = await api(tokenAdminA, "GET", "/api/admin/quote-catalog");
    assert(res.status === 200 && res.data.items.length === 0, "liste vide sans include_inactive");
    console.log("   ✅ 0 items\n");

    // j) AdminA GET list include_inactive=true => item présent
    console.log("j) AdminA GET list include_inactive=true => item présent");
    res = await api(tokenAdminA, "GET", "/api/admin/quote-catalog?include_inactive=true");
    assert(res.status === 200 && res.data.items.length === 1, "1 item avec include_inactive");
    assert(res.data.items[0].is_active === false, "item is_active false");
    console.log("   ✅ 1 item (inactif)\n");

    // k) AdminA PATCH id from org B => 404
    console.log("k) AdminA PATCH item org B => 404");
    res = await api(tokenAdminA, "PATCH", `/api/admin/quote-catalog/${created.itemB}`, {
      name: "Hack"
    });
    assert(res.status === 404, `Attendu 404, reçu ${res.status}`);
    console.log("   ✅ 404 (anti-leak)\n");

    console.log("PASS CP-QUOTE-002");
  } catch (err) {
    console.error("\n❌ FAIL:", err.message || err);
    throw err;
  } finally {
    console.log("Cleanup...");
    const client = await pool.connect();
    try {
      if (created.orgA || created.orgB) {
        await client.query(
          "DELETE FROM quote_catalog_items WHERE organization_id = ANY($1)",
          [[created.orgA, created.orgB].filter(Boolean)]
        );
      }
      const userIds = [created.adminA?.id, created.adminB?.id, created.userA?.id].filter(Boolean);
      if (userIds.length) {
        await client.query("DELETE FROM rbac_user_roles WHERE user_id = ANY($1)", [userIds]);
        await client.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [userIds]);
        await client.query("DELETE FROM users WHERE id = ANY($1)", [userIds]);
      }
      if (created.orgA) {
        await client.query("DELETE FROM pipeline_stages WHERE organization_id = $1", [created.orgA]);
        await client.query(
          "DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
          [created.orgA]
        );
        await client.query(
          "DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
          [created.orgA]
        );
        await client.query("DELETE FROM rbac_roles WHERE organization_id = $1", [created.orgA]);
        await client.query("DELETE FROM organizations WHERE id = $1", [created.orgA]);
      }
      if (created.orgB) {
        await client.query("DELETE FROM pipeline_stages WHERE organization_id = $1", [created.orgB]);
        await client.query(
          "DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
          [created.orgB]
        );
        await client.query(
          "DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
          [created.orgB]
        );
        await client.query("DELETE FROM rbac_roles WHERE organization_id = $1", [created.orgB]);
        await client.query("DELETE FROM organizations WHERE id = $1", [created.orgB]);
      }
    } finally {
      client.release();
      await pool.end();
    }
    if (serverProcess && !USE_EXISTING_SERVER) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode == null) serverProcess.kill("SIGKILL");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
