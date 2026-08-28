/**
 * PDF P5 daily profile fallback.
 * Usage: node --test backend/tests/pdfP5DailyProfile.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildP5DailyProfiles } from "../services/pdf/pdfP5DailyProfile.js";

test("current EV fallback places most consumption at night without changing annual energy", () => {
  const profile = buildP5DailyProfiles({
    annualProductionKwh: 6778,
    monthlyProductionKwh12: Array(12).fill(565),
    annualConsumptionKwh: 11000,
    monthlyConsumptionKwh12: Array(12).fill(916.67),
    latitudeDeg: 48,
    currentEquipmentText: "ve pac",
  });

  const conso = profile.consommation_kw;
  const dailyKwh = conso.reduce((sum, value) => sum + value, 0);
  const nightKwh = conso
    .slice(0, 7)
    .concat(conso.slice(20))
    .reduce((sum, value) => sum + value, 0);
  const businessHoursKwh = conso.slice(9, 18).reduce((sum, value) => sum + value, 0);

  assert.equal(conso.length, 24);
  assert.ok(Math.abs(dailyKwh - 11000 / 365) < 1e-9);
  assert.ok(nightKwh > businessHoursKwh * 2, "night charging should dominate daytime consumption");
  assert.match(profile.profile_notes.consumption, /recharge de véhicule principalement nocturne/);
});
