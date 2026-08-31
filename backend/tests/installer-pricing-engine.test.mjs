import test from "node:test";
import assert from "node:assert/strict";
import { computeInstallationCostFromCatalog } from "../domains/installers/installers.pricing.js";

function ohelecCatalog(overrides = {}) {
  const installer = { id: "installer-ohelec", name: "OHELEC" };
  const tariffVersion = { id: "tariff-v1", version_label: "OHELEC HT V1", status: "ACTIVE" };
  const roofGrid = { id: "grid-roof", code: "OHELEC_ROOF_SUPERIMPOSED_GRID", label: "Toiture" };
  const flatGrid = { id: "grid-flat", code: "OHELEC_FLAT_ROOF_GRID", label: "Toit plat" };
  const groundGrid = { id: "grid-ground", code: "OHELEC_GROUND_GRID", label: "Installation au sol" };
  const mkRow = (pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents) => ({
    pricing_grid_id,
    power_wc,
    panel_count_hint,
    amount_ht_cents,
  });
  const roofPrices = [
    [2000, 140000],
    [2500, 150000],
    [3000, 155000],
    [3500, 160000],
    [4000, 170000],
    [4500, 175000],
    [5000, 180000],
    [5500, 190000],
    [6000, 200000],
    [6500, 210000],
    [7000, 220000],
    [7500, 230000],
    [8000, 240000],
    [8500, 250000],
    [9000, 260000],
    [9500, 270000],
    [10000, 280000],
    [10500, 290000],
    [11000, 300000],
    [11500, 310000],
    [12000, 320000],
    [12500, 330000],
    [13000, 340000],
    [13500, 350000],
    [14000, 360000],
    [14500, 370000],
    [15000, 380000],
  ];
  const flatGroundPrices = [
    [2000, 160000],
    [2500, 170000],
    [3000, 180000],
    [3500, 190000],
    [4000, 200000],
    [4500, 205000],
    [5000, 210000],
    [5500, 220000],
    [6000, 230000],
    [6500, 235000],
    [7000, 240000],
    [7500, 250000],
    [8000, 260000],
    [8500, 265000],
    [9000, 270000],
    [9500, 280000],
    [10000, 290000],
    [10500, 300000],
    [11000, 310000],
    [11500, 320000],
    [12000, 330000],
    [12500, 340000],
    [13000, 350000],
    [13500, 360000],
    [14000, 370000],
    [14500, 380000],
    [15000, 390000],
  ];

  return {
    installer,
    tariff_version: tariffVersion,
    grids: [roofGrid, flatGrid, groundGrid],
    installation_type_mappings: [
      { installation_type: "ROOF_SUPERIMPOSED", pricing_grid_id: roofGrid.id },
      { installation_type: "FLAT_ROOF", pricing_grid_id: flatGrid.id },
      { installation_type: "GROUND", pricing_grid_id: groundGrid.id },
    ],
    tariff_rows: [
      ...roofPrices.map(([power, amount]) => mkRow(roofGrid.id, power, null, amount)),
      ...flatGroundPrices.map(([power, amount]) => mkRow(flatGrid.id, power, null, amount)),
      ...flatGroundPrices.map(([power, amount]) => mkRow(groundGrid.id, power, null, amount)),
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
      {
        code: "GRID_CONNECTION_CONSUEL",
        label: "Raccordement et Consuel",
        category: "ELECTRICAL",
        amount_ht_cents: 35000,
        is_selectable_for_installation: true,
        is_amount_overridable: false,
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

test("la puissance 6300 Wc matche le demi-palier immédiatement supérieur 6500 Wc", () => {
  const result = compute({
    requested_power_wc: 6300,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(result.matched_power_wc, 6500);
  assert.equal(result.base_amount_ht_cents, 210000);
});

test("OHELEC toiture couvre les nouveaux paliers jusqu'a 15 kWc", () => {
  const cases = [
    [6500, 6500, 210000],
    [9500, 9500, 270000],
    [10000, 10000, 280000],
    [12500, 12500, 330000],
    [15000, 15000, 380000],
  ];
  for (const [requested, matched, amount] of cases) {
    const result = compute({
      requested_power_wc: requested,
      installation_type: "ROOF_SUPERIMPOSED",
      electrical_type: "MONO",
    });
    assert.equal(result.matched_power_wc, matched);
    assert.equal(result.base_amount_ht_cents, amount);
  }
});

test("OHELEC toiture prend le premier demi-palier supérieur", () => {
  const cases = [
    [8730, 9000, 260000],
    [10200, 10500, 290000],
    [14600, 15000, 380000],
  ];
  for (const [requested, matched, amount] of cases) {
    const result = compute({
      requested_power_wc: requested,
      installation_type: "ROOF_SUPERIMPOSED",
      electrical_type: "MONO",
    });
    assert.equal(result.matched_power_wc, matched);
    assert.equal(result.base_amount_ht_cents, amount);
  }
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
  assert.notEqual(flat.pricing_grid.id, ground.pricing_grid.id);
});

test("le dernier palier exact est autorisé, au-delà le moteur refuse sans fallback", () => {
  const exact = compute({
    requested_power_wc: 15000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
  });
  assert.equal(exact.matched_power_wc, 15000);
  assert.equal(exact.base_amount_ht_cents, 380000);
  assertDomainCode(
    () =>
      compute({
        requested_power_wc: 15001,
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
  assert.equal(result.final_total_ht_cents, 188333);
});

test("OHELEC toit plat et sol couvrent les demi-paliers jusqu'a 15 kWc", () => {
  const cases = [
    ["FLAT_ROOF", 6500, 6500, 235000],
    ["FLAT_ROOF", 15000, 15000, 390000],
    ["GROUND", 6500, 6500, 235000],
    ["GROUND", 15000, 15000, 390000],
  ];
  for (const [type, requested, matched, amount] of cases) {
    const result = compute({
      requested_power_wc: requested,
      installation_type: type,
      electrical_type: "MONO",
    });
    assert.equal(result.matched_power_wc, matched);
    assert.equal(result.base_amount_ht_cents, amount);
    assert.equal(result.installation_type, type);
  }
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
  assert.equal(result.catalog_total_ht_cents, 155000 + 15000 + 16667 + 35000);
  assert.equal(result.final_total_ht_cents, 155000 + 22000 + 16667 + 35000);
  assert.deepEqual(result.option_overrides, [
    {
      code: "CABLE_AND_CONNECTION",
      catalog_amount_ht_cents: 15000,
      override_amount_ht_cents: 22000,
    },
  ]);
});

test("l'option raccordement et Consuel vaut 350 euros HT en mono et 400 euros HT en tri", () => {
  const mono = compute({
    requested_power_wc: 3000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
    options: ["GRID_CONNECTION_CONSUEL"],
  });
  const tri = compute({
    requested_power_wc: 3000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "TRI",
    options: ["GRID_CONNECTION_CONSUEL"],
  });

  assert.equal(mono.options[0].catalog_amount_ht_cents, 35000);
  assert.equal(mono.options[0].final_amount_ht_cents, 35000);
  assert.equal(mono.final_total_ht_cents, 155000 + 35000);
  assert.equal(tri.options[0].catalog_amount_ht_cents, 40000);
  assert.equal(tri.options[0].final_amount_ht_cents, 40000);
  assert.equal(tri.final_total_ht_cents, 155000 + 25000 + 40000);
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

test("toit plat et sol ont des grilles distinctes et conservent le type demandé", () => {
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
  assert.notEqual(flat.pricing_grid.id, ground.pricing_grid.id);
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
  assert.equal(result.catalog_total_ht_cents, 155000);
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
      row.pricing_grid_id === "grid-roof" && row.power_wc === 3000
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
  assert.equal(quoteSnapshot.final_total_ht_cents, 155000);
  assert.equal(after.final_total_ht_cents, 999999);
});
