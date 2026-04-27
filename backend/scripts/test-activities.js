/**
 * CP-030 — Tests Activités CRM
 * Usage: node scripts/test-activities.js
 * Prérequis: DATABASE_URL, JWT_SECRET dans .env.dev
 * Migration CP-030 (lead_activities) appliquée
 *
 * Le script :
 * - Login user org A
 * - Créer lead
 * - POST activité NOTE → OK
 * - GET activités → contient NOTE
 * - PATCH lead status LEAD→CLIENT → vérifier STATUS_CHANGE créé
 * - PATCH stage → vérifier STAGE_CHANGE créé
 * - Créer address + lier au lead + verify-pin → vérifier ADDRESS_VERIFIED créé
 * - Org isolation : user B autre org ne peut pas lire les activités (404/403)
 * - Soft delete : DELETE note → n'apparaît plus dans GET
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

    const orgBEmail = `activities-orgb-${Date.now()}@test.local`;
    const orgB = (await client.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", ["Test Org B Activities"])).rows[0].id;
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
  let createdIds = { leadId: null, noteActivityId: null, addressId: null, orgB: null, userB: null };

  try {
    console.log("=== CP-030 ACTIVITIES TESTS ===\n");

    console.log("1. Arrêt du process sur le port 3000...");
    killProcessOnPort(PORT);
    await sleep(500);

    console.log("2. Bootstrap: org A + user A, org B + user B...");
    const { adminEmail, adminPwd, orgBEmail, orgBEmailPwd } = await ensureTestUsers(pool);
    createdIds.orgB = (await pool.query("SELECT id FROM organizations WHERE name = 'Test Org B Activities' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
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
    const stageA = (await pool.query("SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1", [orgA])).rows[0]?.id;
    const stageA2 = (await pool.query("SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC OFFSET 1 LIMIT 1", [orgA])).rows[0]?.id;

    if (!stageA) {
      fail("Pipeline stage", new Error("Aucun stage pipeline pour org A"));
    } else {
      console.log("5. POST /api/leads (lead minimal)...");
      const createRes = await api(tokenA, "POST", "/api/leads", {
        full_name: "Test Activities",
        stage_id: stageA
      });
      if (createRes.status !== 200 && createRes.status !== 201) {
        fail("Create lead", new Error(`Attendu 200/201, reçu ${createRes.status}: ${JSON.stringify(createRes.data)}`));
      } else {
        createdIds.leadId = createRes.data.id;
        ok("Create lead");
      }

      console.log("6. POST /api/leads/:id/activities (NOTE)...");
      const postNoteRes = await api(tokenA, "POST", `/api/leads/${createdIds.leadId}/activities`, {
        type: "NOTE",
        content: "Note de test CP-030"
      });
      if (postNoteRes.status !== 201) {
        fail("POST activité NOTE", new Error(`Attendu 201, reçu ${postNoteRes.status}: ${JSON.stringify(postNoteRes.data)}`));
      } else {
        createdIds.noteActivityId = postNoteRes.data.id;
        if (postNoteRes.data.type !== "NOTE") {
          fail("Type NOTE", new Error(`Reçu ${postNoteRes.data.type}`));
        } else {
          ok("POST activité NOTE");
        }
      }

      console.log("7. GET /api/leads/:id/activities → contient NOTE...");
      const getRes = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}/activities`);
      if (getRes.status !== 200) {
        fail("GET activités", new Error(`Attendu 200, reçu ${getRes.status}: ${JSON.stringify(getRes.data)}`));
      } else {
        const items = getRes.data.items || [];
        const note = items.find((a) => a.type === "NOTE");
        if (!note) {
          fail("GET contient NOTE", new Error("NOTE non trouvée dans la liste"));
        } else {
          ok("GET activités", "contient NOTE");
        }
      }

      console.log("8. PATCH lead status LEAD→CLIENT → vérifier STATUS_CHANGE...");
      await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}`, { status: "CLIENT" });
      const getAfterStatus = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}/activities`);
      if (getAfterStatus.status !== 200) {
        fail("GET après status change", new Error(`Attendu 200, reçu ${getAfterStatus.status}`));
      } else {
        const statusChange = (getAfterStatus.data.items || []).find((a) => a.type === "STATUS_CHANGE");
        if (!statusChange) {
          fail("STATUS_CHANGE créé", new Error("Activité STATUS_CHANGE non trouvée"));
        } else {
          ok("STATUS_CHANGE créé", `payload: ${JSON.stringify(statusChange.payload)}`);
        }
      }

      console.log("9. PATCH status => LEAD pour test stage...");
      await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}`, { status: "LEAD" });

      if (stageA2) {
        console.log("10. PATCH stage → vérifier STAGE_CHANGE...");
        await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}/stage`, { stageId: stageA2 });
        const getAfterStage = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}/activities`);
        if (getAfterStage.status !== 200) {
          fail("GET après stage change", new Error(`Attendu 200, reçu ${getAfterStage.status}`));
        } else {
          const stageChange = (getAfterStage.data.items || []).find((a) => a.type === "STAGE_CHANGE");
          if (!stageChange) {
            fail("STAGE_CHANGE créé", new Error("Activité STAGE_CHANGE non trouvée"));
          } else {
            ok("STAGE_CHANGE créé");
          }
        }
      } else {
        ok("STAGE_CHANGE", "skip (1 seul stage)");
      }

      console.log("11. Créer address + lier au lead + verify-pin...");
      const createAddrRes = await api(tokenA, "POST", "/api/addresses", {
        address_line1: "10 rue Test",
        postal_code: "75001",
        city: "Paris",
        country_code: "FR",
        formatted_address: "10 rue Test, 75001 Paris",
        lat: 48.8566,
        lon: 2.3522
      });
      if (createAddrRes.status !== 200 && createAddrRes.status !== 201) {
        fail("Create address", new Error(`Attendu 200/201, reçu ${createAddrRes.status}`));
      } else {
        createdIds.addressId = createAddrRes.data.id;
        await api(tokenA, "PATCH", `/api/leads/${createdIds.leadId}`, { site_address_id: createdIds.addressId });
        const verifyRes = await api(tokenA, "POST", "/api/addresses/verify-pin", {
          address_id: createdIds.addressId,
          lat: 48.8567,
          lon: 2.3523,
          geo_notes: "Section AB 1234"
        });
        if (verifyRes.status !== 200) {
          fail("verify-pin", new Error(`Attendu 200, reçu ${verifyRes.status}: ${JSON.stringify(verifyRes.data)}`));
        } else {
          const getAfterVerify = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}/activities`);
          const addrVerified = (getAfterVerify.data.items || []).find((a) => a.type === "ADDRESS_VERIFIED");
          if (!addrVerified) {
            fail("ADDRESS_VERIFIED créé", new Error("Activité ADDRESS_VERIFIED non trouvée"));
          } else {
            ok("ADDRESS_VERIFIED créé");
            console.log("11b. GET lead après ADDRESS_VERIFIED → last_activity_at + inactivity_level...");
            const leadAfterAddr = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}`);
            if (leadAfterAddr.status !== 200 || !leadAfterAddr.data?.lead) {
              fail(
                "Lead après ADDRESS_VERIFIED",
                new Error(`Attendu 200 + lead, reçu ${leadAfterAddr.status}`)
              );
            } else {
              const la = leadAfterAddr.data.lead.last_activity_at;
              if (!la) {
                fail("last_activity_at après ADDRESS_VERIFIED", new Error("Champ absent"));
              } else {
                const ageSec = (Date.now() - new Date(la).getTime()) / 1000;
                if (ageSec > 120 || ageSec < -5) {
                  fail(
                    "last_activity_at frais après ADDRESS_VERIFIED",
                    new Error(`Attendu récent, écart ${ageSec}s pour ${la}`)
                  );
                } else {
                  ok("last_activity_at rafraîchi après ADDRESS_VERIFIED", `écart ~${Math.round(ageSec)}s`);
                }
              }
              const level = leadAfterAddr.data.lead.inactivity_level;
              if (level !== "none") {
                fail(
                  "inactivity_level cohérent après ADDRESS_VERIFIED",
                  new Error(`Attendu none pour activité fraîche, reçu ${level}`)
                );
              } else {
                ok("inactivity_level", "none après ADDRESS_VERIFIED");
              }
            }
          }
        }
      }

      console.log("12. Org isolation: user B tente GET activités lead A...");
      const tokenB = await login(orgBEmail, orgBEmailPwd);
      const getOtherRes = await api(tokenB, "GET", `/api/leads/${createdIds.leadId}/activities`);
      if (getOtherRes.status !== 404 && getOtherRes.status !== 403) {
        fail("Org isolation GET activities", new Error(`Attendu 404/403, reçu ${getOtherRes.status}`));
      } else {
        ok("Org isolation", `${getOtherRes.status} sur activités autre org`);
      }

      console.log("13. Soft delete: DELETE note → n'apparaît plus...");
      const delRes = await api(tokenA, "DELETE", `/api/activities/${createdIds.noteActivityId}`);
      if (delRes.status !== 204 && delRes.status !== 200) {
        fail("DELETE activité", new Error(`Attendu 204, reçu ${delRes.status}`));
      } else {
        const getAfterDel = await api(tokenA, "GET", `/api/leads/${createdIds.leadId}/activities`);
        const stillNote = (getAfterDel.data.items || []).find((a) => a.id === createdIds.noteActivityId);
        if (stillNote) {
          fail("Soft delete", new Error("Note supprimée apparaît encore"));
        } else {
          ok("Soft delete", "note n'apparaît plus");
        }
      }
    }

    console.log("\n14. Cleanup...");
    const client = await pool.connect();
    try {
      if (createdIds.leadId) await client.query("DELETE FROM lead_activities WHERE lead_id = $1", [createdIds.leadId]);
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
    console.log("RÉSUMÉ CP-030 ACTIVITIES");
    console.log("=".repeat(60));
    console.log(`✅ Tests réussis: ${results.passed}/${results.total}`);
    console.log(`❌ Tests échoués: ${results.failed}`);
    if (results.failed > 0) {
      process.exit(1);
    }
    console.log("\n✅ ACTIVITIES PASS\n");
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
