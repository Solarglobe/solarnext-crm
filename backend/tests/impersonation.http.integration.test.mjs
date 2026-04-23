/**
 * Intégration HTTP Express (supertest) — impersonation super admin / utilisateur.
 *
 * Prérequis : base PostgreSQL dédiée (migrations à jour), JWT_SECRET défini.
 * Obligatoire : IMPERSONATION_HTTP_DATABASE_URL (sécurité — n’utilise pas la DB dev par défaut).
 *
 * Exemple :
 *   cd backend
 *   set IMPERSONATION_HTTP_DATABASE_URL=postgresql://...
 *   npm run test:impersonation-http
 *
 * Désactiver : IMPERSONATION_HTTP_SKIP=1
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import request from "supertest";

const SKIP = process.env.IMPERSONATION_HTTP_SKIP === "1";
const TEST_DB = String(process.env.IMPERSONATION_HTTP_DATABASE_URL || "").trim();

if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
}
process.env.RBAC_ENFORCE = "1";
process.env.RATE_LIMIT_STORE = "memory";

await import("../config/load-env.js");
const { buildHttpApp } = await import("../httpApp.js");
const { pool } = await import("../config/db.js");
const { hashPassword, generateJWT, generateImpersonationJWT } = await import("../auth/auth.service.js");
const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
const { ensureCanonicalLeadSourcesForOrg } = await import("../services/leadSourcesCatalog.service.js");
const rbacCache = await import("../rbac/rbac.cache.js");
const { SUPER_ADMIN_ROLE_CODE } = await import("../lib/superAdminUserGuards.js");

/** @type {import("express").Express | null} */
let app = null;

/** @type {{
 * orgActive: string,
 * orgArchived: string,
 * superAdminId: string,
 * superAdminRoleId: string,
 * adminTargetId: string,
 * colleagueId: string,
 * techId: string,
 * salesId: string,
 * inactiveId: string,
 * superOnlyId: string,
 * pwd: string,
 * tag: string,
 * }} */
let ctx = null;

async function systemRoleId(code) {
  const r = await pool.query(
    `SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1 LIMIT 1`,
    [code]
  );
  assert.ok(r.rows[0]?.id, `rôle système manquant: ${code}`);
  return r.rows[0].id;
}

async function orgRoleId(orgId, code) {
  const r = await pool.query(
    `SELECT id FROM rbac_roles WHERE organization_id = $1 AND code = $2 LIMIT 1`,
    [orgId, code]
  );
  assert.ok(r.rows[0]?.id, `rôle org manquant: ${code} @${orgId}`);
  return r.rows[0].id;
}

async function assignRbac(userId, roleId) {
  await pool.query(
    `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, roleId]
  );
}

describe("Impersonation HTTP (supertest)", () => {
  before(async () => {
    if (SKIP || !TEST_DB) return;
    app = buildHttpApp();
    const tag = `ih${Date.now()}`;
    const pwd = "TestImpersonationHttp!2026";
    const hash = await hashPassword(pwd);

    const o1 = await pool.query(
      `INSERT INTO organizations (name, settings_json, is_archived)
       VALUES ($1, '{}'::jsonb, false) RETURNING id`,
      [`ImpHTTP Active ${tag}`]
    );
    const o2 = await pool.query(
      `INSERT INTO organizations (name, settings_json, is_archived)
       VALUES ($1, '{}'::jsonb, true) RETURNING id`,
      [`ImpHTTP Archived ${tag}`]
    );
    const orgActive = o1.rows[0].id;
    const orgArchived = o2.rows[0].id;
    await ensureOrgRolesSeeded(orgActive);
    await ensureOrgRolesSeeded(orgArchived);
    await ensureCanonicalLeadSourcesForOrg(orgActive);

    const superAdminRoleId = await systemRoleId("SUPER_ADMIN");
    const adminRid = await orgRoleId(orgActive, "ADMIN");
    const techRid = await orgRoleId(orgActive, "TECHNICIEN");
    const salesRid = await orgRoleId(orgActive, "SALES");

    const ins = async (email, orgId, status = "active") => {
      const u = await pool.query(
        `INSERT INTO users (organization_id, email, password_hash, status, first_name, last_name)
         VALUES ($1, $2, $3, $4, 'T', 'U') RETURNING id`,
        [orgId, email, hash, status]
      );
      return u.rows[0].id;
    };

    const superAdminId = await ins(`sa-${tag}@imp-http.test`, orgActive);
    const adminTargetId = await ins(`admin-${tag}@imp-http.test`, orgActive);
    const colleagueId = await ins(`colleague-${tag}@imp-http.test`, orgActive);
    const techId = await ins(`tech-${tag}@imp-http.test`, orgActive);
    const salesId = await ins(`sales-${tag}@imp-http.test`, orgActive);
    const inactiveId = await ins(`inactive-${tag}@imp-http.test`, orgActive, "inactive");
    const superOnlyId = await ins(`superonly-${tag}@imp-http.test`, orgActive);

    await assignRbac(superAdminId, superAdminRoleId);
    await assignRbac(adminTargetId, adminRid);
    await assignRbac(colleagueId, adminRid);
    await assignRbac(techId, techRid);
    await assignRbac(salesId, salesRid);
    await assignRbac(superOnlyId, superAdminRoleId);

    rbacCache.clear();

    ctx = {
      orgActive,
      orgArchived,
      superAdminId,
      superAdminRoleId,
      adminTargetId,
      colleagueId,
      techId,
      salesId,
      inactiveId,
      superOnlyId,
      pwd,
      tag,
    };
  });

  after(async () => {
    if (!ctx) return;
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [
      [ctx.orgActive, ctx.orgArchived],
    ]);
    rbacCache.clear();
  });

  test("POST /api/admin/organizations/:id/impersonate — 200 SUPER_ADMIN valide", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const token = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/organizations/${ctx.orgActive}/impersonate`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(typeof res.body.token === "string" && res.body.token.length > 20);
    assert.equal(res.body.organization?.id, ctx.orgActive);
  });

  test("POST /api/admin/organizations/:id/impersonate — 400 org archivée (ORG_ARCHIVED)", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const token = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/organizations/${ctx.orgArchived}/impersonate`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "ORG_ARCHIVED");
  });

  test("POST /api/admin/organizations/:id/impersonate — 401 sans Bearer", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const res = await request(app).post(`/api/admin/organizations/${ctx.orgActive}/impersonate`).send({});
    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.match(String(res.body.error || ""), /Token manquant/i);
  });

  test("POST /api/admin/organizations/:id/impersonate — 403 non SUPER_ADMIN", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const token = generateJWT({
      id: ctx.adminTargetId,
      organization_id: ctx.orgActive,
      role: "ADMIN",
    });
    const res = await request(app)
      .post(`/api/admin/organizations/${ctx.orgActive}/impersonate`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("POST /api/admin/organizations/:id/impersonate — 400 impersonation déjà active", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const first = await request(app)
      .post(`/api/admin/organizations/${ctx.orgActive}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(first.status, 200);
    const res = await request(app)
      .post(`/api/admin/organizations/${ctx.orgActive}/impersonate`)
      .set("Authorization", `Bearer ${first.body.token}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "IMPERSONATION_CHAIN_FORBIDDEN");
  });

  test("POST /api/admin/users/:id/impersonate — 200 SUPER_ADMIN valide + chaînes /auth/me", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/users/${ctx.adminTargetId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.token);
    assert.equal(res.body.user?.id, ctx.adminTargetId);

    const me = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send();
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.id, ctx.adminTargetId);
    assert.equal(me.body.organizationId, ctx.orgActive);
    assert.equal(me.body.superAdmin, false);
    assert.equal(me.body.impersonation, true);
    assert.equal(me.body.impersonationType, "USER");
  });

  test("POST /api/admin/users/:id/impersonate — 401 sans Bearer", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const res = await request(app).post(`/api/admin/users/${ctx.salesId}/impersonate`).send({});
    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.match(String(res.body.error || ""), /Token manquant/i);
  });

  test("POST /api/admin/users/:id/impersonate — 403 non SUPER_ADMIN", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const token = generateJWT({
      id: ctx.adminTargetId,
      organization_id: ctx.orgActive,
      role: "ADMIN",
    });
    const res = await request(app)
      .post(`/api/admin/users/${ctx.salesId}/impersonate`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("POST /api/admin/users/:id/impersonate — 400 USER_NOT_ACTIVE", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/users/${ctx.inactiveId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "USER_NOT_ACTIVE");
  });

  test("POST /api/admin/users/:id/impersonate — 400 ORG_ARCHIVED (utilisateur org archivée)", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const hash = await hashPassword(ctx.pwd);
    const u = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status, first_name, last_name)
       VALUES ($1, $2, $3, 'active', 'A', 'B') RETURNING id`,
      [ctx.orgArchived, `archuser-${ctx.tag}@imp-http.test`, hash]
    );
    const uid = u.rows[0].id;
    const rid = await orgRoleId(ctx.orgArchived, "SALES");
    await assignRbac(uid, rid);
    rbacCache.clear();
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/users/${uid}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "ORG_ARCHIVED");
    await pool.query(`DELETE FROM users WHERE id = $1`, [uid]);
    rbacCache.clear();
  });

  test("POST /api/admin/users/:id/impersonate — 400 IMPERSONATE_SUPER_FORBIDDEN", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const res = await request(app)
      .post(`/api/admin/users/${ctx.superOnlyId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "IMPERSONATE_SUPER_FORBIDDEN");
  });

  test("POST /api/admin/users/:id/impersonate — 400 impersonation déjà active", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const orgTok = generateImpersonationJWT({
      originalAdminId: ctx.superAdminId,
      targetOrganizationId: ctx.orgActive,
      originalAdminOrganizationId: ctx.orgActive,
    });
    const res = await request(app)
      .post(`/api/admin/users/${ctx.salesId}/impersonate`)
      .set("Authorization", `Bearer ${orgTok}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "IMPERSONATION_CHAIN_FORBIDDEN");
  });

  test("RBAC — token USER impersonation sans permission leads → 403 MISSING_PERMISSION", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const imp = await request(app)
      .post(`/api/admin/users/${ctx.techId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(imp.status, 200);
    const res = await request(app)
      .get("/api/leads/meta")
      .set("Authorization", `Bearer ${imp.body.token}`)
      .send();
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "MISSING_PERMISSION");
    assert.ok(String(res.body.permission || "").includes("lead.read"));
  });

  test("RBAC — token USER impersonation avec lead.read.self → 200 /api/leads/meta", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const imp = await request(app)
      .post(`/api/admin/users/${ctx.salesId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(imp.status, 200);
    const res = await request(app)
      .get("/api/leads/meta")
      .set("Authorization", `Bearer ${imp.body.token}`)
      .send();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.stages));
  });

  test("PUT user en impersonation USER — interdits self / admin / originalAdminId body", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const imp = await request(app)
      .post(`/api/admin/users/${ctx.adminTargetId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(imp.status, 200);
    const tok = imp.body.token;

    const selfPut = await request(app)
      .put(`/api/admin/users/${ctx.adminTargetId}`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ first_name: "X" });
    assert.equal(selfPut.status, 400, JSON.stringify(selfPut.body));
    assert.equal(selfPut.body.code, "IMPERSONATION_SELF_EDIT_FORBIDDEN");

    const adminPut = await request(app)
      .put(`/api/admin/users/${ctx.superAdminId}`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ first_name: "Y" });
    assert.equal(adminPut.status, 400, JSON.stringify(adminPut.body));
    assert.equal(adminPut.body.code, "IMPERSONATION_ADMIN_EDIT_FORBIDDEN");

    const bodyField = await request(app)
      .put(`/api/admin/users/${ctx.colleagueId}`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ first_name: "Z", originalAdminId: "00000000-0000-4000-8000-000000000099" });
    assert.equal(bodyField.status, 400, JSON.stringify(bodyField.body));
    assert.equal(bodyField.body.code, "IMPERSONATION_ORIGINAL_ADMIN_ID_BODY_FORBIDDEN");
  });

  test("Jeton USER — après révocation SUPER_ADMIN sur originalAdminId → 403 SUPER_ADMIN_JWT_STALE", async (t) => {
    if (SKIP || !TEST_DB || !ctx) {
      t.skip("IMPERSONATION_HTTP_DATABASE_URL requis ou suite désactivée");
      return;
    }
    const sa = generateJWT({
      id: ctx.superAdminId,
      organization_id: ctx.orgActive,
      role: SUPER_ADMIN_ROLE_CODE,
    });
    const imp = await request(app)
      .post(`/api/admin/users/${ctx.salesId}/impersonate`)
      .set("Authorization", `Bearer ${sa}`)
      .send({});
    assert.equal(imp.status, 200);
    const tok = imp.body.token;

    await pool.query(`DELETE FROM rbac_user_roles WHERE user_id = $1 AND role_id = $2`, [
      ctx.superAdminId,
      ctx.superAdminRoleId,
    ]);
    rbacCache.clear();

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${tok}`).send();
    assert.equal(me.status, 403, JSON.stringify(me.body));
    assert.equal(me.body.code, "SUPER_ADMIN_JWT_STALE");

    await assignRbac(ctx.superAdminId, ctx.superAdminRoleId);
    rbacCache.clear();
  });
});
