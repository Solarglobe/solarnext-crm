/**
 * D2 — Lecture DB uniquement : structure de data_json.scenarios_v2 et economic_snapshots.config_json.
 * Usage: cd backend && node scripts/diag-d2-read-db.js <versionId>
 *        versionId = study_versions.id (UUID). Si omis, prend la dernière version de la première org.
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";

async function main() {
  let versionId = process.argv[2];
  if (!versionId) {
    const r = await pool.query(
      `SELECT sv.id FROM study_versions sv
       JOIN studies s ON s.id = sv.study_id AND s.organization_id = sv.organization_id
       WHERE sv.organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
       ORDER BY sv.created_at DESC LIMIT 1`
    );
    if (r.rows.length === 0) {
      console.error("Aucune version trouvée. Usage: node diag-d2-read-db.js <versionId>");
      process.exit(1);
    }
    versionId = r.rows[0].id;
    console.log("versionId (dernière version):", versionId);
  }

  const versionRes = await pool.query(
    "SELECT id, study_id, version_number, data_json FROM study_versions WHERE id = $1",
    [versionId]
  );
  if (versionRes.rows.length === 0) {
    console.error("Version inconnue:", versionId);
    process.exit(1);
  }

  const row = versionRes.rows[0];
  const studyId = row.study_id;
  const dataJson = row.data_json || {};
  const scenariosV2 = dataJson.scenarios_v2;

  console.log("\n=== data_json.scenarios_v2 ===\n");
  console.log("type:", Array.isArray(scenariosV2) ? "Array" : typeof scenariosV2);
  if (Array.isArray(scenariosV2)) {
    console.log("longueur réelle:", scenariosV2.length);
    console.log("liste des IDs:", scenariosV2.map((s) => s?.id ?? "?").join(", "));
    console.log("\nstructure (JSON):");
    console.log(JSON.stringify(scenariosV2, null, 2));
  } else if (scenariosV2 && typeof scenariosV2 === "object" && !Array.isArray(scenariosV2)) {
    const keys = Object.keys(scenariosV2);
    console.log("clés (objet indexé):", keys.join(", "));
    console.log("\nstructure (JSON):");
    console.log(JSON.stringify(scenariosV2, null, 2));
  } else {
    console.log("valeur:", scenariosV2);
  }

  const snapRes = await pool.query(
    "SELECT id, study_version_id, config_json FROM economic_snapshots WHERE study_id = $1 AND is_active = true LIMIT 1",
    [studyId]
  );
  console.log("\n=== economic_snapshots (actif) ===\n");
  if (snapRes.rows.length === 0) {
    console.log("Aucun snapshot actif pour study_id =", studyId);
  } else {
    const cfg = snapRes.rows[0].config_json || {};
    console.log("présence battery:", cfg.battery != null || cfg.batterie != null);
    console.log("présence virtual_battery:", cfg.virtual_battery != null);
    console.log("battery.enabled / capacity:", cfg.battery?.enabled, cfg.battery?.capacity_kwh ?? cfg.batterie?.capacite_kwh);
    console.log("virtual_battery.enabled / annual:", cfg.virtual_battery?.enabled, cfg.virtual_battery?.annual_subscription_ttc ?? cfg.virtual_battery?.annual_cost);
    console.log("config_json keys:", Object.keys(cfg).join(", "));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
