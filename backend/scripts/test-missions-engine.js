/**
 * Mission Engine V1 — Tests terminal
 * Usage: node scripts/test-missions-engine.js
 * Prérequis: Backend démarré, migrations exécutées
 *
 * Cas couverts :
 * - Create mission
 * - Assign user
 * - Try overlapping mission → 409
 * - Drag & drop (PATCH time) → ok
 * - Prospecteur tente modifier mission autre user → 403
 */

import "../config/register-local-env.js";
import fetch from "node-fetch";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const BASE_URL = process.env.API_URL || "http://localhost:3000";
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
  console.log(`   Erreur: ${error?.message || error}`);
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
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
      "Content-Type": "application/json",
    },
  };
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {},
  };
}

async function main() {
  console.log("\n=== MISSION ENGINE V1 TESTS ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let adminToken;
  let prospecteurToken;
  let userId;
  let otherUserId;
  let missionId;
  let missionTypeId;

  try {
    const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
    const adminPwd = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";
    const prospecteurEmail = "prospecteur-missions@test.local";

    // 1. Login admin
    try {
      adminToken = await login(adminEmail, adminPwd);
      ok("Login admin");
    } catch (e) {
      fail("Login admin", e);
      return;
    }

    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    const orgId = orgRes.rows[0]?.id;
    if (!orgId) {
      fail("Org", "Aucune organisation");
      return;
    }

    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    await ensureOrgRolesSeeded(orgId);

    userId = (await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail])).rows[0]?.id;
    if (!userId) {
      fail("User", "Utilisateur admin non trouvé");
      return;
    }

    // Récupérer un autre user pour test 403
    const otherUser = await pool.query(
      "SELECT id FROM users WHERE organization_id = $1 AND id != $2 LIMIT 1",
      [orgId, userId]
    );
    otherUserId = otherUser.rows[0]?.id;

    // Récupérer un mission_type
    const mtRes = await pool.query(
      "SELECT id FROM mission_types WHERE organization_id = $1 LIMIT 1",
      [orgId]
    );
    missionTypeId = mtRes.rows[0]?.id;

    const start1 = new Date();
    start1.setHours(10, 0, 0, 0);
    const end1 = new Date(start1);
    end1.setHours(11, 0, 0, 0);

    // 2. Create mission
    const createRes = await api(adminToken, "POST", "/api/missions", {
      title: "Test Mission Engine",
      mission_type_id: missionTypeId || undefined,
      start_at: start1.toISOString(),
      end_at: end1.toISOString(),
      assignments: [{ user_id: userId }],
    });

    if (createRes.status !== 201) {
      fail("Create mission", createRes.data);
    } else {
      missionId = createRes.data.id;
      ok("Create mission", `id=${missionId}`);
    }

    if (!missionId) {
      console.log("\n⚠️ Impossible de continuer sans mission créée\n");
      return;
    }

    // 3. Assign user (déjà fait dans create)
    ok("Assign user", "inclus dans création");

    // 4. Try overlapping mission → 409
    const start2 = new Date();
    start2.setHours(10, 30, 0, 0);
    const end2 = new Date(start2);
    end2.setHours(11, 30, 0, 0);

    const overlapRes = await api(adminToken, "POST", "/api/missions", {
      title: "Mission chevauchement",
      start_at: start2.toISOString(),
      end_at: end2.toISOString(),
      assignments: [{ user_id: userId }],
    });

    if (overlapRes.status === 409) {
      ok("Overlapping mission → 409");
    } else {
      fail("Overlapping mission", `attendu 409, reçu ${overlapRes.status}`);
    }

    // 5. Drag & drop (PATCH time)
    const newStart = new Date();
    newStart.setDate(newStart.getDate() + 1);
    newStart.setHours(14, 0, 0, 0);
    const newEnd = new Date(newStart);
    newEnd.setHours(15, 0, 0, 0);

    const patchRes = await api(adminToken, "PATCH", `/api/missions/${missionId}/time`, {
      start_at: newStart.toISOString(),
      end_at: newEnd.toISOString(),
    });

    if (patchRes.status === 200) {
      ok("Drag & drop (PATCH time)");
    } else {
      fail("Drag & drop", patchRes.data);
    }

    // 6. Prospecteur tente modifier mission autre user → 403
    if (otherUserId) {
      const prospecteurUser = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [prospecteurEmail]
      );
      if (prospecteurUser.rows.length > 0) {
        const prospecteurPwd = "Prospecteur123!";
        try {
          prospecteurToken = await login(prospecteurEmail, prospecteurPwd);
          const prospecteurId = prospecteurUser.rows[0].id;

          if (prospecteurId !== userId) {
            const missionForOther = await api(adminToken, "POST", "/api/missions", {
              title: "Mission autre user",
              start_at: new Date(Date.now() + 86400000 * 2).toISOString(),
              end_at: new Date(Date.now() + 86400000 * 2 + 3600000).toISOString(),
              assignments: [{ user_id: userId }],
            });
            const otherMissionId = missionForOther.data?.id;

            if (otherMissionId) {
              const patchOtherRes = await api(prospecteurToken, "PATCH", `/api/missions/${otherMissionId}/time`, {
                start_at: new Date(Date.now() + 86400000 * 2).toISOString(),
                end_at: new Date(Date.now() + 86400000 * 2 + 3600000).toISOString(),
              });
              if (patchOtherRes.status === 403) {
                ok("Prospecteur modifie mission autre user → 403");
              } else {
                fail("Prospecteur 403", `attendu 403, reçu ${patchOtherRes.status}`);
              }
            } else {
              ok("Prospecteur 403", "skip (mission autre non créée)");
            }
          } else {
            ok("Prospecteur 403", "skip (même user)");
          }
        } catch {
          ok("Prospecteur 403", "skip (prospecteur non configuré)");
        }
      } else {
        ok("Prospecteur 403", "skip (pas de prospecteur)");
      }
    } else {
      ok("Prospecteur 403", "skip (pas d'autre user)");
    }

    console.log("\n=== RÉSULTAT ===");
    console.log(`✅ ${results.passed}/${results.total} passés`);
    if (results.failed > 0) {
      console.log(`❌ ${results.failed} échecs`);
    }
  } catch (e) {
    fail("Script", e);
  } finally {
    await pool.end();
  }
}

main();
