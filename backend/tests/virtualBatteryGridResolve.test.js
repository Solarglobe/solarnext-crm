/**
 * Résolution grille BV (alignement org / legacy).
 * node backend/tests/virtualBatteryGridResolve.test.js
 */

import {
  vbHasExploitableProviderGrid,
  resolveVirtualBatteryMonthlyFromGrid,
  vbBaseDischargeRatePerKwhFromRow,
  vbPickRowByKvaKey,
} from "../services/pv/virtualBatteryGridResolve.service.js";
import { vbLegacyMySmartAnnualContributionHt } from "../services/pv/virtualBatteryLegacyDefaults.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 0.02) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function main() {
  console.log("=== virtualBatteryGridResolve.test.js ===\n");

  // TEST 3 — providers vide
  assert(vbHasExploitableProviderGrid(null) === false, "null");
  assert(vbHasExploitableProviderGrid({}) === false, "sans providers");
  assert(vbHasExploitableProviderGrid({ providers: {} }) === false, "providers {}");
  assert(vbHasExploitableProviderGrid({ providers: [] }) === false, "providers array");
  assert(
    vbHasExploitableProviderGrid({ providers: { URBAN_SOLAR: { segments: {} } } }) === true,
    "un fournisseur objet"
  );
  assert(resolveVirtualBatteryMonthlyFromGrid({ providers: {} }, {}) === 0, "resolve sur providers vides = 0");
  console.log("✅ TEST 3 providers vide / grille non exploitable");

  // TEST 1 — provider complet Urban (ligne BASE 9 kVA alignée TS)
  const urbanRow = {
    abonnement_per_kwc_month: 1,
    abonnement_fixed_month: 0,
    restitution_energy_eur_per_kwh: 0.1308,
    reseau_eur_per_kwh: 0.0484,
    contribution_eur_per_year: 9.6,
    enabled: true,
  };
  const gridsUrban = {
    providers: {
      URBAN_SOLAR: {
        segments: {
          PARTICULIER_BASE: { rowsByKva: { "9": urbanRow } },
        },
      },
    },
  };
  const mUrban = resolveVirtualBatteryMonthlyFromGrid(gridsUrban, {
    provider: "URBAN_SOLAR",
    contractType: "BASE",
    meterPowerKva: 9,
    pvPowerKwc: 6,
    capacityKwh: undefined,
  });
  assertApprox(mUrban, 6 * 1.0 + 9.6 / 12, "Urban 6 kWc + contrib mensuelle");
  console.log("✅ TEST 1 provider complet (Urban)");

  // TEST 2 — MySmart + contributionRule explicite + capacité 0 (aligné front : pas de défaut 300 kWh)
  const gridsSmart = {
    providers: {
      MYLIGHT_MYSMARTBATTERY: {
        capacityTiers: [
          { kwh: 20, abonnement_month_ht: 10.83 },
          { kwh: 300, abonnement_month_ht: 22.49 },
        ],
        contributionRule: { a: 3.96, b: 0 },
        segments: {},
      },
    },
  };
  const mSmart = resolveVirtualBatteryMonthlyFromGrid(gridsSmart, {
    provider: "MYLIGHT_MYSMARTBATTERY",
    contractType: "BASE",
    meterPowerKva: 10,
    pvPowerKwc: 6,
    capacityKwh: 0,
  });
  const expectContribM = (3.96 * 10) / 12;
  assertApprox(mSmart, 10.83 + expectContribM, "MySmart palier 20 + contrib grille");
  console.log("✅ TEST 2 MySmart rule admin + capacité 0");

  // TEST 4 — segment / kVA manquant
  const mMissing = resolveVirtualBatteryMonthlyFromGrid(
    {
      providers: {
        URBAN_SOLAR: {
          segments: {
            PARTICULIER_BASE: { rowsByKva: {} },
          },
        },
      },
    },
    {
      provider: "URBAN_SOLAR",
      contractType: "BASE",
      meterPowerKva: 9,
      pvPowerKwc: 6,
    }
  );
  assert(mMissing === 0, "pas de ligne kVA → 0");
  console.log("✅ TEST 4 segment/kVA manquant → 0 sans crash");

  // TEST 5 — appel sans notion de grille (objet null)
  assert(
    resolveVirtualBatteryMonthlyFromGrid(null, {
      provider: "URBAN_SOLAR",
      contractType: "BASE",
      meterPowerKva: 9,
      pvPowerKwc: 6,
    }) === 0,
    "grille null → 0"
  );
  console.log("✅ TEST 5 sans settings org cohérent");

  // MySmart sans paliers : contribution seule (aligné front)
  const mSmartNoTiers = resolveVirtualBatteryMonthlyFromGrid(
    {
      providers: {
        MYLIGHT_MYSMARTBATTERY: {
          capacityTiers: [],
          contributionRule: { type: "linear", a: 3.96, b: 0 },
        },
      },
    },
    {
      provider: "MYLIGHT_MYSMARTBATTERY",
      contractType: "BASE",
      meterPowerKva: 10,
      pvPowerKwc: 6,
      capacityKwh: 100,
    }
  );
  assertApprox(mSmartNoTiers, (3.96 * 10) / 12, "MySmart sans tiers = contrib/12");

  // vbPickRowByKvaKey
  const row = vbPickRowByKvaKey({ 9: urbanRow }, "9");
  assert(row === urbanRow, "pick row clé numérique JSON");

  // vbBaseDischargeRatePerKwhFromRow moyenne HP/HC
  const rateAvg = vbBaseDischargeRatePerKwhFromRow({
    restitution_hp_eur_per_kwh: 0.2,
    restitution_hc_eur_per_kwh: 0.1,
    reseau_hp_eur_per_kwh: 0.05,
    reseau_hc_eur_per_kwh: 0.04,
  });
  assertApprox(rateAvg, 0.15 + 0.045, "BASE depuis moyenne HP/HC");

  assertApprox(vbLegacyMySmartAnnualContributionHt(10), 9.6 + 23.8, "legacy MySmart 10 kVA");

  console.log("\n=== Tous les tests virtualBatteryGridResolve OK ===");
}

main();
