/**
 * Après un calcul étude (validate-devis / runStudyCalc), vérifie study_versions.data_json.scenarios_v2.BATTERY_VIRTUAL.
 *
 * Usage: cd backend && node scripts/validate-battery-virtual-persistence.js <study_versions.id UUID>
 *
 * Exemple: node scripts/validate-battery-virtual-persistence.js 4e17c052-6bb8-48e2-bb75-3d2d3bc85620
 */

import "../config/register-local-env.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const versionId = process.argv[2];
if (!versionId) {
  console.error("Usage: node scripts/validate-battery-virtual-persistence.js <study_versions UUID>");
  process.exit(1);
}

function ok(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    return false;
  }
  console.log("OK:", msg);
  return true;
}

const r = await pool.query(
  `SELECT id, study_id, version_number, data_json->'scenarios_v2' AS scenarios_v2
   FROM study_versions WHERE id = $1`,
  [versionId]
);
const row = r.rows[0];
if (!row) {
  console.error("Version introuvable:", versionId);
  process.exit(1);
}

console.log("Version:", row.id, "study:", row.study_id, "n°", row.version_number);
const arr = row.scenarios_v2;
if (!Array.isArray(arr)) {
  console.error("scenarios_v2 absent ou non-tableau");
  process.exit(1);
}
const bv = arr.find((s) => (s?.id ?? s?.name) === "BATTERY_VIRTUAL");
if (!bv) {
  console.error("BATTERY_VIRTUAL absent du tableau");
  process.exit(1);
}

let all = true;
const bvDisabled =
  bv.battery_virtual?.enabled === false ||
  bv.assumptions?.virtual_enabled === false;
if (bvDisabled) {
  console.log("Info: batterie virtuelle désactivée (simulation non contractuelle / skip) — attentes allégées.");
  all = ok(bv.finance != null, "finance objet présent") && all;
  all = ok(bv.battery_virtual != null, "battery_virtual présent") && all;
} else {
  all = ok(bv.finance?.economie_year_1 != null, "finance.economie_year_1 renseigné") && all;
  all = ok(bv.finance?.capex_ttc != null, "finance.capex_ttc renseigné") && all;
  all = ok(bv.battery_virtual != null && bv.battery_virtual.enabled === true, "battery_virtual.enabled true") && all;
  all = ok(Array.isArray(bv.virtual_battery_8760?.hourly_charge), "virtual_battery_8760.hourly_charge tableau") && all;
  all = ok(bv.energy?.credited_kwh != null, "energy.credited_kwh renseigné") && all;
  all = ok(bv.energy?.restored_kwh != null, "energy.restored_kwh renseigné") && all;
  all = ok(bv.energy?.billable_import_kwh != null, "energy.billable_import_kwh renseigné") && all;
  all = ok(bv.energy?.overflow_export_kwh != null, "energy.overflow_export_kwh renseigné") && all;
}

console.log("\n--- Extrait BATTERY_VIRTUAL (échantillon) ---");
console.log(
  JSON.stringify(
    {
      id: bv.id,
      _skipped: bv._skipped ?? null,
      finance: {
        economie_year_1: bv.finance?.economie_year_1 ?? null,
        capex_ttc: bv.finance?.capex_ttc ?? null,
        roi_years: bv.finance?.roi_years ?? null,
      },
      energy: {
        credited_kwh: bv.energy?.credited_kwh ?? null,
        restored_kwh: bv.energy?.restored_kwh ?? null,
        billable_import_kwh: bv.energy?.billable_import_kwh ?? null,
        overflow_export_kwh: bv.energy?.overflow_export_kwh ?? null,
      },
      battery_virtual: bv.battery_virtual
        ? {
            enabled: bv.battery_virtual.enabled,
            capacity_simulated_kwh: bv.battery_virtual.capacity_simulated_kwh ?? null,
            annual_throughput_kwh: bv.battery_virtual.annual_throughput_kwh ?? null,
          }
        : null,
      virtual_battery_8760_len: bv.virtual_battery_8760?.hourly_charge?.length ?? null,
    },
    null,
    2
  )
);

await pool.end();
process.exit(all ? 0 : 1);
