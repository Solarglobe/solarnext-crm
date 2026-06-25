function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

function clamp(v, min, max) {
  const n = num(v);
  if (n == null) return null;
  return Math.min(max, Math.max(min, n));
}

function scenarioId(sc) {
  return sc?.id ?? sc?.name ?? sc?.scenario_type ?? null;
}

function virtualProviderCode(sc) {
  return String(
    sc?.virtual_battery_finance?.provider_code ??
      sc?._virtualBatteryP2?.provider_code ??
      sc?.provider_code ??
      ""
  ).toUpperCase();
}

/**
 * Corrige les vieux snapshots BATTERY_VIRTUAL qui n'exposent que les KPI année 1 / PV direct.
 * La page scénarios lit data_json.scenarios_v2 sans recalcul ; cette réparation évite de réafficher
 * 63 % quand le snapshot contient assez d'information pour inférer le crédit kWh reportable.
 */
function firstNum(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
}

function hasAuthoritativeVirtual8760(sc) {
  if (!sc || typeof sc !== "object") return false;
  const e = sc.energy && typeof sc.energy === "object" ? sc.energy : {};
  const has8760Payload =
    sc.virtual_battery_8760 != null ||
    sc._virtualBattery8760 != null ||
    sc.virtual_battery_rollover?.year1 != null ||
    sc.virtual_battery_rollover?.stabilized != null;
  const hasExplicitCredit =
    firstNum(e.used_credit_kwh, e.restored_kwh, sc.used_credit_kwh, sc.battery_virtual?.restored_kwh) != null;
  const hasExplicitBillable =
    firstNum(e.billable_import_kwh, e.energy_grid_import_kwh, sc.billable_import_kwh) != null;
  return has8760Payload && hasExplicitCredit && hasExplicitBillable;
}

function repairFinanceFromImport(sc, previousImport, repairedImport) {
  const finance = sc.finance && typeof sc.finance === "object" ? sc.finance : {};
  const previousBill = firstNum(
    finance.estimated_annual_bill_eur,
    finance.remaining_bill_eur,
    finance.residual_bill_eur,
    sc.residual_bill_eur
  );
  if (previousBill == null || previousBill <= 0 || previousImport == null || previousImport <= 0) {
    return finance;
  }

  const repairedBill = round2(previousBill * (repairedImport / previousImport));
  if (repairedBill == null || repairedBill >= previousBill) return finance;

  const annualDelta = previousBill - repairedBill;
  const horizonYears = firstNum(
    finance.economie_horizon_years,
    finance.finance_meta?.horizon_years
  ) ?? 25;

  const nextFinance = {
    ...finance,
    estimated_annual_bill_eur: repairedBill,
    remaining_bill_eur: repairedBill,
    residual_bill_eur: repairedBill,
  };

  const ecoY1 = num(finance.economie_year_1);
  if (ecoY1 != null) nextFinance.economie_year_1 = round2(ecoY1 + annualDelta);

  const ecoTotal = num(finance.economie_total ?? finance.total_savings_25y);
  if (ecoTotal != null) {
    const repairedTotal = round2(ecoTotal + annualDelta * horizonYears);
    nextFinance.economie_total = repairedTotal;
    nextFinance.total_savings_25y = repairedTotal;
  }

  nextFinance._display_repair = {
    ...(finance._display_repair && typeof finance._display_repair === "object" ? finance._display_repair : {}),
    previous_annual_bill_eur: round2(previousBill),
    repaired_annual_bill_eur: repairedBill,
    annual_savings_delta_eur: round2(annualDelta),
  };

  return nextFinance;
}

export function repairVirtualScenarioDisplayKpis(sc) {
  if (!sc || typeof sc !== "object") return sc;
  if (scenarioId(sc) !== "BATTERY_VIRTUAL") return sc;
  if (hasAuthoritativeVirtual8760(sc)) return sc;

  const provider = virtualProviderCode(sc);
  if (provider === "MYLIGHT_MYSMARTBATTERY") return sc;

  const energy = sc.energy && typeof sc.energy === "object" ? sc.energy : {};
  const production = num(energy.production_kwh ?? sc.production_kwh ?? sc.prod_kwh);
  const consumption = num(energy.consumption_kwh ?? sc.consumption_kwh ?? sc.conso_kwh);
  if (production == null || production <= 0 || consumption == null || consumption <= 0) return sc;

  const currentImport = num(
    energy.energy_grid_import_kwh ??
      energy.billable_import_kwh ??
      energy.grid_import_kwh ??
      energy.import_kwh ??
      sc.billable_import_kwh ??
      sc.import_kwh
  );
  if (currentImport == null || currentImport <= 0) return sc;

  const stabilized = sc.stabilized ?? sc.virtual_battery_rollover?.stabilized ?? null;
  const stabilizedImport = num(
    stabilized?.grid_import_kwh ??
      stabilized?.import_kwh ??
      stabilized?.billable_import_kwh
  );

  const directOrYear1PvUsed = num(
    energy.energy_solar_used_kwh ??
      energy.total_pv_used_on_site_kwh ??
      energy.autoconsumption_kwh ??
      sc.auto_kwh
  );
  const credited = num(energy.credited_kwh ?? sc.credited_kwh ?? sc.battery_virtual?.credited_kwh);
  const inferredCredit =
    credited != null && credited > 0
      ? credited
      : directOrYear1PvUsed != null && production > directOrYear1PvUsed
        ? production - directOrYear1PvUsed
        : null;

  const repairedImport =
    stabilizedImport != null && stabilizedImport < currentImport
      ? stabilizedImport
      : inferredCredit != null && inferredCredit > 0
        ? Math.max(0, currentImport - inferredCredit)
        : null;
  if (repairedImport == null || repairedImport >= currentImport) return sc;

  const covered = clamp(consumption - repairedImport, 0, Math.min(consumption, production));
  if (covered == null || covered <= directOrYear1PvUsed) return sc;

  const coveragePct = round2((covered / consumption) * 100);
  const pvSelfPct = round2((covered / production) * 100);
  const fixedEnergy = {
    ...energy,
    autoconsumption_kwh: round2(covered),
    total_pv_used_on_site_kwh: round2(covered),
    energy_solar_used_kwh: round2(covered),
    site_solar_or_credit_used_kwh: round2(covered),
    import_kwh: round2(repairedImport),
    billable_import_kwh: round2(repairedImport),
    grid_import_kwh: round2(repairedImport),
    energy_grid_import_kwh: round2(repairedImport),
    credited_kwh: round2(inferredCredit ?? 0),
    restored_kwh: round2(inferredCredit ?? 0),
    used_credit_kwh: round2(inferredCredit ?? 0),
    pv_self_consumption_pct: pvSelfPct,
    self_consumption_pct: pvSelfPct,
    solar_coverage_pct: coveragePct,
    self_production_pct: coveragePct,
    site_autonomy_pct: coveragePct,
  };

  const fixedFinance = repairFinanceFromImport(sc, currentImport, repairedImport);

  return {
    ...sc,
    energy: fixedEnergy,
    finance: fixedFinance,
    residual_bill_eur: fixedFinance.residual_bill_eur ?? sc.residual_bill_eur,
    auto_kwh: round2(covered),
    import_kwh: round2(repairedImport),
    billable_import_kwh: round2(repairedImport),
    self_consumption_pct: pvSelfPct,
    self_production_pct: coveragePct,
    _display_repair: {
      ...(sc._display_repair && typeof sc._display_repair === "object" ? sc._display_repair : {}),
      virtual_battery_stabilized_from_legacy_snapshot: true,
      previous_import_kwh: round2(currentImport),
      inferred_credit_kwh: round2(inferredCredit ?? 0),
    },
  };
}

export function repairScenarioV2DisplayKpis(scenarios) {
  if (!Array.isArray(scenarios)) return scenarios;
  return scenarios.map((sc) => repairVirtualScenarioDisplayKpis(sc));
}
