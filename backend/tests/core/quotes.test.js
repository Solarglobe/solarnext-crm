/**
 * CP-077 — Devis : création, mise à jour, changement de statut.
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
      console.error("[CP-077 quotes] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("devis : création sur lead, modification, statut CANCELLED", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }

  const suffix = Date.now();
  const email = `cp077-quote-${suffix}@test.local`;
  const lead = await api(ctx.token, "POST", "/api/leads", {
    first_name: "Quote",
    last_name: "Cp077",
    email,
    customer_type: "PERSON",
  });
  assert.equal(lead.status, 201);
  const leadId = lead.data.id;

  const q = await api(ctx.token, "POST", "/api/quotes", {
    lead_id: leadId,
    items: [
      {
        label: "Ligne test",
        quantity: 1,
        unit_price_ht: 100,
        discount_ht: 0,
        vat_rate: 20,
      },
    ],
  });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  const quoteId = q.data?.quote?.id;
  assert.ok(quoteId);

  const upd = await api(ctx.token, "PATCH", `/api/quotes/${quoteId}`, {
    notes: "cp077-quote-notes",
  });
  assert.ok([200].includes(upd.status), `PATCH quote ${upd.status} ${JSON.stringify(upd.data)}`);

  const st = await api(ctx.token, "PATCH", `/api/quotes/${quoteId}/status`, {
    status: "CANCELLED",
  });
  assert.ok([200].includes(st.status), `PATCH status ${st.status} ${JSON.stringify(st.data)}`);
  assert.equal(st.data?.quote?.status, "CANCELLED");
});
