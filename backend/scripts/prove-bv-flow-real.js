/**
 * Preuve E2E : validateDevisTechnique (même chaîne que le CRM) → DB → lecture type GET scénarios.
 * Usage: cd backend && node scripts/prove-bv-flow-real.js
 */

import "../config/register-local-env.js";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.env.DEBUG_BV_CALC = "1";
process.env.LOG_STUDY_CALC_PERSIST = "1";

const { pool } = await import("../config/db.js");
const { validateDevisTechnique } = await import("../controllers/validateDevisTechnique.controller.js");
const { getStudyScenarios } = await import("../controllers/studyScenarios.controller.js");

function mockRes() {
  const out = { statusCode: 200, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    get captured() {
      return out;
    },
  };
}

function extractBv(scenariosV2) {
  if (!Array.isArray(scenariosV2)) return null;
  return scenariosV2.find((s) => (s?.id ?? s?.name) === "BATTERY_VIRTUAL") ?? null;
}

function compactBvProof(label, bv) {
  if (!bv) return { label, bv: null };
  const e = bv.energy || {};
  const f = bv.finance || {};
  const bvm = bv.battery_virtual || null;
  const vb8760 = bv.virtual_battery_8760 || null;
  return {
    label,
    id: bv.id,
    _skipped: bv._skipped ?? undefined,
    finance: {
      economie_year_1: f.economie_year_1 ?? null,
      capex_ttc: f.capex_ttc ?? null,
      roi_years: f.roi_years ?? null,
    },
    energy: {
      credited_kwh: e.credited_kwh ?? null,
      restored_kwh: e.restored_kwh ?? null,
      billable_import_kwh: e.billable_import_kwh ?? null,
      overflow_export_kwh: e.overflow_export_kwh ?? null,
      import_kwh: e.import_kwh ?? null,
    },
    battery_virtual: bvm
      ? {
          enabled: bvm.enabled,
          capacity_simulated_kwh: bvm.capacity_simulated_kwh ?? null,
          annual_throughput_kwh: bvm.annual_throughput_kwh ?? null,
        }
      : null,
    virtual_battery_8760: vb8760
      ? {
          hourly_charge_len: vb8760.hourly_charge?.length ?? vb8760.virtual_battery_hourly_charge_kwh?.length ?? 0,
          hourly_discharge_len: vb8760.hourly_discharge?.length ?? vb8760.virtual_battery_hourly_discharge_kwh?.length ?? 0,
        }
      : null,
  };
}

const pick = await pool.query(
  `SELECT sv.id, sv.study_id, sv.organization_id, sv.version_number
   FROM study_versions sv
   INNER JOIN calpinage_data cd
     ON cd.study_version_id = sv.id AND cd.organization_id = sv.organization_id
   WHERE sv.is_locked = false
   ORDER BY sv.created_at DESC
   LIMIT 1`
);

if (pick.rows.length === 0) {
  console.error("Aucune study_version déverrouillée avec calpinage — impossible de rejouer validate-devis.");
  process.exit(1);
}

const { id: versionId, study_id: studyId, organization_id: orgId, version_number: versionNumber } =
  pick.rows[0];

console.log("\n========== A. VERSION TESTÉE (preuve URL CRM) ==========");
console.log("Route React (main.tsx) : studies/:studyId/versions/:versionId/scenarios");
console.log("ScenariosPage lit versionId depuis useParams → même UUID que study_versions.id.");
console.log("studyId     :", studyId);
console.log("versionId   :", versionId, "(UUID study_versions.id)");
console.log("version n°  :", versionNumber);
console.log("URL attendue:", `/studies/${studyId}/versions/${versionId}/scenarios`);

const req = {
  params: { studyId, versionId },
  user: { organizationId: orgId },
};
const res = mockRes();

await validateDevisTechnique(req, res);
const cap = res.captured;
console.log("\n========== validate-devis-technique (réponse HTTP simulée) ==========");
console.log("statusCode:", cap.statusCode);
console.log("body:", JSON.stringify(cap.body ?? {}, null, 2));

const dbRow = await pool.query(
  `SELECT id, data_json->'scenarios_v2' AS scenarios_v2 FROM study_versions WHERE id = $1`,
  [versionId]
);
const scenariosFromDb = dbRow.rows[0]?.scenarios_v2;
const bvDb = extractBv(scenariosFromDb);
console.log("\n========== E. DB après persistance (même UUID) ==========");
console.log(JSON.stringify(compactBvProof("db", bvDb), null, 2));

const getRes = mockRes();
const getReq = { params: { studyId, versionId }, user: { organizationId: orgId } };
await getStudyScenarios(getReq, getRes);
const getCap = getRes.captured;
console.log("\n========== F. GET /scenarios (contrôleur réel, même UUID) ==========");
console.log("getStudyScenarios statusCode:", getCap.statusCode);
const getBody = getCap.body ?? {};
const scenariosFromGet = getBody.scenarios;
const bvGet = extractBv(scenariosFromGet);
console.log("ok:", getBody.ok);
console.log("BV extrait GET:", JSON.stringify(compactBvProof("get", bvGet), null, 2));

if (getCap.statusCode === 404) {
  console.log("GET body complet:", JSON.stringify(getBody, null, 2));
}

await pool.end();
