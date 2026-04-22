/**
 * CP-MAIRIES-002 — API /api/mairies (intégration : backend + DB + RBAC).
 * Prérequis : migrations à jour (mairie.read / mairie.manage), backend sur TEST_BASE_URL.
 * Désactiver : CP_MAIRIES_SKIP_INTEGRATION=1
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  integrationAvailable,
  ensureAdminContext,
  api,
  getPool,
  loginJson,
} from "./core/harness.mjs";

let canRun = false;
let ctx = null;

before(async () => {
  if (process.env.CP_MAIRIES_SKIP_INTEGRATION === "1") return;
  canRun = await integrationAvailable();
  if (canRun) {
    try {
      ctx = await ensureAdminContext();
    } catch (e) {
      console.error("[CP-MAIRIES-002] fixture:", e?.message || e);
      canRun = false;
    }
  }
});

test("GET/POST/PATCH/DELETE mairies + 409 doublon + isolation org", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }

  const pool = getPool();
  const suffix = Date.now();
  const nameA = `CP-Mairies-A-${suffix}`;
  const postal = String(99000 + (suffix % 900));

  const create = await api(ctx.token, "POST", "/api/mairies", {
    name: nameA,
    postal_code: postal,
    city: "Testville",
    portal_url: `https://example-${suffix}.test/portail`,
    portal_type: "online",
    account_status: "none",
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  assert.equal(create.data.name, nameA);
  assert.equal(create.data.linked_leads_count, 0);

  const list = await api(ctx.token, "GET", "/api/mairies");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.data.items));
  assert.ok(list.data.items.some((m) => m.id === create.data.id));

  const dup = await api(ctx.token, "POST", "/api/mairies", {
    name: "Autre nom",
    postal_code: postal,
    city: "Testville",
    portal_url: `https://example-${suffix}.test/portail`,
    portal_type: "online",
    account_status: "none",
  });
  assert.equal(dup.status, 409, JSON.stringify(dup.data));
  assert.equal(dup.data.code, "MAIRIE_ALREADY_EXISTS");
  assert.ok(dup.data.suggestion);

  const otherOrg = await pool.query(
    "SELECT id FROM organizations WHERE id <> $1 LIMIT 1",
    [ctx.orgId]
  );
  const { ensureCanonicalLeadSourcesForOrg } = await import("../services/leadSourcesCatalog.service.js");
  await ensureCanonicalLeadSourcesForOrg(ctx.orgId);
  const srcRes = await pool.query(
    `SELECT id FROM lead_sources WHERE organization_id = $1 AND slug = 'autre' LIMIT 1`,
    [ctx.orgId]
  );

  if (otherOrg.rows.length > 0) {
    const org2 = otherOrg.rows[0].id;
    const ghostName = `ORG2-GHOST-${suffix}`;
    await pool.query(
      `INSERT INTO mairies (organization_id, name, postal_code, city, portal_type, account_status)
       VALUES ($1, $2, $3, 'X', 'paper', 'none')`,
      [org2, ghostName, postal]
    );
    const list2 = await api(ctx.token, "GET", `/api/mairies?q=${encodeURIComponent(ghostName)}`);
    assert.equal(list2.status, 200);
    assert.equal(
      list2.data.items.some((m) => m.name === ghostName),
      false,
      "pas de fuite inter-organisation"
    );
    await pool.query(`DELETE FROM mairies WHERE organization_id = $1 AND name = $2`, [org2, ghostName]);
  }

  const beforeUp = create.data.updated_at;
  const patch = await api(ctx.token, "PATCH", `/api/mairies/${create.data.id}`, {
    account_status: "created",
    account_email: `mairie-${suffix}@example.test`,
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.account_status, "created");
  assert.ok(patch.data.updated_at);
  if (beforeUp) {
    assert.notEqual(String(patch.data.updated_at), String(beforeUp));
  }

  const one = await api(ctx.token, "GET", `/api/mairies/${create.data.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.data.account_email, `mairie-${suffix}@example.test`);

  const stg = await pool.query(
    `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1`,
    [ctx.orgId]
  );
  if (stg.rows.length === 0) {
    await pool.query(`DELETE FROM mairies WHERE id = $1`, [create.data.id]);
    t.skip("pipeline_stages manquant pour l’org");
    return;
  }
  const stageId = stg.rows[0].id;
  const sourceId = srcRes.rows[0]?.id;
  if (!sourceId) {
    await pool.query(`DELETE FROM mairies WHERE id = $1`, [create.data.id]);
    t.skip("lead_sources / autre introuvable");
    return;
  }

  const leadIns = await pool.query(
    `INSERT INTO leads (
      organization_id, stage_id, source_id, status, full_name, email, mairie_id
    ) VALUES ($1, $2, $3, 'LEAD', 'Lead test DP', $4, $5) RETURNING id`,
    [ctx.orgId, stageId, sourceId, `lead-${suffix}@example.test`, create.data.id]
  );
  const leadId = leadIns.rows[0].id;

  try {
    const oneAfterLead = await api(ctx.token, "GET", `/api/mairies/${create.data.id}`);
    assert.equal(oneAfterLead.data.linked_leads_count, 1);

    const del = await api(ctx.token, "DELETE", `/api/mairies/${create.data.id}`);
    assert.equal(del.status, 204);

    const leadCheck = await pool.query(`SELECT mairie_id FROM leads WHERE id = $1`, [leadId]);
    assert.equal(leadCheck.rows[0].mairie_id, null);

    await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  } catch (e) {
    await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]).catch(() => {});
    throw e;
  }
});

test("TECHNICIEN : lecture OK, écriture 403", async (t) => {
  if (!canRun || !ctx) {
    t.skip("intégration indisponible");
    return;
  }

  const pool = getPool();
  const suffix = Date.now();
  const email = `tech-mairie-${suffix}@example.test`;
  const pwd = "TechMairie123!";

  const { hashPassword } = await import("../auth/auth.service.js");
  const h = await hashPassword(pwd);
  const insU = await pool.query(
    `INSERT INTO users (organization_id, email, password_hash, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [ctx.orgId, email, h]
  );
  const uid = insU.rows[0].id;

  const roleRes = await pool.query(
    `SELECT id FROM rbac_roles WHERE code = 'TECHNICIEN' AND (organization_id IS NULL OR organization_id = $1) ORDER BY organization_id NULLS LAST LIMIT 1`,
    [ctx.orgId]
  );
  if (roleRes.rows.length === 0) {
    t.skip("rôle TECHNICIEN absent");
    return;
  }
  const roleId = roleRes.rows[0].id;
  await pool.query(
    `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [uid, roleId]
  );

  const loginRes = await loginJson(email, pwd);
  if (loginRes.status !== 200 || !loginRes.data.token) {
    t.skip("login technicien impossible");
    return;
  }
  const techToken = loginRes.data.token;

  const rList = await api(techToken, "GET", "/api/mairies?limit=1");
  assert.equal(rList.status, 200, JSON.stringify(rList.data));

  const rPost = await api(techToken, "POST", "/api/mairies", {
    name: "Forbidden",
    postal_code: "10001",
  });
  assert.equal(rPost.status, 403, JSON.stringify(rPost.data));

  await pool.query(`DELETE FROM rbac_user_roles WHERE user_id = $1`, [uid]);
});
