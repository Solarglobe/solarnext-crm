/**
 * PDF Pipeline — Fixtures partagées pour les tests
 */
import { pool } from "../../config/db.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../../.env"), override: false });

const SCENARIOS_V2 = [
  {
    id: "BASE",
    label: "Sans batterie",
    energy: { autoconsumption_kwh: 3000, surplus_kwh: 2000 },
    finance: { capex_ttc: 15000, roi_years: 8 },
    production: { annual_kwh: 7200, monthly_kwh: Array(12).fill(600) },
    shading: { total_loss_pct: 5 },
    hardware: {},
    assumptions: {},
    computed_at: new Date().toISOString(),
  },
];

const MINIMAL_SNAPSHOT = {
  scenario_type: "BASE",
  created_at: new Date().toISOString(),
  client: { nom: "Test", prenom: "Pipeline" },
  site: { lat: 48.85, lon: 2.35 },
  installation: { puissance_kwc: 6, panneaux_nombre: 12 },
  production: { annual_kwh: 7200, monthly_kwh: Array(12).fill(600) },
  equipment: {},
  shading: { total_loss_pct: 5 },
  energy: {},
  finance: {},
  cashflows: [],
  assumptions: {},
};

/** Snapshot partiel — données minimales pour TEST 5 CP-PDF-V2-018 */
const PARTIAL_SNAPSHOT = {
  scenario_type: "BASE",
  created_at: new Date().toISOString(),
  client: {},
  site: {},
  installation: {},
  production: {},
  equipment: {},
  shading: {},
  energy: {},
  finance: {},
  cashflows: [],
  assumptions: {},
};

export async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [`PDF-Pipeline-${Date.now()}`]
  );
  return ins.rows[0].id;
}

/** Étude + version avec snapshot (pour generate-pdf) */
export async function createStudyWithSnapshot(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-PIPE-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked)
     VALUES ($1, $2, 1, '{}'::jsonb, 'BASE', $3::jsonb, true) RETURNING id`,
    [orgId, studyId, JSON.stringify(MINIMAL_SNAPSHOT)]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

/** Étude + version SANS snapshot (pour select-scenario) */
export async function createStudyForSelectScenario(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-SEL-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const dataJson = { scenarios_v2: SCENARIOS_V2 };
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, is_locked)
     VALUES ($1, $2, 1, $3::jsonb, false) RETURNING id`,
    [orgId, studyId, JSON.stringify(dataJson)]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

/** Étude + version avec snapshot partiel (pour TEST 5 CP-PDF-V2-018) */
export async function createStudyWithPartialSnapshot(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-PARTIAL-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked)
     VALUES ($1, $2, 1, '{}'::jsonb, 'BASE', $3::jsonb, true) RETURNING id`,
    [orgId, studyId, JSON.stringify(PARTIAL_SNAPSHOT)]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

/** Étude + version verrouillée (pour TEST 4) */
export async function createLockedStudy(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-LOCK-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked, locked_at)
     VALUES ($1, $2, 1, '{}'::jsonb, 'BASE', '{}'::jsonb, true, NOW()) RETURNING id`,
    [orgId, studyId]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

export function mockReq(studyId, versionId, orgId, body = {}) {
  return {
    params: { studyId, versionId },
    body,
    user: orgId ? { organizationId: orgId, userId: null, id: null } : null,
  };
}

export function mockRes() {
  const captured = { statusCode: null, body: null, headers: {} };
  const res = {
    setHeader(name, value) {
      captured.headers[name] = value;
      return res;
    },
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(data) {
      captured.body = data;
      if (captured.statusCode == null) captured.statusCode = 200;
      return res;
    },
  };
  return { captured, res };
}

export function countPdfPages(buffer) {
  if (!Buffer.isBuffer(buffer)) return 0;
  const s = buffer.toString("binary");
  const matches = s.match(/\/Type\s*\/Page\s/g);
  return matches ? matches.length : 0;
}
