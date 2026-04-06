/**
 * Tests API PATCH /api/leads/:id — statuts étendus + lost_reason + archived_at
 * Usage (serveur sur PORT 3000) : node --env-file=./.env scripts/test-lead-status-api.js
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

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
  if (body != null && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function ok(name) {
  console.log(`✅ ${name}`);
}

function fail(name, detail) {
  console.error(`❌ ${name}`, detail || "");
  process.exitCode = 1;
}

async function main() {
  const email = process.env.TEST_ADMIN_EMAIL || "rbac-test-admin@test.local";
  const password = process.env.TEST_ADMIN_PASSWORD || "TestAdmin123!";

  let token;
  try {
    token = await login(email, password);
  } catch (e) {
    fail("Login", e.message);
    return;
  }

  const create = await api(token, "POST", "/api/leads", {
    full_name: `Lead status API ${Date.now()}`,
    email: `lead-status-${Date.now()}@test.local`,
  });
  if (create.status !== 201 || !create.data?.id) {
    fail("POST /api/leads", JSON.stringify(create));
    return;
  }
  const leadId = create.data.id;

  // TEST 1 — IN_REFLECTION
  const t1 = await api(token, "PATCH", `/api/leads/${leadId}`, { status: "IN_REFLECTION" });
  if (t1.status !== 200 || t1.data.status !== "IN_REFLECTION") {
    fail("TEST 1 PATCH IN_REFLECTION", JSON.stringify(t1));
  } else {
    ok("TEST 1 PATCH status = IN_REFLECTION → 200");
  }

  // TEST 2 — LOST sans reason
  const t2 = await api(token, "PATCH", `/api/leads/${leadId}`, { status: "LOST" });
  if (t2.status !== 400) {
    fail("TEST 2 LOST sans reason (attendu 400)", JSON.stringify(t2));
  } else {
    ok("TEST 2 LOST sans lost_reason → 400");
  }

  // TEST 3 — LOST avec reason
  const t3 = await api(token, "PATCH", `/api/leads/${leadId}`, {
    status: "LOST",
    lost_reason: "Too expensive",
  });
  if (t3.status !== 200 || t3.data.status !== "LOST" || !t3.data.lost_reason) {
    fail("TEST 3 LOST avec reason", JSON.stringify(t3));
  } else {
    ok("TEST 3 LOST avec lost_reason → 200");
  }

  // TEST 4 — ARCHIVED → archived_at non null
  const t4 = await api(token, "PATCH", `/api/leads/${leadId}`, { status: "ARCHIVED" });
  if (t4.status !== 200 || t4.data.status !== "ARCHIVED" || t4.data.archived_at == null) {
    fail("TEST 4 ARCHIVED", JSON.stringify(t4));
  } else {
    ok("TEST 4 ARCHIVED → archived_at défini");
  }

  // TEST 5 — QUALIFIED depuis ARCHIVED → archived_at null
  const t5 = await api(token, "PATCH", `/api/leads/${leadId}`, { status: "QUALIFIED" });
  if (t5.status !== 200 || t5.data.archived_at != null) {
    fail("TEST 5 QUALIFIED depuis ARCHIVED", JSON.stringify(t5));
  } else {
    ok("TEST 5 QUALIFIED depuis ARCHIVED → archived_at null");
  }

  // TEST 6 — PATCH status SIGNED normalisé en CLIENT + SIGNE (plus de trou noir)
  const create2 = await api(token, "POST", "/api/leads", {
    full_name: `Lead signed ${Date.now()}`,
    email: `lead-signed-${Date.now()}@test.local`,
  });
  if (create2.status !== 201 || !create2.data?.id) {
    fail("POST lead pour TEST 6", JSON.stringify(create2));
    return;
  }
  const lead2 = create2.data.id;
  const setSigned = await api(token, "PATCH", `/api/leads/${lead2}`, { status: "SIGNED" });
  if (
    setSigned.status !== 200 ||
    setSigned.data?.status !== "CLIENT" ||
    setSigned.data?.project_status !== "SIGNE"
  ) {
    fail("TEST 6 PATCH SIGNED → CLIENT + SIGNE", JSON.stringify(setSigned));
  } else {
    ok("TEST 6 PATCH SIGNED → CLIENT + SIGNE");
  }

  console.log("\n=== test-lead-status-api terminé ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
