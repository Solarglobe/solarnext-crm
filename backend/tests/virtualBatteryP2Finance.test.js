/**
 * Tests P2 tarification batterie virtuelle (sans moteur 8760).
 * node backend/tests/virtualBatteryP2Finance.test.js
 */

import {
  computeVirtualBatteryP2Finance,
  selectMySmartTier,
  urbanBaseEnergyPriceHt,
  splitDischargeHpHc,
  resolveP2ContractType,
} from "../services/virtualBatteryP2Finance.service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 0.02) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function mockVbSim({ discharged = 0, overflow = 0, importKwh = 0, capacityKwh = null }) {
  const hourly = new Array(8760).fill(0);
  hourly[0] = discharged;
  return {
    virtual_battery_total_discharged_kwh: discharged,
    virtual_battery_overflow_export_kwh: overflow,
    grid_import_kwh: importKwh,
    virtual_battery_hourly_discharge_kwh: hourly,
    ...(capacityKwh != null ? { virtual_battery_capacity_kwh: capacityKwh } : {}),
  };
}

function main() {
  console.log("=== virtualBatteryP2Finance.test.js ===\n");

  // Test 1 — Urban Base (9 kVA → grille frontend virtualBatteryTariffs2026 : paliers 3,6,9 = 0.1308)
  {
    const vb = mockVbSim({ discharged: 100 });
    const e = urbanBaseEnergyPriceHt(9);
    assertApprox(e, 0.1308, "Urban BASE palier 9 kVA = LOW (aligné TS)");
    const r = computeVirtualBatteryP2Finance({
      providerCode: "URBAN_SOLAR",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 50,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assertApprox(r.virtual_battery_finance.annual_subscription_ht, 6 * 12 * 1.0, "abo stockage kWc");
    assertApprox(r.virtual_battery_finance.annual_autoproducer_contribution_ht, 9.6, "contribution");
    const expectedDischarge = 100 * (0.1308 + 0.0484);
    assertApprox(r.virtual_battery_finance.annual_virtual_discharge_cost_ht, expectedDischarge, "déstockage");
    console.log("✅ Test 1 Urban Base (9 kVA)");
  }

  // Test 1b — Urban Base 6 kVA (palier LOW)
  {
    assertApprox(urbanBaseEnergyPriceHt(6), 0.1308, "6 kVA LOW");
    assertApprox(urbanBaseEnergyPriceHt(12), 0.1297, "12 kVA HIGH");
    console.log("✅ Test 1b Urban Base paliers 6 / 12 kVA");
  }

  // Test 2 — MyLight MyBattery Base
  {
    const vb = mockVbSim({ discharged: 50 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "MYLIGHT_MYBATTERY",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 40,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assertApprox(r.virtual_battery_finance.annual_subscription_ht, 72, "abo MyBattery");
    assertApprox(r.virtual_battery_finance.annual_activation_fee_ht, 232.5, "activation");
    assertApprox(r.virtual_battery_finance.annual_virtual_discharge_cost_ht, 50 * 0.07925, "déstockage MyBatt");
    console.log("✅ Test 2 MyBattery Base");
  }

  // Test 3 — MySmart capacité contractuelle 300 (required > 300)
  {
    const t = selectMySmartTier(300);
    assert(t.ok, "tier ok");
    assert(t.selected_capacity_kwh === 300, "palier 300");
    const vb = mockVbSim({ discharged: 10, capacityKwh: 300 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "MYLIGHT_MYSMARTBATTERY",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 10,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 900,
      selectedCapacityKwh: 300,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assertApprox(r.virtual_battery_finance.selected_capacity_kwh, 300, "capacité retenue = contractuelle");
    assertApprox(r.virtual_battery_finance.annual_subscription_ht, 22.49 * 12, "abo palier");
    assertApprox(
      r.virtual_battery_finance.annual_autoproducer_contribution_ht,
      9.6 + 2.38 * 10,
      "contrib MySmart"
    );
    assert(r.virtual_battery_finance.annual_virtual_discharge_cost_ht === 0, "déstockage 0");
    assert(
      Array.isArray(r.virtual_battery_finance.notes) &&
        r.virtual_battery_finance.notes.some((n) => String(n).includes("Risque de saturation")),
      "warning saturation présent"
    );
    console.log("✅ Test 3 MySmartBattery capacité contractuelle conservée + warning saturation");
  }

  // Test 3b — MySmart : grille org avec contributionRule explicite (priorité sur legacy P2)
  {
    const vb = mockVbSim({ discharged: 10 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "MYLIGHT_MYSMARTBATTERY",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 10,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 250,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
      virtual_battery_settings: {
        providers: {
          MYLIGHT_MYSMARTBATTERY: {
            capacityTiers: [
              { kwh: 20, abonnement_month_ht: 10.83 },
              { kwh: 100, abonnement_month_ht: 14.16 },
              { kwh: 300, abonnement_month_ht: 22.49 },
            ],
            contributionRule: { a: 3.96, b: 0 },
          },
        },
      },
    });
    assertApprox(r.virtual_battery_finance.annual_autoproducer_contribution_ht, 3.96 * 10, "contrib depuis grille admin");
    assertApprox(r.virtual_battery_finance.annual_subscription_ht, 22.49 * 12, "abo palier grille");
    console.log("✅ Test 3b MySmartBattery grille org (contributionRule)");
  }

  // Test 4 — HPHC sans masque
  {
    const vb = mockVbSim({ discharged: 80 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "URBAN_SOLAR",
      contractType: "HPHC",
      installedKwc: 5,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 20,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assert(r.virtual_battery_finance.hphc_allocation_status === "PARTIAL_HPHC_ALLOCATION", "statut partial");
    assert(r.virtual_battery_finance.annual_virtual_discharge_cost_ht === null, "pas de coût déstockage inventé");
    console.log("✅ Test 4 HPHC sans ventilation");
  }

  // Test 4b — HPHC avec masque
  {
    const d = new Array(8760).fill(0);
    d[0] = 10;
    d[1] = 30;
    const hp = new Array(8760).fill(0);
    hp[0] = 1;
    hp[1] = 0;
    const vb = {
      virtual_battery_total_discharged_kwh: 40,
      virtual_battery_overflow_export_kwh: 0,
      grid_import_kwh: 0,
      virtual_battery_hourly_discharge_kwh: d,
    };
    const sp = splitDischargeHpHc(d, hp);
    assert(sp.ok && sp.discharged_hp_kwh === 10 && sp.discharged_hc_kwh === 30, "split HP/HC");
    const r = computeVirtualBatteryP2Finance({
      providerCode: "URBAN_SOLAR",
      contractType: "HPHC",
      installedKwc: 5,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 20,
      hourlyDischargeKwh: d,
      hphcHourlyIsHp: hp,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assert(r.virtual_battery_finance.hphc_allocation_status === "OK", "HPHC OK");
    const expected =
      10 * (0.1412 + 0.0494) +
      30 * (0.1007 + 0.035);
    assertApprox(r.virtual_battery_finance.annual_virtual_discharge_cost_ht, expected, "coût HPHC ventilé");
    console.log("✅ Test 4b HPHC avec masque");
  }

  // Test 5 — selectMySmartTier > 10 000 kWh
  {
    const t = selectMySmartTier(20000);
    assert(!t.ok && t.reason === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY", "erreur palier");
    console.log("✅ Test 5 dépassement palier MySmart (sélection)");
  }

  // Test 6 — compute P2 MySmart > 10 MWh : pas de virtual_battery_finance
  {
    const vb = mockVbSim({ discharged: 1 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "MYLIGHT_MYSMARTBATTERY",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 12000,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
    });
    assert(r.virtual_battery_finance === null, "pas de finance tarifaire");
    assert(r.provider_tier_status === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY", "statut explicite");
    assert(r.annual_recurring_provider_cost_ttc === null, "aucun montant récurrent inventé");
    console.log("✅ Test 6 MySmart > plafond : finance nulle, statut manquant");
  }

  // Test 7 — contract_type : priorité devis puis hp_hc form/lead (pas de nouveau choix UI)
  {
    assert(resolveP2ContractType({}, {}) === "BASE", "défaut BASE sans signal");
    assert(resolveP2ContractType({ contract_type: "HPHC" }, {}) === "HPHC", "priorité champ devis");
    assert(
      resolveP2ContractType({}, { form: { params: { hp_hc: true } } }) === "HPHC",
      "déduction hp_hc params"
    );
    assert(
      resolveP2ContractType({}, { form: { lead: { hp_hc: true } } }) === "HPHC",
      "déduction lead.hp_hc"
    );
    console.log("✅ Test 7 contract_type résolu sans saisie dédiée produit");
  }

  // Test 8 — offre produit : palier = f(required_kwh issu sim), pas champ utilisateur
  {
    assert(selectMySmartTier(400).ok && selectMySmartTier(400).selected_capacity_kwh === 600, "palier auto");
    console.log("✅ Test 8 logique produit : capacité commerciale dérivée du besoin, pas saisie manuelle");
  }

  // Test 9 — providers: {} : pas de grille exploitable → legacy Urban (TEST 5 lot 3B)
  {
    const vb = mockVbSim({ discharged: 100 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "URBAN_SOLAR",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 50,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
      virtual_battery_settings: { providers: {} },
    });
    assertApprox(r.virtual_battery_finance.annual_autoproducer_contribution_ht, 9.6, "contrib legacy");
    const expectedDischarge = 100 * (0.1308 + 0.0484);
    assertApprox(r.virtual_battery_finance.annual_virtual_discharge_cost_ht, expectedDischarge, "déstockage legacy");
    console.log("✅ Test 9 providers vides → legacy P2");
  }

  // Test 10 — grille org sans ligne kVA : fallback legacy (TEST 4 lot 3B)
  {
    const vb = mockVbSim({ discharged: 50 });
    const r = computeVirtualBatteryP2Finance({
      providerCode: "URBAN_SOLAR",
      contractType: "BASE",
      installedKwc: 6,
      meterKva: 9,
      vbSim: vb,
      unboundedRequiredCapacityKwh: 20,
      hourlyDischargeKwh: vb.virtual_battery_hourly_discharge_kwh,
      hphcHourlyIsHp: null,
      tariffElectricityPerKwh: 0.2,
      oaRatePerKwh: 0.05,
      virtual_battery_settings: {
        providers: {
          URBAN_SOLAR: {
            segments: { PARTICULIER_BASE: { rowsByKva: {} } },
          },
        },
      },
    });
    assertApprox(r.virtual_battery_finance.annual_autoproducer_contribution_ht, 9.6, "ligne absente → legacy");
    assertApprox(r.virtual_battery_finance.annual_virtual_discharge_cost_ht, 50 * (0.1308 + 0.0484), "déstockage legacy");
    console.log("✅ Test 10 ligne kVA absente sous provider → legacy");
  }

  console.log("\n=== Tous les tests P2 finance OK ===");
}

main();
