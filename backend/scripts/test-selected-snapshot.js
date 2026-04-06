/**
 * Test temporaire — Vérification du snapshot selected_scenario_snapshot.
 * 1) Récupère une study_version (avec scenarios_v2 ou snapshot existant)
 * 2) Au besoin appelle buildSelectedScenarioSnapshot
 * 3) Valide les blocs, champs critiques, cashflows, incohérences
 * 4) Affiche SNAPSHOT_VALIDATION_REPORT
 *
 * Usage (depuis repo racine) :
 *   node backend/scripts/test-selected-snapshot.js
 * Optionnel (IDs en env) :
 *   STUDY_ID=... VERSION_ID=... ORG_ID=... node backend/scripts/test-selected-snapshot.js
 *
 * Prérequis : .env ou .env.dev avec DATABASE_URL, migrations à jour.
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
import { buildSelectedScenarioSnapshot } from "../services/selectedScenarioSnapshot.service.js";

const REQUIRED_BLOCKS = [
  "scenario_type",
  "created_at",
  "client",
  "site",
  "installation",
  "equipment",
  "shading",
  "energy",
  "finance",
  "production",
  "cashflows",
  "assumptions",
];

const CRITICAL_PATHS = [
  "client.nom",
  "client.prenom",
  "client.adresse",
  "client.cp",
  "client.ville",
  "site.lat",
  "site.lon",
  "site.orientation_deg",
  "site.tilt_deg",
  "site.puissance_compteur_kva",
  "site.type_reseau",
  "installation.panneaux_nombre",
  "installation.puissance_kwc",
  "installation.production_annuelle_kwh",
  "equipment.panneau.marque",
  "equipment.panneau.modele",
  "equipment.panneau.puissance_wc",
  "equipment.onduleur.marque",
  "equipment.onduleur.modele",
  "equipment.onduleur.quantite",
  "shading.total_loss_pct",
  "energy.production_kwh",
  "energy.consumption_kwh",
  "energy.import_kwh",
  "energy.billable_import_kwh",
  "finance.capex_ttc",
  "finance.economie_year_1",
  "finance.economie_total",
  "finance.roi_years",
  "finance.irr_pct",
  "finance.facture_restante",
  "finance.revenu_surplus",
  "production.annual_kwh",
  "production.monthly_kwh",
  "assumptions.model_version",
];

function getAt(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function validateSnapshot(snapshot) {
  const report = {
    structure: { ok: true, missing: [], extra: [] },
    critical: { missing: [], nullValues: [] },
    cashflows: { ok: true, missing: [], incomplete: [] },
    inconsistencies: [],
  };

  if (!snapshot || typeof snapshot !== "object") {
    report.structure.ok = false;
    report.structure.missing = REQUIRED_BLOCKS;
    return report;
  }

  for (const block of REQUIRED_BLOCKS) {
    if (!(block in snapshot)) report.structure.missing.push(block);
  }
  for (const key of Object.keys(snapshot)) {
    if (!REQUIRED_BLOCKS.includes(key)) report.structure.extra.push(key);
  }
  report.structure.ok = report.structure.missing.length === 0;

  for (const path of CRITICAL_PATHS) {
    const val = getAt(snapshot, path);
    if (val === undefined) report.critical.missing.push(path);
    else if (val === null) report.critical.nullValues.push(path);
  }

  const cashflows = snapshot.cashflows;
  if (!Array.isArray(cashflows)) {
    report.cashflows.ok = false;
    report.cashflows.missing.push("cashflows (not array)");
  } else {
    cashflows.forEach((f, i) => {
      if (f == null || typeof f !== "object") {
        report.cashflows.incomplete.push({ index: i, reason: "not object" });
        report.cashflows.ok = false;
      } else {
        if (f.year == null) {
          report.cashflows.incomplete.push({ index: i, reason: "year missing" });
          report.cashflows.ok = false;
        }
        if (f.cumul == null) {
          report.cashflows.incomplete.push({ index: i, reason: "cumul missing" });
          report.cashflows.ok = false;
        }
      }
    });
  }

  if (snapshot.scenario_type === "BATTERY_VIRTUAL") {
    const billable = snapshot.energy?.billable_import_kwh;
    if (billable === undefined) report.inconsistencies.push("BATTERY_VIRTUAL: energy.billable_import_kwh absent");
    else if (billable === null) report.inconsistencies.push("BATTERY_VIRTUAL: energy.billable_import_kwh est null (attendu pour import facturé)");
  }

  const instProd = snapshot.installation?.production_annuelle_kwh;
  const prodAnnual = snapshot.production?.annual_kwh;
  if (
    instProd != null &&
    prodAnnual != null &&
    typeof instProd === "number" &&
    typeof prodAnnual === "number" &&
    Math.abs(instProd - prodAnnual) > 100
  ) {
    report.inconsistencies.push(
      `Production incohérente: installation.production_annuelle_kwh=${instProd} vs production.annual_kwh=${prodAnnual}`
    );
  }

  return report;
}

function printReport(snapshot, report, source) {
  console.log("\n========== SNAPSHOT_VALIDATION_REPORT ==========\n");
  console.log("Source:", source);
  console.log("scenario_type:", snapshot?.scenario_type ?? "—");
  console.log("created_at:", snapshot?.created_at ?? "—\n");

  console.log("1) STRUCTURE");
  if (report.structure.ok) {
    console.log("   OK — Tous les blocs présents.");
  } else {
    console.log("   KO — Blocs manquants:", report.structure.missing.join(", "));
    if (report.structure.extra.length) console.log("   Blocs non attendus:", report.structure.extra.join(", "));
  }

  console.log("\n2) CHAMPS CRITIQUES");
  if (report.critical.missing.length === 0 && report.critical.nullValues.length === 0) {
    console.log("   OK — Tous les chemins présents et non null.");
  } else {
    if (report.critical.missing.length) console.log("   Manquants:", report.critical.missing.join(", "));
    if (report.critical.nullValues.length) console.log("   Valeurs null:", report.critical.nullValues.join(", "));
  }

  console.log("\n3) CASHFLOWS");
  if (report.cashflows.ok) {
    console.log("   OK — Tableau présent, éléments avec year/gain/cumul.");
    if (snapshot?.cashflows?.length != null) console.log("   Nombre d'entrées:", snapshot.cashflows.length);
  } else {
    console.log("   KO —", report.cashflows.missing.join("; "));
    if (report.cashflows.incomplete.length) console.log("   Entrées incomplètes:", report.cashflows.incomplete.length);
  }

  console.log("\n4) INCOHÉRENCES");
  if (report.inconsistencies.length === 0) {
    console.log("   Aucune détectée.");
  } else {
    report.inconsistencies.forEach((s) => console.log("   -", s));
  }

  console.log("\n=================================================\n");
}

async function main() {
  const studyId = process.env.STUDY_ID;
  const versionId = process.env.VERSION_ID;
  const orgId = process.env.ORG_ID;

  let snapshot = null;
  let source = "";

  if (studyId && versionId && orgId) {
    const versionRes = await pool.query(
      `SELECT id, study_id, data_json FROM study_versions
       WHERE id = $1 AND study_id = $2 AND organization_id = $3`,
      [versionId, studyId, orgId]
    );
    if (versionRes.rows.length === 0) {
      console.error("Version non trouvée pour studyId=%s versionId=%s orgId=%s", studyId, versionId, orgId);
      process.exit(1);
    }
    const row = versionRes.rows[0];
    const dataJson = row.data_json && typeof row.data_json === "object" ? row.data_json : {};
    const scenariosV2 = dataJson.scenarios_v2;
    if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) {
      console.error("Aucun scenarios_v2 pour cette version. Lancer le calcul (run-study) d'abord.");
      process.exit(1);
    }
    const scenarioId = scenariosV2[0]?.id ?? scenariosV2[0]?.name ?? "BASE";
    snapshot = await buildSelectedScenarioSnapshot({
      studyId,
      versionId,
      scenarioId,
      organizationId: orgId,
      dataJson,
    });
    source = `buildSelectedScenarioSnapshot(${studyId}, ${versionId}, ${scenarioId})`;
  } else {
    const res = await pool.query(
      `SELECT sv.id, sv.study_id, sv.organization_id, sv.data_json, sv.selected_scenario_snapshot
       FROM study_versions sv
       WHERE (sv.selected_scenario_snapshot IS NOT NULL AND jsonb_typeof(sv.selected_scenario_snapshot) = 'object')
          OR ((sv.data_json->'scenarios_v2') IS NOT NULL AND jsonb_array_length(sv.data_json->'scenarios_v2') > 0)
       ORDER BY (sv.selected_scenario_snapshot IS NOT NULL) DESC
       LIMIT 1`
    );
    if (res.rows.length === 0) {
      console.error("Aucune study_version avec scenarios_v2 ou selected_scenario_snapshot. Utilisez STUDY_ID, VERSION_ID, ORG_ID pour tester une version précise après calcul.");
      process.exit(1);
    }
    const row = res.rows[0];
    if (row.selected_scenario_snapshot && typeof row.selected_scenario_snapshot === "object") {
      snapshot = row.selected_scenario_snapshot;
      source = `DB selected_scenario_snapshot (version ${row.id})`;
    } else {
      const dataJson = row.data_json && typeof row.data_json === "object" ? row.data_json : {};
      const scenariosV2 = dataJson.scenarios_v2 || [];
      const scenarioId = scenariosV2[0]?.id ?? scenariosV2[0]?.name ?? "BASE";
      snapshot = await buildSelectedScenarioSnapshot({
        studyId: row.study_id,
        versionId: row.id,
        scenarioId,
        organizationId: row.organization_id,
        dataJson,
      });
      source = `buildSelectedScenarioSnapshot(${row.study_id}, ${row.id}, ${scenarioId})`;
    }
  }

  const report = validateSnapshot(snapshot);
  printReport(snapshot, report, source);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
