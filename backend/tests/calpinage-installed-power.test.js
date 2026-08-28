import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInstalledPowerFromGeometry,
  computeInstalledPowerFromPlacedPanels,
} from "../services/calpinage/calpinageInstalledPower.js";

test("calpinage installed power sums mixed per-panel module power", () => {
  const summary = computeInstalledPowerFromGeometry({
    frozenBlocks: [
      {
        panels: [
          { panel_id: "fr-375", power_wc: 375 },
          { panel_id: "fr-375", powerWc: 375 },
          { panel_id: "fr-500", power_wc: 500 },
          { panel_id: "fr-500", power_wc: 500 },
          { panel_id: "fr-500", power_wc: 500 },
        ],
      },
    ],
  });

  assert.equal(summary.panels_count, 5);
  assert.equal(summary.known_power_count, 5);
  assert.equal(summary.total_power_wc, 2250);
  assert.equal(summary.total_power_kwc, 2.25);
});

test("calpinage installed power ignores disabled panels", () => {
  const summary = computeInstalledPowerFromPlacedPanels([
    { power_wc: 375 },
    { power_wc: 500, enabled: false },
  ]);

  assert.equal(summary.panels_count, 1);
  assert.equal(summary.total_power_kwc, 0.375);
});

test("calpinage installed power keeps legacy fallback only when panel power is absent", () => {
  const summary = computeInstalledPowerFromPlacedPanels([
    { power_wc: 375 },
    { center: { x: 1, y: 2 } },
  ], 500);

  assert.equal(summary.panels_count, 2);
  assert.equal(summary.known_power_count, 2);
  assert.equal(summary.total_power_kwc, 0.875);
});

test("calpinage installed power does not apply a single fallback to mixed unknown dimensions", () => {
  const summary = computeInstalledPowerFromPlacedPanels([
    { panelWidthMm: 1755, panelHeightMm: 1038 },
    { panelWidthMm: 2094, panelHeightMm: 1134 },
  ], 500);

  assert.equal(summary, null);
});
