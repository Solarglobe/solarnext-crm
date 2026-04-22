/**
 * CP-077 — RGPD : export JSON + anonymisation + audit (minimum).
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
      console.error("[CP-077 rgpd] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("RGPD export + anonymisation + audit_logs", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }

  const pool = getPool();
  const suffix = Date.now();
  const clientNumber = `CP077-RGPD-${suffix}`;
  const email = `cp077-rgpd-${suffix}@example.test`;

  const ins = await pool.query(
    `INSERT INTO clients (
      organization_id, client_number, company_name, first_name, last_name, email, city
    ) VALUES ($1, $2, 'Cp077 RGPD', 'A', 'B', $3, 'Paris')
    RETURNING id`,
    [ctx.orgId, clientNumber, email]
  );
  const clientId = ins.rows[0].id;

  try {
    const exp = await api(ctx.token, "GET", `/api/rgpd/export/client/${clientId}`);
    assert.equal(exp.status, 200, JSON.stringify(exp.data));
    assert.equal(exp.data?.entity?.email, email);
    assert.ok(exp.data?.exported_at);
    assert.equal(exp.data?.organization_id, ctx.orgId);

    const del = await api(ctx.token, "DELETE", `/api/rgpd/delete/client/${clientId}`);
    assert.equal(del.status, 200, JSON.stringify(del.data));

    const row = await pool.query(`SELECT email, first_name FROM clients WHERE id = $1`, [clientId]);
    assert.equal(row.rows[0].email, "anonymized@invalid.local");
    assert.equal(row.rows[0].first_name, "ANONYMIZED");

    const aud = await pool.query(
      `SELECT action FROM audit_logs
       WHERE organization_id = $1 AND entity_id = $2::uuid
         AND action IN ('RGPD_EXPORT_REQUESTED','RGPD_DELETE_REQUESTED')
       ORDER BY created_at`,
      [ctx.orgId, clientId]
    );
    const actions = aud.rows.map((r) => r.action);
    assert.ok(actions.includes("RGPD_EXPORT_REQUESTED"));
    assert.ok(actions.includes("RGPD_DELETE_REQUESTED"));
  } finally {
    /* ligne conservée anonymisée — pas de suppression destructive */
  }
});
