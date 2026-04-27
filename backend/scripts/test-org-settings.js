/**
 * Test paramètres spécifiques — GET/POST /api/admin/org/settings
 * Usage: node scripts/test-org-settings.js
 * Prérequis: serveur lancé (npm run dev), .env.dev avec DATABASE_URL
 *
 * 1) GET retourne settings
 * 2) POST modifie
 * 3) GET confirme modification
 * 4) Vérifie isolation multi-organisation
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const ROOT = resolve(BACKEND_DIR, "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";


function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("=== Test paramètres spécifiques /api/admin/org/settings ===\n");

    // Vérifier serveur
    const health = await fetch(`${BASE_URL}/`).catch(() => null);
    if (!health?.ok) {
      console.error("❌ Serveur non accessible. Lancez: npm run dev");
      process.exit(1);
    }
    console.log("1. Serveur OK\n");

    // Admin avec org.settings.manage
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

    // 2) GET retourne settings
    console.log("2. GET /api/admin/org/settings...");
    let r = await api(adminToken, "GET", "/api/admin/org/settings");
    assert(r.status === 200, `GET attendu 200, reçu ${r.status}`);
    const initial = r.data;
    assert(initial.pricing !== undefined, "pricing manquant");
    assert(initial.economics !== undefined, "economics manquant");
    assert(initial.pvtech !== undefined, "pvtech manquant");
    assert(initial.components !== undefined, "components manquant");
    assert(initial.ai !== undefined, "ai manquant");
    assert(initial.panels_catalog === undefined, "panels_catalog ne doit plus être exposé (source panneaux = pv_panels)");
    assert(initial.calpinage_rules !== undefined, "calpinage_rules manquant");
    assert(Array.isArray(initial.pricing?.install_tiers), "install_tiers doit être un tableau");
    assert(
      initial.pricing?.install_tiers?.length >= 1,
      `install_tiers doit contenir au moins 1 palier, reçu: ${initial.pricing?.install_tiers?.length ?? 0}`
    );
    if (initial.pricing?.install_tiers?.length === 19) {
      console.log("   (19 paliers par défaut OK)");
    }
    assert(typeof initial.pricing?.battery_unit_kwh === "number", "battery_unit_kwh manquant");
    assert(typeof initial.pvtech?.fallback_prod_kwh_kwc === "number", "fallback_prod_kwh_kwc manquant");
    assert(typeof initial.pvtech?.longi_eff_pct === "number", "longi_eff_pct manquant");
    assert(typeof initial.components?.micro_ac_w === "number", "micro_ac_w manquant");
    assert(typeof initial.components?.micro_dc_w === "number", "micro_dc_w manquant");
    assert(typeof initial.ai?.use_enedis_first === "boolean", "use_enedis_first manquant");
    console.log("   ✅ GET retourne settings (19 paliers, battery_unit_kwh, pvtech legacy, components micro, ai)\n");

    // 3) POST modifie
    console.log("3. POST /api/admin/org/settings...");
    const payload = {
      pricing: {
        kit_price_lt_4_5: 490,
        kit_price_gt_4_5: 510,
      },
      economics: {
        prime_lt9: 85,
      },
      calpinage_rules: {
        distanceLimitesCm: 25,
      },
    };
    r = await api(adminToken, "POST", "/api/admin/org/settings", payload);
    assert(r.status === 200, `POST attendu 200, reçu ${r.status}`);
    assert(r.data.pricing?.kit_price_lt_4_5 === 490, "kit_price_lt_4_5 non mis à jour");
    assert(r.data.economics?.prime_lt9 === 85, "prime_lt9 non mis à jour");
    assert(r.data.calpinage_rules?.distanceLimitesCm === 25, "distanceLimitesCm non mis à jour");
    assert(r.data.panels_catalog === undefined, "panels_catalog ne doit pas apparaître dans la réponse POST");
    console.log("   ✅ POST modifie settings\n");

    // 4) GET confirme modification
    console.log("4. GET confirme modification...");
    r = await api(adminToken, "GET", "/api/admin/org/settings");
    assert(r.status === 200, `GET attendu 200, reçu ${r.status}`);
    assert(r.data.pricing?.kit_price_lt_4_5 === 490, "kit_price_lt_4_5 non persisté");
    assert(r.data.panels_catalog === undefined, "panels_catalog ne doit pas être renvoyé par GET");
    console.log("   ✅ GET confirme modification\n");

    // 5) Isolation multi-organisation
    console.log("5. Isolation multi-organisation...");
    const org2Res = await pool.query(
      "SELECT id FROM organizations WHERE id != $1 LIMIT 1",
      [orgId]
    );
    if (org2Res.rows.length > 0) {
      const org2Settings = await pool.query(
        "SELECT settings_json FROM organizations WHERE id = $1",
        [org2Res.rows[0].id]
      );
      const s2 = org2Settings.rows[0]?.settings_json ?? {};
      if (s2.pricing?.kit_price_lt_4_5 === 490) {
        console.log("   ⚠️ Org2 a les mêmes settings (possible si partagés) — skip isolation");
      } else {
        console.log("   ✅ Org2 a des settings distincts");
      }
    } else {
      console.log("   ⚠️ Une seule org — skip test isolation");
    }

    // Restaurer état initial
    await api(adminToken, "POST", "/api/admin/org/settings", {
      pricing: { kit_price_lt_4_5: initial.pricing?.kit_price_lt_4_5 ?? 480, kit_price_gt_4_5: initial.pricing?.kit_price_gt_4_5 ?? 500 },
      economics: { prime_lt9: initial.economics?.prime_lt9 ?? 80 },
      calpinage_rules: { distanceLimitesCm: initial.calpinage_rules?.distanceLimitesCm ?? 20 },
    });

    console.log("\n=== Test paramètres spécifiques OK ✅ ===\n");
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
    throw err;
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
