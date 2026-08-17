import test from "node:test";
import assert from "node:assert/strict";
import { computeInstallationCostFromCatalog } from "../domains/installers/installers.pricing.js";

function ohelecCatalog(overrides = {}) {
  const installer = { id: "installer-ohelec", name: "OHELEC" };
  const tariffVersion = { id: "tariff-v1", version_label: "OHELEC HT V1", status: "ACTIVE" };
  const roofGrid = { id: "grid-roof", code: "OHELEC_ROOF_SUPERIMPOSED_GRID", label: "Toiture" };
  const flatGroundGrid = { id: "grid-flat-ground", code: "OHELEC_FLAT_GROUND_GRID", label: "Toit plat / sol" };
  const mkRow = (pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents) => ({
    pricing_grid_id,
    power_wc,
    panel_count_hint,
    amount_ht_cents,
  });

  return {
    installer,
    tariff_version: tariffVersion,
    grids: [roofGrid, flatGroundGrid],
    installation_type_mappings: [
      { installation_type: "ROOF_SUPERIMPOSED", pricing_grid_id: roofGrid.id },
      { installation_type: "FLAT_ROOF", pricing_grid_id: flatGroundGrid.id },
      { installation_type: "GROUND", pricing_grid_id: flatGroundGrid.id },
    ],
    tariff_rows: [
      mkRow(roofGrid.id, 2000, null, 140000),
      mkRow(roofGrid.id, 2500, null, 150000),
      mkRow(roofGrid.id, 3500, null, 160000),
      mkRow(roofGrid.id, 4000, null, 170000),
      mkRow(roofGrid.id, 5000, null, 180000),
      mkRow(roofGrid.id, 5500, null, 190000),
      mkRow(roofGrid.id, 6000, null, 200000),
      mkRow(roofGrid.id, 7000, null, 220000),
      mkRow(roofGrid.id, 8000, null, 240000),
      mkRow(roofGrid.id, 9000, null, 260000),
      mkRow(flatGroundGrid.id, 2000, null, 160000),
      mkRow(flatGroundGrid.id, 3000, null, 180000),
      mkRow(flatGroundGrid.id, 3500, null, 190000),
      mkRow(flatGroundGrid.id, 4000, null, 200000),
      mkRow(flatGroundGrid.id, 5000, null, 210000),
      mkRow(flatGroundGrid.id, 6000, null, 230000),
      mkRow(flatGroundGrid.id, 7000, null, 240000),
      mkRow(flatGroundGrid.id, 8000, null, 260000),
      mkRow(flatGroundGrid.id, 9000, null, 270000),
    ],
    electrical_rules: [
      { electrical_type: "MONO", rule_type: "NONE", amount_ht_cents: 0 },
      { electrical_type: "TRI", rule_type: "FIXED_SURCHARGE", amount_ht_cents: 25000 },
    ],
    options: [
      {
        code: "BATTERY_UP_TO_5_KWH",
        label: "Batterie jusqu'à 5 kWh",
        category: "BATTERY",
        amount_ht_cents: 30000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        incompatible_group: "BATTERY_CAPACITY",
        is_active: true,
      },
      {
        code: "BATTERY_OVER_5_KWH",
        label: "Batterie > 5 kWh",
        category: "BATTERY",
        amount_ht_cents: 60000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        incompatible_group: "BATTERY_CAPACITY",
        is_active: true,
      },
      {
        code: "EV_CHARGER",
        label: "Borne de recharge",
        category: "ELECTRICAL",
        amount_ht_cents: 35000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        is_active: true,
      },
      {
        code: "MULTIPLE_ROOF_SECTIONS",
        label: "Plusieurs pans de toiture",
        category: "INSTALLATION",
        amount_ht_cents: 25000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        is_active: true,
      },
      {
        code: "NEW_SLATE_INSTALLATION",
        label: "Pose ardoise neuve",
        category: "INSTALLATION",
        amount_ht_cents: 30000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        is_active: true,
      },
      {
        code: "TECHNICAL_VISIT",
        label: "Visite technique",
        category: "SERVICE",
        amount_ht_cents: 16667,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
        is_active: true,
      },
      {
        code: "CABLE_AND_CONNECTION",
        label: "Câble et raccordement",
        category: "ELECTRICAL",
        amount_ht_cents: 15000,
        is_selectable_for_installation: true,
        is_amount_overridable: true,
        is_active: true,
      },
    ],
    ancillary_services: [
      {
        code: "DIAGNOSTIC_TROUBLESHOOTING",
        label: "Diagnostic / dépannage",
        amount_ht_cents: 40000,
      },
    ],
    ...overrides,
  };
}

function compute(input, catalog = ohelecCatalog()) {
  return computeInstallationCostFromCatalog(catalog, input);
}

function assertDomainCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

test("OHELEC toiture 6 kW mono retourne le prix HT exact", () => {
  const result = compute({
    requested_power_wc: 6000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(result.matched_power_wc, 6000);
  assert.equal(result.base_amount_ht_cents, 200000);
  assert.equal(result.catalog_total_ht_cents, 200000);
  assert.equal(result.final_total_ht_cents, 200000);
});

test("OHELEC toiture 5820 Wc matche le palier 6000 Wc", () => {
  const result = compute({
    requested_power_wc: 5820,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(result.matched_power_wc, 6000);
  assert.equal(result.base_amount_ht_cents, 200000);
});

test("la puissance 6300 Wc matche le palier immédiatement supérieur 7000 Wc", () => {
  const result = compute({
    requested_power_wc: 6300,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(result.matched_power_wc, 7000);
  assert.equal(result.base_amount_ht_cents, 220000);
});

test("OHELEC toit plat et sol 6 kW mono retournent 2300 euros HT avec types distincts", () => {
  const flat = compute({
    requested_power_wc: 6000,
    installation_type: "FLAT_ROOF",
    electrical_type: "MONO",
  });
  const ground = compute({
    requested_power_wc: 6000,
    installation_type: "GROUND",
    electrical_type: "MONO",
  });
  assert.equal(flat.matched_power_wc, 6000);
  assert.equal(ground.matched_power_wc, 6000);
  assert.equal(flat.base_amount_ht_cents, 230000);
  assert.equal(ground.base_amount_ht_cents, 230000);
  assert.equal(flat.installation_type, "FLAT_ROOF");
  assert.equal(ground.installation_type, "GROUND");
});

test("le dernier palier exact est autorisé, au-delà le moteur refuse sans fallback", () => {
  const exact = compute({
    requested_power_wc: 9000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(exact.matched_power_wc, 9000);
  assertDomainCode(
    () =>
      compute({
        requested_power_wc: 9001,
        installation_type: "ROOF_SUPERIMPOSED",
        electrical_type: "MONO",
      }),
    "NO_TARIFF_FOR_POWER"
  );
});

test("le TRI ajoute le supplément HT lu dans la règle tarifaire", () => {
  const catalog = ohelecCatalog({
    electrical_rules: [
      { electrical_type: "MONO", rule_type: "NONE", amount_ht_cents: 0 },
      { electrical_type: "TRI", rule_type: "FIXED_SURCHARGE", amount_ht_cents: 33333 },
    ],
  });
  const result = compute(
    {
      requested_power_wc: 3000,
      installation_type: "ROOF_SUPERIMPOSED",
      electrical_type: "TRI",
    },
    catalog
  );
  assert.equal(result.electrical_adjustments[0].amount_ht_cents, 33333);
  assert.equal(result.final_total_ht_cents, 193333);
});

test("OHELEC 6 kW toiture TRI retourne 2250 euros HT", () => {
  const result = compute({
    requested_power_wc: 6000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "TRI",
  });
  assert.equal(result.base_amount_ht_cents, 200000);
  assert.equal(result.electrical_adjustments[0].amount_ht_cents, 25000);
  assert.equal(result.final_total_ht_cents, 225000);
});

test("OHELEC 6 kW toiture TRI avec plusieurs pans et câble catalogue retourne 2650 euros HT", () => {
  const result = compute({
    requested_power_wc: 6000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "TRI",
    options: ["MULTIPLE_ROOF_SECTIONS", "CABLE_AND_CONNECTION"],
  });
  assert.equal(result.base_amount_ht_cents, 200000);
  assert.equal(result.catalog_total_ht_cents, 265000);
  assert.equal(result.final_total_ht_cents, 265000);
});

test("options, câble overridable et visite technique sont calculés en HT", () => {
  const result = compute({
    requested_power_wc: 3000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
    options: [
      { code: "CABLE_AND_CONNECTION", amount_ht_cents_override: 22000 },
      { code: "TECHNICAL_VISIT" },
      { code: "EV_CHARGER" },
    ],
  });
  assert.equal(result.catalog_total_ht_cents, 160000 + 15000 + 16667 + 35000);
  assert.equal(result.final_total_ht_cents, 160000 + 22000 + 16667 + 35000);
  assert.deepEqual(result.option_overrides, [
    {
      code: "CABLE_AND_CONNECTION",
      catalog_amount_ht_cents: 15000,
      override_amount_ht_cents: 22000,
    },
  ]);
});

test("les options batterie sont mutuellement exclusives", () => {
  assertDomainCode(
    () =>
      compute({
        requested_power_wc: 3000,
        installation_type: "ROOF_SUPERIMPOSED",
        electrical_type: "MONO",
        options: ["BATTERY_UP_TO_5_KWH", "BATTERY_OVER_5_KWH"],
      }),
    "INCOMPATIBLE_OPTIONS"
  );
});

test("toit plat et sol partagent la même grille mais conservent le type demandé", () => {
  const flat = compute({
    requested_power_wc: 3000,
    installation_type: "FLAT_ROOF",
    electrical_type: "MONO",
  });
  const ground = compute({
    requested_power_wc: 3000,
    installation_type: "GROUND",
    electrical_type: "MONO",
  });
  assert.equal(flat.base_amount_ht_cents, 180000);
  assert.equal(ground.base_amount_ht_cents, 180000);
  assert.equal(flat.installation_type, "FLAT_ROOF");
  assert.equal(ground.installation_type, "GROUND");
  assert.equal(flat.pricing_grid.id, ground.pricing_grid.id);
});

test("override global impose le total final et exige une raison", () => {
  assertDomainCode(
    () =>
      compute({
        requested_power_wc: 3000,
        installation_type: "ROOF_SUPERIMPOSED",
        electrical_type: "MONO",
        manual_override_ht_cents: 199999,
      }),
    "MANUAL_OVERRIDE_REASON_REQUIRED"
  );
  const result = compute({
    requested_power_wc: 3000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
    manual_override_ht_cents: 199999,
    manual_override_reason: "Accord direction",
  });
  assert.equal(result.catalog_total_ht_cents, 160000);
  assert.equal(result.final_total_ht_cents, 199999);
  assert.equal(result.manual_override.reason, "Accord direction");
});

test("une option ancillary n'est pas incluse par computeInstallationCost", () => {
  assertDomainCode(
    () =>
      compute({
        requested_power_wc: 3000,
        installation_type: "ROOF_SUPERIMPOSED",
        electrical_type: "MONO",
        options: ["DIAGNOSTIC_TROUBLESHOOTING"],
      }),
    "UNKNOWN_OPTION"
  );
});

test("historisation: modifier le catalogue après calcul ne change pas le snapshot précédent", () => {
  const before = compute({
    requested_power_wc: 3000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  const changedCatalog = ohelecCatalog({
    tariff_rows: ohelecCatalog().tariff_rows.map((row) =>
      row.pricing_grid_id === "grid-roof" && row.power_wc === 3500
        ? { ...row, amount_ht_cents: 999999 }
        : row
    ),
  });
  const after = compute(
    {
      requested_power_wc: 3000,
      installation_type: "ROOF_SUPERIMPOSED",
      electrical_type: "MONO",
    },
    changedCatalog
  );
  const quoteSnapshot = structuredClone(before);
  assert.equal(quoteSnapshot.final_total_ht_cents, 160000);
  assert.equal(after.final_total_ht_cents, 999999);
});
