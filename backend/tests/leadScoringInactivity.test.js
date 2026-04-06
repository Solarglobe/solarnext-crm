/**
 * Seuils d'inactivité (calculateInactivityLevel) — tests unitaires sans DB.
 * Usage: node --test tests/leadScoringInactivity.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { calculateInactivityLevel } from "../services/leadScoring.service.js";

test("null → none", () => {
  assert.equal(calculateInactivityLevel(null), "none");
});

test("date récente (< 3 j) → none", () => {
  const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert.equal(calculateInactivityLevel(d.toISOString()), "none");
});

test("≥ 3 j et < 7 j → warning", () => {
  const d = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  assert.equal(calculateInactivityLevel(d.toISOString()), "warning");
});

test("≥ 7 j et < 14 j → danger", () => {
  const d = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  assert.equal(calculateInactivityLevel(d.toISOString()), "danger");
});

test("≥ 14 j → critical", () => {
  const d = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  assert.equal(calculateInactivityLevel(d.toISOString()), "critical");
});
