/**
 * CP-076 — Tests unitaires store rate limit (sans serveur HTTP).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRateLimitStore } from "../middleware/security/stores/memory.store.js";

test("consumeQuota : autorise jusqu'à max puis refuse", async () => {
  const s = new MemoryRateLimitStore();
  const w = 60_000;
  const max = 3;
  for (let i = 0; i < 3; i++) {
    const r = await s.consumeQuota("k1", w, max);
    assert.equal(r.allowed, true);
  }
  const blocked = await s.consumeQuota("k1", w, max);
  assert.equal(blocked.allowed, false);
});

test("clés indépendantes (consumeQuota)", async () => {
  const s = new MemoryRateLimitStore();
  await s.consumeQuota("a", 60_000, 1);
  assert.equal((await s.consumeQuota("a", 60_000, 1)).allowed, false);
  assert.equal((await s.consumeQuota("b", 60_000, 1)).allowed, true);
});

test("login : increment échecs + reset succès", async () => {
  const s = new MemoryRateLimitStore();
  const w = 60_000;
  const max = 3;
  const key = "login_fail:127.0.0.1|u@test.local";
  for (let i = 0; i < 3; i++) {
    await s.increment(key, w);
  }
  let st = await s.get(key);
  assert.equal(st.count, 3);
  await s.reset(key);
  st = await s.get(key);
  assert.equal(st, null);
  await s.increment(key, w);
  st = await s.get(key);
  assert.equal(st.count, 1);
});

test("login : bloqué si count >= max avant nouvelle tentative", async () => {
  const s = new MemoryRateLimitStore();
  const w = 60_000;
  const max = 2;
  const key = "login_fail:ip|e@x";
  await s.increment(key, w);
  await s.increment(key, w);
  const st = await s.get(key);
  assert.ok(st && st.count >= max);
});
