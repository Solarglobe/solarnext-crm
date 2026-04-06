/**
 * CP — TESTS VENDEUR-PROOF (MICRO + STRING) — PHASE 3 SIZING LOCK
 *
 * Valide :
 * - unités micro et string sur plusieurs valeurs (4,5,18,20,21…)
 * - flags KO courant / tension / MPPT sur au moins 1 cas
 * - cohérence live/export (validateInverterSizing + objet inverter_totals)
 *
 * Usage: node backend/scripts/test-phase3-inverter-sampling.js
 * (depuis la racine du projet)
 *
 * Exit: 0 si tout passe, 1 si un seul test échoue
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Catalogue hardcodé (modèles seedés) ─────────────────────────────────────

const INVERTERS = {
  MI1000: {
    inverter_type: "micro",
    brand: "ATMOCE",
    model_ref: "MI-1000",
    name: "ATMOCE MI-1000",
    modules_per_inverter: 2,
    inputs_per_mppt: 2,
    max_input_current_a: 22,
    max_dc_power_kw: 1.0,
  },
  MI500_1to1: {
    inverter_type: "micro",
    brand: "ATMOCE",
    model_ref: "MI-500",
    name: "ATMOCE MI-500",
    modules_per_inverter: 1,
    max_input_current_a: 22,
    max_dc_power_kw: 0.5,
  },
  HUAWEI_10KW: {
    inverter_type: "string",
    brand: "Huawei",
    model_ref: "10KTL-M1",
    name: "Huawei 10KTL-M1",
    nominal_power_kw: 10,
    mppt_count: 2,
    mppt_min_v: 140,
    mppt_max_v: 980,
    max_input_current_a: 22,
    max_dc_power_kw: 12,
  },
};

const PANELS = {
  LONGI_500: { power_wc: 500, isc_a: 15.53, vmp_v: 33.73 },
};

// ─── Chargement validateInverterSizing ───────────────────────────────────────

async function loadValidateInverterSizing() {
  const p = resolve(__dirname, "../../frontend/src/modules/calpinage/inverterSizing.js");
  const mod = await import(pathToFileURL(p).href);
  return mod.validateInverterSizing;
}

// ─── Construction objet inverter_totals (même logique que calpinage export) ───

function buildInverterTotals(validation) {
  return {
    units_required: validation.requiredUnits,
    isDcPowerOk: validation.isDcPowerOk,
    isCurrentOk: validation.isCurrentOk,
    isMpptOk: validation.isMpptOk,
    isVoltageOk: validation.isVoltageOk,
    warnings: validation.warnings,
  };
}

// ─── Exécution des scénarios ─────────────────────────────────────────────────

async function run() {
  const validateInverterSizing = await loadValidateInverterSizing();

  const rows = [];
  let allPass = true;

  function runScenario(scenario, totalPanels, totalPowerKwc, inverter, panelSpec, expectedUnits, expectFlags = null) {
    const validation = validateInverterSizing({
      totalPanels,
      totalPowerKwc,
      inverter,
      panelSpec,
    });
    const got = validation.requiredUnits;
    const passUnits = got === expectedUnits;

    const flagsSummary = [
      validation.isDcPowerOk ? "DC✓" : "DC✗",
      validation.isCurrentOk ? "I✓" : "I✗",
      validation.isMpptOk ? "MPPT✓" : "MPPT✗",
      validation.isVoltageOk ? "V✓" : "V✗",
    ].join(" ");

    let passFlags = true;
    if (expectFlags) {
      if (expectFlags.isCurrentOk === false && validation.isCurrentOk !== false) passFlags = false;
      if (expectFlags.isVoltageOk === false && validation.isVoltageOk !== false) passFlags = false;
      if (expectFlags.isMpptOk === false && validation.isMpptOk !== false) passFlags = false;
    }

    const pass = passUnits && passFlags;
    if (!pass) allPass = false;

    const inverterTotals = buildInverterTotals(validation);
    const coherent = inverterTotals.units_required === validation.requiredUnits &&
      inverterTotals.isCurrentOk === validation.isCurrentOk &&
      inverterTotals.isVoltageOk === validation.isVoltageOk;
    if (!coherent) allPass = false;

    rows.push({
      scenario,
      expected: expectedUnits,
      got,
      flagsSummary,
      coherent: coherent ? "✓" : "✗",
      pass: pass && coherent ? "PASS" : "FAIL",
    });
  }

  // ─── MICRO MI1000 (modules_per_inverter=2) ──────────────────────────────────
  runScenario("MICRO MI1000 totalPanels=4", 4, 2, INVERTERS.MI1000, null, 2);
  runScenario("MICRO MI1000 totalPanels=5", 5, 2.5, INVERTERS.MI1000, null, 3);
  runScenario("MICRO MI1000 totalPanels=18", 18, 9, INVERTERS.MI1000, null, 9);

  // ─── MICRO 1:1 (modules_per_inverter=1) ────────────────────────────────────
  runScenario("MICRO 1:1 totalPanels=4", 4, 2, INVERTERS.MI500_1to1, null, 4);

  // ─── STRING Huawei 10kW ────────────────────────────────────────────────────
  runScenario("STRING 10kW totalPowerKwc=8", 16, 8, INVERTERS.HUAWEI_10KW, null, 1);
  runScenario("STRING 10kW totalPowerKwc=12", 24, 12, INVERTERS.HUAWEI_10KW, null, 2);
  runScenario("STRING 10kW totalPowerKwc=20", 40, 20, INVERTERS.HUAWEI_10KW, null, 2);
  runScenario("STRING 10kW totalPowerKwc=21", 42, 21, INVERTERS.HUAWEI_10KW, null, 3);

  // ─── VALIDATION FLAGS : micro isCurrentOk=false ───────────────────────────
  const microCurrentKo = {
    ...INVERTERS.MI1000,
    inputs_per_mppt: 2,
    max_input_current_a: 18,
  };
  const panelIscHigh = { ...PANELS.LONGI_500, isc_a: 11 };
  runScenario(
    "MICRO isCurrentOk=false (isc_a élevé)",
    4,
    2,
    microCurrentKo,
    panelIscHigh,
    2,
    { isCurrentOk: false }
  );

  // ─── VALIDATION FLAGS : string isVoltageOk=false ────────────────────────────
  const stringVoltageKo = {
    ...INVERTERS.HUAWEI_10KW,
    mppt_min_v: 200,
    mppt_max_v: 400,
  };
  const panelVmpHigh = { ...PANELS.LONGI_500, vmp_v: 50 };
  runScenario(
    "STRING isVoltageOk=false (mppt_max_v faible)",
    20,
    10,
    stringVoltageKo,
    panelVmpHigh,
    1,
    { isVoltageOk: false }
  );

  // ─── Affichage tableau console ────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════");
  console.log("  CP — TESTS PHASE 3 SIZING LOCK — MICRO + STRING");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════\n");

  const col = (s, w) => String(s).padEnd(w);
  const header = col("SCENARIO", 45) + col("EXPECTED", 10) + col("GOT", 8) + col("FLAGS", 20) + col("PASS/FAIL", 10);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of rows) {
    const line = col(r.scenario, 45) + col(r.expected, 10) + col(r.got, 8) + col(r.flagsSummary, 20) + col(r.pass, 10);
    console.log(line);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════\n");

  if (allPass) {
    console.log("✅ ALL PASS — Tous les tests passent.\n");
    process.exit(0);
  } else {
    const fails = rows.filter((r) => r.pass === "FAIL");
    console.log("❌ FAIL — " + fails.length + " test(s) échoué(s) :\n");
    for (const f of fails) {
      console.log("  • " + f.scenario);
      console.log("    Attendu: " + f.expected + " unités, reçu: " + f.got + " | Flags: " + f.flagsSummary + "\n");
    }
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("❌ Erreur:", e.message);
  process.exit(1);
});
