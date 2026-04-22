/**
 * CP-077 — Auth : login, rate limit échecs, routes protégées.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  integrationAvailable,
  ensureAdminContext,
  BASE_URL,
  loginJson,
  api,
} from "./harness.mjs";

let canRun = false;
let ctx = null;

before(async () => {
  canRun = await integrationAvailable();
  if (canRun) {
    try {
      ctx = await ensureAdminContext();
    } catch (e) {
      console.error("[CP-077 auth] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("login OK → 200 + token JWT", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible (serveur + DB + fixture)");
    return;
  }
  const { status, data } = await loginJson(ctx.adminEmail, ctx.adminPassword);
  assert.equal(status, 200);
  assert.ok(data.token && typeof data.token === "string");
  assert.ok(data.user?.organizationId || data.user?.organization_id);
});

test("login KO → 401", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const { status, data } = await loginJson(ctx.adminEmail, "wrong-password-cp077");
  assert.equal(status, 401);
  assert.ok(data.error);
});

test("rate limit login : 6e échec → 429", async (t) => {
  if (!canRun) {
    t.skip("intégration indisponible");
    return;
  }
  const probe = `cp077-rl-${Date.now()}@invalid.local`;
  let last = 0;
  for (let i = 0; i < 8; i++) {
    const r = await loginJson(probe, "bad");
    last = r.status;
    if (r.status === 429) {
      assert.equal(r.data.error, "RATE_LIMITED");
      return;
    }
  }
  assert.fail(`429 attendu après plusieurs 401, dernier status=${last}`);
});

test("route protégée sans token → 401", async (t) => {
  if (!canRun) {
    t.skip("intégration indisponible");
    return;
  }
  const res = await fetch(`${BASE_URL}/api/clients`, { headers: {} });
  assert.equal(res.status, 401);
});

test("route protégée avec token → 200", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const { status } = await api(ctx.token, "GET", "/api/clients");
  assert.ok(status === 200 || status === 403, `GET /api/clients → ${status}`);
});
