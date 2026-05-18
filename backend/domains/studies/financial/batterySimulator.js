const HOURS_PER_YEAR = 8760;
const DEFAULT_ANALYSIS_YEARS = 25;

function assertHourly(values, name) {
  if (!Array.isArray(values) || values.length !== HOURS_PER_YEAR) {
    throw new TypeError(`${name} must be an array of ${HOURS_PER_YEAR} kWh values`);
  }
  return values.map((value, index) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      throw new RangeError(`${name}[${index}] must be a finite non-negative number`);
    }
    return numberValue;
  });
}

function finiteNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function finitePositive(value, name) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
  return numberValue;
}

function ratioFromPercent(value, fallbackPercent = 100) {
  const raw = value == null ? fallbackPercent : finiteNumber(value, fallbackPercent);
  if (raw > 1) return Math.max(0, Math.min(1, raw / 100));
  return Math.max(0, Math.min(1, raw));
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function computeBaseline(productionHourlyKwh, consumptionHourlyKwh) {
  const selfConsumptionHourlyKwh = [];
  const injectionHourlyKwh = [];
  const gridImportHourlyKwh = [];

  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    const production = productionHourlyKwh[hour];
    const consumption = consumptionHourlyKwh[hour];
    const direct = Math.min(production, consumption);
    selfConsumptionHourlyKwh.push(direct);
    injectionHourlyKwh.push(Math.max(0, production - consumption));
    gridImportHourlyKwh.push(Math.max(0, consumption - direct));
  }

  const productionKwh = sum(productionHourlyKwh);
  const consumptionKwh = sum(consumptionHourlyKwh);
  const selfConsumptionKwh = sum(selfConsumptionHourlyKwh);

  return {
    productionKwh,
    consumptionKwh,
    selfConsumptionHourlyKwh,
    injectionHourlyKwh,
    gridImportHourlyKwh,
    selfConsumptionKwh,
    injectionKwh: sum(injectionHourlyKwh),
    gridImportKwh: sum(gridImportHourlyKwh),
    selfConsumptionRate: productionKwh > 0 ? selfConsumptionKwh / productionKwh : 0,
    selfSufficiencyRate: consumptionKwh > 0 ? selfConsumptionKwh / consumptionKwh : 0,
  };
}

function resolvePhysicalBatteryConfig(config = {}, capacityMultiplier = 1) {
  const capacityKwh = finitePositive(
    config.usableCapacityKwh ?? config.capacityUsefulKwh ?? config.capacity_kwh,
    "physicalBattery.usableCapacityKwh"
  );
  const dodRatio = ratioFromPercent(config.depthOfDischargePct ?? config.dodPct ?? config.dod_pct, 100);
  const effectiveCapacityKwh = capacityKwh * dodRatio * capacityMultiplier;
  const chargeEfficiency = ratioFromPercent(config.chargeEfficiencyPct ?? config.efficiencyChargePct ?? config.charge_efficiency_pct, 100);
  const dischargeEfficiency = ratioFromPercent(config.dischargeEfficiencyPct ?? config.efficiencyDischargePct ?? config.discharge_efficiency_pct, 100);
  const maxChargeKw = config.maxChargeKw ?? config.max_charge_kw;
  const maxDischargeKw = config.maxDischargeKw ?? config.max_discharge_kw;

  return {
    capacityKwh,
    dodRatio,
    effectiveCapacityKwh,
    chargeEfficiency,
    dischargeEfficiency,
    maxChargeKw: maxChargeKw == null ? Infinity : Math.max(0, finiteNumber(maxChargeKw, 0)),
    maxDischargeKw: maxDischargeKw == null ? Infinity : Math.max(0, finiteNumber(maxDischargeKw, 0)),
    initialSocKwh: Math.max(0, finiteNumber(config.initialSocKwh ?? config.initial_soc_kwh, 0)),
    annualDegradationPct: Math.max(0, finiteNumber(config.annualDegradationPct ?? config.degradationAnnuellePct ?? config.annual_degradation_pct, 0)),
  };
}

function simulatePhysicalYear(productionHourlyKwh, consumptionHourlyKwh, config) {
  const baseline = computeBaseline(productionHourlyKwh, consumptionHourlyKwh);
  const resolved = resolvePhysicalBatteryConfig(config, config.capacityMultiplier ?? 1);
  const capacity = resolved.effectiveCapacityKwh;
  let soc = Math.min(resolved.initialSocKwh, capacity);

  const socHourlyKwh = [];
  const chargeHourlyKwh = [];
  const dischargeHourlyKwh = [];
  const selfConsumptionHourlyKwh = [];
  const injectionHourlyKwh = [];
  const gridImportHourlyKwh = [];

  let chargeInputKwh = 0;
  let storedKwh = 0;
  let dischargedKwh = 0;
  let conversionLossesKwh = 0;

  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    const production = productionHourlyKwh[hour];
    const consumption = consumptionHourlyKwh[hour];
    const direct = Math.min(production, consumption);
    let surplus = Math.max(0, production - consumption);
    let deficit = Math.max(0, consumption - production);

    const chargeFromPv = Math.min(surplus, resolved.maxChargeKw);
    const storable = Math.min(chargeFromPv * resolved.chargeEfficiency, Math.max(0, capacity - soc));
    const pvUsedForCharge = resolved.chargeEfficiency > 0 ? storable / resolved.chargeEfficiency : 0;
    soc += storable;
    surplus -= pvUsedForCharge;
    chargeInputKwh += pvUsedForCharge;
    storedKwh += storable;
    conversionLossesKwh += Math.max(0, pvUsedForCharge - storable);

    const deliverableFromSoc = soc * resolved.dischargeEfficiency;
    const dischargeToLoad = Math.min(deficit, resolved.maxDischargeKw, deliverableFromSoc);
    const socDraw = resolved.dischargeEfficiency > 0 ? dischargeToLoad / resolved.dischargeEfficiency : 0;
    soc -= socDraw;
    deficit -= dischargeToLoad;
    dischargedKwh += dischargeToLoad;
    conversionLossesKwh += Math.max(0, socDraw - dischargeToLoad);

    const selfConsumption = direct + dischargeToLoad;
    selfConsumptionHourlyKwh.push(selfConsumption);
    injectionHourlyKwh.push(Math.max(0, surplus));
    gridImportHourlyKwh.push(Math.max(0, deficit));
    chargeHourlyKwh.push(storable);
    dischargeHourlyKwh.push(dischargeToLoad);
    socHourlyKwh.push(soc);
  }

  const productionKwh = baseline.productionKwh;
  const consumptionKwh = baseline.consumptionKwh;
  const selfConsumptionKwh = sum(selfConsumptionHourlyKwh);
  const selfConsumptionRate = productionKwh > 0 ? selfConsumptionKwh / productionKwh : 0;
  const selfSufficiencyRate = consumptionKwh > 0 ? selfConsumptionKwh / consumptionKwh : 0;

  return {
    ok: true,
    type: "PHYSICAL",
    config: resolved,
    productionKwh: round(productionKwh),
    consumptionKwh: round(consumptionKwh),
    selfConsumptionKwh: round(selfConsumptionKwh),
    selfConsumptionRate,
    selfSufficiencyRate: Math.min(1, selfSufficiencyRate),
    injectionKwh: round(sum(injectionHourlyKwh)),
    gridImportKwh: round(sum(gridImportHourlyKwh)),
    storedAnnualKwh: round(storedKwh),
    chargeInputAnnualKwh: round(chargeInputKwh),
    dischargeAnnualKwh: round(dischargedKwh),
    conversionLossesKwh: round(conversionLossesKwh),
    equivalentCycles: capacity > 0 ? dischargedKwh / capacity : 0,
    socHourlyKwh,
    chargeHourlyKwh,
    dischargeHourlyKwh,
    selfConsumptionHourlyKwh,
    injectionHourlyKwh,
    gridImportHourlyKwh,
    baseline,
    coherence: {
      selfConsumptionNotDegraded: selfConsumptionKwh + 1e-9 >= baseline.selfConsumptionKwh,
      autonomyAtMost100Pct: selfSufficiencyRate <= 1 + 1e-9,
      socWithinBounds: socHourlyKwh.every((value) => value >= -1e-9 && value <= capacity + 1e-9),
    },
  };
}

export function simulatePhysicalBattery8760({ productionHourlyKwh, consumptionHourlyKwh, battery = {}, analysisYears = DEFAULT_ANALYSIS_YEARS }) {
  const production = assertHourly(productionHourlyKwh, "productionHourlyKwh");
  const consumption = assertHourly(consumptionHourlyKwh, "consumptionHourlyKwh");
  const year1 = simulatePhysicalYear(production, consumption, battery);
  const degradationPct = year1.config.annualDegradationPct;
  const years = Math.max(1, Math.floor(finiteNumber(analysisYears, DEFAULT_ANALYSIS_YEARS)));
  const aging = [];

  for (let year = 1; year <= years; year++) {
    const capacityMultiplier = (1 - degradationPct / 100) ** (year - 1);
    const yearly = simulatePhysicalYear(production, consumption, { ...battery, capacityMultiplier });
    aging.push({
      year,
      effectiveCapacityKwh: round(yearly.config.effectiveCapacityKwh),
      selfConsumptionKwh: yearly.selfConsumptionKwh,
      selfConsumptionRate: yearly.selfConsumptionRate,
      selfSufficiencyRate: yearly.selfSufficiencyRate,
      storedAnnualKwh: yearly.storedAnnualKwh,
      dischargeAnnualKwh: yearly.dischargeAnnualKwh,
    });
  }

  return {
    ...year1,
    agingYears: aging,
  };
}

export function simulateVirtualBatteryContract8760({
  productionHourlyKwh,
  consumptionHourlyKwh,
  virtualBattery = {},
  retailElectricityRateEurKwh = 0,
}) {
  const production = assertHourly(productionHourlyKwh, "productionHourlyKwh");
  const consumption = assertHourly(consumptionHourlyKwh, "consumptionHourlyKwh");
  const baseline = computeBaseline(production, consumption);
  const annualCreditCapKwh = finitePositive(
    virtualBattery.annualCapKwh ?? virtualBattery.plafondAnnuelKwh ?? virtualBattery.annual_cap_kwh,
    "virtualBattery.annualCapKwh"
  );
  const creditRateEurKwh = Math.max(0, finiteNumber(virtualBattery.creditRateEurKwh ?? virtualBattery.tauxCreditEurKwh ?? virtualBattery.credit_rate_eur_kwh, 0));

  let creditBalanceKwh = 0;
  let creditedAnnualKwh = 0;
  let usedCreditAnnualKwh = 0;
  const creditBalanceHourlyKwh = [];
  const creditedHourlyKwh = [];
  const usedCreditHourlyKwh = [];
  const billableImportHourlyKwh = [];
  const overflowInjectionHourlyKwh = [];
  const selfConsumptionHourlyKwh = [];

  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    const productionKwh = production[hour];
    const consumptionKwh = consumption[hour];
    const direct = Math.min(productionKwh, consumptionKwh);
    const surplus = Math.max(0, productionKwh - consumptionKwh);
    const deficit = Math.max(0, consumptionKwh - productionKwh);

    const remainingAnnualCredit = Math.max(0, annualCreditCapKwh - creditedAnnualKwh);
    const credited = Math.min(surplus, remainingAnnualCredit);
    creditBalanceKwh += credited;
    creditedAnnualKwh += credited;

    const usedCredit = Math.min(deficit, creditBalanceKwh);
    creditBalanceKwh -= usedCredit;
    usedCreditAnnualKwh += usedCredit;

    creditedHourlyKwh.push(credited);
    usedCreditHourlyKwh.push(usedCredit);
    creditBalanceHourlyKwh.push(creditBalanceKwh);
    billableImportHourlyKwh.push(Math.max(0, deficit - usedCredit));
    overflowInjectionHourlyKwh.push(Math.max(0, surplus - credited));
    selfConsumptionHourlyKwh.push(direct + usedCredit);
  }

  const productionKwh = baseline.productionKwh;
  const consumptionKwh = baseline.consumptionKwh;
  const selfConsumptionKwh = sum(selfConsumptionHourlyKwh);
  const grossImportSavingsEur = usedCreditAnnualKwh * Math.max(0, finiteNumber(retailElectricityRateEurKwh, 0));
  const creditCostEur = usedCreditAnnualKwh * creditRateEurKwh;

  return {
    ok: true,
    type: "VIRTUAL",
    annualCreditCapKwh,
    creditRateEurKwh,
    productionKwh: round(productionKwh),
    consumptionKwh: round(consumptionKwh),
    selfConsumptionKwh: round(selfConsumptionKwh),
    selfConsumptionRate: productionKwh > 0 ? selfConsumptionKwh / productionKwh : 0,
    selfSufficiencyRate: Math.min(1, consumptionKwh > 0 ? selfConsumptionKwh / consumptionKwh : 0),
    creditedAnnualKwh: round(creditedAnnualKwh),
    usedCreditAnnualKwh: round(usedCreditAnnualKwh),
    unusedCreditEndKwh: round(creditBalanceKwh),
    overflowInjectionKwh: round(sum(overflowInjectionHourlyKwh)),
    billableImportKwh: round(sum(billableImportHourlyKwh)),
    grossImportSavingsEur: round(grossImportSavingsEur, 2),
    creditCostEur: round(creditCostEur, 2),
    netEconomicBenefitEur: round(grossImportSavingsEur - creditCostEur, 2),
    creditedHourlyKwh,
    usedCreditHourlyKwh,
    creditBalanceHourlyKwh,
    billableImportHourlyKwh,
    overflowInjectionHourlyKwh,
    selfConsumptionHourlyKwh,
    baseline,
    coherence: {
      selfConsumptionNotDegraded: selfConsumptionKwh + 1e-9 >= baseline.selfConsumptionKwh,
      autonomyAtMost100Pct: consumptionKwh <= 0 || selfConsumptionKwh / consumptionKwh <= 1 + 1e-9,
      creditedWithinAnnualCap: creditedAnnualKwh <= annualCreditCapKwh + 1e-9,
    },
  };
}

export function compareStorageEconomics({ physicalBatteryResult, virtualBatteryResult, physicalBatteryAnnualizedCostEur = 0 }) {
  const physicalBenefit = Math.max(0, finiteNumber(physicalBatteryResult?.baseline?.gridImportKwh, 0) - finiteNumber(physicalBatteryResult?.gridImportKwh, 0));
  const virtualBenefitEur = finiteNumber(virtualBatteryResult?.netEconomicBenefitEur, 0);
  const retailValue = finiteNumber(virtualBatteryResult?.grossImportSavingsEur, 0);
  const physicalValueEur = retailValue > 0 && finiteNumber(virtualBatteryResult?.usedCreditAnnualKwh, 0) > 0
    ? physicalBenefit * (retailValue / finiteNumber(virtualBatteryResult.usedCreditAnnualKwh, 1))
    : 0;

  return {
    physicalNetBenefitEur: round(physicalValueEur - Math.max(0, finiteNumber(physicalBatteryAnnualizedCostEur, 0)), 2),
    virtualNetBenefitEur: round(virtualBenefitEur, 2),
    recommended: physicalValueEur - Math.max(0, finiteNumber(physicalBatteryAnnualizedCostEur, 0)) >= virtualBenefitEur
      ? "PHYSICAL"
      : "VIRTUAL",
  };
}

export function simulateStorageOptions8760(input) {
  const physical = simulatePhysicalBattery8760({
    productionHourlyKwh: input.productionHourlyKwh,
    consumptionHourlyKwh: input.consumptionHourlyKwh,
    battery: input.physicalBattery,
    analysisYears: input.analysisYears,
  });
  const virtual = simulateVirtualBatteryContract8760({
    productionHourlyKwh: input.productionHourlyKwh,
    consumptionHourlyKwh: input.consumptionHourlyKwh,
    virtualBattery: input.virtualBattery,
    retailElectricityRateEurKwh: input.retailElectricityRateEurKwh,
  });

  return {
    physical,
    virtual,
    economicsComparison: compareStorageEconomics({
      physicalBatteryResult: physical,
      virtualBatteryResult: virtual,
      physicalBatteryAnnualizedCostEur: input.physicalBatteryAnnualizedCostEur,
    }),
  };
}

export { HOURS_PER_YEAR, DEFAULT_ANALYSIS_YEARS };
