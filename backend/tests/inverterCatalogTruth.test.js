/**
 * Lot ONDULEURS — pv_inverters + multi-pan factor AC.
 * node --test backend/tests/inverterCatalogTruth.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  nominalKwPerUnitFromRow,
  resolvePvInverterEngineFields,
} from "../services/pv/resolveInverterFromDb.service.js";
import { extractPvInverterFromCalpinagePayload } from "../services/pv/inverterFinanceContext.js";
import { computeFactorACForTests } from "../services/pvgisService.js";

const invRowString = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "String X",
  brand: "BrandS",
  model_ref: "STR-10",
  inverter_type: "string",
  inverter_family: "CENTRAL",
  nominal_power_kw: 10,
  nominal_va: null,
  euro_efficiency_pct: 97.5,
  modules_per_inverter: null,
};

const invRowMicro = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Micro M",
  brand: "BrandM",
  model_ref: "MIC-400",
  inverter_type: "micro",
  inverter_family: "MICRO",
  nominal_power_kw: null,
  nominal_va: 400,
  euro_efficiency_pct: 96.8,
  modules_per_inverter: 1,
};

function mockPool(row) {
  return {
    async query() {
      return { rows: row ? [row] : [] };
    },
  };
}

test("nominalKwPerUnitFromRow : string nominal_power_kw", () => {
  assert.equal(nominalKwPerUnitFromRow({ nominal_power_kw: 8.5, nominal_va: null }), 8.5);
});

test("nominalKwPerUnitFromRow : micro nominal_va → kW", () => {
  assert.equal(nominalKwPerUnitFromRow({ nominal_power_kw: null, nominal_va: 400 }), 0.4);
});

test("extract : nominal_va seul → inverter_nominal_kw_total", () => {
  const ext = extractPvInverterFromCalpinagePayload({
    inverter: { id: "x", nominal_va: 500, inverter_type: "micro" },
    inverter_totals: { units_required: 20 },
  });
  assert.equal(ext.inverter_nominal_kw_total, 10);
});

test("resolvePvInverterEngineFields : DB recale euro + kW total (string × 2)", async () => {
  const pool = mockPool(invRowString);
  const snap = {
    inverter: {
      id: invRowString.id,
      euro_efficiency_pct: 90,
      nominal_power_kw: 8,
    },
    inverter_totals: { units_required: 2 },
  };
  const ext = extractPvInverterFromCalpinagePayload(snap);
  const merged = await resolvePvInverterEngineFields(pool, snap, ext);
  assert.equal(merged.euro_efficiency_pct, 97.5);
  assert.equal(merged.inverter_nominal_kw_total, 20);
  assert.equal(merged.inverter_id, invRowString.id);
});

test("resolvePvInverterEngineFields : micro + modules_per_inverter catalogue", async () => {
  const pool = mockPool(invRowMicro);
  const snap = {
    inverter: { id: invRowMicro.id, nominal_va: 300 },
    inverter_totals: { units_required: 10 },
  };
  const ext = extractPvInverterFromCalpinagePayload(snap);
  const merged = await resolvePvInverterEngineFields(pool, snap, ext);
  assert.equal(merged.modules_per_inverter, 1);
  assert.equal(merged.inverter_type, "micro");
  assert.equal(merged.euro_efficiency_pct, 96.8);
  assert.equal(merged.inverter_nominal_kw_total, 4);
});

test("resolvePvInverterEngineFields : extract + payload vides → null", async () => {
  const pool = mockPool(null);
  const out = await resolvePvInverterEngineFields(pool, null, null);
  assert.equal(out, null);
});

test("computeFactorACForTests : multi-pan ctx avec pv_inverter 97 % vs défaut", () => {
  const def = computeFactorACForTests({ form: {} });
  const hi = computeFactorACForTests({
    form: { pv_inverter: { euro_efficiency_pct: 97 } },
  });
  assert.ok(hi.etaInv > def.etaInv);
  assert.ok(Math.abs(hi.etaInv - 0.97) < 1e-6);
});
