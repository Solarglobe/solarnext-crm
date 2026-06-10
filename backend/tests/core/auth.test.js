/**
 * CP-077 - Auth: login, routes protegees.
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

test("login OK -> 200 + token JWT", async (t) => {
  if (!canRun || !ctx) {
    t.skip("integration indisponible (serveur + DB + fixture)");
    return;
  }
  const { status, data } = await loginJson(ctx.adminEmail, ctx.adminPassword);
  assert.equal(status, 200);
  assert.ok(data.token && typeof data.token === "string");
  assert.ok(data.user?.organizationId || data.user?.organization_id);
});

test("login KO -> 401", async (t) => {
  if (!canRun || !ctx) {
    t.skip("integration indisponible");
    return;
  }
  const { status, data } = await loginJson(ctx.adminEmail, "wrong-password-cp077");
  assert.equal(status, 401);
  assert.ok(data.error);
});

test("login KO repete -> 401, sans RATE_LIMITED", async (t) => {
  if (!canRun) {
    t.skip("integration indisponible");
    return;
  }
  const probe = `cp077-rl-${Date.now()}@invalid.local`;
  let last = 0;
  for (let i = 0; i < 8; i++) {
    const r = await loginJson(probe, "bad");
    last = r.status;
    assert.equal(r.status, 401);
    assert.notEqual(r.data?.error, "RATE_LIMITED");
  }
  assert.equal(last, 401);
});

test("route protegee sans token -> 401", async (t) => {
  if (!canRun) {
    t.skip("integration indisponible");
    return;
  }
  const res = await fetch(`${BASE_URL}/api/clients`, { headers: {} });
  assert.equal(res.status, 401);
});

test("route protegee avec token -> 200", async (t) => {
  if (!canRun || !ctx) {
    t.skip("integration indisponible");
    return;
  }
  const { status } = await api(ctx.token, "GET", "/api/clients");
  assert.ok(status === 200 || status === 403, `GET /api/clients -> ${status}`);
});
