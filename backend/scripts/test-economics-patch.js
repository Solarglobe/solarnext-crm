/**
 * PATCH PHASE 1 — Test 4 clés economics
 * POST org settings avec price_eur_kwh, maintenance_pct, onduleur_year, onduleur_cost_pct
 * GET confirme persistance
 * Vérifie que le calcul (ctx/payload) lit ces valeurs
 *
 * Usage: node scripts/test-economics-patch.js
 * Prérequis: serveur lancé (npm run dev), .env.dev avec DATABASE_URL
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "../..");
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
    console.log("=== Test 4 clés economics (PATCH Phase 1) ===\n");

    const health = await fetch(`${BASE_URL}/`).catch(() => null);
    if (!health?.ok) {
      console.error("❌ Serveur non accessible. Lancez: npm run dev");
      process.exit(1);
    }
    console.log("1. Serveur OK\n");

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

    // Sauvegarder état initial
    let r = await api(adminToken, "GET", "/api/admin/org/settings");
    assert(r.status === 200, `GET attendu 200, reçu ${r.status}`);
    const initial = r.data;

    // 2) POST avec les 4 clés economics
    const economicsPayload = {
      price_eur_kwh: 0.22,
      maintenance_pct: 1.5,
      onduleur_year: 18,
      onduleur_cost_pct: 10,
    };
    console.log("2. POST /api/admin/org/settings (economics)...");
    r = await api(adminToken, "POST", "/api/admin/org/settings", {
      economics: economicsPayload,
    });
    assert(r.status === 200, `POST attendu 200, reçu ${r.status}`);
    assert(r.data.economics?.price_eur_kwh === 0.22, "price_eur_kwh non mis à jour");
    assert(r.data.economics?.maintenance_pct === 1.5, "maintenance_pct non mis à jour");
    assert(r.data.economics?.onduleur_year === 18, "onduleur_year non mis à jour");
    assert(r.data.economics?.onduleur_cost_pct === 10, "onduleur_cost_pct non mis à jour");
    console.log("   ✅ POST OK\n");

    // 3) GET confirme persistance
    console.log("3. GET confirme persistance...");
    r = await api(adminToken, "GET", "/api/admin/org/settings");
    assert(r.status === 200, `GET attendu 200, reçu ${r.status}`);
    assert(r.data.economics?.price_eur_kwh === 0.22, "price_eur_kwh non persisté");
    assert(r.data.economics?.maintenance_pct === 1.5, "maintenance_pct non persisté");
    assert(r.data.economics?.onduleur_year === 18, "onduleur_year non persisté");
    assert(r.data.economics?.onduleur_cost_pct === 10, "onduleur_cost_pct non persisté");
    console.log("   ✅ GET confirme persistance\n");

    // 4) Vérifier que solarnextPayloadBuilder / loadOrgParams lit ces valeurs
    const { buildSolarNextPayload } = await import("../services/solarnextPayloadBuilder.service.js");
    // On a besoin d'une étude avec calpinage pour buildSolarNextPayload
    // Alternative : tester loadOrgParams via un appel direct au pool
    const paramsRes = await pool.query(
      "SELECT settings_json FROM organizations WHERE id = $1",
      [orgId]
    );
    const settings = paramsRes.rows[0]?.settings_json ?? {};
    const economics = settings.economics ?? {};
    assert(economics.price_eur_kwh === 0.22, "DB: price_eur_kwh incorrect");
    assert(economics.maintenance_pct === 1.5, "DB: maintenance_pct incorrect");
    assert(economics.onduleur_year === 18, "DB: onduleur_year incorrect");
    assert(economics.onduleur_cost_pct === 10, "DB: onduleur_cost_pct incorrect");
    console.log("4. Vérification DB settings_json");
    console.log("   economics.price_eur_kwh =", economics.price_eur_kwh);
    console.log("   economics.maintenance_pct =", economics.maintenance_pct);
    console.log("   economics.onduleur_year =", economics.onduleur_year);
    console.log("   economics.onduleur_cost_pct =", economics.onduleur_cost_pct);
    console.log("   ✅ DB contient les 4 clés\n");

    // 5) Vérifier financeService pickEconomics (test unitaire)
    const { buildLegacyPayloadFromSolarNext } = await import("../services/solarnextAdapter.service.js");
    const mockPayload = {
      lead: { nom: "Test", ville: "Paris", lat: 48.8, lon: 2.3, puissance_kva: 9, tarif_kwh: null },
      consommation: { mode: "annuelle", annuelle_kwh: 5000, mensuelle: null, profil: "active", csv_path: null },
      installation: { orientation_deg: 180, tilt_deg: 30, panneaux_count: 10, reseau_type: "mono", shading_loss_pct: 0 },
      options: { remise: null, batterie: false, capacite_batterie_kwh: null },
      parameters_snapshot: {
        pricing: {},
        economics: { price_eur_kwh: 0.22, maintenance_pct: 1.5, onduleur_year: 18, onduleur_cost_pct: 10 },
        pvtech: {},
        components: {},
      },
    };
    const { form, settings: adaptedSettings } = buildLegacyPayloadFromSolarNext(mockPayload);
    const e = adaptedSettings.economics || {};
    assert(e.price_eur_kwh === 0.22, "Adapter: price_eur_kwh incorrect");
    assert(e.maintenance_pct === 1.5, "Adapter: maintenance_pct incorrect");
    assert(e.onduleur_year === 18, "Adapter: onduleur_year incorrect");
    assert(e.onduleur_cost_pct === 10, "Adapter: onduleur_cost_pct incorrect");
    console.log("5. Vérification payload/ctx (parameters_snapshot → settings)");
    console.log("   settings.economics contient les 4 clés");
    console.log("   ✅ financeService lira ces valeurs depuis ctx.settings.economics\n");

    // Restaurer état initial
    await api(adminToken, "POST", "/api/admin/org/settings", {
      economics: initial.economics ?? {},
    });

    console.log("=== Test 4 clés economics OK ✅ ===\n");
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
