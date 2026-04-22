/**
 * CP-077 — Rate limit : store mémoire + endpoint public_heavy (calc).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { MemoryRateLimitStore } from "../../middleware/security/stores/memory.store.js";
import { integrationAvailable, BASE_URL, ensureAdminContext } from "./harness.mjs";
import fetch from "node-fetch";

test("MemoryRateLimitStore.consumeQuota refuse après max", async () => {
  const s = new MemoryRateLimitStore();
  const w = 60_000;
  const max = 2;
  assert.equal((await s.consumeQuota("k", w, max)).allowed, true);
  assert.equal((await s.consumeQuota("k", w, max)).allowed, true);
  assert.equal((await s.consumeQuota("k", w, max)).allowed, false);
});

let canRun = false;
before(async () => {
  canRun = await integrationAvailable();
});

test("public_heavy : POST /api/calc finit par 429", async (t) => {
  if (!canRun) {
    t.skip("intégration indisponible");
    return;
  }
  let ctx;
  try {
    ctx = await ensureAdminContext();
  } catch (e) {
    t.skip(String(e?.message || e));
    return;
  }
  let got429 = false;
  for (let i = 0; i < 24; i++) {
    const fd = new FormData();
    fd.append("csv", new Blob(["x\n"], { type: "text/csv" }), "t.csv");
    const res = await fetch(`${BASE_URL}/api/calc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}` },
      body: fd,
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      assert.equal(j.error, "RATE_LIMITED");
      got429 = true;
      break;
    }
  }
  assert.ok(got429, "429 attendu sur /api/calc");
});
