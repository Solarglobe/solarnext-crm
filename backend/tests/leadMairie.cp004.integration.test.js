/**
 * CP-MAIRIES-004 — Leads ↔ mairies (enrichissement liste, PATCH mairie_id, auto-match).
 * Prérequis : harness intégration, migrations mairies + leads.mairie_id.
 * Désactiver : CP_LEAD_MAIRIE_SKIP=1
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  integrationAvailable,
  ensureAdminContext,
  api,
  getPool,
} from "./core/harness.mjs";

let canRun = false;
let ctx = null;

before(async () => {
  if (process.env.CP_LEAD_MAIRIE_SKIP === "1") return;
  canRun = await integrationAvailable();
  if (canRun) {
    try {
      ctx = await ensureAdminContext();
    } catch (e) {
      console.error("[CP-004] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("GET liste leads expose mairie_account_status ; PATCH mairie_id ; auto-match CP+ville unique", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }

  const pool = getPool();
  const suffix = Date.now();
  const postal = String(75000 + (suffix % 99));
  const city = `Ville-${suffix}`;

  const m = await api(ctx.token, "POST", "/api/mairies", {
    name: `Mairie CP004-${suffix}`,
    postal_code: postal,
    city,
    portal_type: "online",
    account_status: "to_create",
    portal_url: `https://cp004-${suffix}.example.test`,
  });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  const mairieId = m.data.id;

  await api(ctx.token, "POST", "/api/mairies", {
    name: `Mairie même CP autre ville-${suffix}`,
    postal_code: postal,
    city: `Autre-${suffix}`,
    portal_type: "paper",
    account_status: "none",
  });

  const addr = await pool.query(
    `INSERT INTO addresses (organization_id, postal_code, city, address_line1, country_code)
     VALUES ($1, $2, $3, '1 rue test', 'FR') RETURNING id`,
    [ctx.orgId, postal, city]
  );
  const addressId = addr.rows[0].id;

  const { ensureCanonicalLeadSourcesForOrg } = await import("../services/leadSourcesCatalog.service.js");
  await ensureCanonicalLeadSourcesForOrg(ctx.orgId);
  const srcRes = await pool.query(
    `SELECT id FROM lead_sources WHERE organization_id = $1 AND slug = 'autre' LIMIT 1`,
    [ctx.orgId]
  );
  const sourceId = srcRes.rows[0]?.id;
  assert.ok(sourceId, "source autre");

  const stages = await pool.query(
    `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1`,
    [ctx.orgId]
  );
  const stageId = stages.rows[0]?.id;
  assert.ok(stageId);

  const ins = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, email, source_id, site_address_id, mairie_id)
     VALUES ($1, $2, 'LEAD', $3, $4, $5, $6, NULL) RETURNING id`,
    [ctx.orgId, stageId, `Lead CP004 ${suffix}`, `cp004-${suffix}@example.test`, sourceId, addressId]
  );
  const leadId = ins.rows[0].id;

  const list = await api(ctx.token, "GET", "/api/leads?search=" + encodeURIComponent(`cp004-${suffix}`));
  assert.equal(list.status, 200);
  const rows = Array.isArray(list.data) ? list.data : list.data?.leads;
  assert.ok(Array.isArray(rows));
  const row = rows.find((r) => r.id === leadId);
  assert.ok(row, "lead dans liste");
  if (row.mairie_id == null) {
    const patchAuto = await api(ctx.token, "PATCH", `/api/leads/${leadId}`, { notes: `touch-${suffix}` });
    assert.equal(patchAuto.status, 200, "PATCH déclenche auto-match");
    const r2 = await pool.query(`SELECT mairie_id FROM leads WHERE id = $1`, [leadId]);
    assert.equal(String(r2.rows[0].mairie_id), String(mairieId), "auto-match unique CP+ville");
  } else {
    assert.equal(String(row.mairie_id), String(mairieId));
  }

  const list2 = await api(ctx.token, "GET", `/api/leads?limit=5&search=${encodeURIComponent(String(suffix))}`);
  assert.equal(list2.status, 200);
  const rows2 = Array.isArray(list2.data) ? list2.data : list2.data?.leads;
  const row2 = rows2?.find((r) => r.id === leadId);
  assert.ok(row2?.mairie_account_status != null || row2?.mairie_id, "champ mairie liste");

  const unlink = await api(ctx.token, "PATCH", `/api/leads/${leadId}`, { mairie_id: null });
  assert.equal(unlink.status, 200);

  const link = await api(ctx.token, "PATCH", `/api/leads/${leadId}`, { mairie_id: mairieId });
  assert.equal(link.status, 200);
  assert.equal(String(link.data.mairie_id), String(mairieId));

  const bad = await api(ctx.token, "PATCH", `/api/leads/${leadId}`, {
    mairie_id: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(bad.status, 400);

  await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  await pool.query(`DELETE FROM addresses WHERE id = $1`, [addressId]);
  await pool.query(`DELETE FROM mairies WHERE organization_id = $1 AND postal_code = $2`, [ctx.orgId, postal]);
});
