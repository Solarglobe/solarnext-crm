/**
 * E2E API test harness — 3 scénarios V2 (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL).
 * Prouve par JSON réel que PHYSICAL modifie l’énergie et VIRTUAL la finance.
 *
 * Usage:
 *   node scripts/run-real-scenarios-e2e.js --studyId <uuid> --versionId <uuid> [--dump]
 *   node scripts/run-real-scenarios-e2e.js [--fixture-calpinage] [--cleanup]
 *   Sans args : prend la dernière version de la première org.
 *   --fixture-calpinage : si calpinage_data manquant, injecte un calpinage minimal (dev only, refusé si NODE_ENV=production).
 *   --cleanup : après run, supprime le calpinage fixture injecté (si utilisé).
 *
 * Étapes:
 * 1) Charge study/version + economic_snapshot + vérifie calpinage_data.
 * 2) Construit 3 variantes de config (BASE, PHYSICAL, VIRTUAL) et pour chacune :
 *    - Upsert economic_snapshots.config_json
 *    - Lance le calcul (runStudyCalc in-process)
 *    - Lit scenarios_v2 depuis study_versions.data_json
 *    - Sauve backend/tmp/scenarios_<variant>.json
 * 3) Diff + assertions : PHYSICAL.energy ≠ BASE.energy ; VIRTUAL.finance ≠ BASE.finance.
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { getVersionById } from "../routes/studies/service.js";
import {
  getEconomicSnapshotForVersion,
  createOrUpdateEconomicSnapshot,
  createEconomicSnapshotForVersion,
} from "../services/economic/economicSnapshot.service.js";
import { runStudyCalc } from "../controllers/studyCalc.controller.js";

const TMP_DIR = resolve(__dirname, "../tmp");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { studyId: null, versionId: null, dump: false, fixtureCalpinage: false, cleanup: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--studyId" && args[i + 1]) out.studyId = args[++i];
    else if (args[i] === "--versionId" && args[i + 1]) out.versionId = args[++i];
    else if (args[i] === "--dump") out.dump = true;
    else if (args[i] === "--fixture-calpinage") out.fixtureCalpinage = true;
    else if (args[i] === "--cleanup") out.cleanup = true;
  }
  return out;
}

async function resolveStudyAndVersion(studyId, versionId) {
  if (versionId) {
    const orgRows = await pool.query(
      "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"
    );
    if (orgRows.rows.length === 0) throw new Error("Aucune organisation trouvée");
    const orgId = orgRows.rows[0].id;
    const version = await getVersionById(versionId, orgId);
    if (!version) throw new Error("Version non trouvée: " + versionId);
    if (studyId && version.study_id !== studyId) throw new Error("studyId ne correspond pas à la version");
    return { studyId: version.study_id, versionId: version.id, versionNumber: version.version_number, orgId };
  }
  const r = await pool.query(
    `SELECT sv.id, sv.study_id, sv.version_number, sv.organization_id
     FROM study_versions sv
     WHERE sv.organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
     ORDER BY sv.created_at DESC LIMIT 1`
  );
  if (r.rows.length === 0) throw new Error("Aucune version trouvée. Utilisez --studyId et --versionId.");
  const row = r.rows[0];
  return {
    studyId: row.study_id,
    versionId: row.id,
    versionNumber: row.version_number,
    orgId: row.organization_id,
  };
}

function ensureTmpDir() {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}

/**
 * Construit la config economic_snapshot pour une variante.
 * baseConfig = config_json existant (ou {}).
 */
function buildVariantConfig(baseConfig, variant) {
  const base = baseConfig && typeof baseConfig === "object" ? { ...baseConfig } : {};
  if (!base.batteries) base.batteries = { physical: {}, virtual: {} };

  if (variant === "BASE") {
    base.batteries = {
      physical: { enabled: false, capacity_kwh: 0 },
      virtual: { enabled: false },
    };
    return base;
  }

  if (variant === "PHYSICAL") {
    base.batteries = {
      physical: {
        enabled: true,
        capacity_kwh: 10,
        product_snapshot: {
          usable_kwh: 10,
          max_charge_kw: 5,
          max_discharge_kw: 5,
          roundtrip_efficiency_pct: 90,
        },
      },
      virtual: { enabled: false },
    };
    return base;
  }

  if (variant === "VIRTUAL") {
    base.batteries = {
      physical: { enabled: false, capacity_kwh: 0 },
      virtual: {
        enabled: true,
        annual_subscription_ttc: 480,
        price: 480,
        qty: 1,
        cost_per_kwh_storage: 0,
        fee_fixed: 0,
      },
    };
    return base;
  }

  throw new Error("Variant inconnu: " + variant);
}

function mockReqRes(studyId, versionNumber, orgId) {
  const captured = { statusCode: 200, data: null };
  const req = {
    params: { studyId, versionId: String(versionNumber) },
    user: { organizationId: orgId },
  };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(data) {
      captured.data = data;
      return res;
    },
  };
  return { req, res, captured };
}

async function runCalcForVariant(studyId, versionNumber, orgId) {
  const { req, res, captured } = mockReqRes(studyId, versionNumber, orgId);
  await runStudyCalc(req, res);
  if (captured.statusCode !== 200) {
    throw new Error(
      "Calc échoué: " + captured.statusCode + " " + JSON.stringify(captured.data)
    );
  }
  return captured.data;
}

function getScenariosV2FromDb(versionId) {
  return pool
    .query("SELECT data_json FROM study_versions WHERE id = $1", [versionId])
    .then((r) => {
      const row = r.rows[0];
      if (!row) return null;
      const data = row.data_json;
      return data && typeof data === "object" ? data.scenarios_v2 : null;
    });
}

function extractEnergy(scenario) {
  if (!scenario) return null;
  const e = scenario.energy || {};
  return {
    production_kwh: e.production_kwh ?? scenario.prod_kwh ?? null,
    autoconsumption_kwh: e.autoconsumption_kwh ?? scenario.auto_kwh ?? e.auto ?? null,
    surplus_kwh: e.surplus_kwh ?? scenario.surplus_kwh ?? e.surplus ?? null,
    import_kwh: e.import_kwh ?? e.import ?? null,
    billable_import_kwh: e.billable_import_kwh ?? scenario.billable_import_kwh ?? null,
    credited_kwh: e.credited_kwh ?? scenario.credited_kwh ?? null,
    used_credit_kwh: e.used_credit_kwh ?? scenario.used_credit_kwh ?? null,
  };
}

function extractFinance(scenario) {
  if (!scenario) return null;
  const f = scenario.finance || {};
  return {
    capex_ttc: f.capex_ttc ?? scenario.capex_ttc ?? null,
    roi_years: f.roi_years ?? scenario.roi_years ?? null,
    irr_pct: f.irr_pct ?? scenario.irr_pct ?? null,
    annual_cashflows: f.annual_cashflows ?? scenario.flows ?? null,
    virtual_battery_cost_annual: f.virtual_battery_cost_annual ?? scenario._virtualBatteryQuote?.annual_cost_ttc ?? null,
  };
}

function findScenarioById(scenarios, id) {
  if (!Array.isArray(scenarios)) return null;
  return scenarios.find((s) => (s.id || s.name) === id) || null;
}

function energyDiffers(a, b) {
  if (!a || !b) return false;
  const keys = ["autoconsumption_kwh", "surplus_kwh", "import_kwh", "production_kwh"];
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (va != null && vb != null && Number(va) !== Number(vb)) return true;
  }
  return false;
}

function financeDiffers(a, b) {
  if (!a || !b) return false;
  if (a.virtual_battery_cost_annual !== b.virtual_battery_cost_annual)
    return true;
  if (a.roi_years != null && b.roi_years != null && Number(a.roi_years) !== Number(b.roi_years))
    return true;
  const aFlows = a.annual_cashflows;
  const bFlows = b.annual_cashflows;
  if (Array.isArray(aFlows) && Array.isArray(bFlows) && aFlows.length !== bFlows.length)
    return true;
  return false;
}

/**
 * Géométrie calpinage minimale valide pour le payload builder / calc.
 * Champs réellement lus dans solarnextPayloadBuilder.service.js :
 * roofState.gps, roof.gps → lat/lon ; validatedRoofData.pans / roof.pans → orientation_deg, tilt_deg ;
 * frozenBlocks ou validatedRoofData.pans → hasPanelsInGeometry ; shading.totalLossPct ; total_panels (colonne).
 */
function buildMinimalCalpinageGeometry(lat = 48.8566, lon = 2.3522) {
  return {
    roofState: { gps: { lat, lon } },
    roof: { gps: { lat, lon } },
    validatedRoofData: {
      pans: [{ id: "PAN_1", orientationDeg: 180, tiltDeg: 30, panelCount: 6 }],
    },
    frozenBlocks: [
      { id: "b1", panels: [{ id: "p0", center: { x: 100, y: 100 }, state: "placed" }] },
    ],
    shading: { normalized: { totalLossPct: 0 }, totalLossPct: 0 },
  };
}

async function injectFixtureCalpinage(studyId, versionId, orgId) {
  let lat = 48.8566;
  let lon = 2.3522;
  const studyRow = await pool.query(
    "SELECT lead_id FROM studies WHERE id = $1 AND organization_id = $2",
    [studyId, orgId]
  );
  if (studyRow.rows.length > 0 && studyRow.rows[0].lead_id) {
    const addr = await pool.query(
      `SELECT a.lat, a.lon FROM leads l
       JOIN addresses a ON a.id = l.site_address_id AND a.organization_id = l.organization_id
       WHERE l.id = $1 AND l.organization_id = $2`,
      [studyRow.rows[0].lead_id, orgId]
    );
    if (addr.rows.length > 0 && addr.rows[0].lat != null && addr.rows[0].lon != null) {
      lat = Number(addr.rows[0].lat);
      lon = Number(addr.rows[0].lon);
    }
  }
  const geometry = buildMinimalCalpinageGeometry(lat, lon);
  const totalPanels = 6;
  const totalPowerKwc = 3;
  const annualProductionKwh = 3500;
  const totalLossPct = 0;
  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     ON CONFLICT (study_version_id)
     DO UPDATE SET
       geometry_json = EXCLUDED.geometry_json,
       total_panels = EXCLUDED.total_panels,
       total_power_kwc = EXCLUDED.total_power_kwc,
       annual_production_kwh = EXCLUDED.annual_production_kwh,
       total_loss_pct = EXCLUDED.total_loss_pct`,
    [orgId, versionId, JSON.stringify(geometry), totalPanels, totalPowerKwc, annualProductionKwh, totalLossPct]
  );
}

async function main() {
  const opts = parseArgs();
  const { studyId: argStudyId, versionId: argVersionId, dump, fixtureCalpinage, cleanup } = opts;

  if (process.env.NODE_ENV === "production" && fixtureCalpinage) {
    throw new Error("--fixture-calpinage interdit en production (script dev only)");
  }

  console.log("--- E2E Scenarios V2 (BASE / PHYSICAL / VIRTUAL) ---\n");

  let studyId, versionId, versionNumber, orgId;
  try {
    const resolved = await resolveStudyAndVersion(argStudyId, argVersionId);
    studyId = resolved.studyId;
    versionId = resolved.versionId;
    versionNumber = resolved.versionNumber;
    orgId = resolved.orgId;
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log("studyId:", studyId);
  console.log("versionId (UUID):", versionId);
  console.log("version_number:", versionNumber);
  console.log("orgId:", orgId);

  let calpinage = await pool.query(
    "SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2",
    [versionId, orgId]
  );
  let fixtureInjected = false;
  if (calpinage.rows.length === 0) {
    if (fixtureCalpinage) {
      await injectFixtureCalpinage(studyId, versionId, orgId);
      fixtureInjected = true;
      console.log("Injected fixture calpinage_data");
      calpinage = await pool.query(
        "SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2",
        [versionId, orgId]
      );
    }
    if (calpinage.rows.length === 0) {
      console.error("Calpinage requis pour cette version. Validez le calpinage ou utilisez --fixture-calpinage.");
      process.exit(1);
    }
  }

  let economic = await getEconomicSnapshotForVersion(versionId, orgId);
  if (!economic) {
    await createEconomicSnapshotForVersion({
      studyId,
      studyVersionId: versionId,
      organizationId: orgId,
      config: {},
    });
    economic = await getEconomicSnapshotForVersion(versionId, orgId);
  }
  const baseConfig = economic?.config_json ?? {};

  ensureTmpDir();

  const variants = ["BASE", "PHYSICAL", "VIRTUAL"];
  const results = { BASE: null, PHYSICAL: null, VIRTUAL: null };

  for (const variant of variants) {
    console.log("\n--- Variante", variant, "---");
    const configVariant = buildVariantConfig(baseConfig, variant);
    await createOrUpdateEconomicSnapshot({
      studyId,
      studyVersionId: versionId,
      organizationId: orgId,
      config: configVariant,
    });
    console.log("Config batterie utilisée:", JSON.stringify({
      physical: configVariant.batteries?.physical?.enabled,
      physical_capacity_kwh: configVariant.batteries?.physical?.capacity_kwh,
      virtual: configVariant.batteries?.virtual?.enabled,
      virtual_subscription_ttc: configVariant.batteries?.virtual?.annual_subscription_ttc ?? configVariant.batteries?.virtual?.price,
    }, null, 2));

    await runCalcForVariant(studyId, versionNumber, orgId);
    const scenariosV2 = await getScenariosV2FromDb(versionId);
    if (!Array.isArray(scenariosV2)) {
      console.error("scenarios_v2 absent ou invalide après calc " + variant);
      process.exit(1);
    }

    const scenarioIds = scenariosV2.map((s) => s?.id ?? s?.name).filter(Boolean);
    console.log("Scenario ids dans scenarios_v2:", scenarioIds.join(", "));

    const payload = {
      ok: true,
      variant,
      usedConfig: { batteries: configVariant.batteries },
      scenarios_v2: scenariosV2,
      scenarios: scenariosV2,
    };
    const outPath = resolve(TMP_DIR, `scenarios_${variant}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("Sauvegardé:", outPath);

    results[variant] = scenariosV2;
  }

  console.log("\nWrote tmp/scenarios_BASE.json, tmp/scenarios_PHYSICAL.json, tmp/scenarios_VIRTUAL.json");

  const baseScenarios = results.BASE;
  const physicalScenarios = results.PHYSICAL;
  const virtualScenarios = results.VIRTUAL;

  const baseScenario = findScenarioById(baseScenarios, "BASE");
  const physicalScenario = findScenarioById(physicalScenarios, "BATTERY_PHYSICAL");
  const virtualScenario = findScenarioById(virtualScenarios, "BATTERY_VIRTUAL");
  const baseFromPhysical = findScenarioById(physicalScenarios, "BASE");
  const baseFromVirtual = findScenarioById(virtualScenarios, "BASE");

  console.log("\n--- Extrait energy (BASE vs BATTERY_PHYSICAL vs BATTERY_VIRTUAL) ---");
  const baseEnergy = extractEnergy(baseScenario);
  const physicalEnergy = extractEnergy(physicalScenario);
  const virtualEnergy = extractEnergy(virtualScenario);
  console.log("BASE.energy:", JSON.stringify(baseEnergy, null, 2));
  console.log("BATTERY_PHYSICAL.energy:", JSON.stringify(physicalEnergy, null, 2));
  console.log("BATTERY_VIRTUAL.energy:", JSON.stringify(virtualEnergy, null, 2));

  console.log("\n--- Diff PHYSICAL vs BASE (énergie) ---");
  if (baseEnergy && physicalEnergy) {
    const autoDiff = (physicalEnergy.autoconsumption_kwh ?? 0) - (baseEnergy.autoconsumption_kwh ?? 0);
    const importDiff = (physicalEnergy.import_kwh ?? 0) - (baseEnergy.import_kwh ?? 0);
    const surplusDiff = (physicalEnergy.surplus_kwh ?? 0) - (baseEnergy.surplus_kwh ?? 0);
    console.log("  autoconsumption_kwh diff:", autoDiff, "(PHYSICAL - BASE)");
    console.log("  import_kwh diff:", importDiff);
    console.log("  surplus_kwh diff:", surplusDiff);
  }
  console.log("\n--- Diff VIRTUAL vs BASE (import facturé / crédit) ---");
  if (baseEnergy && virtualEnergy) {
    const baseImport = baseEnergy.import_kwh ?? 0;
    const billableImport = virtualEnergy.billable_import_kwh ?? virtualEnergy.import_kwh ?? 0;
    console.log("  BASE.import_kwh:", baseImport);
    console.log("  VIRTUAL.billable_import_kwh:", virtualEnergy.billable_import_kwh ?? "(= import_kwh)", billableImport);
    console.log("  VIRTUAL.credited_kwh:", virtualEnergy.credited_kwh ?? "—");
    console.log("  VIRTUAL.used_credit_kwh:", virtualEnergy.used_credit_kwh ?? "—");
    if (baseEnergy.surplus_kwh > 0 && billableImport < baseImport) {
      console.log("  OK: billable_import < BASE.import quand surplus > 0");
    }
  }

  console.log("\n--- Extrait finance ---");
  const baseFinance = extractFinance(baseScenario);
  const physicalFinance = extractFinance(physicalScenario);
  const virtualFinance = extractFinance(virtualScenario);
  console.log("BASE.finance:", JSON.stringify(baseFinance, null, 2));
  console.log("BATTERY_PHYSICAL.finance:", JSON.stringify(physicalFinance, null, 2));
  console.log("BATTERY_VIRTUAL.finance:", JSON.stringify(virtualFinance, null, 2));

  let fail = false;

  if (!physicalScenario) {
    console.error("\nFAIL: BATTERY_PHYSICAL scénario absent (config physical non appliquée ou calc n'a pas généré le scénario).");
    fail = true;
  } else {
    const baseForCompare = baseScenario || findScenarioById(physicalScenarios, "BASE");
    const baseE = extractEnergy(baseForCompare);
    const physE = extractEnergy(physicalScenario);
    if (!energyDiffers(baseE, physE)) {
      console.error("\nFAIL: BATTERY_PHYSICAL n'a pas modifié l'énergie par rapport à BASE.");
      console.error("BASE.energy:", JSON.stringify(baseE, null, 2));
      console.error("BATTERY_PHYSICAL.energy:", JSON.stringify(physE, null, 2));
      if (dump) {
        writeFileSync(resolve(TMP_DIR, "diff_physical_energy_fail.json"), JSON.stringify({ base: baseE, physical: physE }, null, 2), "utf8");
      }
      fail = true;
    } else {
      console.log("\nOK: PHYSICAL modifie bien les métriques énergie vs BASE.");
    }
  }

  if (!virtualScenario) {
    console.error("\nFAIL: BATTERY_VIRTUAL scénario absent (config virtual non appliquée ou calc n'a pas généré le scénario).");
    fail = true;
  } else {
    const baseForCompare = baseScenario || findScenarioById(virtualScenarios, "BASE");
    const baseE = extractEnergy(baseForCompare);
    const virtE = extractEnergy(virtualScenario);
    const billableImport = virtE?.billable_import_kwh ?? virtE?.import_kwh ?? null;
    const hasCreditMetrics = (virtE?.credited_kwh != null && Number(virtE.credited_kwh) > 0) ||
      (virtE?.used_credit_kwh != null && Number(virtE.used_credit_kwh) > 0);
    const billableLtBase = baseE?.import_kwh != null && billableImport != null && Number(billableImport) < Number(baseE.import_kwh);
    if (!hasCreditMetrics && !billableLtBase) {
      const baseF = extractFinance(baseForCompare);
      const virtF = extractFinance(virtualScenario);
      if (!financeDiffers(baseF, virtF)) {
        console.error("\nFAIL: BATTERY_VIRTUAL doit montrer une différence vs BASE (billable_import_kwh < BASE.import_kwh si surplus > 0, ou credited/used_credit non nuls, ou finance).");
        console.error("BASE.energy.import_kwh:", baseE?.import_kwh, "| VIRTUAL.billable_import_kwh:", billableImport, "| credited_kwh:", virtE?.credited_kwh);
        if (dump) {
          writeFileSync(resolve(TMP_DIR, "diff_virtual_fail.json"), JSON.stringify({ baseEnergy: baseE, virtualEnergy: virtE }, null, 2), "utf8");
        }
        fail = true;
      }
    }
    if (!fail) {
      console.log("\nOK: VIRTUAL a billable_import_kwh / crédits ou finance différente de BASE.");
    }
  }

  if (fail) {
    console.error("\n--- Diagnostic ---");
    console.error("PHYSICAL: batteries.physical lu dans solarnextPayloadBuilder.service.js → battery_input; calc.controller.js → simulateBattery8760.");
    console.error("VIRTUAL: batteries.virtual → virtual_battery_input; virtualBatteryCreditModel.applyVirtualBatteryCredit (crédit kWh mensuel) + computeFinance.");
    if (fixtureInjected && cleanup) {
      await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2", [versionId, orgId]);
      console.log("Cleanup: calpinage fixture supprimé.");
    }
    process.exit(1);
  }

  if (fixtureInjected && cleanup) {
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2", [versionId, orgId]);
    console.log("Cleanup: calpinage fixture supprimé.");
  }

  console.log("\n--- Tous les contrôles E2E sont passés. ---");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
