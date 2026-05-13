import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import {
  assessScenarioAntiOversell,
  isCommercialUnboundedVirtualBatteryAllowed,
  markVirtualBatteryUnboundedBlocked,
} from "../services/antiOversell.service.js";

function makeHourly8760(constant) {
  return Array.from({ length: 8760 }, () => constant);
}

test("BASE non pilote : buildScenarioBaseV2 ignore conso_p_pilotee", () => {
  const rawLoad = makeHourly8760(0.2);
  const pilotedLoad = makeHourly8760(0.8);
  const ctx = {
    pv: { hourly: makeHourly8760(1), kwc: 6, panelsCount: 10 },
    conso: { hourly: rawLoad, annual_kwh: rawLoad.reduce((a, b) => a + b, 0) },
    conso_p_pilotee: pilotedLoad,
    form: { maison: { panneaux_max: 20 } },
    settings: {},
    meta: { engine_consumption_source: "SYNTHETIC_MANUAL_PROFILE" },
  };
  const sc = buildScenarioBaseV2(ctx);
  assert.equal(sc.scenario_uses_piloted_profile, false);
  assert.ok(Math.abs(sc.energy.auto - rawLoad.reduce((a, b) => a + b, 0)) < 1);
  assert.ok(sc.energy.auto < pilotedLoad.reduce((a, b) => a + b, 0));
});

test("VB unbounded commercial : bloque hors debug/admin/test explicite", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_VB_UNBOUNDED_COMMERCIAL;
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_VB_UNBOUNDED_COMMERCIAL;
  try {
    assert.equal(isCommercialUnboundedVirtualBatteryAllowed({ virtual_battery_input: {} }), false);
    assert.equal(
      isCommercialUnboundedVirtualBatteryAllowed({
        virtual_battery_input: { allow_unbounded_for_debug: true },
      }),
      true
    );
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_VB_UNBOUNDED_COMMERCIAL;
    else process.env.ALLOW_VB_UNBOUNDED_COMMERCIAL = prevAllow;
  }
});

test("VB unbounded : score anti-survente max et warning bloquant", () => {
  const scenario = markVirtualBatteryUnboundedBlocked({
    name: "BATTERY_VIRTUAL",
    _v2: true,
    energy: { production_kwh: 7000, consumption_kwh: 6000, autoconsumption_kwh: 5900, billable_import_kwh: 100 },
  });
  const assessment = assessScenarioAntiOversell(
    {
      meta: { engine_consumption_source: "SYNTHETIC_MANUAL_PROFILE" },
      form: { conso: { profil: "teletravail" }, params: {} },
    },
    scenario
  );
  assert.equal(scenario.oversell_risk_score, 100);
  assert.ok(scenario.finance_warnings.includes("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE"));
  assert.ok(assessment.anti_oversell_flags.includes("VB_CAPACITY_AUTO_UNBOUNDED"));
  assert.equal(assessment.oversell_risk_score, 100);
});

test("anti-survente : cas CSV realiste sans batterie ne declenche pas de warning", () => {
  const assessment = assessScenarioAntiOversell(
    {
      meta: { engine_consumption_source: "CSV_HOURLY_ENEDIS" },
      form: { conso: { profil: "active" }, params: {} },
    },
    {
      name: "BASE",
      scenario_uses_piloted_profile: false,
      energy: { production_kwh: 5000, consumption_kwh: 6000, autoconsumption_kwh: 1500, grid_import_kwh: 4500 },
    }
  );
  assert.deepEqual(assessment.anti_oversell_flags, []);
  assert.equal(assessment.oversell_risk_score, 0);
});

test("anti-survente : synthetique + pilotage + VB tres autonome est downgraded", () => {
  const assessment = assessScenarioAntiOversell(
    {
      meta: { engine_consumption_source: "SYNTHETIC_MANUAL_PROFILE" },
      form: {
        conso: {
          profil: "teletravail",
          equipements_a_venir: {
            ve: { enabled: true, mode_charge: "jour" },
            ballon: { enabled: true, mode_charge: "pilote" },
          },
        },
        params: {},
      },
    },
    {
      name: "BATTERY_VIRTUAL",
      scenario_uses_piloted_profile: true,
      energy: { production_kwh: 7200, consumption_kwh: 6000, autoconsumption_kwh: 5900, billable_import_kwh: 100 },
    }
  );
  assert.ok(assessment.oversell_risk_score >= 70);
  assert.ok(assessment.anti_oversell_flags.includes("SYNTHETIC_CONSUMPTION_PROFILE"));
  assert.ok(assessment.anti_oversell_flags.includes("PILOTED_PROFILE_USED"));
  assert.ok(assessment.anti_oversell_flags.includes("VIRTUAL_BATTERY_USED"));
  assert.ok(assessment.anti_oversell_flags.includes("VB_AUTONOMY_OVER_85"));
});
