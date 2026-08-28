import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInstalledPowerByPanFromGeometryWithCatalog,
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

test("calpinage installed power resolves mixed legacy dimensions by pan from catalog", async () => {
  const db = {
    async query(_sql, params) {
      const [w, h] = params;
      if (
        (Math.abs(w - 1755) <= 2 && Math.abs(h - 1038) <= 2) ||
        (Math.abs(w - 1038) <= 2 && Math.abs(h - 1755) <= 2)
      ) {
        return { rows: [{ power_wc: 375 }] };
      }
      if (
        (Math.abs(w - 2094) <= 2 && Math.abs(h - 1134) <= 2) ||
        (Math.abs(w - 1134) <= 2 && Math.abs(h - 2094) <= 2)
      ) {
        return { rows: [{ power_wc: 500 }] };
      }
      return { rows: [] };
    },
  };

  const byPan = await computeInstalledPowerByPanFromGeometryWithCatalog(db, {
    frozenBlocks: [
      { panId: "bas-375", panels: Array.from({ length: 9 }, () => ({ panelWidthMm: 1755, panelHeightMm: 1038 })) },
      { panId: "bas-500", panels: Array.from({ length: 6 }, () => ({ panelWidthMm: 2094, panelHeightMm: 1134 })) },
    ],
  });

  assert.equal(byPan["bas-375"].total_power_kwc, 3.375);
  assert.equal(byPan["bas-500"].total_power_kwc, 3);
});
