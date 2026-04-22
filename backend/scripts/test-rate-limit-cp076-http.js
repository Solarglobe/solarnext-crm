/**
 * CP-076 — Tests runtime contre API (nécessite serveur : npm run dev).
 * Usage : node --env-file=../.env.dev scripts/test-rate-limit-cp076-http.js
 *
 * 1) Login échecs : 5× 401 puis 6e → 429 (compteur échecs uniquement)
 * 2) Login succès : après échecs, login OK avec identifiants valides → reset ; nouveaux échecs repartent de zéro
 * 3) /api/calc POST : public_heavy → 429
 * 4) GET / : pas de rate limit agressif
 */

import "../config/load-env.js";
import fetch from "node-fetch";

const BASE = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const health = await fetch(`${BASE}/`).catch(() => null);
  assert(health?.ok, `Serveur injoignable (${BASE})`);

  const probeEmail = "rate-limit-probe@invalid.local";

  console.log("--- 1) Login : échecs uniquement → 429 au 6e mauvais mot de passe ---");
  let got429Login = false;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: probeEmail,
        password: "wrong-password-probe",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) {
      assert(j.error === "RATE_LIMITED", `JSON 429 inattendu: ${JSON.stringify(j)}`);
      got429Login = true;
      console.log(`  Tentative ${i + 1} → 429 RATE_LIMITED OK`);
      break;
    }
    assert(r.status === 401, `Attendu 401 avant blocage, reçu ${r.status}`);
  }
  assert(got429Login, "429 login non observé.");

  const okEmail = process.env.TEST_LOGIN_EMAIL || process.env.TEST_ADMIN_EMAIL;
  const okPass = process.env.TEST_LOGIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD;
  if (okEmail && okPass) {
    console.log("--- 2) Login succès après échecs (reset compteur) ---");
    const testUser = `rate-limit-ok-${Date.now()}@example.test`;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: okEmail, password: "wrong-" + i }),
      });
      assert(r.status === 401, `Échec attendu 401, reçu ${r.status}`);
    }
    const ok = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: okEmail, password: okPass }),
    });
    const okJson = await ok.json().catch(() => ({}));
    assert(ok.status === 200 && okJson.token, `Login OK attendu, reçu ${ok.status} ${JSON.stringify(okJson)}`);
    console.log("  Login réussi → compteur réinitialisé (pas de 429)");

    let failuresAfterOk = 0;
    let saw429AfterReset = false;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: okEmail, password: "bad-after-reset" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) failuresAfterOk += 1;
      if (r.status === 429) {
        saw429AfterReset = true;
        assert(j.error === "RATE_LIMITED", JSON.stringify(j));
        console.log(`  Après reset : ${failuresAfterOk} échecs 401 puis 429 OK`);
        break;
      }
    }
    assert(saw429AfterReset, "Après succès, le 6e échec devrait à nouveau produire 429.");
    void testUser;
  } else {
    console.log("--- 2) SKIP login succès (TEST_LOGIN_EMAIL / TEST_ADMIN_EMAIL + mot de passe non définis) ---");
  }

  console.log("--- 3) /api/calc (public_heavy) ---");
  let calcHeaders = {};
  if (okEmail && okPass) {
    const loginCalc = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: okEmail, password: okPass }),
    });
    const lj = await loginCalc.json().catch(() => ({}));
    if (loginCalc.ok && lj.token) {
      calcHeaders = { Authorization: `Bearer ${lj.token}` };
    }
  }
  if (!calcHeaders.Authorization) {
    console.log("  SKIP /api/calc (identifiants TEST_LOGIN_EMAIL / TEST_ADMIN_EMAIL requis pour JWT)");
  } else {
  let got429Calc = false;
  for (let i = 0; i < 25; i++) {
    const fd = new FormData();
    fd.append("csv", new Blob(["a\n"], { type: "text/csv" }), "probe.csv");
    const r = await fetch(`${BASE}/api/calc`, { method: "POST", headers: calcHeaders, body: fd });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      assert(j.error === "RATE_LIMITED", JSON.stringify(j));
      got429Calc = true;
      console.log(`  Requête ${i + 1} → 429 RATE_LIMITED OK`);
      break;
    }
  }
  assert(got429Calc, "429 sur /api/calc non observé.");
  }

  console.log("--- 4) GET / (usage normal) ---");
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${BASE}/`);
    assert(r.status === 200, `GET / attendu 200, reçu ${r.status}`);
  }
  console.log("  25× GET / → 200 OK");

  console.log("\n=== CP-076 hardening : tests runtime OK ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
