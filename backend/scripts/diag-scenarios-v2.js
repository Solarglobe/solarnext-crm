/**
 * D1 — Diagnostic scenarios_v2 : pourquoi colonnes Batterie physique / virtuelle vides ?
 * 1) Charge .env, prend studyId + versionId en args (ou dernière study_version de l'org).
 * 2) Appelle validate-devis-technique (controller direct, pas HTTP).
 * 3) Interroge DB : economic_snapshots actif, study_versions.data_json.
 * 4) Rapport : config_json keys, batteries, scenarios_v2 length/ids, finance/energy par scénario.
 * 5) PASS si scenarios_v2.length === 3, sinon FAIL.
 *
 * Usage: cd backend && node scripts/diag-scenarios-v2.js [studyId] [versionId]
 *        (studyId et versionId = UUIDs; si omis, utilise dernière study_version de la première org)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { validateDevisTechnique } from "../controllers/validateDevisTechnique.controller.js";

function mockRes() {
  const out = { statusCode: null, body: null };
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

async function getDefaultStudyAndVersion() {
  const orgRes = await pool.query(
    `SELECT id FROM organizations ORDER BY name ASC, created_at ASC LIMIT 1`
  );
  if (orgRes.rows.length === 0) {
    throw new Error("Aucune organisation trouvée");
  }
  const orgId = orgRes.rows[0].id;

  const versionRes = await pool.query(
    `SELECT sv.id AS version_id, sv.study_id, sv.version_number, sv.data_json
     FROM study_versions sv
     JOIN studies s ON s.id = sv.study_id AND s.organization_id = $1
     WHERE sv.organization_id = $1
     ORDER BY sv.created_at DESC
     LIMIT 1`,
    [orgId]
  );
  if (versionRes.rows.length === 0) {
    throw new Error("Aucune study_version trouvée pour l'organisation");
  }
  const row = versionRes.rows[0];
  return { studyId: row.study_id, versionId: row.version_id, orgId };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env ou .env.dev)");
    process.exit(1);
  }

  let studyId = process.argv[2];
  let versionId = process.argv[3];
  let orgId;

  if (!studyId || !versionId) {
    console.log("studyId ou versionId absent → recherche dernière study_version de l'org…");
    try {
      const def = await getDefaultStudyAndVersion();
      studyId = studyId || def.studyId;
      versionId = versionId || def.versionId;
      orgId = def.orgId;
    } catch (e) {
      console.error("❌", e.message);
      process.exit(1);
    }
  }

  if (!orgId || !studyId) {
    const vRes = await pool.query(
      "SELECT study_id, organization_id FROM study_versions WHERE id = $1",
      [versionId]
    );
    if (vRes.rows.length === 0) {
      console.error("❌ versionId inconnu:", versionId);
      process.exit(1);
    }
    if (!studyId) studyId = vRes.rows[0].study_id;
    if (!orgId) orgId = vRes.rows[0].organization_id;
  }

  console.log("\n=== D1 DIAGNOSTIC SCENARIOS V2 ===\n");
  console.log("studyId:", studyId);
  console.log("versionId:", versionId);
  console.log("orgId:", orgId);

  const res = mockRes();
  try {
    await validateDevisTechnique(
      {
        params: { studyId, versionId },
        user: { organizationId: orgId },
      },
      res
    );
  } catch (e) {
    console.error("❌ validate-devis-technique a levé:", e.message);
    process.exit(1);
  }

  const statusCode = res.captured.statusCode;
  const body = res.captured.body;
  console.log("\n--- Réponse validate-devis-technique ---");
  console.log("statusCode:", statusCode);
  console.log("body:", JSON.stringify(body, null, 2));

  if (statusCode >= 400) {
    console.log("\n⚠ Endpoint en erreur, on continue le diagnostic DB quand même.");
  }

  const studyIdForSnapshot = studyId;

  const snapshotRes = await pool.query(
    `SELECT id, study_id, study_version_id, is_active, config_json
     FROM economic_snapshots
     WHERE study_id = $1 AND is_active = true
     LIMIT 1`,
    [studyIdForSnapshot]
  );

  const versionRes = await pool.query(
    `SELECT id, version_number, is_locked, data_json
     FROM study_versions
     WHERE id = $1`,
    [versionId]
  );

  console.log("\n========== RAPPORT DIAGNOSTIC ==========\n");

  if (snapshotRes.rows.length === 0) {
    console.log("A) economic_snapshots actif: AUCUN pour study_id =", studyIdForSnapshot);
  } else {
    const snap = snapshotRes.rows[0];
    console.log("A) economic_snapshots actif:");
    console.log("   id:", snap.id);
    console.log("   study_id:", snap.study_id);
    console.log("   study_version_id:", snap.study_version_id);
    console.log("   is_active:", snap.is_active);
    const configJson = snap.config_json || {};
    const configKeys = Object.keys(configJson);
    console.log("   config_json keys:", configKeys.length ? configKeys.join(", ") : "(vide)");

    const bat = configJson.battery ?? configJson.batterie ?? null;
    const vb = configJson.virtual_battery ?? null;
    console.log("\n   Présence batteries dans config_json:");
    console.log("   - battery/batterie:", bat != null ? "présent" : "absent");
    if (bat) {
      console.log("     - enabled:", bat.enabled);
      console.log("     - capacity_kwh / capacite_kwh:", bat.capacity_kwh ?? bat.capacite_kwh);
      console.log("     - (prix/item selon schéma):", bat.price ?? bat.prix ?? "—");
    }
    console.log("   - virtual_battery:", vb != null ? "présent" : "absent");
    if (vb) {
      console.log("     - enabled:", vb.enabled);
      console.log("     - provider / annual_cost / annual_subscription_ttc:", vb.provider ?? vb.annual_subscription_ttc ?? vb.annual_cost ?? "—");
    }
  }

  if (versionRes.rows.length === 0) {
    console.log("\nB) study_versions: version id inconnu");
  } else {
    const ver = versionRes.rows[0];
    console.log("\nB) study_versions:");
    console.log("   id:", ver.id);
    console.log("   version_number:", ver.version_number);
    console.log("   is_locked:", ver.is_locked);
    const dataJson = ver.data_json || {};
    const scenariosV2 = dataJson.scenarios_v2;
    const len = Array.isArray(scenariosV2) ? scenariosV2.length : 0;
    console.log("\n   Scenarios persistés (data_json.scenarios_v2):");
    console.log("   - length:", len);
    if (Array.isArray(scenariosV2)) {
      console.log("   - ids:", scenariosV2.map((s) => s?.id ?? "?").join(", "));
      scenariosV2.forEach((s, i) => {
        const fin = s?.finance ?? {};
        const en = s?.energy ?? {};
        console.log(`   - [${i}] id=${s?.id} finance.capex_ttc=${fin.capex_ttc != null ? "oui" : "non"} annual_cashflows.length=${Array.isArray(fin.annual_cashflows) ? fin.annual_cashflows.length : 0} energy.self_consumption_pct=${en.self_consumption_pct != null ? "oui" : "non"} self_production_pct=${en.self_production_pct != null ? "oui" : "non"}`);
      });
    }
  }

  const scenariosV2 = (versionRes.rows[0]?.data_json || {}).scenarios_v2;
  const length = Array.isArray(scenariosV2) ? scenariosV2.length : 0;

  console.log("\n========== RÉSULTAT ==========");
  if (length !== 3) {
    console.log("FAIL: expected 3 scenarios, got", length);
    process.exit(1);
  }
  console.log("PASS: 3 scenarios present");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
