/**
 * CP-077 — Leads + clients (création via étape Signé, MAJ, convert idempotent).
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

/** @param {string} orgId */
async function signedStageId(orgId) {
  const pool = getPool();
  assert.ok(pool, "pool");
  const r = await pool.query(
    `SELECT id FROM pipeline_stages WHERE organization_id = $1 AND code = 'SIGNED' LIMIT 1`,
    [orgId]
  );
  return r.rows[0]?.id ?? null;
}

test("lead : création + étape Signé → fiche client (organization_id cohérent)", async (t) => {
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

  const stageId = await signedStageId(ctx.orgId);
  assert.ok(stageId, "étape SIGNED introuvable pour l’org (seed pipeline)");
  const st = await api(ctx.token, "PATCH", `/api/leads/${leadId}/stage`, { stageId });
  assert.equal(st.status, 200, JSON.stringify(st.data));

  const det = await api(ctx.token, "GET", `/api/leads/${leadId}`);
  assert.equal(det.status, 200, JSON.stringify(det.data));
  const clientId = det.data?.lead?.client_id;
  assert.ok(clientId, JSON.stringify(det.data));

  const pool = getPool();
  const row = await pool.query(`SELECT organization_id FROM clients WHERE id = $1`, [clientId]);
  assert.equal(row.rows[0].organization_id, ctx.orgId);

  const put = await api(ctx.token, "PUT", `/api/clients/${clientId}`, {
    notes: "cp077-client-notes",
  });
  assert.ok([200].includes(put.status), `PUT client ${put.status}`);
});

test("POST /convert interdit sans Signé ; convert-to-client idempotent après Signé", async (t) => {
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

  const conv0 = await api(ctx.token, "POST", `/api/leads/${leadId}/convert`, {});
  assert.equal(conv0.status, 400, JSON.stringify(conv0.data));
  assert.equal(conv0.data?.code, "CLIENT_REQUIRES_PIPELINE_SIGNED");

  const stageId = await signedStageId(ctx.orgId);
  assert.ok(stageId);
  const st = await api(ctx.token, "PATCH", `/api/leads/${leadId}/stage`, { stageId });
  assert.equal(st.status, 200, JSON.stringify(st.data));

  const conv1 = await api(ctx.token, "POST", `/api/leads/${leadId}/convert-to-client`, {});
  assert.equal(conv1.status, 200, JSON.stringify(conv1.data));
  assert.ok(conv1.data?.client?.id);
  assert.equal(conv1.data?.already_converted, true);

  const conv2 = await api(ctx.token, "POST", `/api/leads/${leadId}/convert-to-client`, {});
  assert.equal(conv2.status, 200, JSON.stringify(conv2.data));
  assert.equal(conv2.data?.client?.id, conv1.data?.client?.id);
  assert.equal(conv2.data?.already_converted, true);
});
