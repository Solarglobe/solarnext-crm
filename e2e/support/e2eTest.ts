import { test as base, expect, request } from "../../frontend/node_modules/@playwright/test";

export { expect, request };

export const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:3000";

const PREFIX = "e2e-critical";
const PERMISSIONS = [
  "org.settings.manage",
  "user.manage",
  "rbac.manage",
  "structure.manage",
  "lead.create",
  "lead.read.all",
  "lead.update.all",
  "client.read.all",
  "mail.accounts.manage",
  "study.manage",
  "quote.manage",
  "QUOTE_CATALOG:READ",
  "QUOTE_CATALOG:WRITE",
  "invoice.manage",
];

let backendModules:
  | {
      pool: typeof import("../../backend/config/db.js").pool;
      hashPassword: typeof import("../../backend/auth/auth.service.js").hashPassword;
      ensureOrgRolesSeeded: typeof import("../../backend/rbac/rbac.service.js").ensureOrgRolesSeeded;
    }
  | null = null;

async function backend() {
  if (!backendModules) {
    await import("../../backend/config/register-local-env.js");
    const db = await import("../../backend/config/db.js");
    const auth = await import("../../backend/auth/auth.service.js");
    const rbac = await import("../../backend/rbac/rbac.service.js");
    backendModules = {
      pool: db.pool,
      hashPassword: auth.hashPassword,
      ensureOrgRolesSeeded: rbac.ensureOrgRolesSeeded,
    };
  }
  return backendModules;
}

type SeedContext = {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  token: string;
};

export const test = base.extend<{ seed: SeedContext }>({
  seed: async ({}, use) => {
    await ensureApiReady();
    const seed = await createSeedContext();
    try {
      await use(seed);
    } finally {
      await cleanupOrg(seed.orgId);
    }
  },
});

export async function ensureApiReady() {
  if (!process.env.DATABASE_URL) {
    test.skip(true, "DATABASE_URL requis pour les E2E metier isoles");
  }
  const res = await fetch(`${API_URL}/`).catch(() => null);
  test.skip(!res?.ok, `API E2E indisponible sur ${API_URL}`);
}

export async function createSeedContext(): Promise<SeedContext> {
  const { pool, hashPassword, ensureOrgRolesSeeded } = await backend();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `${PREFIX}-${suffix}@test.local`;
  const password = "E2eTest123!";

  const orgRes = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [
    `${PREFIX}-org-${suffix}`,
  ]);
  const orgId = orgRes.rows[0].id;
  await ensureOrgRolesSeeded(orgId);

  const pwdHash = await hashPassword(password);
  const userRes = await pool.query(
    `INSERT INTO users (organization_id, email, password_hash, status, email_verified_at)
     VALUES ($1, $2, $3, 'active', now())
     RETURNING id`,
    [orgId, email, pwdHash]
  );
  const userId = userRes.rows[0].id;

  const adminRole = await pool.query(
    "SELECT id FROM rbac_roles WHERE code = 'ADMIN' AND (organization_id = $1 OR organization_id IS NULL) ORDER BY organization_id NULLS LAST LIMIT 1",
    [orgId]
  );
  if (adminRole.rows[0]?.id) {
    await pool.query(
      "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, adminRole.rows[0].id]
    );
    for (const code of PERMISSIONS) {
      const perm = await pool.query("SELECT id FROM rbac_permissions WHERE code = $1", [code]);
      if (perm.rows[0]?.id) {
        await pool.query(
          "INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [adminRole.rows[0].id, perm.rows[0].id]
        );
      }
    }
  }

  const login = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await login.json().catch(() => ({}));
  expect(login.status, JSON.stringify(data)).toBe(200);
  expect(data.token).toEqual(expect.any(String));

  return { orgId, userId, email, password, token: data.token };
}

export async function cleanupOrg(orgId: string) {
  const { pool } = await backend();
  await pool.query("DELETE FROM organizations WHERE id = $1", [orgId]).catch(() => {});
}

export async function api(seed: SeedContext, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${seed.token}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { status: res.status, data, headers: res.headers };
}

export async function completeOnboarding(seed: SeedContext) {
  const res = await api(seed, "PATCH", "/api/organizations/onboarding", {
    completed: true,
    completedSteps: ["company", "mail", "team", "lead"],
    activeStep: "lead",
    data: {
      profile: {
        name: `Organisation ${seed.orgId.slice(0, 8)}`,
      },
    },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  return res.data;
}

export function coherentQuotePayload(ids: Awaited<ReturnType<typeof seedLockedFinancialScenario>>) {
  return {
    lead_id: ids.leadId,
    study_id: ids.studyId,
    study_version_id: ids.versionId,
    items: [
      {
        label: "Installation photovoltaique 6 kWc",
        description: "Installation photovoltaique 6 kWc",
        quantity: 1,
        unit_price_ht: 10000,
        vat_rate: 20,
      },
    ],
  };
}

export async function lockQuoteForImmutability(seed: SeedContext, quoteId: string) {
  const { pool } = await backend();
  await pool.query(
    "UPDATE quotes SET locked_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2",
    [quoteId, seed.orgId]
  );
}

export async function markQuoteAccepted(seed: SeedContext, quoteId: string) {
  const { pool } = await backend();
  await pool.query(
    "UPDATE quotes SET status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2",
    [quoteId, seed.orgId]
  );
}

export async function createLeadStudyVersion(seed: SeedContext) {
  const { pool } = await backend();
  const stage = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position NULLS LAST, created_at ASC LIMIT 1",
    [seed.orgId]
  );
  const lead = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, consumption_mode, consumption_annual_kwh)
     VALUES ($1, $2, 'E2E', 'Critique', 'E2E Critique', $3, 'ANNUAL', 6500)
     RETURNING id`,
    [seed.orgId, stage.rows[0]?.id ?? null, `lead-${Date.now()}@test.local`]
  );
  const study = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status, current_version, created_by)
     VALUES ($1, $2, $3, 'draft', 1, $4)
     RETURNING id`,
    [seed.orgId, lead.rows[0].id, `E2E-${Date.now()}`, seed.userId]
  );
  const version = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, title, data_json, created_by)
     VALUES ($1, $2, 1, 'E2E v1', '{}'::jsonb, $3)
     RETURNING id`,
    [seed.orgId, study.rows[0].id, seed.userId]
  );

  return { leadId: lead.rows[0].id, studyId: study.rows[0].id, versionId: version.rows[0].id };
}

export async function createClient(seed: SeedContext) {
  const { pool } = await backend();
  const client = await pool.query(
    `INSERT INTO clients (organization_id, first_name, last_name, full_name, email, status)
     VALUES ($1, 'E2E', 'Client', 'E2E Client', $2, 'active')
     RETURNING id`,
    [seed.orgId, `client-${Date.now()}@test.local`]
  );
  return client.rows[0].id;
}

export async function seedLockedFinancialScenario(seed: SeedContext) {
  const { pool } = await backend();
  const ids = await createLeadStudyVersion(seed);
  const snapshot = {
    id: "BASE",
    installation: { production_annuelle_kwh: 7200, puissance_kwc: 6 },
    finance: { capex_ttc: 12000 },
  };
  await pool.query(
    `UPDATE study_versions
     SET is_locked = true,
         locked_at = now(),
         selected_scenario_id = 'BASE',
         selected_scenario_snapshot = $1::jsonb,
         data_json = jsonb_set(COALESCE(data_json, '{}'::jsonb), '{scenarios_v2}', $2::jsonb)
     WHERE id = $3`,
    [JSON.stringify(snapshot), JSON.stringify([snapshot]), ids.versionId]
  );
  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
     VALUES ($1, $2, '{}'::jsonb, 15, 6, 7200, 0)
     ON CONFLICT (study_version_id) DO UPDATE
     SET total_power_kwc = EXCLUDED.total_power_kwc,
         annual_production_kwh = EXCLUDED.annual_production_kwh`,
    [seed.orgId, ids.versionId]
  );
  return ids;
}
