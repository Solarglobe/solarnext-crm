import test from 'node:test';
import assert from 'node:assert/strict';
import { attachScenarioElectricityBilling, resolveVirtualSupplyPricing } from '../services/scenarioElectricityBilling.service.js';
import { computeFinance } from '../services/financeService.js';
import { computeVirtualBatteryP2Finance, splitDischargeHpHc } from '../services/virtualBatteryP2Finance.service.js';
import { buildHpHcHourlyFractions } from '../services/pv/hphcMask.service.js';
import { mapScenarioToV2 } from '../services/scenarioV2Mapper.service.js';
import { buildEnergyReference } from '../services/energyReference.service.js';
import { validateStudyScenarioForExport } from '../services/studyExportValidation.service.js';

process.env.NODE_ENV = 'production';
const sum = (values) => values.reduce((a, b) => a + b, 0);
const approx = (actual, expected, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const hours = (fn) => Array.from({ length: 8760 }, (_, i) => fn(i % 24));
const periods = [{ start: '22:30', end: '06:30' }];

function fixture({ currentType = 'hp_hc', virtualType = 'HPHC', cheap = false, subscription = 20, provider = 'URBAN_SOLAR' } = {}) {
  const load = hours(() => 1);
  const pv = hours((h) => h === 12 ? 2 : 0);
  const direct = hours((h) => h === 12 ? 1 : 0);
  const physical = hours((h) => h === 1 ? 0.25 : 0);
  const credit = hours((h) => h === 0 ? 0.5 : 0);
  const prices = cheap ? { elec_price_hp_eur_kwh: 0.08, elec_price_hc_eur_kwh: 0.06, elec_price_base_eur_kwh: 0.07 }
    : { elec_price_hp_eur_kwh: 0.3, elec_price_hc_eur_kwh: 0.13, elec_price_base_eur_kwh: 0.12 };
  const economics = { price_eur_kwh: 0.9, horizon_years: 3, elec_growth_pct: 0, pv_degradation_pct: 0, battery_degradation_pct: 0, maintenance_pct: 0, onduleur_year: 0, onduleur_cost_pct: 0, prime_lt9: 0, prime_gte9: 0, oa_rate_lt_9: 0, oa_rate_gte_9: 0 };
  const ctx = {
    form: { params: { tariff_type: currentType, hp_hc: currentType === 'hp_hc', ...prices, current_supplier_subscription_ttc_month: subscription, current_off_peak_periods: periods, off_peak_periods: periods, puissance_kva: 18, tarif_kwh: 0.9 }, economics },
    conso: { hourly: load }, pv: { hourly: pv, kwc: 6 },
    site: { puissance_kva: 18 },
    virtual_battery_input: { provider_code: provider, contract_type: virtualType, off_peak_periods: periods },
    finance_input: { capex_ttc: 10000, battery_physical_price_ttc: 2000 },
    settings: { economics, economics_raw: economics },
  };
  const scenarios = {};
  for (const key of ['BASE', 'BATTERY_PHYSICAL', 'BATTERY_VIRTUAL', 'BATTERY_HYBRID']) {
    const isPhysical = ['BATTERY_PHYSICAL', 'BATTERY_HYBRID'].includes(key);
    const isVirtual = ['BATTERY_VIRTUAL', 'BATTERY_HYBRID'].includes(key);
    const auto = direct.map((v, h) => v + (isPhysical ? physical[h] : 0));
    const imports = load.map((v, h) => v - auto[h] - (isVirtual ? credit[h] : 0));
    const sc = scenarios[key] = { name: key, _v2: true, kwc: 6, conso_kwh: sum(load), prod_kwh: sum(pv), auto_kwh: sum(auto), import_kwh: sum(imports), surplus_kwh: 0, energy: { import: sum(imports), physical_auto_kwh: sum(auto), physical_grid_import_kwh: sum(load) - sum(auto) }, battery: { annual_discharge_kwh: isPhysical ? sum(physical) : 0 } };
    if (isVirtual) {
      const vb = sc._virtualBattery8760 = { grid_import_kwh: sum(imports), virtual_battery_total_discharged_kwh: sum(credit), virtual_battery_overflow_export_kwh: 0, virtual_battery_hourly_grid_import_kwh: imports, virtual_battery_hourly_discharge_kwh: credit };
      const supply = resolveVirtualSupplyPricing(ctx, vb);
      const p2 = computeVirtualBatteryP2Finance({ providerCode: provider, contractType: virtualType, installedKwc: 6, meterKva: 18, vbSim: vb, unboundedRequiredCapacityKwh: 10, selectedCapacityKwh: 100, hourlyDischargeKwh: credit, hphcHourlyHpFraction: buildHpHcHourlyFractions(periods), tariffElectricityPerKwh: supply.priceImport, oaRatePerKwh: 0 });
      sc.virtual_battery_finance = p2.virtual_battery_finance;
      sc.billable_import_kwh = sum(imports);
      sc.costs = { battery_virtual_annual_cost: p2.annual_recurring_provider_cost_ttc };
    }
  }
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  return { ctx, scenarios, physical };
}

test('one EDF reference; base and physical stay on the lead, virtual and hybrid use Urban', () => {
  const { scenarios } = fixture();
  const baseline = 365 * (16 * 0.3 + 8 * 0.13) + 240;
  for (const sc of Object.values(scenarios)) {
    assert.equal(sc.electricity_billing.status, 'FULL');
    approx(sc.electricity_billing.bill_before_eur, baseline);
  }
  approx(scenarios.BASE.electricity_billing.bill_after_eur, baseline - 365 * 0.3);
  approx(scenarios.BATTERY_PHYSICAL.electricity_billing.bill_after_eur, baseline - 365 * 0.3 - 365 * 0.25 * 0.13);
  const v = scenarios.BATTERY_VIRTUAL.electricity_billing;
  approx(v.scenario_energy_purchase_eur, 365 * (15 * 0.2142 + 7.5 * 0.1589));
  approx(v.scenario_supplier_subscription_eur, 35.68 * 12);
  // Storage 6 kWc, plus 182.5 kWh restitution HC. Autoproducer contribution is in supplier subscription.
  approx(v.virtual_service_cost_eur, 6 * 1.2 * 12 + 182.5 * 0.0945);
  approx(scenarios.BATTERY_HYBRID.electricity_billing.scenario_energy_purchase_eur, v.scenario_energy_purchase_eur - 365 * 0.25 * 0.1589);
});

test('choosing virtual Base leaves both current HP/HC scenarios and common reference unchanged', () => {
  const hphc = fixture().scenarios;
  const base = fixture({ virtualType: 'BASE' }).scenarios;
  assert.deepEqual(base.BASE.electricity_billing, hphc.BASE.electricity_billing);
  assert.deepEqual(base.BATTERY_PHYSICAL.electricity_billing, hphc.BATTERY_PHYSICAL.electricity_billing);
  const v = base.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(v.current_contract.contract_type, 'HPHC');
  assert.equal(v.scenario_contract.contract_type, 'BASE');
  approx(v.scenario_energy_purchase_eur, 365 * 22.5 * 0.1985);
});

test('current Base stays Base when supplier is HP/HC; org/project flat price never overrides lead', () => {
  const { scenarios } = fixture({ currentType: 'base' });
  approx(scenarios.BASE.electricity_billing.bill_before_eur, 8760 * 0.12 + 240);
  approx(scenarios.BASE.electricity_billing.bill_savings_eur, 365 * 0.12);
  assert.equal(scenarios.BATTERY_VIRTUAL.electricity_billing.scenario_contract.price_hc_eur_kwh, 0.1589);
});

test('cheap existing electricity may make virtual savings negative, including long-term projection', async () => {
  const { ctx, scenarios } = fixture({ cheap: true });
  const out = await computeFinance(ctx, scenarios);
  const v = out.scenarios.BATTERY_VIRTUAL;
  assert.ok(v.economie_an1 < 0);
  assert.equal(v.economie_an1, scenarios.BATTERY_VIRTUAL.electricity_billing.bill_savings_eur);
  approx(v.flows[0].electricity_bill_savings_eur, v.economie_an1);
  approx(v.flows[1].electricity_bill_savings_eur, v.economie_an1);
  approx(v.flows[1].total_eur, v.economie_an1);
  assert.equal(v.roi_years, null);
});

test('all three BV providers have their own verified purchase prices', () => {
  const urban = fixture().scenarios.BATTERY_VIRTUAL.electricity_billing;
  for (const provider of ['MYLIGHT_MYBATTERY', 'MYLIGHT_MYSMARTBATTERY']) {
    const v = fixture({ provider }).scenarios.BATTERY_VIRTUAL.electricity_billing;
    assert.equal(v.scenario_contract.price_hc_eur_kwh, 0.1406);
    assert.equal(v.scenario_contract.price_hp_eur_kwh, 0.2386);
    approx(v.scenario_energy_purchase_eur, 365 * (15 * 0.2386 + 7.5 * 0.1406));
    assert.equal(v.bill_before_eur, urban.bill_before_eur);
  }
});

test('unknown subscription cannot silently become zero in a supplier-change comparison', async () => {
  const { ctx, scenarios, physical } = fixture({ subscription: null });
  ctx.form.params.current_meter_power_kva = null;
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  assert.equal(scenarios.BASE.electricity_billing.status, 'ENERGY_ONLY');
  approx(scenarios.BASE.electricity_billing.bill_savings_eur, 109.5);
  assert.equal(scenarios.BATTERY_VIRTUAL.electricity_billing.status, 'INCOMPLETE');
  const out = await computeFinance(ctx, scenarios);
  assert.equal(out.scenarios.BATTERY_VIRTUAL.economie_an1, null);
  assert.equal(out.scenarios.BATTERY_VIRTUAL.flows, null);
  const explicitZero = fixture({ subscription: 0 });
  assert.equal(explicitZero.scenarios.BATTERY_VIRTUAL.electricity_billing.status, 'FULL');
});

test('estimated current subscription completes all scenarios without altering exact energy or future supplier prices', async () => {
  const { ctx, scenarios, physical } = fixture({ subscription: null });
  const baseline = 365 * (16 * 0.3 + 8 * 0.13) + 31.14 * 12;
  for (const sc of Object.values(scenarios)) {
    const bill = sc.electricity_billing;
    assert.equal(bill.status, 'FULL');
    assert.equal(bill.current_contract.source, 'CURRENT_LEAD');
    assert.equal(bill.current_contract.subscription_is_estimate, true);
    approx(bill.current_supplier_subscription_eur, 31.14 * 12);
    approx(bill.bill_before_eur, baseline);
  }
  approx(scenarios.BASE.electricity_billing.bill_savings_eur, 365 * 0.3);
  approx(scenarios.BATTERY_PHYSICAL.electricity_billing.bill_savings_eur, 365 * 0.3 + 365 * 0.25 * 0.13);
  const virtualBefore = scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(virtualBefore.scenario_contract.price_hp_eur_kwh, 0.2142);
  assert.equal(virtualBefore.scenario_contract.price_hc_eur_kwh, 0.1589);
  approx(virtualBefore.scenario_supplier_subscription_eur, 35.68 * 12);
  const out = await computeFinance(ctx, scenarios);
  approx(out.scenarios.BATTERY_VIRTUAL.flows[0].electricity_bill_savings_eur, virtualBefore.bill_savings_eur);
  ctx.form.params.current_supplier_subscription_ttc_month = 20;
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  const manual = scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(manual.current_contract.subscription_is_estimate, false);
  approx(manual.bill_after_eur, virtualBefore.bill_after_eur);
  approx(manual.bill_savings_eur - virtualBefore.bill_savings_eur, (20 - 31.14) * 12);
  approx(scenarios.BASE.electricity_billing.bill_savings_eur, 365 * 0.3);
});

test('unknown current HC schedule cannot use a guessed schedule as a complete bill', () => {
  const { ctx, scenarios, physical } = fixture();
  delete ctx.form.params.current_off_peak_periods;
  delete ctx.form.params.off_peak_periods;
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  assert.equal(scenarios.BASE.electricity_billing.status, 'INCOMPLETE');
  assert.ok(scenarios.BASE.electricity_billing.missing_fields.includes('CURRENT_OFF_PEAK_PERIODS'));
});

test('P2 restitution shares both boundary hours instead of billing nine off-peak hours', () => {
  const split = splitDischargeHpHc(hours(() => 1), null, buildHpHcHourlyFractions(periods));
  assert.equal(split.discharged_hc_kwh, 8 * 365);
  assert.equal(split.discharged_hp_kwh, 16 * 365);
});

test('supplier tariff difference persists on increasing imports when PV production degrades', async () => {
  const { ctx, scenarios } = fixture();
  ctx.form.economics.pv_degradation_pct = 10;
  const out = await computeFinance(ctx, scenarios);
  const v = out.scenarios.BATTERY_VIRTUAL;
  const y1 = v.flows[0], y2 = v.flows[1];
  assert.ok(y2.bill_with_project_energy_eur > y1.bill_with_project_energy_eur);
  assert.notEqual(y2.supplier_tariff_gain_eur, y1.supplier_tariff_gain_eur);
  approx(y2.total_eur, y2.bill_without_project_eur - y2.bill_with_project_and_service_eur);
});

test('computed bills survive the V2 mapping and export validation, including negative savings', async () => {
  const { ctx, scenarios } = fixture({ cheap: true });
  for (const key of ['BASE', 'BATTERY_VIRTUAL']) {
    const reference = buildEnergyReference({ pv: ctx.pv.hourly, load: ctx.conso.hourly, scenarioId: key });
    if (key === 'BATTERY_VIRTUAL') reference.virtual_credit = { opening_kwh: 0, credited_kwh: 365, used_kwh: 182.5, closing_kwh: 182.5 };
    scenarios[key].energy.reference = reference;
  }
  const out = await computeFinance(ctx, scenarios);
  for (const key of ['BASE', 'BATTERY_VIRTUAL']) {
    const mapped = mapScenarioToV2(out.scenarios[key], ctx);
    const result = validateStudyScenarioForExport(mapped, key);
    assert.deepEqual(result.errors, []);
    assert.equal(mapped.finance.estimated_annual_bill_eur, mapped.finance.electricity_billing.bill_after_eur);
    assert.equal(mapped.finance.economie_year_1, mapped.finance.electricity_billing.bill_savings_eur);
    const corrupted = structuredClone(mapped);
    corrupted.finance.annual_cashflows[0].total_eur += 100;
    assert.equal(validateStudyScenarioForExport(corrupted, key).ok, false);
  }
});

test('imports appearing after year one are priced at the new supplier even when original import was zero', async () => {
  const { ctx, scenarios } = fixture({ currentType: 'base', virtualType: 'BASE' });
  ctx.form.params.elec_price_base_eur_kwh = 0.1;
  ctx.form.economics.pv_degradation_pct = 10;
  const v = scenarios.BATTERY_VIRTUAL;
  const used = hours((h) => h === 12 ? 0 : 1);
  v._virtualBattery8760.virtual_battery_hourly_grid_import_kwh = hours(() => 0);
  v._virtualBattery8760.virtual_battery_hourly_discharge_kwh = used;
  v._virtualBattery8760.grid_import_kwh = 0;
  v._virtualBattery8760.virtual_battery_total_discharged_kwh = sum(used);
  v.billable_import_kwh = 0;
  v.import_kwh = 0;
  attachScenarioElectricityBilling(scenarios, ctx);
  const out = await computeFinance(ctx, { BASE: scenarios.BASE, BATTERY_VIRTUAL: v });
  const flows = out.scenarios.BATTERY_VIRTUAL.flows;
  assert.equal(flows[0].bill_with_project_energy_eur, 0);
  // 10% of 8760 kWh becomes uncovered: Urban Base 18kVA, not current EDF 0.10.
  approx(flows[1].bill_with_project_energy_eur, 876 * 0.1985);
  approx(flows[2].bill_with_project_energy_eur, 8760 * (1 - 0.9 ** 2) * 0.1985);
});

test('annual bill average excludes subscription and keeps provider purchases independent', async () => {
  const { ctx, scenarios, physical } = fixture({ currentType: 'base', virtualType: 'BASE' });
  ctx.form.params.elec_price_base_eur_kwh = null;
  ctx.form.params.elec_price_hp_eur_kwh = null;
  ctx.form.params.elec_price_hc_eur_kwh = null;
  ctx.form.params.electricity_annual_bill_ttc = 2400;
  ctx.form.conso = { annuelle_kwh: 10000 };
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  const base = scenarios.BASE.electricity_billing;
  const virtual = scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(base.current_contract.source, 'ANNUAL_BILL_AVERAGE');
  approx(base.current_contract.price_base_eur_kwh, 0.216, 1e-10);
  // Historical invoice consumption defines the rate even when the simulated load differs.
  approx(base.bill_before_eur, 8760 * 0.216 + 240);
  approx(base.bill_savings_eur, 365 * 0.216);
  assert.equal(virtual.bill_before_eur, base.bill_before_eur);
  assert.equal(virtual.scenario_contract.price_base_eur_kwh, 0.1985);
  const out = await computeFinance(ctx, scenarios);
  approx(out.scenarios.BATTERY_VIRTUAL.flows[0].electricity_bill_savings_eur, virtual.bill_savings_eur);
  approx(out.scenarios.BASE.economie_an1, 365 * 0.216);
});

test('annual bill without subscription uses the meter reference and the same baseline in every scenario', async () => {
  const { ctx, scenarios, physical } = fixture({ currentType: 'base', virtualType: 'BASE', subscription: null });
  for (const key of ['elec_price_base_eur_kwh', 'elec_price_hp_eur_kwh', 'elec_price_hc_eur_kwh']) delete ctx.form.params[key];
  ctx.form.params.electricity_annual_bill_ttc = 2400;
  ctx.form.conso = { annuelle_kwh: 8760 };
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  const average = (2400 - 31.14 * 12) / 8760;
  for (const sc of Object.values(scenarios)) {
    const bill = sc.electricity_billing;
    assert.equal(bill.status, 'FULL');
    assert.equal(bill.current_contract.source, 'ANNUAL_BILL_AVERAGE');
    assert.equal(bill.current_contract.subscription_is_estimate, true);
    approx(bill.current_contract.price_base_eur_kwh, average, 1e-10);
    approx(bill.bill_before_eur, 2400);
  }
  const virtual = scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(virtual.scenario_contract.price_base_eur_kwh, 0.1985);
  const out = await computeFinance(ctx, scenarios);
  approx(out.scenarios.BASE.economie_an1, 365 * average);
  approx(out.scenarios.BATTERY_VIRTUAL.flows[0].electricity_bill_savings_eur, virtual.bill_savings_eur);
});

test('consumption without client tariffs uses software price visibly and never changes virtual supplier', () => {
  const { ctx, scenarios, physical } = fixture({ currentType: 'base', virtualType: 'BASE' });
  for (const key of ['elec_price_base_eur_kwh', 'elec_price_hp_eur_kwh', 'elec_price_hc_eur_kwh']) delete ctx.form.params[key];
  ctx.settings.economics.price_eur_kwh = 0.22;
  attachScenarioElectricityBilling(scenarios, ctx, { batt_discharge_hourly: physical });
  const base = scenarios.BASE.electricity_billing;
  const virtual = scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(base.current_contract.source, 'SOFTWARE_ESTIMATE');
  assert.equal(base.current_contract.is_estimate, true);
  approx(base.bill_before_eur, 8760 * 0.22 + 240);
  approx(base.bill_savings_eur, 365 * 0.22);
  assert.equal(virtual.bill_before_eur, base.bill_before_eur);
  assert.equal(virtual.scenario_contract.price_base_eur_kwh, 0.1985);
});
