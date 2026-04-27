/**
 * CP-002 — Tests migration sync_inverter_family_with_type
 * Usage: node tests/inverterFamilySync.test.js
 * Prérequis: serveur lancé, .env.dev, migrations up (incl. 1771159000007)
 *
 * 1) Tous inverter_type='micro' → inverter_family='MICRO'
 * 2) Tous inverter_type='string' → inverter_family='CENTRAL'
 * 3) Aucun name contenant 'test' après migration
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

async function api(token, method, path) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return {
    status: res.status,
    data: res.headers.get("content-type")?.includes("json") ? await res.json() : {},
  };
}

async function main() {
  console.log("=== Test inverterFamilySync (migration sync) ===\n");

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

  // --- GET tous les onduleurs (sans filtre) ---
  console.log("3. GET /api/pv/inverters — vérification post-migration...");
  const r = await api(token, "GET", "/api/pv/inverters");
  assert(r.status === 200, `Attendu 200, reçu ${r.status}`);
  assert(Array.isArray(r.data), "Liste doit être un tableau");
  const inverters = r.data;
  console.log(`   ${inverters.length} onduleur(s) en base\n`);

  // --- 1) Tous type='micro' → inverter_family='MICRO' ---
  const microInverters = inverters.filter((i) => i.inverter_type === "micro");
  const microOk = microInverters.every((i) => i.inverter_family === "MICRO");
  assert(microOk, `Tous les inverter_type='micro' doivent avoir inverter_family='MICRO'. Trouvé: ${JSON.stringify(microInverters.filter((i) => i.inverter_family !== "MICRO"))}`);
  console.log(`4. ✅ Tous type='micro' (${microInverters.length}) → inverter_family='MICRO'\n`);

  // --- 2) Tous type='string' → inverter_family='CENTRAL' ---
  const stringInverters = inverters.filter((i) => i.inverter_type === "string");
  const stringOk = stringInverters.every((i) => i.inverter_family === "CENTRAL");
  assert(stringOk, `Tous les inverter_type='string' doivent avoir inverter_family='CENTRAL'. Trouvé: ${JSON.stringify(stringInverters.filter((i) => i.inverter_family !== "CENTRAL"))}`);
  console.log(`5. ✅ Tous type='string' (${stringInverters.length}) → inverter_family='CENTRAL'\n`);

  // --- 3) Aucun name contenant 'test' ---
  const withTest = inverters.filter((i) => (i.name || "").toLowerCase().includes("test"));
  assert(withTest.length === 0, `Aucun onduleur ne doit avoir 'test' dans le name. Trouvé: ${JSON.stringify(withTest.map((i) => i.name))}`);
  console.log(`6. ✅ Aucun name contenant 'test' (catalogue propre)\n`);

  console.log("=== Test inverterFamilySync OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
