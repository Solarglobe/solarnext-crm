/**
 * CP-077 — Leads + clients (création, MAJ, conversion).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { integrationAvailable, ensureAdminContext, api, getPool } from "./harness.mjs";

let canRun = false;
let ctx = null;

before(async () => {
  canRun = await integrationAvailable();
  if (canRun) {
    try {
      ctx = await ensureAdminContext();
    } catch (e) {
      console.error("[CP-077 clients-leads] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("lead : création + MAJ + conversion → client (organization_id cohérent)", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const suffix = Date.now();
  const email = `cp077-lead-${suffix}@test.local`;

  const create = await api(ctx.token, "POST", "/api/leads", {
    first_name: "Cp077",
    last_name: "Test",
    email,
    customer_type: "PERSON",
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const leadId = create.data?.id;
  assert.ok(leadId);

  const patch = await api(ctx.token, "PATCH", `/api/leads/${leadId}`, {
    notes: "cp077-patch",
  });
  assert.ok([200, 204].includes(patch.status), `PATCH lead ${patch.status}`);

  const conv = await api(ctx.token, "POST", `/api/leads/${leadId}/convert`, {});
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  const clientId = conv.data?.client?.id;
  assert.ok(clientId);
  assert.equal(conv.data?.client?.organization_id ?? conv.data?.client?.organizationId, ctx.orgId);

  const pool = getPool();
  const row = await pool.query(`SELECT organization_id FROM clients WHERE id = $1`, [clientId]);
  assert.equal(row.rows[0].organization_id, ctx.orgId);

  const put = await api(ctx.token, "PUT", `/api/clients/${clientId}`, {
    notes: "cp077-client-notes",
  });
  assert.ok([200].includes(put.status), `PUT client ${put.status}`);
});

test("POST /api/leads/:id/convert-to-client — création puis idempotent", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }
  const suffix = Date.now();
  const email = `cp077-conv2-${suffix}@test.local`;

  const create = await api(ctx.token, "POST", "/api/leads", {
    first_name: "Convert2",
    last_name: "Client",
    email,
    customer_type: "PERSON",
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const leadId = create.data?.id;
  assert.ok(leadId);

  const conv1 = await api(ctx.token, "POST", `/api/leads/${leadId}/convert-to-client`, {});
  assert.equal(conv1.status, 200, JSON.stringify(conv1.data));
  assert.ok(conv1.data?.client?.id);
  assert.equal(conv1.data?.already_converted, false);

  const conv2 = await api(ctx.token, "POST", `/api/leads/${leadId}/convert-to-client`, {});
  assert.equal(conv2.status, 200, JSON.stringify(conv2.data));
  assert.equal(conv2.data?.client?.id, conv1.data?.client?.id);
  assert.equal(conv2.data?.already_converted, true);
});
