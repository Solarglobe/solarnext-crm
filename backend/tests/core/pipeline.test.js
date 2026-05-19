/**
 * Pipeline regression guards.
 *
 * Command:
 *   node --env-file=../.env.dev --test tests/core/pipeline.test.js
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { integrationAvailable, api, getPool, loginJson } from "./harness.mjs";

const EXPECTED_PIPELINE = [
  { code: "NEW", name: "Nouveau lead", is_closed: false },
  { code: "QUALIFIED", name: "Qualification", is_closed: false },
  { code: "APPOINTMENT", name: "RDV planifie", is_closed: false },
  { code: "STUDY", name: "Etude en cours", is_closed: false },
  { code: "OFFER_SENT", name: "Offre envoyee", is_closed: false },
  { code: "FOLLOW_UP", name: "A relancer", is_closed: false },
  { code: "SIGNED", name: "Signe", is_closed: false },
  { code: "LOST", name: "Perdu", is_closed: true },
  { code: "CONTACTED", name: "Injoignable", is_closed: false },
];

let canRun = false;

before(async () => {
  canRun = await integrationAvailable();
});

function skipIfUnavailable(t) {
  if (canRun) return false;
  t.skip("integration indisponible");
  return true;
}

async function createIsolatedAdminContext() {
  const pool = getPool();
  assert.ok(pool, "pool");

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const orgName = `Pipeline Guard ${suffix}`;
  const orgRes = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [orgName]);
  const orgId = orgRes.rows[0].id;

  await pool.query(
    "UPDATE organizations SET onboarding_completed = true, onboarding_step_completed = ARRAY['company','mail','team','lead']::text[] WHERE id = $1",
    [orgId]
  );

  const { hashPassword } = await import("../../auth/auth.service.js");
  const { ensureOrgRolesSeeded } = await import("../../rbac/rbac.service.js");
  await ensureOrgRolesSeeded(orgId);

  const email = `pipeline-guard-${suffix}@test.local`;
  const password = "PipelineGuard123!";
  const passwordHash = await hashPassword(password);
  const userRes = await pool.query(
    "INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id",
    [orgId, email, passwordHash]
  );
  const userId = userRes.rows[0].id;

  const adminRole = await pool.query(
    "SELECT id FROM rbac_roles WHERE code = 'ADMIN' AND (organization_id = $1 OR organization_id IS NULL) ORDER BY organization_id NULLS LAST LIMIT 1",
    [orgId]
  );
  assert.ok(adminRole.rows[0]?.id, "role ADMIN introuvable");
  await pool.query(
    "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
    [userId, adminRole.rows[0].id]
  );

  for (const code of ["org.settings.manage", "lead.create", "lead.read.all", "lead.update.all"]) {
    const permRes = await pool.query("SELECT id FROM rbac_permissions WHERE code = $1", [code]);
    if (!permRes.rows[0]?.id) continue;
    await pool.query(
      "INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING",
      [adminRole.rows[0].id, permRes.rows[0].id]
    );
  }

  const login = await loginJson(email, password);
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.ok(login.data?.token, "token manquant");

  return { orgId, token: login.data.token };
}

async function pipelineStages(orgId) {
  const pool = getPool();
  const res = await pool.query(
    "SELECT id, name, code, position, is_closed FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC",
    [orgId]
  );
  return res.rows;
}

async function createLead(token, emailPrefix = "pipeline-guard") {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const res = await api(token, "POST", "/api/leads", {
    first_name: "Pipeline",
    last_name: "Guard",
    email: `${emailPrefix}-${suffix}@test.local`,
    customer_type: "PERSON",
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.ok(res.data?.id, "lead id manquant");
  return res.data;
}

test("organisation neuve: seed pipeline V2 canonique et colonnes Kanban lisibles", async (t) => {
  if (skipIfUnavailable(t)) return;
  const ctx = await createIsolatedAdminContext();

  const stages = await pipelineStages(ctx.orgId);
  assert.deepEqual(
    stages.map((stage) => ({ code: stage.code, name: stage.name, is_closed: stage.is_closed })),
    EXPECTED_PIPELINE
  );
  assert.deepEqual(stages.map((stage) => stage.position), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const kanban = await api(ctx.token, "GET", "/api/leads/kanban");
  assert.equal(kanban.status, 200, JSON.stringify(kanban.data));
  assert.deepEqual(
    kanban.data.columns.map((column) => column.stage_name),
    EXPECTED_PIPELINE.map((stage) => stage.name)
  );
});

test("stage SIGNED: convertit le lead en client sans changer le pipeline", async (t) => {
  if (skipIfUnavailable(t)) return;
  const ctx = await createIsolatedAdminContext();
  const beforeStages = await pipelineStages(ctx.orgId);
  const lead = await createLead(ctx.token, "signed");
  const signed = beforeStages.find((stage) => stage.code === "SIGNED");
  assert.ok(signed?.id, "stage SIGNED manquant");

  const move = await api(ctx.token, "PATCH", `/api/leads/${lead.id}/stage`, { stageId: signed.id });
  assert.equal(move.status, 200, JSON.stringify(move.data));

  const pool = getPool();
  const row = await pool.query(
    "SELECT l.status, l.client_id, c.organization_id AS client_org_id FROM leads l LEFT JOIN clients c ON c.id = l.client_id WHERE l.id = $1",
    [lead.id]
  );
  assert.equal(row.rows[0].status, "CLIENT");
  assert.ok(row.rows[0].client_id, "client_id manquant apres SIGNED");
  assert.equal(row.rows[0].client_org_id, ctx.orgId);
  assert.deepEqual(await pipelineStages(ctx.orgId), beforeStages);
});

test("stage LOST: archive le lead sans conversion client", async (t) => {
  if (skipIfUnavailable(t)) return;
  const ctx = await createIsolatedAdminContext();
  const stages = await pipelineStages(ctx.orgId);
  const lead = await createLead(ctx.token, "lost");
  const lost = stages.find((stage) => stage.code === "LOST");
  assert.ok(lost?.id, "stage LOST manquant");
  assert.equal(lost.is_closed, true);

  const move = await api(ctx.token, "PATCH", `/api/leads/${lead.id}/stage`, { stageId: lost.id });
  assert.equal(move.status, 200, JSON.stringify(move.data));

  const pool = getPool();
  const row = await pool.query(
    "SELECT status, archived, archived_at, archived_reason, client_id FROM leads WHERE id = $1",
    [lead.id]
  );
  assert.equal(row.rows[0].status, "ARCHIVED");
  assert.equal(row.rows[0].archived, true);
  assert.ok(row.rows[0].archived_at, "archived_at manquant");
  assert.equal(row.rows[0].archived_reason, "LOST");
  assert.equal(row.rows[0].client_id, null);
});

test("onboarding: ignore un payload pipeline legacy et preserve le pipeline reel", async (t) => {
  if (skipIfUnavailable(t)) return;
  const ctx = await createIsolatedAdminContext();
  const beforeStages = await pipelineStages(ctx.orgId);

  const res = await api(ctx.token, "PATCH", "/api/organizations/onboarding", {
    completedSteps: ["company", "pipeline", "lead"],
    activeStep: "pipeline",
    completed: false,
    data: {
      pipeline: [{ id: "fake", name: "Pipeline a ne jamais stocker" }],
      lead: {
        first_name: "Premier",
        last_name: "Lead",
        email: "onboarding-pipeline-legacy@test.local",
      },
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.completedSteps, ["company", "lead"]);
  assert.equal(res.data.data.active_step, "company");
  assert.equal(Object.hasOwn(res.data.data, "pipeline"), false);

  const pool = getPool();
  const settings = await pool.query(
    "SELECT settings_json, onboarding_step_completed FROM organizations WHERE id = $1",
    [ctx.orgId]
  );
  assert.equal(Object.hasOwn(settings.rows[0].settings_json.onboarding, "pipeline"), false);
  assert.deepEqual(settings.rows[0].onboarding_step_completed, ["company", "lead"]);
  assert.deepEqual(await pipelineStages(ctx.orgId), beforeStages);
});
