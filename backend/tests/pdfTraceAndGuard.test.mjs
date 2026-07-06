// ======================================================================
// PDF — Vérité conso/pilotage identique à l'écran : trace, notices, garde, anti-reconstruction.
// ======================================================================
import assert from "node:assert";
import test from "node:test";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";
import { CALC_ENGINE_VERSION } from "../services/calc/calc.constants.js";

// Réplique exacte de la garde du contrôleur generatePdfFromScenario.controller.js
function pdfGuard(selectedV2, snapshotEngineVersion) {
  const staleSnapshot = snapshotEngineVersion !== CALC_ENGINE_VERSION;
  const blocked = selectedV2.display_blocked === true || selectedV2.needs_recompute === true || staleSnapshot;
  return {
    blocked,
    error: blocked ? "PDF_BLOCKED_STALE_SNAPSHOT" : null,
    message: blocked ? "PDF impossible : snapshot périmé — recalcul requis." : null,
  };
}

function snap(trace, withMonthly = true) {
  const energy = {
    production_kwh: 6850, consumption_kwh: 6000, autoconsumption_kwh: 3077, surplus_kwh: 3667, import_kwh: 2923,
  };
  if (withMonthly) {
    energy.monthly = Array.from({ length: 12 }, () => ({
      prod_kwh: 570, conso_kwh: 500, auto_kwh: 256, surplus_kwh: 305, import_kwh: 244, batt_kwh: 0,
    }));
  }
  return {
    scenario_type: "BASE", created_at: new Date().toISOString(), consumption_trace: trace,
    client: {}, site: {}, installation: {}, equipment: {}, shading: {},
    energy, finance: { capex_ttc: 14000 }, production: { annual_kwh: 6850, monthly_kwh: Array(12).fill(570) },
    cashflows: [], assumptions: {},
  };
}
const opts = { studyId: "s1", versionId: "v1", studyNumber: "SGS-2026-0117" };

function hourlyByMonth(valuesByMonth) {
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [];
  for (let m = 0; m < 12; m++) {
    for (let h = 0; h < daysPerMonth[m] * 24; h++) out.push(valuesByMonth[m]);
  }
  return out;
}

test("T1 — PDF refusé si display_blocked=true", () => {
  const g = pdfGuard({ display_blocked: true }, CALC_ENGINE_VERSION);
  assert.strictEqual(g.blocked, true);
  assert.strictEqual(g.error, "PDF_BLOCKED_STALE_SNAPSHOT");
  assert.match(g.message, /snapshot périmé — recalcul requis/);
});

test("T2 — PDF refusé si needs_recompute=true OU version périmée", () => {
  assert.strictEqual(pdfGuard({ needs_recompute: true }, CALC_ENGINE_VERSION).blocked, true);
  assert.strictEqual(pdfGuard({}, "SmartPitch V-LIGHT V12").blocked, true);
  // snapshot courant non bloqué
  assert.strictEqual(pdfGuard({}, CALC_ENGINE_VERSION).blocked, false);
});

test("T3 — la view-model PDF conserve les champs trace", () => {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false, scenarios_engine_version: CALC_ENGINE_VERSION }),
    opts
  );
  assert.ok(vm.consumption_trace, "consumption_trace présent");
  assert.strictEqual(vm.consumption_trace.consumption_source, "ENEDIS_HOURLY");
  assert.strictEqual(vm.consumption_trace.scenarios_engine_version, CALC_ENGINE_VERSION);
});

test("T4 — PDF brut : 'consommation actuelle non optimisée' + source Enedis", () => {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false }),
    opts
  );
  assert.strictEqual(vm.consumption_profile_notice, "Profil de consommation : consommation actuelle non optimisée.");
  assert.strictEqual(vm.consumption_source_label, "Source : courbe Enedis réelle");
});

test("T5 — PDF piloté : 'optimisation solaire des usages activée'", () => {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "MONTHLY_SYNTHETIC", scenario_uses_piloted_profile: true }),
    opts
  );
  assert.strictEqual(vm.consumption_profile_notice, "Profil de consommation : optimisation solaire des usages activée.");
  assert.strictEqual(vm.consumption_source_label, "Source : profil synthétique mensuel");
});

test("T6 — aucun fallback ne reconstruit une courbe mensuelle manquante", () => {
  const withMonthly = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false }, true),
    opts
  );
  const noMonthly = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false }, false),
    opts
  );
  // Données réelles présentes : lues telles quelles (somme = 6000), pas de flag.
  assert.strictEqual(withMonthly.consumption_monthly_missing, false);
  const sumWith = (withMonthly.fullReport?.p4?.consommation_kwh || []).reduce((a, b) => a + (Number(b) || 0), 0);
  assert.ok(Math.abs(sumWith - 6000) < 1, "monthly réel préservé");
  // Données manquantes : AUCUNE fabrication (zéros + flag), pas de répartition uniforme depuis l'annuel.
  assert.strictEqual(noMonthly.consumption_monthly_missing, true);
  const sumNo = (noMonthly.fullReport?.p4?.consommation_kwh || []).reduce((a, b) => a + (Number(b) || 0), 0);
  assert.strictEqual(sumNo, 0, "aucune courbe reconstruite");
});

test("T7 - PDF Enedis : les 8760h priment sur une reference mensuelle plate", () => {
  const hourly = hourlyByMonth([2.2, 2.1, 1.9, 1.7, 1.4, 1.2, 1.1, 1.2, 1.5, 1.8, 2.0, 2.3]);
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(
    snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false }, false),
    {
      ...opts,
      p5_conso_hourly_kw_8760: hourly,
      consumption_monthly_reference: Array(12).fill(1099),
    }
  );
  const conso = vm.fullReport?.p4?.consommation_kwh || [];
  assert.ok(conso[0] > conso[6], "courbe Enedis saisonnalisee, pas ligne droite");
  assert.strictEqual(vm.fullReport?.p4?.consommation_kwh_source, "enedis_hourly_monthly");
});

test("T8 - PDF P4 : le graphe mensuel affiche le solaire valorise et garde le detail direct/stockage", () => {
  const direct = [80, 90, 160, 260, 380, 470, 430, 360, 250, 150, 90, 70];
  const vehicle = [20, 25, 55, 90, 140, 190, 170, 130, 90, 60, 35, 25];
  const virtual = [120, 130, 60, 30, 10, 0, 0, 20, 160, 310, 420, 300];
  const monthly = direct.map((d, i) => ({
    prod: 500,
    conso: 900,
    auto: d + vehicle[i] + virtual[i],
    surplus: 0,
    import: 900 - d - vehicle[i] - virtual[i],
    batt: vehicle[i] + virtual[i],
    direct_self_consumption_kwh: d,
    vehicle_v2h_discharge_kwh: vehicle[i],
    virtual_battery_discharge_kwh: virtual[i],
  }));
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(
    {
      ...snap({ consumption_source: "ENEDIS_HOURLY", scenario_uses_piloted_profile: false }, true),
      scenario_type: "VEHICLE_V2H_VIRTUAL",
      energy: {
        production_kwh: 6000,
        consumption_kwh: 10800,
        autoconsumption_kwh: direct.reduce((a, b) => a + b, 0) + vehicle.reduce((a, b) => a + b, 0) + virtual.reduce((a, b) => a + b, 0),
        direct_self_consumption_kwh: direct.reduce((a, b) => a + b, 0),
        ev_v2h_discharge_kwh: vehicle.reduce((a, b) => a + b, 0),
        virtual_battery_discharge_kwh: virtual.reduce((a, b) => a + b, 0),
        grid_import_kwh: 10800 - direct.reduce((a, b) => a + b, 0) - vehicle.reduce((a, b) => a + b, 0) - virtual.reduce((a, b) => a + b, 0),
        monthly,
      },
      vehicle_v2h: {
        enabled: true,
        ev_v2h_discharge_kwh: vehicle.reduce((a, b) => a + b, 0),
      },
      battery_virtual: {
        enabled: true,
        annual_discharge_kwh: virtual.reduce((a, b) => a + b, 0),
      },
      production: { annual_kwh: 6000, monthly_kwh: Array(12).fill(500) },
    },
    opts
  );
  assert.deepStrictEqual(vm.fullReport?.p4?.autoconso_kwh, direct.map((v, i) => v + vehicle[i] + virtual[i]));
  assert.deepStrictEqual(vm.fullReport?.p4?.direct_pv_kwh, direct);
  assert.deepStrictEqual(vm.fullReport?.p4?.batterie_kwh, vehicle.map((v, i) => v + virtual[i]));
  assert.strictEqual(
    vm.fullReport?.p4?.energie_solaire_valorisee,
    direct.reduce((a, b) => a + b, 0) + vehicle.reduce((a, b) => a + b, 0) + virtual.reduce((a, b) => a + b, 0)
  );
  assert.strictEqual(vm.fullReport?.p4?.energie_consommee_directement, direct.reduce((a, b) => a + b, 0));
  assert.strictEqual(
    vm.fullReport?.p4?.reste_reseau_kwh,
    10800 - direct.reduce((a, b) => a + b, 0) - vehicle.reduce((a, b) => a + b, 0) - virtual.reduce((a, b) => a + b, 0)
  );
  assert.strictEqual(vm.fullReport?.p4?.storage_legend_label, "Stockage restitué");
  assert.strictEqual(vm.fullReport?.p4?.storage_legend_sublabel, "V2H + batterie virtuelle");
});
