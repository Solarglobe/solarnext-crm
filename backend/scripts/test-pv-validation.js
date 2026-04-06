/**
 * CP-002 — Tests validation API PV (matériel incomplet actif = 400)
 * Usage: node scripts/test-pv-validation.js
 * Prérequis: serveur lancé, .env.dev, migrations up
 *
 * 1) Créer micro incomplet active=true → 400
 * 2) Créer panneau sans voc_v active=true → 400
 * 3) Créer string sans mppt_count → 400
 * 4) Créer batterie sans max_charge_kw → 400
 * 5) Créer matériel complet → 200/201
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "../..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

dotenv.config({ path: resolve(ROOT, ".env.dev"), override: false });

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
  console.log("=== Test validation PV (matériel incomplet actif) ===\n");

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

  // --- 1) Micro incomplet active=true → 400 ---
  console.log("3. POST /api/pv/inverters — micro incomplet active=true...");
  let r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Micro Incomplet",
    brand: "TestBrand",
    model_ref: "MICRO-INCOMPLETE",
    inverter_type: "micro",
    active: true,
    nominal_va: 400,
    // manque: modules_per_inverter, max_input_current_a, max_dc_power_kw
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  assert(
    (r.data?.error || "").includes("Micro-onduleur incomplet"),
    `Message attendu "Micro-onduleur incomplet", reçu: ${r.data?.error}`
  );
  console.log("   ✅ 400 — Micro-onduleur incomplet\n");

  // --- 2) Panneau sans voc_v active=true → 400 ---
  console.log("4. POST /api/pv/panels — panneau sans voc_v active=true...");
  r = await api(token, "POST", "/api/pv/panels", {
    name: "Test Panel Incomplet",
    brand: "TestBrand",
    model_ref: "PANEL-INCOMPLETE",
    power_wc: 400,
    efficiency_pct: 20,
    width_mm: 2000,
    height_mm: 1000,
    active: true,
    // manque: voc_v, vmp_v, isc_a, imp_a
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  assert(
    (r.data?.error || "").includes("Panneau incomplet"),
    `Message attendu "Panneau incomplet", reçu: ${r.data?.error}`
  );
  console.log("   ✅ 400 — Panneau incomplet\n");

  // --- 3) String sans mppt_count → 400 ---
  console.log("5. POST /api/pv/inverters — string sans mppt_count active=true...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test String Incomplet",
    brand: "TestBrand",
    model_ref: "STRING-INCOMPLETE",
    inverter_type: "string",
    nominal_power_kw: 5,
    active: true,
    mppt_min_v: 90,
    mppt_max_v: 530,
    max_input_current_a: 22,
    max_dc_power_kw: 6,
    // manque: mppt_count
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  assert(
    (r.data?.error || "").includes("Onduleur string incomplet"),
    `Message attendu "Onduleur string incomplet", reçu: ${r.data?.error}`
  );
  console.log("   ✅ 400 — Onduleur string incomplet\n");

  // --- 4) Batterie sans max_charge_kw → 400 ---
  console.log("6. POST /api/pv/batteries — batterie sans max_charge_kw active=true...");
  r = await api(token, "POST", "/api/pv/batteries", {
    name: "Test Battery Incomplet",
    brand: "TestBrand",
    model_ref: "BAT-INCOMPLETE",
    usable_kwh: 5,
    nominal_voltage_v: 48,
    active: true,
    max_discharge_kw: 5,
    roundtrip_efficiency_pct: 90,
    depth_of_discharge_pct: 90,
    // manque: max_charge_kw
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  assert(
    (r.data?.error || "").includes("Batterie incomplète"),
    `Message attendu "Batterie incomplète", reçu: ${r.data?.error}`
  );
  console.log("   ✅ 400 — Batterie incomplète\n");

  // --- 5) Matériel complet → 200/201 ---
  console.log("7. POST /api/pv/panels — panneau complet active=true...");
  r = await api(token, "POST", "/api/pv/panels", {
    name: "Test Panel Complet",
    brand: "TestBrand",
    model_ref: "PANEL-COMPLETE",
    power_wc: 400,
    efficiency_pct: 20,
    voc_v: 40,
    vmp_v: 33,
    isc_a: 15,
    imp_a: 14,
    width_mm: 2000,
    height_mm: 1000,
    active: true,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  const panelId = r.data.id;
  console.log("   ✅ 201 — Panneau créé\n");

  console.log("8. POST /api/pv/inverters — micro complet active=true...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Micro Complet",
    brand: "TestBrand",
    model_ref: "MICRO-COMPLETE",
    inverter_type: "micro",
    nominal_va: 400,
    modules_per_inverter: 1,
    max_input_current_a: 22,
    max_dc_power_kw: 0.4,
    active: true,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  const invId = r.data.id;
  console.log("   ✅ 201 — Micro-onduleur créé\n");

  console.log("9. POST /api/pv/batteries — batterie complète active=true...");
  r = await api(token, "POST", "/api/pv/batteries", {
    name: "Test Battery Complet",
    brand: "TestBrand",
    model_ref: "BAT-COMPLETE",
    usable_kwh: 5,
    nominal_voltage_v: 48,
    max_charge_kw: 2.5,
    max_discharge_kw: 5,
    roundtrip_efficiency_pct: 90,
    depth_of_discharge_pct: 90,
    active: true,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  const batId = r.data.id;
  console.log("   ✅ 201 — Batterie créée\n");

  // Nettoyage
  console.log("10. Nettoyage (soft delete)...");
  await api(token, "DELETE", `/api/pv/panels/${panelId}`);
  await api(token, "DELETE", `/api/pv/inverters/${invId}`);
  await api(token, "DELETE", `/api/pv/batteries/${batId}`);
  console.log("   ✅\n");

  console.log("=== Test validation PV OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
