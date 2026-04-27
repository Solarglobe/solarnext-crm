/**
 * CP-002 — Tests inverter_family (CENTRAL | MICRO)
 * Usage: node tests/inverterFamily.test.js
 * Prérequis: serveur lancé, .env.dev, migrations up
 *
 * 1) Création onduleur sans spécifier family → doit être CENTRAL
 * 2) Création onduleur avec MICRO → doit être MICRO
 * 3) Requête liste → retourne bien inverter_family
 * 4) Anciennes données → bien migrées en CENTRAL
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
  console.log("=== Test inverter_family (CENTRAL | MICRO) ===\n");

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

  // --- 1) Création sans family → CENTRAL ---
  console.log("3. POST /api/pv/inverters sans inverter_family...");
  let r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Inverter CENTRAL default",
    brand: "TestBrand",
    model_ref: "INV-FAMILY-DEFAULT",
    inverter_type: "string",
    nominal_power_kw: 5,
    mppt_count: 2,
    mppt_min_v: 200,
    mppt_max_v: 600,
    max_input_current_a: 12,
    max_dc_power_kw: 6,
  });
  assert(r.status === 201, `Attendu 201, reçu ${r.status}`);
  assert(r.data.inverter_family === "CENTRAL", `inverter_family attendu CENTRAL, reçu ${r.data.inverter_family}`);
  const idDefault = r.data.id;
  console.log("   ✅ inverter_family = CENTRAL (défaut)\n");

  // --- 2) Création avec MICRO ---
  console.log("4. POST /api/pv/inverters avec inverter_family: MICRO...");
  r = await api(token, "POST", "/api/pv/inverters", {
    name: "Test Inverter MICRO",
    brand: "TestBrand",
    model_ref: "INV-FAMILY-MICRO",
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
  console.log("   ✅ inverter_family = MICRO\n");

  // --- 3) Requête liste → retourne inverter_family ---
  console.log("5. GET /api/pv/inverters — vérifier inverter_family dans la liste...");
  r = await api(token, "GET", "/api/pv/inverters");
  assert(r.status === 200, `Attendu 200, reçu ${r.status}`);
  assert(Array.isArray(r.data), "Liste doit être un tableau");
  const invDefault = r.data.find((i) => i.id === idDefault);
  const invMicro = r.data.find((i) => i.id === idMicro);
  assert(invDefault?.inverter_family === "CENTRAL", "Onduleur sans family doit avoir CENTRAL");
  assert(invMicro?.inverter_family === "MICRO", "Onduleur MICRO doit avoir MICRO");
  const allHaveFamily = r.data.every((i) => i.inverter_family === "CENTRAL" || i.inverter_family === "MICRO");
  assert(allHaveFamily, "Tous les onduleurs doivent avoir inverter_family");
  console.log("   ✅ Liste retourne inverter_family\n");

  // --- 4) Anciennes données migrées en CENTRAL ---
  console.log("6. GET /api/public/pv/inverters — vérifier inverter_family présent...");
  const pubRes = await fetch(`${BASE_URL}/api/public/pv/inverters`);
  assert(pubRes.ok, "Public inverters doit être OK");
  const pubData = await pubRes.json();
  assert(Array.isArray(pubData), "Public liste doit être un tableau");
  const pubInvMicro = pubData.find((i) => i.id === idMicro);
  assert(pubInvMicro?.inverter_family === "MICRO", "Public doit retourner inverter_family");
  const allPublicHaveFamily = pubData.every(
    (i) => i.inverter_family === "CENTRAL" || i.inverter_family === "MICRO"
  );
  assert(allPublicHaveFamily, "Tous les onduleurs publics doivent avoir inverter_family");
  console.log("   ✅ Anciennes/nouvelles données ont inverter_family (CENTRAL ou MICRO)\n");

  // Nettoyage
  await api(token, "DELETE", `/api/pv/inverters/${idDefault}`);
  await api(token, "DELETE", `/api/pv/inverters/${idMicro}`);

  console.log("=== Test inverter_family OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
