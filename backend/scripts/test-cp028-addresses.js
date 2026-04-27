/**
 * CP-028 — Tests Address (DB + API)
 * Usage: node scripts/test-cp028-addresses.js
 * Prérequis: DATABASE_URL, JWT_SECRET dans .env.dev
 * Migrations CP-028 appliquées (addresses, leads.site_address_id, leads.billing_address_id)
 *
 * Le script :
 * - Lance le serveur
 * - Bootstrap: org A + user A, org B + user B
 * - POST /addresses (postal only) → lat/lon null, precision null
 * - POST /addresses/verify-pin → MANUAL_PIN_BUILDING, is_geo_verified true
 * - Org isolation: user B tente GET/PATCH address A → 404
 * - FK lead: PATCH lead avec site_address_id, read lead => site_address_id présent
 * - Cleanup explicite
 */

import "../config/register-local-env.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";
import pg from "pg";

import { isBuildingPrecision, canRunPVGIS } from "../modules/address/address.guards.js";

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

    const orgBEmail = `cp028-orgb-${Date.now()}@test.local`;
    const orgB = (await client.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", ["Test Org B"])).rows[0].id;
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
  let createdIds = { addressId: null, leadId: null, orgB: null, userB: null };

  try {
    console.log("=== CP-028 ADDRESS TESTS ===\n");

    console.log("1. Arrêt du process sur le port 3000...");
    killProcessOnPort(PORT);
    await sleep(500);

    console.log("2. Bootstrap: org A + user A, org B + user B...");
    const { adminEmail, adminPwd, orgBEmail, orgBEmailPwd } = await ensureTestUsers(pool);
    createdIds.orgB = (await pool.query("SELECT id FROM organizations WHERE name = 'Test Org B' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
    createdIds.userB = (await pool.query("SELECT id FROM users WHERE email = $1", [orgBEmail])).rows[0]?.id;

    console.log("3. Démarrage du serveur...");
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    await sleep(3000);
    const health = await fetch(`${BASE_URL}/`);
    if (!health.ok) throw new Error("Serveur non accessible après 3s");
    console.log("   Serveur prêt.\n");

    console.log("4. Login user A (org A)...");
    const tokenA = await login(adminEmail, adminPwd);
    ok("Login user A");

    console.log("5. POST /api/addresses (postal only)...");
    const createRes = await api(tokenA, "POST", "/api/addresses", {
      label: "Site",
      address_line1: "10 rue de Rivoli",
      postal_code: "75001",
      city: "Paris",
      country_code: "FR"
    });
    if (createRes.status !== 201) {
      fail("POST /api/addresses", new Error(`Attendu 201, reçu ${createRes.status}: ${JSON.stringify(createRes.data)}`));
    } else {
      createdIds.addressId = createRes.data.id;
      if (createRes.data.lat != null || createRes.data.lon != null) {
        fail("Adresse postal only", new Error("lat/lon devraient être null"));
      } else {
        ok("POST /api/addresses", "lat/lon null");
      }
    }

    console.log("6. Vérifier guard PVGIS bloquant (precision null)...");
    const addrPostal = createRes.data;
    if (addrPostal) {
      const canPVGIS = canRunPVGIS(addrPostal);
      const isBuilding = isBuildingPrecision(addrPostal);
      if (canPVGIS || isBuilding) {
        fail("Guard PVGIS", new Error("canRunPVGIS devrait être false pour adresse sans geo"));
      } else {
        ok("Guard PVGIS bloquant", "precision null => canRunPVGIS false");
      }
    }

    console.log("7. POST /api/addresses/verify-pin...");
    const verifyRes = await api(tokenA, "POST", "/api/addresses/verify-pin", {
      address_id: createdIds.addressId,
      lat: 48.8566,
      lon: 2.3522
    });
    if (verifyRes.status !== 200) {
      fail("POST verify-pin", new Error(`Attendu 200, reçu ${verifyRes.status}: ${JSON.stringify(verifyRes.data)}`));
    } else {
      if (verifyRes.data.geo_precision_level !== "MANUAL_PIN_BUILDING" || !verifyRes.data.is_geo_verified) {
        fail("verify-pin", new Error(`precision=${verifyRes.data.geo_precision_level}, verified=${verifyRes.data.is_geo_verified}`));
      } else {
        ok("POST verify-pin", "MANUAL_PIN_BUILDING + is_geo_verified true");
      }
    }

    console.log("8. Org isolation: user B tente GET address A...");
    const tokenB = await login(orgBEmail, orgBEmailPwd);
    const getOtherRes = await api(tokenB, "GET", `/api/addresses/${createdIds.addressId}`);
    if (getOtherRes.status !== 404) {
      fail("Org isolation GET", new Error(`Attendu 404, reçu ${getOtherRes.status}`));
    } else {
      ok("Org isolation GET", "404 sur address autre org");
    }

    console.log("9. Org isolation: user B tente PATCH address A...");
    const patchOtherRes = await api(tokenB, "PATCH", `/api/addresses/${createdIds.addressId}`, { city: "Hack" });
    if (patchOtherRes.status !== 404) {
      fail("Org isolation PATCH", new Error(`Attendu 404, reçu ${patchOtherRes.status}`));
    } else {
      ok("Org isolation PATCH", "404 sur address autre org");
    }

    console.log("10. FK lead: créer lead, PATCH site_address_id, read lead...");
    const orgA = (await pool.query("SELECT organization_id FROM users WHERE email = $1", [adminEmail])).rows[0]?.organization_id;
    const stageA = (await pool.query("SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1", [orgA])).rows[0]?.id;
    if (!stageA) {
      fail("FK lead", new Error("Aucun stage pipeline pour org A"));
    } else {
      const leadRes = await api(tokenA, "POST", "/api/leads", {
        first_name: "Test",
        last_name: "CP028",
        stage_id: stageA
      });
      if (leadRes.status !== 200 && leadRes.status !== 201) {
        fail("Création lead", new Error(`Attendu 200/201, reçu ${leadRes.status}: ${JSON.stringify(leadRes.data)}`));
      } else {
        createdIds.leadId = leadRes.data.id;

        const patchLeadRes = await api(tokenA, "PUT", `/api/leads/${createdIds.leadId}`, {
          site_address_id: createdIds.addressId
        });
        if (patchLeadRes.status !== 200) {
          fail("PATCH lead site_address_id", new Error(`Attendu 200, reçu ${patchLeadRes.status}: ${JSON.stringify(patchLeadRes.data)}`));
        } else {
          const readLeadRes = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}`);
          if (readLeadRes.status !== 200) {
            fail("GET lead", new Error(`Attendu 200, reçu ${readLeadRes.status}`));
          } else {
            const lead = readLeadRes.data.lead || readLeadRes.data;
            if (lead?.site_address_id !== createdIds.addressId) {
              fail("FK lead", new Error(`site_address_id attendu ${createdIds.addressId}, reçu ${lead?.site_address_id}`));
            } else {
              ok("FK lead", "site_address_id présent sur lead");
            }
          }
        }
      }
    }

    console.log("\n11. Cleanup...");
    const client = await pool.connect();
    try {
      if (createdIds.leadId) await client.query("DELETE FROM leads WHERE id = $1", [createdIds.leadId]);
      if (createdIds.addressId) await client.query("DELETE FROM addresses WHERE id = $1", [createdIds.addressId]);
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
    console.log("RÉSUMÉ CP-028");
    console.log("=".repeat(60));
    console.log(`✅ Tests réussis: ${results.passed}/${results.total}`);
    console.log(`❌ Tests échoués: ${results.failed}`);
    if (results.failed > 0) {
      process.exit(1);
    }
    console.log("\n✅ CP-028 PASS\n");
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
