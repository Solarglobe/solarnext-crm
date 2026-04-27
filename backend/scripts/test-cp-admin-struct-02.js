/**
 * CP-ADMIN-STRUCT-02 — Tests structure équipes/agences/affectations
 * Usage: npm run migrate:up && node scripts/test-cp-admin-struct-02.js
 *
 * 1) Boot serveur RBAC_ENFORCE=1
 * 2) Créer une agency
 * 3) Créer une team liée à cette agency
 * 4) Créer un user
 * 5) Affecter user à team + agency
 * 6) Vérifier user_team OK, user_agency OK
 * 7) missions/meta fonctionne toujours
 * 8) Tenter cross-org → doit échouer (403 ou 400)
 * 9) Cleanup final
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
  const cleanup = {
    agencyIds: [],
    teamIds: [],
    userIds: []
  };

  try {
    console.log("=== CP-ADMIN-STRUCT-02 Tests ===\n");

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

    // Org + Admin
    const orgRes = await pool.query(
      "SELECT id FROM organizations WHERE name = 'SolarGlobe' LIMIT 1"
    );
    const orgId = orgRes.rows[0]?.id;
    assert(orgId, "Organisation SolarGlobe doit exister");

    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    await ensureOrgRolesSeeded(orgId);

    const ensureAdmin = async () => {
      let u = await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
      if (u.rows.length === 0) {
        const pwdHash = await hashPassword(adminPassword);
        const ins = await pool.query(
          `INSERT INTO users (organization_id, email, password_hash, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
          [orgId, adminEmail, pwdHash]
        );
        const userId = ins.rows[0].id;
        cleanup.userIds.push(userId);
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
        const legRes = await pool.query("SELECT id FROM roles WHERE name = 'ADMIN'");
        if (legRes.rows.length > 0) {
          await pool.query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
            [userId, legRes.rows[0].id]
          );
        }
      }
    };
    await ensureAdmin();

    const loginRes = await login(adminEmail, adminPassword);
    assert(loginRes.status === 200, `Login ADMIN attendu 200, reçu ${loginRes.status}`);
    const adminToken = loginRes.data.token;

    // 2) Créer une agency
    console.log("2. Créer une agency...");
    let r = await api(adminToken, "POST", "/api/admin/agencies", { name: "Agence Test CP-STRUCT-02" });
    assert(r.status === 201, `POST /api/admin/agencies attendu 201, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    const agencyId = r.data.id;
    cleanup.agencyIds.push(agencyId);
    console.log("   ✅ Agency créée:", agencyId);

    // 3) Créer une team liée à cette agency
    console.log("3. Créer une team...");
    r = await api(adminToken, "POST", "/api/admin/teams", {
      name: "Équipe Test CP-STRUCT-02",
      agency_id: agencyId
    });
    assert(r.status === 201, `POST /api/admin/teams attendu 201, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    const teamId = r.data.id;
    cleanup.teamIds.push(teamId);
    console.log("   ✅ Team créée:", teamId);

    // 4) Créer un user
    console.log("4. Créer un user...");
    const testEmail = `cp-struct02-${Date.now()}@test.local`;
    r = await api(adminToken, "POST", "/api/admin/users", {
      email: testEmail,
      password: "Test1234!",
      roleIds: []
    });
    assert(r.status === 201, `POST /api/admin/users attendu 201, reçu ${r.status}`);
    const userId = r.data.id;
    cleanup.userIds.push(userId);
    console.log("   ✅ User créé:", userId);

    // 5) Affecter user à team + agency
    console.log("5. Affecter user à team + agency...");
    r = await api(adminToken, "PUT", `/api/admin/users/${userId}/teams`, { teamIds: [teamId] });
    assert(r.status === 200, `PUT /api/admin/users/:id/teams attendu 200, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    assert(Array.isArray(r.data) && r.data.length === 1, "user_team doit contenir 1 équipe");

    r = await api(adminToken, "PUT", `/api/admin/users/${userId}/agencies`, { agencyIds: [agencyId] });
    assert(r.status === 200, `PUT /api/admin/users/:id/agencies attendu 200, reçu ${r.status}: ${JSON.stringify(r.data)}`);
    assert(Array.isArray(r.data) && r.data.length === 1, "user_agency doit contenir 1 agence");
    console.log("   ✅ Affectations OK");

    // 6) Vérifier user_team et user_agency en DB
    console.log("6. Vérifier user_team et user_agency...");
    const utRes = await pool.query(
      "SELECT 1 FROM user_team WHERE user_id = $1 AND team_id = $2",
      [userId, teamId]
    );
    assert(utRes.rows.length === 1, "user_team doit exister en DB");

    const uaRes = await pool.query(
      "SELECT 1 FROM user_agency WHERE user_id = $1 AND agency_id = $2",
      [userId, agencyId]
    );
    assert(uaRes.rows.length === 1, "user_agency doit exister en DB");
    console.log("   ✅ user_team et user_agency OK");

    // 7) missions/meta fonctionne toujours
    console.log("7. missions/meta non régression...");
    r = await api(adminToken, "GET", "/api/missions/meta");
    assert(r.status === 200, `GET /api/missions/meta attendu 200, reçu ${r.status}`);
    assert(r.data.users && r.data.teams && r.data.agencies !== undefined, "meta doit retourner users, teams, agencies");
    console.log("   ✅ missions/meta OK");

    // 8) Cross-org — créer org2 + team2, tenter d'affecter team2 à user (org1)
    console.log("8. Cross-org doit échouer...");
    const org2Res = await pool.query(
      `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Org2-CrossTest') RETURNING id`
    );
    const org2Id = org2Res.rows[0].id;

    const agency2Res = await pool.query(
      `INSERT INTO agencies (organization_id, name) VALUES ($1, 'Agency Org2') RETURNING id`,
      [org2Id]
    );
    const agency2Id = agency2Res.rows[0].id;

    const team2Res = await pool.query(
      `INSERT INTO teams (organization_id, agency_id, name) VALUES ($1, $2, 'Team Org2') RETURNING id`,
      [org2Id, agency2Id]
    );
    const team2Id = team2Res.rows[0].id;

    r = await api(adminToken, "PUT", `/api/admin/users/${userId}/teams`, { teamIds: [teamId, team2Id] });
    assert(
      r.status === 400 || r.status === 403,
      `Cross-org PUT teams doit échouer (400 ou 403), reçu ${r.status}: ${JSON.stringify(r.data)}`
    );
    console.log("   ✅ Cross-org bloqué (400/403)");

    // Cleanup org2 (rbac_roles avant org pour éviter SET NULL → doublons)
    await pool.query(
      "DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
      [org2Id]
    );
    await pool.query(
      "DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)",
      [org2Id]
    );
    await pool.query("DELETE FROM rbac_roles WHERE organization_id = $1", [org2Id]);
    await pool.query("DELETE FROM teams WHERE id = $1", [team2Id]);
    await pool.query("DELETE FROM agencies WHERE id = $1", [agency2Id]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [org2Id]);

    console.log("\n=== CP-ADMIN-STRUCT-02 VALIDATED ✅ ===\n");
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
    throw err;
  } finally {
    // 9) Cleanup
    console.log("9. Cleanup...");
    if (cleanup.userIds.length > 0) {
      await pool.query("DELETE FROM user_team WHERE user_id = ANY($1)", [cleanup.userIds]);
      await pool.query("DELETE FROM user_agency WHERE user_id = ANY($1)", [cleanup.userIds]);
      await pool.query("DELETE FROM rbac_user_roles WHERE user_id = ANY($1)", [cleanup.userIds]);
      await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [cleanup.userIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [cleanup.userIds]);
    }
    if (cleanup.teamIds.length > 0) {
      await pool.query("DELETE FROM teams WHERE id = ANY($1)", [cleanup.teamIds]);
    }
    if (cleanup.agencyIds.length > 0) {
      await pool.query("DELETE FROM agencies WHERE id = ANY($1)", [cleanup.agencyIds]);
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
