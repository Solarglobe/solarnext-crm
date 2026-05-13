/**
 * Garde-fous anti-survente (règles métier minimales, sans E2E HTTP).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { CalcEngineValidationError, CALC_INVALID_8760_PROFILE } from "../services/calcEngineErrors.js";
import { attachNormalizedEnergyKpiFields } from "../services/energyKpisNormalize.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";
import {
  assessScenarioAntiOversell,
  isCommercialUnboundedVirtualBatteryAllowed,
  markVirtualBatteryUnboundedBlocked,
} from "../services/antiOversell.service.js";

function makeHourly8760(constant) {
  return Array.from({ length: 8760 }, () => constant);
}

test("buildScenarioBaseV2 : pas de scénario sans courbes 8760 valides", () => {
  assert.throws(
    () =>
      buildScenarioBaseV2({
        pv: { hourly: [0, 1] },
        conso: { hourly: [0, 1] },
        meta: { engine_consumption_source: "SYNTHETIC" },
      }),
    (err) => err instanceof CalcEngineValidationError && err.code === CALC_INVALID_8760_PROFILE
  );
});

test("production nulle : pas de taux d’autoconsommation PV exploitable", () => {
  const scenario = {
    name: "BASE",
    _skipped: false,
    energy: { prod: 0, conso: 3300, auto: 0, surplus: 0, import: 3300 },
    prod_kwh: 0,
    conso_kwh: 3300,
    auto_kwh: 0,
    surplus_kwh: 0,
    import_kwh: 3300,
  };
  attachNormalizedEnergyKpiFields(scenario);
  assert.equal(scenario.energy.pv_self_consumption_pct, null);
  assert.equal(scenario.energy.export_pct, null);
});

test("PDF page 1 : libellé gains suit economie_horizon_years (pas 25 figé)", () => {
  const snapshot = {
    meta: { client_nom: "Test", annual_consumption_kwh: 3000 },
    client: {},
    site: {},
    installation: { panneaux_nombre: 10 },
    equipment: { panneau: {}, onduleur: {} },
    hardware: { kwc: 6 },
    form: { params: {} },
    conso: { annual_kwh: 3000 },
    energy: {},
    finance: {},
    shading: {},
    production: { annual_kwh: 4000, monthly_kwh: Array(12).fill(4000 / 12) },
  };
  const scenarios_v2 = [
    {
      id: "BASE",
      name: "BASE",
      label: "Sans batterie",
      finance: {
        economie_horizon_years: 20,
        economie_total: 8000,
        economie_year_1: 400,
        capex_ttc: 12000,
        roi_years: 12,
        irr_pct: 6,
        facture_restante: 200,
      },
      energy: {
        production_kwh: 4000,
        consumption_kwh: 3000,
        site_autonomy_pct: 40,
        pv_self_consumption_pct: 30,
      },
      production: { annual_kwh: 4000, monthly_kwh: Array(12).fill(4000 / 12) },
    },
  ];
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    studyId: "s1",
    versionId: "v1",
    scenarios_v2,
    selected_scenario_id: "BASE",
    org_economics: { horizon_years: 25 },
  });
  const label = vm.fullReport?.p1?.p1_auto?.p1_k_gains_label;
  assert.equal(label, "Gains (20 ans)");
});

test("profil 8760 valide : buildScenarioBaseV2 ne lève pas", () => {
  const ctx = {
    pv: { hourly: makeHourly8760(0.4), kwc: 6, panelsCount: 10 },
    conso: { hourly: makeHourly8760(0.3), annual_kwh: null },
    conso_p_pilotee: null,
    form: { maison: { panneaux_max: 20 } },
    settings: { pricing: { kit_panel_power_w: 400 } },
    meta: { engine_consumption_source: "CSV_HOURLY_ENEDIS" },
  };
  const sc = buildScenarioBaseV2(ctx);
  assert.ok(Number.isFinite(sc.energy.prod));
});
