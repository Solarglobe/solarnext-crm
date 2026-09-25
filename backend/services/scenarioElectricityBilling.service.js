import { resolveCurrentElectricityContract, resolveVirtualElectricityContract } from './electricitySupplyContract.service.js';
import { buildHpHcHourlyFractions } from './pv/hphcMask.service.js';
import { resolveP2ContractType } from './virtualBatteryP2Finance.service.js';

export const VIRTUAL_SUPPLY_SCENARIOS = new Set(['BATTERY_VIRTUAL', 'BATTERY_HYBRID', 'VEHICLE_V2H_VIRTUAL', 'VEHICLE_V2H_PHYSICAL_VIRTUAL']);
const finite = (v) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const money = (v) => v == null ? null : Math.round(v * 100) / 100;
const series = (v) => Array.isArray(v) && v.length === 8760 ? v : null;
const sum = (v) => v.reduce((a, b) => a + (Number(b) || 0), 0);

export function priceElectricitySeries(values, contract, fallbackKwh = null) {
  if (!contract?.energy_pricing_complete) return null;
  const hourly = series(values);
  if (contract.contract_type === 'BASE') {
    const kwh = hourly ? sum(hourly) : finite(fallbackKwh);
    return kwh == null ? null : kwh * contract.price_base_eur_kwh;
  }
  if (!Array.isArray(contract.off_peak_periods) || !contract.off_peak_periods.length) return null;
  if (!hourly) return finite(fallbackKwh) === 0 ? 0 : null;
  const fractions = buildHpHcHourlyFractions(contract.off_peak_periods);
  return hourly.reduce((total, kwh, h) => total + (Number(kwh) || 0) * (
    fractions[h] * contract.price_hp_eur_kwh + (1 - fractions[h]) * contract.price_hc_eur_kwh
  ), 0);
}

/** Supply only: recovered virtual credits have their own fee in P2 finance. */
export function resolveVirtualSupplyPricing(ctx, vbSim, contractType = null, meterKva = null) {
  const input = ctx.virtual_battery_input ?? {};
  const current = resolveCurrentElectricityContract(ctx);
  const contract = resolveVirtualElectricityContract({
    providerCode: input.provider_code ?? input.provider,
    contractType: contractType ?? resolveP2ContractType(input, ctx),
    meterKva: meterKva ?? ctx.site?.puissance_kva ?? ctx.form?.params?.puissance_kva,
    settings: ctx.settings,
    offPeakPeriods: input.off_peak_periods ?? input.offPeakPeriods ?? current.off_peak_periods,
  });
  const hourly = series(vbSim?.virtual_battery_hourly_grid_import_kwh);
  const kwh = hourly ? sum(hourly) : finite(vbSim?.grid_import_kwh ?? vbSim?.billable_import_kwh);
  const energyCost = priceElectricitySeries(hourly, contract, kwh);
  return { contract, energyCost, priceImport: energyCost == null ? null : kwh > 0 ? energyCost / kwh : 0 };
}

/** One baseline for every scenario. No provider selection may rewrite the lead contract. */
export function attachScenarioElectricityBilling(scenarios, ctx, physicalBattery = null) {
  const current = resolveCurrentElectricityContract(ctx);
  const load = series(ctx.conso?.hourly ?? ctx.conso?.clamped);
  const pv = series(ctx.pv?.hourly);
  const currentEnergy = priceElectricitySeries(load, current, ctx.conso?.total_kwh);
  const currentSubscription = finite(current.supplier_subscription_ttc_per_year);
  const direct = load && pv ? load.map((v, h) => Math.min(v, pv[h])) : null;

  for (const [key, sc] of Object.entries(scenarios)) {
    if (!sc || sc._skipped) continue;
    const virtual = VIRTUAL_SUPPLY_SCENARIOS.has(key);
    const vb = sc._virtualBattery8760;
    const usesPhysical = key === 'BATTERY_PHYSICAL' || key === 'BATTERY_HYBRID';
    const physicalDischarge = usesPhysical ? series(physicalBattery?.batt_discharge_hourly) : null;
    const v2h = sc._electricityHourly;
    const autoHourly = series(v2h?.auto) ?? (direct ? direct.map((v, h) => v + (physicalDischarge?.[h] ?? 0)) : null);
    const importHourly = virtual
      ? series(vb?.virtual_battery_hourly_grid_import_kwh)
      : series(v2h?.import) ?? (load && autoHourly ? load.map((v, h) => Math.max(0, v - autoHourly[h])) : null);
    const importKwh = importHourly ? sum(importHourly) : finite(sc.billable_import_kwh ?? sc.import_kwh ?? sc.energy?.import);
    const supply = virtual ? resolveVirtualSupplyPricing(ctx, vb) : null;
    const after = supply?.contract ?? current;
    const futureSubscription = finite(after.supplier_subscription_ttc_per_year);
    const futureEnergy = virtual ? supply.energyCost : priceElectricitySeries(importHourly, current, importKwh);
    const currentImportEnergy = priceElectricitySeries(importHourly, current, importKwh);
    const autoEnergy = priceElectricitySeries(autoHourly, current);
    const creditHourly = series(vb?.virtual_battery_hourly_discharge_kwh ?? vb?.hourly_discharge);
    const creditEnergy = virtual ? priceElectricitySeries(creditHourly, current) : null;
    const futureConsumptionEnergy = priceElectricitySeries(load, after);
    const futureAutoEnergy = priceElectricitySeries(autoHourly, after);
    const futureCreditEnergy = virtual ? priceElectricitySeries(creditHourly, after) : null;
    const vf = sc.virtual_battery_finance;
    const legacyInitialFee = !vf && virtual ? finite(sc._virtualBatteryQuote?.detail?.fee_fixed_ttc) ?? 0 : 0;
    const rawAnnualCost = virtual ? finite(vf?.annual_total_virtual_cost_ttc ?? sc._virtualBatteryQuote?.annual_cost_ttc) : 0;
    const rawService = rawAnnualCost == null ? null : Math.max(0, rawAnnualCost - legacyInitialFee);
    // This contribution is already part of the new supplier subscription (Urban).
    const includedContribution = virtual && after.subscription_includes_autoproducer_contribution
      ? finite(vf?.annual_autoproducer_contribution_ttc) ?? 0 : 0;
    const service = rawService == null ? null : Math.max(0, rawService - includedContribution);
    const missing = [];
    const invalidCurrentFields = {
      annual_bill_ttc_invalid: 'CURRENT_ANNUAL_BILL_INVALID',
      annual_bill_below_subscription: 'CURRENT_ANNUAL_BILL_BELOW_SUBSCRIPTION',
      annual_consumption_kwh_invalid: 'CURRENT_ANNUAL_CONSUMPTION_INVALID',
      annual_bill_energy_price_invalid: 'CURRENT_ANNUAL_BILL_INVALID',
      current_supplier_subscription_ttc_invalid: 'CURRENT_SUPPLIER_SUBSCRIPTION_INVALID',
    };
    for (const field of current.missingFields ?? []) {
      const invalid = invalidCurrentFields[field];
      if (invalid && !missing.includes(invalid)) missing.push(invalid);
    }
    const currentHoursMissing = current.contract_type === 'HPHC' && !current.off_peak_periods?.length;
    const futureHoursMissing = after.contract_type === 'HPHC' && !after.off_peak_periods?.length;
    // A known HP/HC price cannot be applied without its schedule. Report the
    // missing schedule, rather than asking the user to enter existing prices.
    if (!current.energy_pricing_complete) missing.push('CURRENT_ELECTRICITY_PRICES');
    else if (currentEnergy == null && !currentHoursMissing) missing.push('CURRENT_CONSUMPTION_DATA');
    if (!after.energy_pricing_complete) missing.push('SCENARIO_ELECTRICITY_PRICES');
    else if (futureEnergy == null && !futureHoursMissing) missing.push('SCENARIO_CONSUMPTION_DATA');
    if (currentHoursMissing) missing.push('CURRENT_OFF_PEAK_PERIODS');
    if (futureHoursMissing) missing.push('SCENARIO_OFF_PEAK_PERIODS');
    if (virtual && currentSubscription == null) missing.push('CURRENT_SUPPLIER_SUBSCRIPTION');
    if (virtual && futureSubscription == null) missing.push('SCENARIO_SUPPLIER_SUBSCRIPTION');
    if (service == null) missing.push('VIRTUAL_SERVICE_FEES');
    if (virtual && vf && Object.hasOwn(vf, 'annual_virtual_discharge_cost_ttc') && vf.annual_virtual_discharge_cost_ttc == null) missing.push('VIRTUAL_RESTITUTION_FEES');
    const complete = missing.length === 0;
    const scope = !complete ? 'INCOMPLETE' : currentSubscription == null ? 'ENERGY_ONLY' : 'FULL';
    const beforeBill = currentEnergy == null ? null : currentEnergy + (currentSubscription ?? 0);
    const afterBill = futureEnergy == null || service == null ? null : futureEnergy + (futureSubscription ?? 0) + service;
    const billing = {
      schema_version: 1, status: scope, current_contract: current, scenario_contract: after,
      missing_fields: missing,
      current_energy_bill_eur: money(currentEnergy),
      current_supplier_subscription_eur: currentSubscription,
      scenario_energy_purchase_eur: money(futureEnergy),
      scenario_consumption_energy_eur: futureConsumptionEnergy,
      scenario_effective_auto_price: autoHourly && sum(autoHourly) > 0 && futureAutoEnergy != null ? futureAutoEnergy / sum(autoHourly) : 0,
      scenario_effective_credit_price: creditHourly && sum(creditHourly) > 0 && futureCreditEnergy != null ? futureCreditEnergy / sum(creditHourly) : 0,
      scenario_supplier_subscription_eur: futureSubscription,
      virtual_service_cost_eur: money(service),
      included_autoproducer_contribution_eur: money(includedContribution),
      legacy_initial_service_fee_eur: legacyInitialFee,
      bill_before_eur: complete ? money(beforeBill) : null,
      bill_after_eur: complete ? money(afterBill) : null,
      bill_savings_eur: complete ? money(beforeBill - afterBill) : null,
      supplier_energy_delta_eur: currentImportEnergy == null || futureEnergy == null ? null : money(currentImportEnergy - futureEnergy),
      supplier_subscription_delta_eur: virtual && complete ? currentSubscription - futureSubscription : 0,
      current_effective_import_price: importKwh > 0 && currentImportEnergy != null ? currentImportEnergy / importKwh : 0,
      scenario_effective_import_price: importKwh > 0 && futureEnergy != null ? futureEnergy / importKwh : 0,
    };
    sc.electricity_billing = billing;
    sc.pricing = {
      ...(sc.pricing ?? {}),
      mode: current.contract_type,
      p_eff_conso: currentEnergy != null && load && sum(load) > 0 ? currentEnergy / sum(load) : null,
      p_eff_auto: autoEnergy != null && autoHourly && sum(autoHourly) > 0 ? autoEnergy / sum(autoHourly) : null,
      p_eff_vb: creditEnergy != null && creditHourly && sum(creditHourly) > 0 ? creditEnergy / sum(creditHourly) : null,
      p_eff_import_current: billing.current_effective_import_price,
      p_eff_import: billing.scenario_effective_import_price,
    };
    sc.residual_bill_eur = billing.bill_after_eur;
    if (virtual && vf) {
      vf.annual_grid_import_cost_ttc = money(futureEnergy);
      vf.annual_grid_import_cost_ht = futureEnergy == null ? null : money(futureEnergy / 1.2);
      vf.annual_supplier_subscription_ttc = futureSubscription;
      vf.annual_service_cost_excluding_supplier_ttc = money(service);
      vf.supply_contract = after;
    }
    if (virtual && sc.costs) sc.costs.battery_virtual_annual_cost = money(service);
    delete sc._electricityHourly;
  }

  const base = scenarios.BASE?.electricity_billing;
  for (const [key, sc] of Object.entries(scenarios)) {
    if (!VIRTUAL_SUPPLY_SCENARIOS.has(key) || !sc?.electricity_billing) continue;
    const billing = sc.electricity_billing;
    const delta = base?.status !== 'INCOMPLETE' && billing.status !== 'INCOMPLETE' && base?.bill_after_eur != null
      ? money(billing.bill_after_eur - base.bill_after_eur) : null;
    sc.virtual_battery_business = {
      ...(sc.virtual_battery_business ?? {}),
      annual_cost_delta_vs_base_ttc: delta,
      annual_savings_vs_base_ttc: delta == null ? null : -delta,
      comparison_scope: 'electricity_bills_including_supplier_subscriptions',
    };
  }
}
