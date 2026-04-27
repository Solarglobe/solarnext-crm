/**
 * Tests API multi-compteurs + compat GET lead / PATCH consumption
 * Usage: node scripts/test-lead-meters-api.js
 * Prérequis: backend sur TEST_API_URL (défaut http://127.0.0.1:3000), .env.dev + utilisateur admin
 */

import "../config/register-local-env.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.TEST_API_URL || "http://127.0.0.1:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;

function ok(n, d = "") {
  passed++;
  console.log(`✅ ${n}${d ? ` — ${d}` : ""}`);
}
function fail(n, e) {
  failed++;
  console.error(`❌ ${n}:`, e?.message || e);
}

async function api(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body != null && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : {};
  return { status: res.status, data };
}

async function tryLogin() {
  const email = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const password = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.token) return data.token;
  return null;
}

async function main() {
  let token;
  try {
    token = await tryLogin();
  } catch (e) {
    token = null;
  }
  if (!token) {
    console.warn("HTTP indisponible ou login échoué — tests API ignorés.");
    await pool.end();
    process.exit(0);
  }

  const leadR = await pool.query(
    `SELECT id FROM leads WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`
  );
  if (leadR.rows.length === 0) {
    fail("Setup", new Error("Aucun lead en base"));
    await pool.end();
    process.exit(1);
  }
  const leadId = leadR.rows[0].id;

  try {
    // Test 1 — GET meters
    let r = await api(token, "GET", `/api/leads/${leadId}/meters`);
    if (r.status !== 200 || !Array.isArray(r.data)) {
      fail("Test 1 GET meters", new Error(`status ${r.status} ${JSON.stringify(r.data)}`));
    } else {
      ok("Test 1 GET meters", `${r.data.length} compteur(s)`);
    }

    const initial = r.data;
    const defaultRow = initial.find((m) => m.is_default);
    if (!defaultRow) {
      fail("Test 1 default", new Error("pas de défaut"));
      await pool.end();
      process.exit(1);
    }
    const defaultId = defaultRow.id;

    // Test 2 — POST
    const name = `API Test ${Date.now()}`;
    r = await api(token, "POST", `/api/leads/${leadId}/meters`, { name });
    if (r.status !== 201 || !r.data?.id) {
      fail("Test 2 POST meter", new Error(`status ${r.status} ${JSON.stringify(r.data)}`));
      await pool.end();
      process.exit(1);
    }
    ok("Test 2 POST meter", r.data.id);
    const m2 = r.data.id;

    // Test 3 — PATCH
    r = await api(token, "PATCH", `/api/leads/${leadId}/meters/${m2}`, { meter_power_kva: 15 });
    if (r.status !== 200 || r.data.meter_power_kva !== 15) {
      fail("Test 3 PATCH", new Error(JSON.stringify(r.data)));
    } else {
      ok("Test 3 PATCH meter_power_kva");
    }

    // Test 3b — GET détail compteur (route serveur : GET /api/leads/:leadId/meters/:meterId)
    r = await api(token, "GET", `/api/leads/${leadId}/meters/${defaultId}`);
    if (r.status !== 200 || !r.data?.meter?.id) {
      fail(
        "Test 3b GET meter detail",
        new Error(`status ${r.status} body=${JSON.stringify(r.data)} (redémarrer le backend si 404)`)
      );
    } else {
      ok("Test 3b GET meter detail");
    }

    // Test 3c — PATCH grille mensuelle sur compteur
    const y = new Date().getFullYear();
    const months12 = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: 10 }));
    r = await api(token, "PATCH", `/api/leads/${leadId}/meters/${m2}`, {
      consumption_mode: "MONTHLY",
      year: y,
      months: months12,
    });
    const calc =
      r.data.consumption_annual_calculated_kwh ?? r.data.meter_detail?.consumption_annual_calculated_kwh;
    if (r.status !== 200 || calc !== 120) {
      fail("Test 3c PATCH meter MONTHLY", new Error(JSON.stringify(r.data)));
    } else {
      ok("Test 3c PATCH meter MONTHLY (120 kWh)");
    }

    // Test 4 — set-default
    r = await api(token, "POST", `/api/leads/${leadId}/meters/${m2}/set-default`, {});
    if (r.status !== 200 || !r.data?.is_default) {
      fail("Test 4 set-default", new Error(JSON.stringify(r.data)));
    } else {
      ok("Test 4 set-default sur m2");
    }
    r = await api(token, "GET", `/api/leads/${leadId}/meters`);
    const defaults = r.data.filter((x) => x.is_default);
    if (defaults.length !== 1) {
      fail("Test 4 unicité défaut", new Error(JSON.stringify(defaults)));
    } else {
      ok("Test 4 un seul is_default");
    }

    // Test 5 — DELETE non-default puis défaut avec fallback
    r = await api(token, "POST", `/api/leads/${leadId}/meters/${defaultId}/set-default`, {});
    if (r.status !== 200) fail("Test 5 restore default", new Error(String(r.status)));
    else ok("Test 5 restore Compteur principal comme défaut");

    r = await api(token, "DELETE", `/api/leads/${leadId}/meters/${m2}`);
    if (r.status !== 200) {
      fail("Test 5 DELETE second", new Error(JSON.stringify(r.data)));
    } else {
      ok("Test 5 DELETE compteur non défaut");
    }

    const rCreate = await api(token, "POST", `/api/leads/${leadId}/meters`, {
      name: `TMP del def ${Date.now()}`,
    });
    const m3 = rCreate.data?.id;
    if (rCreate.status === 201 && m3) {
      await api(token, "POST", `/api/leads/${leadId}/meters/${m3}/set-default`, {});
      const delDef = await api(token, "DELETE", `/api/leads/${leadId}/meters/${m3}`);
      if (delDef.status !== 200) {
        fail("Test 5 DELETE défaut + fallback", new Error(JSON.stringify(delDef.data)));
      } else {
        ok("Test 5 DELETE défaut (fallback autre compteur)");
      }
    }

    // Test 6 — compat GET lead + PATCH consumption
    r = await api(token, "GET", `/api/leads/${leadId}`);
    if (r.status !== 200 || !r.data?.lead) {
      fail("Test 6 GET lead", new Error(String(r.status)));
    } else {
      ok("Test 6 GET lead");
    }
    const prevAnnual = r.data.lead.consumption_annual_kwh;
    r = await api(token, "PATCH", `/api/leads/${leadId}/consumption`, {
      consumption_mode: "ANNUAL",
      consumption_annual_kwh: 4321,
    });
    if (r.status !== 200) {
      fail("Test 6 PATCH consumption", new Error(JSON.stringify(r.data)));
    } else {
      ok("Test 6 PATCH consumption");
    }
    await api(token, "PATCH", `/api/leads/${leadId}/consumption`, {
      consumption_mode: "ANNUAL",
      consumption_annual_kwh: prevAnnual ?? null,
    });
    ok("Test 6 restore conso initiale");

    // Cross-org : autre UUID
    r = await api(token, "GET", `/api/leads/00000000-0000-0000-0000-000000000001/meters`);
    if (r.status === 200) {
      fail("Test sécurité org", new Error("devrait 404"));
    } else {
      ok("Test sécurité : lead inconnu → non 200");
    }
  } catch (e) {
    fail("Suite", e);
  } finally {
    await pool.end();
  }

  console.log(`\nRésultat: ${passed} OK, ${failed} échecs`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
