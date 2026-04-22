import { test } from "node:test";
import assert from "node:assert/strict";
import { meterRowToListItem } from "../services/leadMeters.service.js";

test("meterRowToListItem PDL : repli energy_profile si colonne annual vide", () => {
  const row = {
    id: "m1",
    name: "Compteur principal",
    is_default: true,
    consumption_mode: "PDL",
    consumption_annual_kwh: null,
    consumption_annual_calculated_kwh: null,
    meter_power_kva: 6,
    grid_type: "mono",
    energy_profile: { engine: { annual_kwh: 3317, hourly: new Array(8760).fill(0) } },
    sort_order: 0,
  };
  const item = meterRowToListItem(row);
  assert.equal(item.consumption_annual_kwh, 3317);
});

test("meterRowToListItem PDL : colonne annual prioritaire", () => {
  const row = {
    id: "m1",
    name: "X",
    is_default: true,
    consumption_mode: "PDL",
    consumption_annual_kwh: 5000,
    energy_profile: { engine: { annual_kwh: 3317, hourly: new Array(8760).fill(0) } },
    sort_order: 0,
  };
  const item = meterRowToListItem(row);
  assert.equal(item.consumption_annual_kwh, 5000);
});
