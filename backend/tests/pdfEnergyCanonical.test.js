/**
 * PDF energy canonical source.
 * Usage: node --test backend/tests/pdfEnergyCanonical.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfEnergyCanonical,
  reconcilePercentParts,
  reconcileRoundedParts,
} from "../services/pdf/pdfEnergyCanonical.js";

function virtualScenario({ production, consumption, direct, credit }) {
  return {
    id: "BATTERY_VIRTUAL",
    energy: {
      production_kwh: production,
      consumption_kwh: consumption,
      direct_self_consumption_kwh: direct,
      surplus_used_by_virtual_battery_kwh: credit,
      virtual_battery_discharge_kwh: credit,
      overflow_export_kwh: 0,
    },
  };
}

function assertAnnualIdentities(canonical) {
  const d = canonical.display;
  assert.equal(
    d.autoconsommationDirecte + d.surplusCredite + d.productionNonValorisee,
    d.productionPV,
    "production = direct + credit + non valorisee"
  );
  assert.equal(
    d.autoconsommationDirecte + d.creditVirtuelRestitue + d.importReseau,
    d.consommation,
    "consommation = direct + credit restitue + reseau"
  );
  assert.equal(
    d.autoconsommationDirecte + d.creditVirtuelRestitue,
    d.energieCouverte,
    "energie couverte = direct + credit restitue"
  );
  assert.equal(
    d.repartitionConsommationPct.pvDirect +
      d.repartitionConsommationPct.creditVirtuel +
      d.repartitionConsommationPct.reseau,
    100,
    "repartition consommation = 100%"
  );
  assert.equal(
    d.repartitionProductionPct.pvDirect +
      d.repartitionProductionPct.creditVirtuel +
      d.repartitionProductionPct.nonValorisee,
    100,
    "repartition production = 100%"
  );
}

test("largest remainder reconciles kWh totals", () => {
  assert.deepEqual(reconcileRoundedParts(3410.771, [962, 2448.771, 0]), {
    total: 3411,
    parts: [962, 2449, 0],
  });
});

test("largest remainder reconciles percentages to 100", () => {
  assert.deepEqual(reconcilePercentParts([1124, 5654.602, 4221.398]), [10, 52, 38]);
});

test("ACHOURI 3 kWc virtual scenario is coherent", () => {
  const canonical = buildPdfEnergyCanonical({
    scenario: virtualScenario({
      production: 3410,
      consumption: 11000,
      direct: 962,
      credit: 2448.771,
    }),
    baseScenario: {
      energy: { direct_self_consumption_kwh: 962 },
    },
  });

  assertAnnualIdentities(canonical);
  assert.equal(canonical.display.productionPV, 3411);
  assert.equal(canonical.display.consommation, 11000);
  assert.equal(canonical.display.importReseau, 7589);
  assert.equal(canonical.display.tauxCouverturePct, 31);
  assert.deepEqual(canonical.display.repartitionConsommationPct, {
    pvDirect: 9,
    creditVirtuel: 22,
    reseau: 69,
  });
  assert.deepEqual(canonical.display.repartitionProductionPct, {
    pvDirect: 28,
    creditVirtuel: 72,
    nonValorisee: 0,
  });
});

test("ACHOURI 6 kWc virtual scenario is coherent", () => {
  const canonical = buildPdfEnergyCanonical({
    scenario: virtualScenario({
      production: 6778,
      consumption: 11000,
      direct: 1124,
      credit: 5654.602,
    }),
    baseScenario: {
      energy: { direct_self_consumption_kwh: 1124 },
    },
  });

  assertAnnualIdentities(canonical);
  assert.equal(canonical.display.productionPV, 6779);
  assert.equal(canonical.display.consommation, 11000);
  assert.equal(canonical.display.importReseau, 4221);
  assert.equal(canonical.display.tauxCouverturePct, 62);
  assert.deepEqual(canonical.display.repartitionConsommationPct, {
    pvDirect: 10,
    creditVirtuel: 52,
    reseau: 38,
  });
  assert.deepEqual(canonical.display.repartitionProductionPct, {
    pvDirect: 17,
    creditVirtuel: 83,
    nonValorisee: 0,
  });
});
