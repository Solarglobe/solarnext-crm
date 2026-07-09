// ======================================================================
// Non-regression — Tracabilite profil de conso exposee par l'API (scenarios_v2)
// Verifie que mapScenarioToV2 propage la verite calculee (source, pilotage, hash,
// version moteur) et que la garde V12/V13 produit needs_recompute/display_blocked.
// ======================================================================
import assert from "node:assert";
import test from "node:test";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import { CALC_ENGINE_VERSION } from "../services/calc/calc.constants.js";

function baseScenario(extra = {}) {
  return {
    id: "BASE",
    name: "BASE",
    _v2: true,
    scenario_uses_piloted_profile: false,
    energy: {
      production_kwh: 6850,
      consumption_kwh: 6000,
      autoconsumption_kwh: 3077,
      surplus_kwh: 3667,
      import_kwh: 2923,
      monthly: Array.from({ length: 12 }, () => ({
        prod_kwh: 570, conso_kwh: 500, auto_kwh: 256, surplus_kwh: 305, import_kwh: 244, batt_kwh: 0,
      })),
    },
    finance: { capex_ttc: 14000, economie_an1: 1041, roi_years: 11, irr_pct: 7.2, gain_25a: 31000 },
    metadata: { kwc: 7 },
    ...extra,
  };
}

function ctxFor({ mode, piloting, baseHash, calcHash, usages, profil }) {
  return {
    form: { conso: { profil: profil ?? "active" } },
    meta: {
      consumption_source_mode: mode,
      solar_piloting_enabled: piloting,
      piloting_reason: piloting ? "explicit_user_choice" : "not_enabled",
      usages_pilotables: usages ?? [],
      base_consumption_profile_hash: baseHash,
      calculated_consumption_profile_hash: calcHash,
    },
  };
}

const TRACE_FIELDS = [
  "consumption_source", "occupancy_profile", "solar_piloting_enabled",
  "scenario_uses_piloted_profile", "piloting_reason", "usages_pilotables",
  "base_consumption_profile_hash", "calculated_consumption_profile_hash",
  "scenarios_engine_version", "needs_recompute", "display_blocked", "blocked_reason",
];

test("V13 brut (Enedis, pas de pilotage) : scenario_uses_piloted_profile=false, hashes egaux presents", () => {
  const out = mapScenarioToV2(
    baseScenario(),
    ctxFor({ mode: "CSV_HOURLY_FULL_YEAR", piloting: false, baseHash: "a1b2c3", calcHash: "a1b2c3" })
  );
  assert.strictEqual(out.scenario_uses_piloted_profile, false);
  assert.strictEqual(out.solar_piloting_enabled, false);
  assert.strictEqual(out.consumption_source, "ENEDIS_HOURLY");
  assert.strictEqual(out.scenarios_engine_version, CALC_ENGINE_VERSION);
  assert.ok(out.base_consumption_profile_hash);
  assert.ok(out.calculated_consumption_profile_hash);
  assert.strictEqual(out.base_consumption_profile_hash, out.calculated_consumption_profile_hash);
});

test("V13 pilote (option ON) : scenario_uses_piloted_profile=true, hashes differents presents", () => {
  const out = mapScenarioToV2(
    baseScenario({ scenario_uses_piloted_profile: true }),
    ctxFor({ mode: "CSV_HOURLY_FULL_YEAR", piloting: true, baseHash: "a1b2c3", calcHash: "z9y8x7", usages: ["ballon_ecs", "ve"] })
  );
  assert.strictEqual(out.scenario_uses_piloted_profile, true);
  assert.strictEqual(out.solar_piloting_enabled, true);
  assert.strictEqual(out.piloting_reason, "explicit_user_choice");
  assert.deepStrictEqual(out.usages_pilotables, ["ballon_ecs", "ve"]);
  assert.notStrictEqual(out.base_consumption_profile_hash, out.calculated_consumption_profile_hash);
});

test("Tous les champs de tracabilite sont presents (jamais undefined)", () => {
  const out = mapScenarioToV2(
    baseScenario(),
    ctxFor({ mode: "CSV_HOURLY_FULL_YEAR", piloting: false, baseHash: "h", calcHash: "h" })
  );
  for (const f of TRACE_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, f), "champ manquant: " + f);
  }
});

// Garde V12/V13 — logique de lecture (studyScenarios.controller.js)
function readGuard(snapshotEngineVersion, engineCoherent = true) {
  const staleSnapshot = snapshotEngineVersion !== CALC_ENGINE_VERSION;
  return {
    needs_recompute: staleSnapshot || !engineCoherent,
    display_blocked: staleSnapshot || !engineCoherent,
    blocked_reason: staleSnapshot
      ? "STALE_SNAPSHOT_ENGINE_VERSION"
      : (!engineCoherent ? "ENGINE_INCOHERENT_MIXED_BASIS" : null),
  };
}

test("Snapshot V12 : needs_recompute=true, display_blocked=true, blocked_reason renseigne", () => {
  const g = readGuard("SmartPitch V-LIGHT V13");
  assert.strictEqual(g.needs_recompute, true);
  assert.strictEqual(g.display_blocked, true);
  assert.strictEqual(g.blocked_reason, "STALE_SNAPSHOT_ENGINE_VERSION");
});

test("Snapshot V13 courant : non bloque", () => {
  const g = readGuard(CALC_ENGINE_VERSION);
  assert.strictEqual(g.needs_recompute, false);
  assert.strictEqual(g.display_blocked, false);
  assert.strictEqual(g.blocked_reason, null);
});
