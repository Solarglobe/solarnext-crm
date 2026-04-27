/**
 * CP-002 — Test catalogue PV (panels, inverters, batteries)
 * Usage: node scripts/test-pv-catalogs.js
 * Prérequis: serveur lancé, .env.dev, migrations up
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";

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
  console.log("=== Test catalogue PV CP-002 ===\n");

  const health = await fetch(`${BASE_URL}/`).catch(() => null);
  if (!health?.ok) {
    console.error("❌ Serveur non accessible. Lancez: npm run dev");
    process.exit(1);
  }
  console.log("1. Serveur OK\n");

  const adminEmail = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

  const loginRes = await login(adminEmail, adminPassword);
  if (loginRes.status !== 200) {
    console.error("❌ Login échoué. Créez un admin avec org.settings.manage.");
    process.exit(1);
  }
  const token = loginRes.data.token;
  assert(token, "Token manquant");
  console.log("2. Login ADMIN OK\n");

  // --- PANELS ---
  console.log("3. GET /api/pv/panels...");
  let r = await api(token, "GET", "/api/pv/panels");
  assert(r.status === 200, `GET panels attendu 200, reçu ${r.status}`);
  const initialPanels = r.data;
  assert(Array.isArray(initialPanels), "panels doit être un tableau");
  console.log(`   ✅ ${initialPanels.length} panneaux\n`);

  console.log("4. POST /api/pv/panels (création)...");
  const newPanel = {
    name: "Test Panel",
    brand: "TestBrand",
    model_ref: "TEST-001",
    power_wc: 400,
    efficiency_pct: 20,
    width_mm: 2000,
    height_mm: 1000,
  };
  r = await api(token, "POST", "/api/pv/panels", newPanel);
  assert(r.status === 201, `POST panels attendu 201, reçu ${r.status}`);
  const createdId = r.data.id;
  assert(createdId, "id manquant");
  console.log("   ✅ Panneau créé\n");

  console.log("5. PUT /api/pv/panels/:id...");
  r = await api(token, "PUT", `/api/pv/panels/${createdId}`, { power_wc: 410 });
  assert(r.status === 200, `PUT panels attendu 200, reçu ${r.status}`);
  assert(r.data.power_wc === 410, "power_wc non mis à jour");
  console.log("   ✅ Panneau mis à jour\n");

  console.log("6. DELETE /api/pv/panels/:id (soft)...");
  r = await api(token, "DELETE", `/api/pv/panels/${createdId}`);
  assert(r.status === 200, `DELETE panels attendu 200, reçu ${r.status}`);
  assert(r.data.active === false, "active doit être false");
  console.log("   ✅ Panneau désactivé\n");

  console.log("7. GET /api/public/pv/panels (sans auth)...");
  r = await fetch(`${BASE_URL}/api/public/pv/panels`);
  const publicPanels = r.ok ? await r.json() : [];
  assert(Array.isArray(publicPanels), "public panels doit être un tableau");
  const inactiveInPublic = publicPanels.find((p) => p.id === createdId);
  assert(!inactiveInPublic, "Le panneau désactivé ne doit pas apparaître en public");
  console.log("   ✅ Public ne renvoie pas les inactifs\n");

  // --- INVERTERS ---
  console.log("8. GET /api/pv/inverters...");
  r = await api(token, "GET", "/api/pv/inverters");
  assert(r.status === 200, `GET inverters attendu 200, reçu ${r.status}`);
  console.log(`   ✅ ${r.data.length} onduleurs\n`);

  console.log("9. POST /api/pv/inverters...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Inverter",
    brand: "TestBrand",
    model_ref: "INV-TEST",
    inverter_type: "micro",
    nominal_va: 400,
  });
  assert(r.status === 201, `POST inverters attendu 201, reçu ${r.status}`);
  const invId = r.data.id;
  console.log("   ✅ Onduleur créé\n");

  console.log("10. DELETE /api/pv/inverters/:id...");
  r = await api(token, "DELETE", `/api/pv/inverters/${invId}`);
  assert(r.status === 200, `DELETE inverters attendu 200, reçu ${r.status}`);
  console.log("   ✅ Onduleur désactivé\n");

  // --- BATTERIES ---
  console.log("11. GET /api/pv/batteries...");
  r = await api(token, "GET", "/api/pv/batteries");
  assert(r.status === 200, `GET batteries attendu 200, reçu ${r.status}`);
  console.log(`   ✅ ${r.data.length} batteries\n`);

  console.log("12. POST /api/pv/batteries...");
  r = await api(token, "POST", "/api/pv/batteries", {
    name: "Test Battery",
    brand: "TestBrand",
    model_ref: "BAT-TEST",
    usable_kwh: 5,
  });
  assert(r.status === 201, `POST batteries attendu 201, reçu ${r.status}`);
  const batId = r.data.id;
  console.log("   ✅ Batterie créée\n");

  console.log("13. GET /api/public/pv/inverters...");
  r = await fetch(`${BASE_URL}/api/public/pv/inverters`);
  assert(r.ok, "Public inverters doit être OK");
  console.log("   ✅\n");

  console.log("14. GET /api/public/pv/batteries...");
  r = await fetch(`${BASE_URL}/api/public/pv/batteries`);
  assert(r.ok, "Public batteries doit être OK");
  console.log("   ✅\n");

  console.log("=== Test catalogue PV OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
