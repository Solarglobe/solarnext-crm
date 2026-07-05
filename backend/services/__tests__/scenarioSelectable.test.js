/**
 * Phase 2 — Tests du helper de sélectionnabilité (evaluateScenarioSelectable).
 * Point clé validé : on NE bloque PAS un scénario économiquement mauvais
 * (0, négatif, ROI non rentable calculé) — seulement les données réellement
 * absentes / invalides (null / undefined / NaN / _skipped).
 *
 * Lancement : node --test services/__tests__/scenarioSelectable.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateScenarioSelectable,
  SCENARIO_SELECTABLE_MESSAGES,
} from "../scenarioSelectable.js";

const sc = (id, finance = {}, extra = {}) => ({ id, finance, ...extra });

test("absent (null) → SCENARIO_ABSENT", () => {
  const r = evaluateScenarioSelectable(null, "BATTERY_PHYSICAL");
  assert.equal(r.selectable, false);
  assert.equal(r.reason, "SCENARIO_ABSENT");
});

test("absent (undefined) → SCENARIO_ABSENT", () => {
  assert.equal(evaluateScenarioSelectable(undefined, "BASE").reason, "SCENARIO_ABSENT");
});

test("_skipped === true → SCENARIO_SKIPPED (même avec finance calculée)", () => {
  const r = evaluateScenarioSelectable(
    sc("BATTERY_PHYSICAL", { economie_year_1: 250 }, { _skipped: true }),
    "BATTERY_PHYSICAL"
  );
  assert.equal(r.selectable, false);
  assert.equal(r.reason, "SCENARIO_SKIPPED");
});

test('energy_basis === "skipped" → SCENARIO_SKIPPED (signal mapper)', () => {
  const r = evaluateScenarioSelectable(
    sc("BATTERY_VIRTUAL", { economie_year_1: 100 }, { energy_basis: "skipped" }),
    "BATTERY_VIRTUAL"
  );
  assert.equal(r.reason, "SCENARIO_SKIPPED");
});

test("BASE présent → toujours sélectionnable (même finance vide)", () => {
  assert.equal(evaluateScenarioSelectable(sc("BASE", {}), "BASE").selectable, true);
});

test("batterie complète (economie_year_1 fini) → sélectionnable", () => {
  assert.equal(
    evaluateScenarioSelectable(sc("BATTERY_PHYSICAL", { economie_year_1: 320.5 }), "BATTERY_PHYSICAL")
      .selectable,
    true
  );
});

// --- Cœur de la correction : mauvaise économie ≠ incomplet ---

test("economie_year_1 = 0 → sélectionnable (pas de blocage économique)", () => {
  assert.equal(
    evaluateScenarioSelectable(sc("BATTERY_PHYSICAL", { economie_year_1: 0 }), "BATTERY_PHYSICAL")
      .selectable,
    true
  );
});

test("economie_total négative → sélectionnable", () => {
  assert.equal(
    evaluateScenarioSelectable(
      sc("BATTERY_VIRTUAL", { economie_total: -1500, economie_year_1: -60 }),
      "BATTERY_VIRTUAL"
    ).selectable,
    true
  );
});

test("ROI non rentable (roi_years null) mais économie calculée → sélectionnable", () => {
  assert.equal(
    evaluateScenarioSelectable(
      sc("BATTERY_HYBRID", { roi_years: null, irr_pct: null, economie_year_1: 40 }),
      "BATTERY_HYBRID"
    ).selectable,
    true
  );
});

// --- Incomplet : données réellement absentes / invalides ---

test("tous les indicateurs finance null → SCENARIO_INCOMPLETE", () => {
  const r = evaluateScenarioSelectable(
    sc("BATTERY_PHYSICAL", {
      economie_year_1: null,
      economie_total: null,
      total_savings_25y: null,
      roi_years: null,
      irr_pct: null,
      tri: null,
    }),
    "BATTERY_PHYSICAL"
  );
  assert.equal(r.selectable, false);
  assert.equal(r.reason, "SCENARIO_INCOMPLETE");
});

test("finance NaN uniquement → SCENARIO_INCOMPLETE", () => {
  const r = evaluateScenarioSelectable(
    sc("BATTERY_VIRTUAL", { economie_year_1: NaN, economie_total: NaN }),
    "BATTERY_VIRTUAL"
  );
  assert.equal(r.reason, "SCENARIO_INCOMPLETE");
});

test("finance absente (objet manquant) → SCENARIO_INCOMPLETE", () => {
  const r = evaluateScenarioSelectable({ id: "BATTERY_PHYSICAL" }, "BATTERY_PHYSICAL");
  assert.equal(r.reason, "SCENARIO_INCOMPLETE");
});

test("messages définis pour chaque raison", () => {
  for (const k of ["SCENARIO_ABSENT", "SCENARIO_SKIPPED", "SCENARIO_INCOMPLETE"]) {
    assert.equal(typeof SCENARIO_SELECTABLE_MESSAGES[k], "string");
    assert.ok(SCENARIO_SELECTABLE_MESSAGES[k].length > 0);
  }
});
