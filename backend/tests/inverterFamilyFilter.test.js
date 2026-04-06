/**
 * P2-CATALOG-SEPARATION-LOCKED — Tests filtre family sur GET /api/pv/inverters
 * Usage: node tests/inverterFamilyFilter.test.js
 * Prérequis: serveur lancé, .env.dev, migrations up
 *
 * 1) GET sans family → retourne tout
 * 2) GET family=CENTRAL → uniquement CENTRAL
 * 3) GET family=MICRO → uniquement MICRO
 * 4) Création MICRO → bien enregistré
 * 5) Création sans family → CENTRAL par défaut
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
  console.log("=== Test inverterFamilyFilter (P2-CATALOG-SEPARATION) ===\n");

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

  // Créer un CENTRAL et un MICRO pour les tests
  console.log("3. Création onduleur CENTRAL...");
  let r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Filter CENTRAL",
    brand: "TestBrand",
    model_ref: "INV-FILTER-CENTRAL",
    inverter_type: "string",
    inverter_family: "CENTRAL",
    nominal_power_kw: 5,
    mppt_count: 2,
    mppt_min_v: 200,
    mppt_max_v: 600,
    max_input_current_a: 12,
    max_dc_power_kw: 6,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  assert(r.data.inverter_family === "CENTRAL", `inverter_family attendu CENTRAL, reçu ${r.data.inverter_family}`);
  const idCentral = r.data.id;
  console.log("   ✅ CENTRAL créé\n");

  console.log("4. Création onduleur MICRO...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Filter MICRO",
    brand: "TestBrand",
    model_ref: "INV-FILTER-MICRO",
    inverter_type: "micro",
    inverter_family: "MICRO",
    nominal_va: 400,
    modules_per_inverter: 1,
    max_input_current_a: 14,
    max_dc_power_kw: 0.4,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  assert(r.data.inverter_family === "MICRO", `inverter_family attendu MICRO, reçu ${r.data.inverter_family}`);
  const idMicro = r.data.id;
  console.log("   ✅ MICRO créé\n");

  // --- GET sans family → retourne tout ---
  console.log("5. GET /api/pv/inverters sans family → retourne tout...");
  r = await api(token, "GET", "/api/pv/inverters");
  assert(r.status === 200, `Attendu 200, reçu ${r.status}`);
  assert(Array.isArray(r.data), "Liste doit être un tableau");
  const hasCentral = r.data.some((i) => i.id === idCentral);
  const hasMicro = r.data.some((i) => i.id === idMicro);
  assert(hasCentral, "Liste sans filtre doit contenir CENTRAL");
  assert(hasMicro, "Liste sans filtre doit contenir MICRO");
  console.log(`   ✅ Retourne ${r.data.length} onduleur(s)`);

  // --- GET family=CENTRAL → uniquement CENTRAL ---
  console.log("\n6. GET /api/pv/inverters?family=CENTRAL → uniquement CENTRAL...");
  r = await api(token, "GET", "/api/pv/inverters?family=CENTRAL");
  assert(r.status === 200, `Attendu 200, reçu ${r.status}`);
  assert(Array.isArray(r.data), "Liste doit être un tableau");
  const allCentral = r.data.every((i) => i.inverter_family === "CENTRAL");
  assert(allCentral, "Tous les résultats doivent être CENTRAL");
  const hasCentralFiltered = r.data.some((i) => i.id === idCentral);
  const hasMicroInCentral = r.data.some((i) => i.id === idMicro);
  assert(hasCentralFiltered, "Liste CENTRAL doit contenir notre onduleur");
  assert(!hasMicroInCentral, "Liste CENTRAL ne doit pas contenir MICRO");
  console.log(`   ✅ Retourne ${r.data.length} onduleur(s) CENTRAL uniquement`);

  // --- GET family=MICRO → uniquement MICRO ---
  console.log("\n7. GET /api/pv/inverters?family=MICRO → uniquement MICRO...");
  r = await api(token, "GET", "/api/pv/inverters?family=MICRO");
  assert(r.status === 200, `Attendu 200, reçu ${r.status}`);
  assert(Array.isArray(r.data), "Liste doit être un tableau");
  const allMicro = r.data.every((i) => i.inverter_family === "MICRO");
  assert(allMicro, "Tous les résultats doivent être MICRO");
  const hasMicroFiltered = r.data.some((i) => i.id === idMicro);
  const hasCentralInMicro = r.data.some((i) => i.id === idCentral);
  assert(hasMicroFiltered, "Liste MICRO doit contenir notre onduleur");
  assert(!hasCentralInMicro, "Liste MICRO ne doit pas contenir CENTRAL");
  console.log(`   ✅ Retourne ${r.data.length} onduleur(s) MICRO uniquement`);

  // --- Création sans family → CENTRAL par défaut ---
  console.log("\n8. Création sans inverter_family → CENTRAL par défaut...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Filter Default",
    brand: "TestBrand",
    model_ref: "INV-FILTER-DEFAULT",
    inverter_type: "string",
    nominal_power_kw: 3,
    mppt_count: 1,
    mppt_min_v: 200,
    mppt_max_v: 500,
    max_input_current_a: 10,
    max_dc_power_kw: 4,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  assert(r.data.inverter_family === "CENTRAL", `inverter_family attendu CENTRAL (défaut), reçu ${r.data.inverter_family}`);
  const idDefault = r.data.id;
  console.log("   ✅ inverter_family = CENTRAL (défaut)\n");

  // Nettoyage
  await api(token, "DELETE", `/api/pv/inverters/${idCentral}`);
  await api(token, "DELETE", `/api/pv/inverters/${idMicro}`);
  await api(token, "DELETE", `/api/pv/inverters/${idDefault}`);

  console.log("=== Test inverterFamilyFilter OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
