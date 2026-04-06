/**
 * Vérifications post-audit 3 bugs :
 * 1) Route quote-builder : path attendu /studies/:studyId/versions/:versionId/quote-builder (versionId requis).
 * 2) orderedScenarios : data_json.scenarios_v2 doit pouvoir contenir 3 ids (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL).
 * 3) Résumé technique : technical_snapshot_summary doit exposer panel/inverter quand le payload calpinage les contient.
 *
 * Usage: cd backend && node scripts/verify-quote-scenarios-audit.js [versionId]
 * versionId = study_versions.id (UUID). Si omis, prend la dernière version de la première org.
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
import { getQuotePrep } from "../services/quotePrep/quotePrep.service.js";

async function main() {
  let versionId = process.argv[2];
  if (!versionId) {
    const r = await pool.query(
      `SELECT sv.id, sv.organization_id FROM study_versions sv
       WHERE sv.organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
       ORDER BY sv.created_at DESC LIMIT 1`
    );
    if (r.rows.length === 0) {
      console.error("Aucune version trouvée. Usage: node verify-quote-scenarios-audit.js <versionId>");
      process.exit(1);
    }
    versionId = r.rows[0].id;
    console.log("versionId (dernière version):", versionId);
  }

  const versionRes = await pool.query(
    "SELECT id, study_id, organization_id, version_number, data_json FROM study_versions WHERE id = $1",
    [versionId]
  );
  if (versionRes.rows.length === 0) {
    console.error("Version inconnue:", versionId);
    process.exit(1);
  }

  const row = versionRes.rows[0];
  const studyId = row.study_id;
  const orgId = row.organization_id;
  const dataJson = row.data_json || {};
  const scenariosV2 = dataJson.scenarios_v2;

  console.log("\n--- 1) Route quote-builder ---");
  console.log("Attendu: /studies/:studyId/versions/:versionId/quote-builder (versionId = UUID)");
  console.log("Le lien 'Configurer dans le devis' doit utiliser versionId:", row.id);

  console.log("\n--- 2) data_json.scenarios_v2 (orderedScenarios) ---");
  if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) {
    console.log("  Aucun scénario (scenarios_v2 vide ou absent). Valider le devis technique pour générer.");
  } else {
    const ids = scenariosV2.map((s) => s?.id ?? s?.name ?? "?").filter(Boolean);
    console.log("  Nombre:", scenariosV2.length, "| ids:", ids.join(", "));
    const hasPhysical = ids.includes("BATTERY_PHYSICAL");
    const hasVirtual = ids.includes("BATTERY_VIRTUAL");
    if (scenariosV2.length === 3 && hasPhysical && hasVirtual) {
      console.log("  OK: 3 slots avec BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL possibles.");
    } else {
      console.log("  Info: BATTERY_PHYSICAL présent =", hasPhysical, "| BATTERY_VIRTUAL présent =", hasVirtual);
    }
  }

  console.log("\n--- 3) Résumé technique (GET quote-prep) panel/inverter ---");
  try {
    const prep = await getQuotePrep({ studyId, versionId, organizationId: orgId });
    const ts = prep.technical_snapshot_summary || {};
    const hasPanel = ts.panel && (ts.panel.brand || ts.panel.model);
    const hasInverter = ts.inverter && (ts.inverter.brand || ts.inverter.name);
    console.log("  technical_snapshot_summary.panel (brand/model):", hasPanel ? "OUI" : "non", ts.panel ?? "—");
    console.log("  technical_snapshot_summary.inverter (brand/name):", hasInverter ? "OUI" : "non", ts.inverter ?? "—");
  } catch (e) {
    if (e.code === "NO_CALPINAGE" || e.message?.includes("calpinage")) {
      console.log("  Aucun calpinage pour cette version:", e.message);
    } else {
      throw e;
    }
  }

  console.log("\n--- Fin vérifications ---");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
