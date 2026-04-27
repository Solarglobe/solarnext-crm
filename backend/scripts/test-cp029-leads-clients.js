/**
 * CP-029 — Tests Lead/Client Record (DB + API)
 * Usage: node scripts/test-cp029-leads-clients.js
 * Prérequis: DATABASE_URL, JWT_SECRET dans .env.dev
 * Migrations CP-029 appliquées
 *
 * Le script :
 * - Login user A org SolarGlobe
 * - Create lead minimal POST /api/leads (status LEAD)
 * - GET /api/leads?view=leads → contient lead
 * - GET /api/leads?view=clients → ne contient pas lead
 * - PATCH status => CLIENT
 * - GET /api/leads?view=leads → ne contient plus
 * - GET /api/leads?view=clients → contient
 * - Test conso MONTHLY : PATCH /api/leads/:id/consumption mode MONTHLY + 12 mois
 * - Vérifie annual_calculated = somme
 * - Test org isolation : user B autre org tente GET lead A => 404
 * - Cleanup
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


const results = { passed: 0, failed: 0, total: 0 };

function ok(name, detail = "") {
  results.passed++;
  results.total++;
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  results.failed++;
  results.total++;
  console.log(`❌ ${name}`);
  console.log(`   Erreur: ${error.message || error}`);
}

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
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {}
  };
}

async function ensureTestUsers(pool) {
  const { hashPassword } = await import("../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

  const client = await pool.connect();
  try {
    let orgA = (await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1")).rows[0]?.id;
    if (!orgA) {
      const ins = await client.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", ["SolarGlobe"]);
      orgA = ins.rows[0].id;
      await ensureOrgRolesSeeded(orgA);
    }

    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPwd = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

    let userA = (await client.query("SELECT id FROM users WHERE email = $1", [adminEmail])).rows[0]?.id;
    if (!userA) {
      const pwdHash = await hashPassword(adminPwd);
      const ins = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
        [orgA, adminEmail, pwdHash]
      );
      userA = ins.rows[0].id;

      const roleRes = await client.query(
        "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN'",
        [orgA]
      );
      if (roleRes.rows.length > 0) {
        await client.query(
          "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [userA, roleRes.rows[0].id]
        );
      }
      const oldRole = await client.query("SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1");
      if (oldRole.rows.length > 0) {
        await client.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [userA, oldRole.rows[0].id]
        );
      }
    }

    const orgBEmail = `cp029-orgb-${Date.now()}@test.local`;
    const orgB = (await client.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", ["Test Org B CP029"])).rows[0].id;
    await ensureOrgRolesSeeded(orgB);

    const pwdHashB = await hashPassword("Test1234!");
    const userB = (
      await client.query(
        `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
        [orgB, orgBEmail, pwdHashB]
      )
    ).rows[0].id;

    const roleB = await client.query(
      "SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'SALES'",
      [orgB]
    );
    if (roleB.rows.length > 0) {
      await client.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [userB, roleB.rows[0].id]
      );
    }
    const oldRoleB = await client.query("SELECT id FROM roles WHERE name = 'SALES' LIMIT 1");
    if (oldRoleB.rows.length > 0) {
      await client.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [userB, oldRoleB.rows[0].id]
      );
    }

    return {
      orgA,
      orgB,
      adminEmail,
      adminPwd,
      orgBEmail,
      orgBEmailPwd: "Test1234!"
    };
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
  let createdIds = { leadId: null, orgB: null, userB: null };

  try {
    console.log("=== CP-029 LEAD/CLIENT RECORD TESTS ===\n");

    console.log("1. Arrêt du process sur le port 3000...");
    killProcessOnPort(PORT);
    await sleep(500);

    console.log("2. Bootstrap: org A + user A, org B + user B...");
    const { adminEmail, adminPwd, orgBEmail, orgBEmailPwd } = await ensureTestUsers(pool);
    createdIds.orgB = (await pool.query("SELECT id FROM organizations WHERE name = 'Test Org B CP029' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
    createdIds.userB = (await pool.query("SELECT id FROM users WHERE email = $1", [orgBEmail])).rows[0]?.id;

    console.log("3. Démarrage du serveur...");
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await sleep(5000);
    let health;
    for (let i = 0; i < 5; i++) {
      try {
        health = await fetch(`${BASE_URL}/`);
        if (health.ok) break;
      } catch (_) {
        await sleep(2000);
      }
    }
    if (!health || !health.ok) throw new Error("Serveur non accessible après démarrage");
    console.log("   Serveur prêt.\n");

    console.log("4. Login user A (org SolarGlobe)...");
    const tokenA = await login(adminEmail, adminPwd);
    ok("Login user A");

    const orgA = (await pool.query("SELECT organization_id FROM users WHERE email = $1", [adminEmail])).rows[0]?.organization_id;
    const stageA = (await pool.query("SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1", [orgA])).rows[0]?.id;
    if (!stageA) {
      fail("Pipeline stage", new Error("Aucun stage pipeline pour org A"));
    } else {
      console.log("5. POST /api/leads (lead minimal, status LEAD)...");
      const createRes = await api(tokenA, "POST", "/api/leads", {
        full_name: "Test CP029",
        stage_id: stageA
      });
      if (createRes.status !== 200 && createRes.status !== 201) {
        fail("Create lead", new Error(`Attendu 200/201, reçu ${createRes.status}: ${JSON.stringify(createRes.data)}`));
      } else {
        createdIds.leadId = createRes.data.id;
        if (createRes.data.status !== "LEAD") {
          fail("Status default LEAD", new Error(`Reçu ${createRes.data.status}`));
        } else {
          ok("Create lead", "status=LEAD");
        }
      }

      console.log("6. GET /api/leads?view=leads → contient lead...");
      const leadsRes = await api(tokenA, "GET", "/api/leads?view=leads");
      if (leadsRes.status !== 200) {
        fail("GET view=leads", new Error(`Attendu 200, reçu ${leadsRes.status}`));
      } else {
        const found = Array.isArray(leadsRes.data) && leadsRes.data.some((l) => l.id === createdIds.leadId);
        if (!found) {
          fail("Lead dans view=leads", new Error("Lead non trouvé"));
        } else {
          ok("GET view=leads", "contient lead");
        }
      }

      console.log("7. GET /api/leads?view=clients → ne contient pas lead...");
      const clientsRes = await api(tokenA, "GET", "/api/leads?view=clients");
      if (clientsRes.status !== 200) {
        fail("GET view=clients", new Error(`Attendu 200, reçu ${clientsRes.status}`));
      } else {
        const found = Array.isArray(clientsRes.data) && clientsRes.data.some((l) => l.id === createdIds.leadId);
        if (found) {
          fail("Lead pas dans view=clients", new Error("Lead ne devrait pas être dans clients"));
        } else {
          ok("GET view=clients", "ne contient pas lead");
        }
      }

      console.log("8. PATCH status => CLIENT...");
      const patchRes = await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}`, { status: "CLIENT" });
      if (patchRes.status !== 200) {
        fail("PATCH status CLIENT", new Error(`Attendu 200, reçu ${patchRes.status}: ${JSON.stringify(patchRes.data)}`));
      } else {
        ok("PATCH status CLIENT");
      }

      console.log("9. GET /api/leads?view=leads → ne contient plus...");
      const leadsAfterRes = await api(tokenA, "GET", "/api/leads?view=leads");
      if (leadsAfterRes.status !== 200) {
        fail("GET view=leads après", new Error(`Attendu 200, reçu ${leadsAfterRes.status}`));
      } else {
        const found = Array.isArray(leadsAfterRes.data) && leadsAfterRes.data.some((l) => l.id === createdIds.leadId);
        if (found) {
          fail("Lead plus dans view=leads", new Error("Lead ne devrait plus être dans leads"));
        } else {
          ok("GET view=leads après", "ne contient plus lead");
        }
      }

      console.log("10. GET /api/leads?view=clients → contient...");
      const clientsAfterRes = await api(tokenA, "GET", "/api/leads?view=clients");
      if (clientsAfterRes.status !== 200) {
        fail("GET view=clients après", new Error(`Attendu 200, reçu ${clientsAfterRes.status}`));
      } else {
        const found = Array.isArray(clientsAfterRes.data) && clientsAfterRes.data.some((l) => l.id === createdIds.leadId);
        if (!found) {
          fail("Lead dans view=clients", new Error("Lead devrait être dans clients"));
        } else {
          ok("GET view=clients après", "contient lead");
        }
      }

      console.log("11. PATCH status => LEAD pour test conso...");
      await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}`, { status: "LEAD" });

      console.log("12. PATCH /api/leads/:id/consumption mode MONTHLY + 12 mois...");
      const months = [];
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        const kwh = m * 100;
        sum += kwh;
        months.push({ month: m, kwh });
      }
      const consumptionRes = await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}/consumption`, {
        consumption_mode: "MONTHLY",
        year: new Date().getFullYear(),
        months
      });
      if (consumptionRes.status !== 200) {
        fail("PATCH consumption", new Error(`Attendu 200, reçu ${consumptionRes.status}: ${JSON.stringify(consumptionRes.data)}`));
      } else {
        const calc = consumptionRes.data.consumption_annual_calculated_kwh;
        if (calc !== sum) {
          fail("consumption_annual_calculated", new Error(`Attendu ${sum}, reçu ${calc}`));
        } else {
          ok("PATCH consumption MONTHLY", `annual_calculated=${sum}`);
        }
      }

      console.log("13. Org isolation: user B tente GET lead A...");
      const tokenB = await login(orgBEmail, orgBEmailPwd);
      const getOtherRes = await api(tokenB, "GET", `/api/leads/${createdIds.leadId}`);
      if (getOtherRes.status !== 404 && getOtherRes.status !== 403) {
        fail("Org isolation GET", new Error(`Attendu 404/403, reçu ${getOtherRes.status}`));
      } else {
        ok("Org isolation GET", `${getOtherRes.status} sur lead autre org`);
      }
    }

    console.log("\n14. Cleanup...");
    const client = await pool.connect();
    try {
      if (createdIds.leadId) await client.query("DELETE FROM lead_consumption_monthly WHERE lead_id = $1", [createdIds.leadId]);
      if (createdIds.leadId) await client.query("DELETE FROM leads WHERE id = $1", [createdIds.leadId]);
      if (createdIds.userB) {
        await client.query("DELETE FROM rbac_user_roles WHERE user_id = $1", [createdIds.userB]);
        await client.query("DELETE FROM user_roles WHERE user_id = $1", [createdIds.userB]);
        await client.query("DELETE FROM users WHERE id = $1", [createdIds.userB]);
      }
      if (createdIds.orgB) {
        await client.query("DELETE FROM pipeline_stages WHERE organization_id = $1", [createdIds.orgB]);
        await client.query("DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)", [createdIds.orgB]);
        await client.query("DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)", [createdIds.orgB]);
        await client.query("DELETE FROM rbac_roles WHERE organization_id = $1", [createdIds.orgB]);
        await client.query("DELETE FROM organizations WHERE id = $1", [createdIds.orgB]);
      }
      ok("Cleanup", "Données test supprimées");
    } catch (e) {
      fail("Cleanup", e);
    } finally {
      client.release();
    }

    console.log("\n" + "=".repeat(60));
    console.log("RÉSUMÉ CP-029");
    console.log("=".repeat(60));
    console.log(`✅ Tests réussis: ${results.passed}/${results.total}`);
    console.log(`❌ Tests échoués: ${results.failed}`);
    if (results.failed > 0) {
      process.exit(1);
    }
    console.log("\n✅ CP-029 PASS\n");
  } catch (err) {
    console.error("\n❌ Erreur fatale:", err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
  }
}

main().catch(() => process.exit(1));
