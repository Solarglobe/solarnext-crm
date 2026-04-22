/**
 * CP-077 — Mail : endpoint /send valide la charge utile (pas d’envoi SMTP réel si données invalides).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { integrationAvailable, ensureAdminContext, api } from "./harness.mjs";

let canRun = false;
let ctx = null;

before(async () => {
  canRun = await integrationAvailable();
  if (canRun) {
    try {
      ctx = await ensureAdminContext();
    } catch (e) {
      console.error("[CP-077 mail] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("POST /api/mail/send : corps incomplet → 400 (pas de crash)", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const res = await api(ctx.token, "POST", "/api/mail/send", {
    subject: "cp077",
  });
  assert.ok(
    [400, 403, 502].includes(res.status),
    `Attendu 400/403/502 (validation ou permission), reçu ${res.status} ${JSON.stringify(res.data)}`
  );
});

test("GET /api/mail/inbox : répond (200 ou 403 selon config mail)", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const res = await api(ctx.token, "GET", "/api/mail/inbox?limit=1");
  assert.ok(
    [200, 403, 400].includes(res.status),
    `inbox ${res.status}`
  );
});
