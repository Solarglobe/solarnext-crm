/** Copy calculated electricity bills into document snapshots, without resolving any tariff. */
export function getScenarioElectricityBilling(scenario) {
  const candidates = [
    scenario?.finance?.electricity_billing,
    scenario?.electricity_billing,
    scenario?.finance?.finance_meta?.electricity_billing,
    scenario?.finance_meta?.electricity_billing,
    scenario?.finance?.finance_meta?.economic_snapshot?.electricity_billing,
    scenario?.economic_snapshot?.electricity_billing,
  ];
  return candidates.find((value) => value && typeof value === "object" && !Array.isArray(value)) ?? null;
}

export function buildScenarioElectricitySnapshotFields(scenario) {
  const source = getScenarioElectricityBilling(scenario);
  if (!source) return { electricity_billing: null, finance: {} };
  const billing = structuredClone(source);
  const incomplete = billing.status === "INCOMPLETE";
  return {
    electricity_billing: billing,
    finance: {
      electricity_billing: structuredClone(billing),
      baseline_annual_bill_eur: incomplete ? null : billing.bill_before_eur ?? null,
      estimated_annual_bill_eur: incomplete ? null : billing.bill_after_eur ?? null,
      residual_bill_eur: incomplete ? null : billing.bill_after_eur ?? null,
      facture_restante: incomplete ? null : billing.bill_after_eur ?? null,
      economie_year_1: incomplete ? null : billing.bill_savings_eur ?? null,
      virtual_battery_cost_annual: billing.virtual_service_cost_eur ?? null,
      ...(incomplete ? { economie_total: null, roi_years: null, irr_pct: null, lcoe: null } : {}),
    },
  };
}
