/**
 * CP-006 Phase 3 Premium — Tests unitaires validateInverterSizing.
 * Exécuter : node scripts/test-inverter-sizing.js
 */

const path = require("path");
const { pathToFileURL } = require("url");

let passed = 0;
let failed = 0;

async function loadValidateInverterSizing() {
  const mod = await import(pathToFileURL(path.join(__dirname, "../frontend/src/modules/calpinage/inverterSizing.js")).href);
  return mod.validateInverterSizing;
}

function assert(cond, msg) {
  if (cond) {
    passed++;
    return true;
  }
  failed++;
  console.error("FAIL:", msg);
  return false;
}

function assertEqual(a, b, msg) {
  const ok = a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6);
  if (ok) {
    passed++;
    return true;
  }
  failed++;
  console.error("FAIL:", msg, "— attendu", b, "reçu", a);
  return false;
}

// --- Micro 1:1 OK (modules_per_inverter=1)
function testMicro1to1(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 1 };
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 10, "Micro 1:1 — requiredUnits = 10");
  assert(r.warnings.length === 0, "Micro 1:1 — pas de warnings");
  assert(r.isDcPowerOk && r.isCurrentOk && r.isMpptOk && r.isVoltageOk, "Micro 1:1 — tous OK");
}

// --- Micro 1:2 OK (modules_per_inverter=2)
function testMicro1to2(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2 };
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 5, "Micro 1:2 — requiredUnits = 5");
  assert(r.warnings.length === 0, "Micro 1:2 — pas de warnings");
}

// --- Micro MI1000 : 4 panneaux + modules_per_inverter=2 => requiredUnits=2
function testMicroMI1000(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, inputs_per_mppt: 1 };
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 2, "Micro MI1000 — 4 panneaux / 2 modules => requiredUnits = 2");
  assert(r.warnings.length === 0, "Micro MI1000 — pas de warnings");
}

// --- Micro 1:1 avec 4 panneaux
function testMicro1to1FourPanels(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 1 };
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 4, "Micro 1:1 — 4 panneaux => requiredUnits = 4");
}

// --- Micro courant par entrée : isc_a=11, inputs_per_mppt=2 => 22A, max=18 => isCurrentOk=false
function testMicroCurrentPerEntry(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, inputs_per_mppt: 2, max_input_current_a: 18 };
  const panelSpec = { isc_a: 11 }; // 11 * 2 = 22A > 18
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec });
  assert(r.requiredUnits === 2, "Micro courant par entrée — requiredUnits = 2");
  assert(!r.isCurrentOk, "Micro courant par entrée — isCurrentOk = false (22A > 18A)");
  assert(r.warnings.some(w => w.includes("Courant d'entrée micro-onduleur")), "Warning courant micro présent");
}

// --- Micro inputs_per_mppt absent : fallback modules_per_inverter => entryModules=2, isc_a=11 => 22A
function testMicroInputsPerMpptAbsent(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, max_input_current_a: 25 };
  const panelSpec = { isc_a: 11 }; // entryModules=2 (fallback), 11*2=22A <= 25
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec });
  assert(r.requiredUnits === 2, "Micro inputs_per_mppt absent — requiredUnits = 2");
  assert(r.isCurrentOk, "Micro inputs_per_mppt absent — isCurrentOk = true (22A <= 25A)");
}

// --- Micro catalogue incomplet : modules_per_inverter manquant
function testMicroCatalogueIncomplet(validateInverterSizing) {
  const inv = { inverter_type: "micro" };
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 0, "Micro catalogue incomplet — requiredUnits = 0");
  assert(!r.isCurrentOk && !r.isDcPowerOk, "Micro catalogue incomplet — isCurrentOk et isDcPowerOk = false");
  assert(r.warnings.some(w => w.includes("Catalogue incomplet")), "Micro catalogue incomplet — warning présent");
}

// --- Micro dépassement courant (isc_a * entryModules > max)
function testMicroCurrentOverflow(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, inputs_per_mppt: 2, max_input_current_a: 10 };
  const panelSpec = { isc_a: 6 }; // 6 * 2 = 12 > 10
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec });
  assert(r.requiredUnits === 5, "Micro 1:2 — requiredUnits = 5");
  assert(!r.isCurrentOk, "Micro courant — isCurrentOk = false");
  assert(r.warnings.some(w => w.includes("Courant d'entrée micro-onduleur")), "Warning courant micro présent");
}

// --- Micro 1:2 courant OK (isc_a * 2 <= max)
function testMicro1to2CurrentOk(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, inputs_per_mppt: 2, max_input_current_a: 12 };
  const panelSpec = { isc_a: 5 }; // 5 * 2 = 10 <= 12
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec });
  assert(r.requiredUnits === 5, "Micro 1:2 courant OK — requiredUnits = 5");
  assert(r.isCurrentOk, "Micro 1:2 courant OK — isCurrentOk = true");
  assert(r.warnings.length === 0, "Micro 1:2 courant OK — pas de warnings");
}

// --- Micro dépassement DC
function testMicroDcOverflow(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, max_dc_power_kw: 0.5 };
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 5, "Micro 1:2 — requiredUnits = 5");
  assert(!r.isDcPowerOk, "Micro DC overflow — isDcPowerOk = false");
  assert(r.warnings.length >= 1, "Micro DC overflow — au moins un warning");
  assert(r.warnings.some(w => w.includes("Puissance DC")), "Micro DC overflow — warning DC présent");
}

// Catalogue string complet (6 champs obligatoires)
function fullStringCatalog(overrides = {}) {
  return {
    inverter_type: "string",
    nominal_power_kw: 10,
    mppt_count: 2,
    mppt_min_v: 200,
    mppt_max_v: 500,
    max_input_current_a: 15,
    max_dc_power_kw: 12,
    ...overrides
  };
}

// --- String catalogue incomplet : mppt_count absent => sizing impossible (sans dépendance active)
function testStringCatalogueIncomplet(validateInverterSizing) {
  const inv = { inverter_type: "string", nominal_power_kw: 10 };
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec: null });
  assert(!r.isMpptOk, "String catalogue incomplet — isMpptOk = false");
  assert(!r.isVoltageOk, "String catalogue incomplet — isVoltageOk = false");
  assert(!r.isCurrentOk, "String catalogue incomplet — isCurrentOk = false");
  assert(!r.isDcPowerOk, "String catalogue incomplet — isDcPowerOk = false");
  assert(r.requiredUnits === 0, "String catalogue incomplet — requiredUnits = 0");
  assert(r.warnings.some(w => w.includes("Catalogue incomplet")), "String catalogue incomplet — warning présent");
}

// --- String OK
function testString10kW8kWc(validateInverterSizing) {
  const inv = fullStringCatalog();
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 1, "String 10kW / 8kWc — requiredUnits = 1");
  assert(r.warnings.length === 0, "String 10kW / 8kWc — pas de warnings");
}

// --- String dépassement DC
function testDcOverflow(validateInverterSizing) {
  const inv = fullStringCatalog({ max_dc_power_kw: 8 });
  const r = validateInverterSizing({ totalPanels: 20, totalPowerKwc: 10, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 1, "String 10kW / 10kWc — requiredUnits = 1");
  assert(!r.isDcPowerOk, "Dépassement DC — isDcPowerOk = false");
  assert(r.warnings.length >= 1, "Dépassement DC — au moins un warning");
  assert(r.warnings.some(w => w.includes("Puissance DC")), "Dépassement DC — warning contient Puissance DC");
}

// --- String tension trop basse
function testStringVoltageTooLow(validateInverterSizing) {
  const inv = fullStringCatalog({ mppt_min_v: 400, mppt_max_v: 800 });
  const panelSpec = { vmp_v: 30 }; // 14 panels / 2 MPPT = 7 panels per MPPT. 7 * 30 = 210 V < 400
  const r = validateInverterSizing({ totalPanels: 14, totalPowerKwc: 5, inverter: inv, panelSpec });
  assert(r.requiredUnits === 1, "String tension basse — requiredUnits = 1");
  assert(!r.isMpptOk || !r.isVoltageOk, "String tension basse — isMpptOk ou isVoltageOk = false");
  assert(r.warnings.some(w => w.includes("Tension MPPT")), "String tension basse — warning tension MPPT");
}

// --- String tension trop haute
function testStringVoltageTooHigh(validateInverterSizing) {
  const inv = fullStringCatalog({ mppt_max_v: 400 });
  const panelSpec = { vmp_v: 50 }; // 14 panels / 2 = 7 panels. 7 * 50 = 350 V < 400 OK... try 20 panels: 10 panels/MPPT, 10*50=500 > 400
  const r = validateInverterSizing({ totalPanels: 20, totalPowerKwc: 10, inverter: inv, panelSpec });
  assert(r.requiredUnits === 1, "String tension haute — requiredUnits = 1");
  assert(!r.isMpptOk || !r.isVoltageOk, "String tension haute — isMpptOk ou isVoltageOk = false");
  assert(r.warnings.some(w => w.includes("Tension MPPT")), "String tension haute — warning tension MPPT");
}

// --- String MPPT insuffisant (legacy: panelSpec.strings.length > mppt_count)
function testStringMpptInsufficient(validateInverterSizing) {
  const inv = fullStringCatalog();
  const panelSpec = { strings: [5, 5, 5] }; // 3 strings > 2 MPPT
  const r = validateInverterSizing({ totalPanels: 15, totalPowerKwc: 7.5, inverter: inv, panelSpec });
  assert(!r.isMpptOk, "String MPPT insuffisant — isMpptOk = false");
  assert(r.warnings.some(w => w.includes("Nombre de strings")), "String MPPT insuffisant — warning strings");
}

// --- String tension OK
function testStringVoltageOk(validateInverterSizing) {
  const inv = fullStringCatalog();
  const panelSpec = { vmp_v: 40 }; // 10 panels / 2 = 5 panels. 5 * 40 = 200 V, dans plage
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: inv, panelSpec });
  assert(r.requiredUnits === 1, "String tension OK — requiredUnits = 1");
  assert(r.isMpptOk && r.isVoltageOk, "String tension OK — isMpptOk et isVoltageOk = true");
  assert(!r.warnings.some(w => w.includes("Tension MPPT")), "String tension OK — pas de warning tension");
}

// --- String courant dépassé
function testStringCurrentOverflow(validateInverterSizing) {
  const inv = fullStringCatalog({ max_input_current_a: 8 });
  const panelSpec = { isc_a: 10 }; // 10 > 8
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec });
  assert(!r.isCurrentOk, "String courant — isCurrentOk = false");
  assert(r.warnings.some(w => w.includes("Courant entrée string")), "String courant — warning courant");
}

// --- Sans onduleur
function testNoInverter(validateInverterSizing) {
  const r = validateInverterSizing({ totalPanels: 10, totalPowerKwc: 5, inverter: null, panelSpec: null });
  assert(r.requiredUnits === 0, "Sans onduleur — requiredUnits = 0");
  assert(r.warnings.length === 0, "Sans onduleur — pas de warnings");
  assert(r.isVoltageOk, "Sans onduleur — isVoltageOk présent");
}

// --- String plusieurs unités
function testStringMultipleUnits(validateInverterSizing) {
  const inv = fullStringCatalog();
  const r = validateInverterSizing({ totalPanels: 50, totalPowerKwc: 25, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 3, "String 10kW / 25kWc — requiredUnits = 3");
  assert(r.warnings.length === 0, "String 25kWc — pas de warnings");
}

// --- E) Tests supplémentaires Phase 3 Premium

// 1) Micro sans modules_per_inverter → sizing impossible
function testMicroSansModulesPerInverter(validateInverterSizing) {
  const inv = { inverter_type: "micro" };
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 0, "Micro sans modules_per_inverter — requiredUnits = 0");
  assert(!r.isDcPowerOk && !r.isCurrentOk && !r.isMpptOk && !r.isVoltageOk, "Micro sans modules_per_inverter — tous false");
  assert(r.warnings.some(w => w.includes("impossible dimensionnement")), "Micro sans modules_per_inverter — warning");
}

// 2) String sans mppt_count → sizing impossible
function testStringSansMpptCount(validateInverterSizing) {
  const inv = { inverter_type: "string", nominal_power_kw: 10 };
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 0, "String sans mppt_count — requiredUnits = 0");
  assert(!r.isDcPowerOk && !r.isCurrentOk && !r.isMpptOk && !r.isVoltageOk, "String sans mppt_count — tous false");
  assert(r.warnings.some(w => w.includes("impossible dimensionnement")), "String sans mppt_count — warning");
}

// 3) String mppt_max_v <= mppt_min_v → sizing impossible
function testStringMpptMaxVLteMinV(validateInverterSizing) {
  const inv = fullStringCatalog({ mppt_min_v: 500, mppt_max_v: 400 });
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 0, "String mppt_max_v <= mppt_min_v — requiredUnits = 0");
  assert(!r.isDcPowerOk && !r.isCurrentOk && !r.isMpptOk && !r.isVoltageOk, "String mppt_max_v <= mppt_min_v — tous false");
  assert(r.warnings.some(w => w.includes("impossible dimensionnement")), "String mppt_max_v <= mppt_min_v — warning");
}

// 4) Micro isc_a manquant → isCurrentOk=false
function testMicroIscAManquant(validateInverterSizing) {
  const inv = { inverter_type: "micro", modules_per_inverter: 2, max_input_current_a: 25 };
  const panelSpec = {}; // pas de isc_a
  const r = validateInverterSizing({ totalPanels: 4, totalPowerKwc: 2, inverter: inv, panelSpec });
  assert(r.requiredUnits === 2, "Micro isc_a manquant — requiredUnits = 2");
  assert(!r.isCurrentOk, "Micro isc_a manquant — isCurrentOk = false");
  assert(r.warnings.some(w => w.includes("Données panneau insuffisantes")), "Micro isc_a manquant — warning panneau");
}

// 5) Aucun test ne dépend du champ active — vérification avec active: false
function testStringCatalogueIncompletSansActive(validateInverterSizing) {
  const inv = { inverter_type: "string", nominal_power_kw: 10, active: false };
  const r = validateInverterSizing({ totalPanels: 16, totalPowerKwc: 8, inverter: inv, panelSpec: null });
  assert(r.requiredUnits === 0, "String catalogue incomplet (active=false) — requiredUnits = 0");
  assert(!r.isDcPowerOk && !r.isCurrentOk && !r.isMpptOk && !r.isVoltageOk, "String catalogue incomplet (active=false) — tous false");
  assert(r.warnings.some(w => w.includes("Catalogue incomplet")), "String catalogue incomplet (active=false) — warning");
}

async function run() {
  const validateInverterSizing = await loadValidateInverterSizing();
  console.log("=== CP-006 Phase 3 Premium — Tests validateInverterSizing ===\n");

  testMicro1to1(validateInverterSizing);
  testMicro1to2(validateInverterSizing);
  testMicroMI1000(validateInverterSizing);
  testMicroCatalogueIncomplet(validateInverterSizing);
  testMicro1to1FourPanels(validateInverterSizing);
  testMicroCurrentPerEntry(validateInverterSizing);
  testMicroInputsPerMpptAbsent(validateInverterSizing);
  testMicroCurrentOverflow(validateInverterSizing);
  testMicro1to2CurrentOk(validateInverterSizing);
  testMicroDcOverflow(validateInverterSizing);
  testStringCatalogueIncomplet(validateInverterSizing);
  testString10kW8kWc(validateInverterSizing);
  testDcOverflow(validateInverterSizing);
  testStringVoltageTooLow(validateInverterSizing);
  testStringVoltageTooHigh(validateInverterSizing);
  testStringMpptInsufficient(validateInverterSizing);
  testStringVoltageOk(validateInverterSizing);
  testStringCurrentOverflow(validateInverterSizing);
  testNoInverter(validateInverterSizing);
  testStringMultipleUnits(validateInverterSizing);
  testMicroSansModulesPerInverter(validateInverterSizing);
  testStringSansMpptCount(validateInverterSizing);
  testStringMpptMaxVLteMinV(validateInverterSizing);
  testMicroIscAManquant(validateInverterSizing);
  testStringCatalogueIncompletSansActive(validateInverterSizing);

  console.log("\nRésultat:", passed, "OK,", failed, "FAIL");
  if (failed > 0) process.exit(1);
  console.log("\n✅ Tous les tests passent");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
