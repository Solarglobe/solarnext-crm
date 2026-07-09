/**
 * PDF V2 - Page batterie virtuelle conditionnelle.
 * Usage: node backend/tests/pdfVirtualBatteryPage.test.js
 */

import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function digits(v) {
  return String(v ?? "").replace(/\D/g, "");
}

function buildSnapshot() {
  return {
    scenario_type: "BASE",
    created_at: new Date().toISOString(),
    meta: { client_nom: "Test PDF" },
    client: { full_name: "Nom complet fiche lead", nom: "Client", prenom: "Test", ville: "Nantes", cp: "44000", adresse: "1 rue test" },
    site: { type_reseau: "mono", puissance_compteur_kva: 9, lat: 47.2, lon: -1.55 },
    installation: { puissance_kwc: 6, panneaux_nombre: 12, production_annuelle_kwh: 13457 },
    equipment: {},
    shading: {},
    energy: { consumption_kwh: 15500, production_kwh: 13457, import_kwh: 6266 },
    finance: { capex_ttc: 18000, economie_year_1: 1200, economie_total: 30000, roi_years: 10, irr_pct: 7.2 },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
    cashflows: [],
    assumptions: {},
    form: {},
    conso: { annual_kwh: 15500 },
  };
}

const scenariosV2 = [
  {
    id: "BASE",
    name: "BASE",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      total_pv_used_on_site_kwh: 5000,
      import_kwh: 10500,
      exported_kwh: 8457,
    },
    finance: { capex_ttc: 18000, economie_year_1: 1000, economie_total: 25000, roi_years: 11, annual_cashflows: [] },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  },
  {
    id: "BATTERY_VIRTUAL",
    name: "BATTERY_VIRTUAL",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      battery_discharge_kwh: 4200,
      total_pv_used_on_site_kwh: 9200,
      import_kwh: 6266,
      exported_kwh: 4257,
      site_autonomy_pct: (9200 / 15500) * 100,
      pv_self_consumption_pct: (9200 / 13457) * 100,
    },
    finance: { capex_ttc: 18000, economie_year_1: 1200, economie_total: 30000, roi_years: 10, annual_cashflows: [] },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  },
  {
    id: "BATTERY_PHYSICAL",
    name: "BATTERY_PHYSICAL",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      battery_discharge_kwh: 1389,
      battery_charge_kwh: 1541,
      total_pv_used_on_site_kwh: 6389,
      import_kwh: 9111,
      exported_kwh: 7068,
      site_autonomy_pct: (6389 / 15500) * 100,
      pv_self_consumption_pct: (6389 / 13457) * 100,
    },
    battery: { annual_charge_kwh: 1541, annual_discharge_kwh: 1389 },
    finance: { capex_ttc: 22000, economie_year_1: 1350, economie_total: 32000, roi_years: 12, annual_cashflows: [] },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  },
];

function main() {
  const snapshot = buildSnapshot();

  const vmBase = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BASE",
    scenarios_v2: scenariosV2,
  });
  assert(vmBase.client?.name === "Nom complet fiche lead", "PDF client name must prefer lead detail full_name over stale meta.client_nom");
  assert(vmBase.fullReport?.p7_virtual_battery == null, "BASE: virtual battery page must be absent");

  const vmVirtual = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: scenariosV2,
  });
  const page = vmVirtual.fullReport?.p7_virtual_battery;
  assert(page != null, "BATTERY_VIRTUAL: virtual battery page must be present");
  assert(page.with_virtual_battery?.pv_total_used_kwh === 9234, "total solar covered must include virtual battery credit");
  assert(page.contribution?.recovered_kwh === 4200, "recovered energy must come from battery_discharge_kwh");

  const vmPhysical = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_PHYSICAL",
    scenarios_v2: scenariosV2,
  });
  assert(
    vmPhysical.fullReport?.p4?.restitution_batterie_kwh === 1389,
    "P4 physical battery restitution must come from energy.battery_discharge_kwh"
  );
  assert(
    vmPhysical.fullReport?.p4?.pertes_batterie_kwh === 152,
    "P4 physical battery losses must use charge - discharge"
  );

  const legacyPhysicalSnapshot = {
    ...snapshot,
    scenario_type: "BATTERY_PHYSICAL",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      total_pv_used_on_site_kwh: 6389,
      autoconsumption_kwh: 6389,
      import_kwh: 9111,
      surplus_kwh: 7068,
    },
    finance: { ...snapshot.finance, capex_ttc: 22000 },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  };
  const vmLegacyPhysical = mapSelectedScenarioSnapshotToPdfViewModel(legacyPhysicalSnapshot, {
    selected_scenario_id: "BATTERY_PHYSICAL",
    scenarios_v2: [],
  });
  assert(
    vmLegacyPhysical.fullReport?.p4?.restitution_batterie_kwh === 1389,
    "P4 legacy physical snapshot must infer restitution from total PV used minus direct self-consumption"
  );

  const faverMonthly = [2860, 2340, 1820, 910, 600, 540, 510, 510, 840, 910, 1690, 2470];
  const legacyPhysicalMonthlySnapshot = {
    ...legacyPhysicalSnapshot,
    energy: {
      ...legacyPhysicalSnapshot.energy,
      monthly: faverMonthly.map((conso, i) => ({
        prod: 100 + i * 10,
        conso,
        auto: Math.min(conso, 250 + i * 5),
        surplus: 0,
        import: Math.max(0, conso - (250 + i * 5)),
        batt: i >= 4 && i <= 8 ? 100 : 0,
      })),
    },
  };
  const vmLegacyPhysicalMonthly = mapSelectedScenarioSnapshotToPdfViewModel(legacyPhysicalMonthlySnapshot, {
    selected_scenario_id: "BATTERY_PHYSICAL",
    scenarios_v2: [],
  });
  assert(
    vmLegacyPhysicalMonthly.fullReport?.p4?.consommation_kwh?.[6] === 510 &&
      vmLegacyPhysicalMonthly.fullReport?.p4?.consommation_kwh?.[7] === 510,
    "P4 legacy physical snapshot must preserve real monthly consumption instead of uniform annual fallback"
  );

  const staleScenarioMonthly = [1900, 1700, 1500, 1200, 1100, 1040, 1046, 1083, 1100, 1200, 1500, 1631];
  const vmStaleScenarioMonthly = mapSelectedScenarioSnapshotToPdfViewModel(
    {
      ...snapshot,
      study_meter: {
        snapshot: {
          consumption_monthly: faverMonthly.map((kwh, i) => ({ month: i + 1, kwh })),
        },
      },
    },
    {
      selected_scenario_id: "BATTERY_PHYSICAL",
      scenarios_v2: [
        {
          ...scenariosV2[2],
          energy: {
            ...scenariosV2[2].energy,
            consumption_kwh: 16000,
            monthly: staleScenarioMonthly.map((conso, i) => ({
              prod: 450 + i * 20,
              conso,
              auto: Math.min(conso, 350),
              surplus: Math.max(0, 450 + i * 20 - 350),
              import: Math.max(0, conso - 350),
              batt: i >= 4 && i <= 8 ? 100 : 0,
            })),
          },
        },
      ],
    }
  );
  assert(
    vmStaleScenarioMonthly.fullReport?.p4?.consommation_kwh?.[6] === 510 &&
      vmStaleScenarioMonthly.fullReport?.p4?.consommation_kwh?.[7] === 510 &&
      vmStaleScenarioMonthly.fullReport?.p4?.consommation_kwh_source === "official_meter_monthly_override",
    "P4 must prefer official meter monthly totals over stale selected scenario monthly data"
  );
  const halfFaverMonthly = faverMonthly.map((kwh) => kwh / 2);
  const vmMetaMonthlyReference = mapSelectedScenarioSnapshotToPdfViewModel(
    {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        conso_monthly_kwh_ref: halfFaverMonthly,
      },
    },
    {
      selected_scenario_id: "BATTERY_PHYSICAL",
      scenarios_v2: [
        {
          ...scenariosV2[2],
          energy: {
            ...scenariosV2[2].energy,
            consumption_kwh: 16000,
            monthly: staleScenarioMonthly.map((conso, i) => ({
              prod: 450 + i * 20,
              conso,
              auto: Math.min(conso, 350),
              surplus: Math.max(0, 450 + i * 20 - 350),
              import: Math.max(0, conso - 350),
              batt: i >= 4 && i <= 8 ? 100 : 0,
            })),
          },
        },
      ],
    }
  );
  assert(
    vmMetaMonthlyReference.fullReport?.p4?.consommation_kwh?.[6] === 255 &&
      vmMetaMonthlyReference.fullReport?.p4?.consommation_kwh_source === "official_meter_monthly_override",
    "P4 must use the stored meter monthly reference even when scenario annual data is stale"
  );

  const vmLegacyInconsistent = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: [
      scenariosV2[0],
      {
        id: "BATTERY_VIRTUAL",
        energy: {
          production_kwh: 9152,
          consumption_kwh: 10200,
          total_pv_used_on_site_kwh: 4733,
          autoconsumption_kwh: 4733,
          energy_solar_used_kwh: 4733,
          import_kwh: 2010,
          energy_grid_import_kwh: 1048,
          billable_import_kwh: 1048,
          site_autonomy_pct: 80.3,
          solar_coverage_pct: 80.3,
          pv_self_consumption_pct: 52,
        },
        finance: { estimated_annual_bill_eur: 392, residual_bill_eur: 392, annual_cashflows: [] },
        production: { annual_kwh: 9152, monthly_kwh: Array(12).fill(763) },
      },
    ],
  });
  const p6Totals = vmLegacyInconsistent.fullReport?.p6?.p6?.totals;
  const p6Series = vmLegacyInconsistent.fullReport?.p6?.p6;
  const p7 = vmLegacyInconsistent.fullReport?.p7;
  assert(Math.round(p6Totals?.solar_used_kwh) === 9152, "P6: solar used kWh includes virtual battery credit");
  assert(Math.round(p6Totals?.grid_import_kwh) === 1048, "P6: import = canonical import");
  assert(Math.round(p6Series?.grid?.reduce((a, b) => a + b, 0)) === 1048, "P6 chart grid series must match canonical import");
  assert(
    Math.round(
      p6Series?.dir?.reduce((a, b) => a + b, 0) +
        p6Series?.bat?.reduce((a, b) => a + b, 0) +
        p6Series?.grid?.reduce((a, b) => a + b, 0)
    ) === 10200,
    "P6 chart stacked series must match annual consumption"
  );
  assert(Math.round(p7?.energy_solar_used_kwh) === 9152, "P7: solar used kWh includes virtual battery credit");
  assert(Math.round(p7?.energy_grid_import_kwh) === 1048, "P7: import = canonical import");
  assert(Math.round(p7?.solar_coverage_pct) === 90, "P7: pct must match solar plus virtual credit");

  const niardLikeSnapshot = {
    ...snapshot,
    scenario_type: "BATTERY_VIRTUAL",
    installation: { puissance_kwc: 7, panneaux_nombre: 14, production_annuelle_kwh: 7873 },
    energy: {
      production_kwh: 7873,
      consumption_kwh: 8421,
      direct_self_consumption_kwh: 2246,
      total_pv_used_on_site_kwh: 2246,
      autoconsumption_kwh: 2246,
      site_solar_or_credit_used_kwh: 7871,
      virtual_battery_discharge_kwh: 5624,
      used_credit_kwh: 5624,
      restored_kwh: 5624,
      import_kwh: 550,
      billable_import_kwh: 550,
      energy_grid_import_kwh: 550,
      surplus_kwh: 11249,
      pv_self_consumption_pct: 28.6,
      solar_coverage_pct: 93.5,
      site_autonomy_pct: 26.7,
    },
    finance: {
      capex_ttc: 12120,
      economie_year_1: 1644,
      economie_total: 60088,
      roi_years: 10,
      irr_pct: 12,
      facture_restante: 107,
      virtual_battery_cost_annual: 619,
      annual_cashflows: Array.from({ length: 25 }, (_, i) => ({
        year: i + 1,
        total_eur: i === 0 ? 918 : 1709,
        cumul_gains_eur: i === 24 ? 54071 : 918 + i * 1709,
        cumul_eur: i === 24 ? 41951 : -12120 + 918 + i * 1709,
      })),
    },
    production: { annual_kwh: 7873, monthly_kwh: Array(12).fill(656) },
    economic_snapshot: { price_eur_kwh: 0.195, elec_growth_pct: 5, horizon_years: 25, oa_rate_eur_kwh: 0.011, capex_ttc: 12120 },
    conso: { annual_kwh: 8421 },
    cashflows: Array.from({ length: 25 }, (_, i) => ({
      year: i + 1,
      gain: i === 0 ? 918 : 1709,
      cumul_gains: i === 24 ? 54071 : 918 + i * 1709,
      cumul: i === 24 ? 41951 : -12120 + 918 + i * 1709,
    })),
  };
  const vmNiardLike = mapSelectedScenarioSnapshotToPdfViewModel(niardLikeSnapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: [],
  });
  assert(vmNiardLike.fullReport?.p1?.p1_auto?.p1_m_auto === "93 %", "P1: needs covered must include virtual credit");
  assert(digits(vmNiardLike.fullReport?.p1?.p1_auto?.p1_m_gain) === "41951", "P1: projected gain must use net cashflow cumul_eur");
  assert(vmNiardLike.fullReport?.p3?.energy_summary?.exported_kwh <= 7873, "P3: valued surplus cannot exceed annual production");
  assert(vmNiardLike.fullReport?.p4?.economie_annee_1 === 916, "P4: year-1 saving must subtract virtual battery service costs");
  assert(Math.round(vmNiardLike.fullReport?.p6?.p6?.totals?.grid_import_kwh) === 550, "P6: virtual battery import must remain 550 kWh, not 0");
  assert(Math.round(vmNiardLike.fullReport?.p7?.energy_grid_import_kwh) === 550, "P7: virtual battery import must remain 550 kWh, not 0");
  assert(Math.round(vmNiardLike.fullReport?.p7?.estimated_annual_bill_eur) === 726, "P7: annual bill must include virtual battery service costs");
  assert(Math.round(vmNiardLike.fullReport?.p7?.p_surplus_valorise) === 5627, "P7: valued surplus must be production minus direct PV, not legacy double counted surplus");
  assert(Math.round(vmNiardLike.fullReport?.p7?.p_surplus_valorise) <= 7873, "P7: valued surplus cannot exceed annual production");
  assert(Math.round(vmNiardLike.fullReport?.p7_virtual_battery?.kpis?.energy_grid_import_kwh) === 550, "P7VB: energy to buy must remain 550 kWh, not 0");
  assert(Math.round(vmNiardLike.fullReport?.p7_virtual_battery?.kpis?.estimated_annual_bill_eur) === 726, "P7VB: bill must include energy purchase plus virtual battery costs");
  assert(vmNiardLike.fullReport?.p9?.scenario?.final_cumul === 41951, "P9: chart final net remains cashflow cumul_eur");
  assert(vmNiardLike.fullReport?.p9?.scenario?.avg_savings_eur_year != null, "P9: average annual savings must be populated from gain cashflows");
  assert(vmNiardLike.fullReport?.p10?.best?.gains_25_eur === 41951, "P10: gain net must align with P9");
  assert(Math.round(vmNiardLike.fullReport?.p10?.best?.autonomy_pct) === 93, "P10: needs covered must include virtual credit");

  console.log("OK - pdfVirtualBatteryPage.test");
}

main();
