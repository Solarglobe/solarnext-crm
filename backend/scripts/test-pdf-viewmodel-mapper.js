/**
 * PDF V2 — Tests mapSelectedScenarioSnapshotToPdfViewModel
 * TEST 1 — Snapshot complet : sections présentes
 * TEST 2 — Snapshot partiel : fallback
 * TEST 3 — Aucun undefined dans tout le ViewModel
 * TEST 4 — KPI cohérence (annualProductionKwh > 0, roiYears >= 0, annualSavings >= 0)
 *
 * Usage: cd backend && node scripts/test-pdf-viewmodel-mapper.js
 */

import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

const REQUIRED_SECTIONS = [
  "meta",
  "client",
  "project",
  "site",
  "technical",
  "production",
  "economics",
  "financing",
  "savings",
  "selectedScenario",
  "company",
  "disclaimers",
];

/** Snapshot complet type (aligné selectedScenarioSnapshot.service.js). */
function buildFullSnapshot() {
  return {
    scenario_type: "BASE",
    created_at: "2025-03-06T12:00:00.000Z",
    client: {
      nom: "Dupont",
      prenom: "Jean",
      adresse: "12 rue de la Paix",
      cp: "75001",
      ville: "Paris",
    },
    site: {
      lat: 48.8566,
      lon: 2.3522,
      orientation_deg: 180,
      tilt_deg: 30,
      puissance_compteur_kva: 9,
      type_reseau: "mono",
    },
    installation: {
      panneaux_nombre: 12,
      puissance_kwc: 5.82,
      production_annuelle_kwh: 7200,
      surface_panneaux_m2: null,
    },
    equipment: {
      panneau: { marque: "LONGi", modele: "Hi-MO 5", puissance_wc: 485 },
      onduleur: { marque: "ATMOCE", modele: "Micro", quantite: 12 },
      batterie: { capacite_kwh: null, type: null },
    },
    shading: { near_loss_pct: 2.5, far_loss_pct: 1.1, total_loss_pct: 3.6 },
    energy: {
      production_kwh: 7200,
      consumption_kwh: 13000,
      autoconsumption_kwh: 3500,
      surplus_kwh: 3700,
      import_kwh: 9500,
      billable_import_kwh: null,
      independence_pct: 26.9,
    },
    finance: {
      capex_ttc: 15000,
      economie_year_1: 850,
      economie_total: 18500,
      roi_years: 12,
      irr_pct: 5.2,
      facture_restante: 2200,
      revenu_surplus: 148,
    },
    production: {
      annual_kwh: 7200,
      monthly_kwh: [320, 480, 620, 680, 720, 750, 740, 700, 580, 420, 350, 330],
    },
    cashflows: [],
    assumptions: {},
  };
}

/** Parcourt récursivement l'objet et retourne true si aucune valeur n'est undefined. */
function hasNoUndefined(obj, path = "root") {
  if (obj === undefined) return { ok: false, path };
  if (obj === null || typeof obj !== "object") return { ok: true };
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = hasNoUndefined(obj[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined) return { ok: false, path: `${path}.${key}` };
    const r = hasNoUndefined(val, `${path}.${key}`);
    if (!r.ok) return r;
  }
  return { ok: true };
}

let passed = 0;
let failed = 0;

// ——— TEST 1 — Snapshot complet ———
try {
  const snapshot = buildFullSnapshot();
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot);
  const missing = REQUIRED_SECTIONS.filter((s) => !(s in vm) || vm[s] == null);
  if (missing.length === 0 && vm.production.monthlyProduction.length === 12) {
    passed++;
    console.log("TEST PASSED — Snapshot complet");
  } else {
    failed++;
    console.log("TEST FAILED — Snapshot complet. Sections manquantes ou monthlyProduction != 12:", missing, vm.production?.monthlyProduction?.length);
  }
} catch (e) {
  failed++;
  console.log("TEST FAILED — Snapshot complet:", e.message);
}

// ——— TEST 2 — Snapshot partiel ———
try {
  const partial = { scenario_type: "BASE", created_at: new Date().toISOString() };
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(partial);
  const missing = REQUIRED_SECTIONS.filter((s) => !(s in vm) || vm[s] == null);
  if (missing.length === 0 && Array.isArray(vm.production.monthlyProduction) && vm.production.monthlyProduction.length === 12) {
    passed++;
    console.log("TEST PASSED — Snapshot partiel");
  } else {
    failed++;
    console.log("TEST FAILED — Snapshot partiel. Sections manquantes:", missing);
  }
} catch (e) {
  failed++;
  console.log("TEST FAILED — Snapshot partiel:", e.message);
}

// ——— TEST 3 — Aucun undefined ———
try {
  const snapshot = buildFullSnapshot();
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot);
  const result = hasNoUndefined(vm);
  if (result.ok) {
    passed++;
    console.log("TEST PASSED — No undefined values");
  } else {
    failed++;
    console.log("TEST FAILED — No undefined values. Premier undefined à:", result.path);
  }
} catch (e) {
  failed++;
  console.log("TEST FAILED — No undefined values:", e.message);
}

// ——— TEST 4 — KPI cohérence ———
try {
  const snapshot = buildFullSnapshot();
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot);
  const ok =
    vm.production.annualProductionKwh > 0 &&
    vm.economics.roiYears >= 0 &&
    vm.economics.annualSavings >= 0;
  if (ok) {
    passed++;
    console.log("TEST PASSED — KPI coherence");
  } else {
    failed++;
    console.log("TEST FAILED — KPI coherence. annualProductionKwh:", vm.production.annualProductionKwh, "roiYears:", vm.economics.roiYears, "annualSavings:", vm.economics.annualSavings);
  }
} catch (e) {
  failed++;
  console.log("TEST FAILED — KPI coherence:", e.message);
}

// Test supplémentaire : snapshot null → empty ViewModel sans crash
try {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(null);
  const result = hasNoUndefined(vm);
  const sectionsOk = REQUIRED_SECTIONS.every((s) => s in vm && vm[s] != null);
  if (result.ok && sectionsOk && vm.production.monthlyProduction.length === 12) {
    passed++;
    console.log("TEST PASSED — Null snapshot → empty ViewModel");
  } else {
    failed++;
    console.log("TEST FAILED — Null snapshot");
  }
} catch (e) {
  failed++;
  console.log("TEST FAILED — Null snapshot:", e.message);
}

console.log("\nRésultat :", passed, "passés,", failed, "échoués");
process.exit(failed > 0 ? 1 : 0);
