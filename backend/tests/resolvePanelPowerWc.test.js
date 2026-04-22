import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePanelPowerWc,
  isInstalledKwcDivergent,
  computeInstalledKwcRounded2,
  computeInstalledKwcRounded3,
} from "../utils/resolvePanelPowerWc.js";
import { DEFAULT_PANEL_POWER_WC } from "../services/core/engineConstants.js";

test("TEST 1 DMEGC-like: 61 × 500 Wc → 30.5 kWc (2 déc.)", () => {
  const w = resolvePanelPowerWc({ brand: "DMEGC", power_wc: 500 });
  assert.equal(w, 500);
  assert.equal(computeInstalledKwcRounded2(61, w), 30.5);
  assert.equal(computeInstalledKwcRounded3(61, w), 30.5);
});

test("TEST 2 DualSun-like: 61 × 500", () => {
  const w = resolvePanelPowerWc({ brand: "DualSun", power_wc: 500 });
  assert.equal(computeInstalledKwcRounded2(61, w), 30.5);
});

test("TEST 3 legacy powerWc seul", () => {
  assert.equal(resolvePanelPowerWc({ powerWc: 500 }), 500);
});

test("TEST 4 legacy power_wc seul", () => {
  assert.equal(resolvePanelPowerWc({ power_wc: 500 }), 500);
});

test("TEST 5 dégradé: aucune puissance → null, pas de 485 dans resolve", () => {
  assert.equal(resolvePanelPowerWc(null), null);
  assert.equal(resolvePanelPowerWc({}), null);
  assert.equal(resolvePanelPowerWc({ power_wc: 40 }), null);
  assert.equal(DEFAULT_PANEL_POWER_WC, 485);
});

test("sanity: 29.585 vs 30.5 divergent", () => {
  assert.equal(isInstalledKwcDivergent(29.585, 30.5), true);
  assert.equal(isInstalledKwcDivergent(30.5, 30.5), false);
});

test("61 × 485 Wc → 29,585 kWc (3 déc.)", () => {
  const w = resolvePanelPowerWc({ power_wc: 485 });
  assert.equal(computeInstalledKwcRounded3(61, w), 29.585);
});
