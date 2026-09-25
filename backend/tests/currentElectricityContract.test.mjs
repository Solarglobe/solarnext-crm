import test from "node:test";
import assert from "node:assert/strict";
import {
  hydrateLeadWithDefaultMeterFields,
  normalizeElectricitySubscriptionTtcMonth,
  normalizeElectricityAnnualBillTtc,
  syncDefaultMeterFromLeadRow,
  syncLeadFlatFromMeterRow,
  updateLeadMeter,
} from "../services/leadMeters.service.js";
import { resolveCurrentMeterTariffKwh, resolveCurrentMeterOffPeakPeriods } from "../services/economicsResolve.service.js";
import { buildLegacyPayloadFromSolarNext, buildCurrentMeterContractInputs } from "../services/solarnextAdapter.service.js";
import { resolveCurrentElectricityContract } from "../services/electricitySupplyContract.service.js";
import { buildMeterSnapshotRecord, buildMeterCalcDiffLinesFr } from "../services/studyMeterSnapshot.service.js";
import { up } from "../migrations/1790400000000_current_electricity_subscription.js";
import { up as annualBillUp } from "../migrations/1790400100000_current_electricity_annual_bill.js";
import { resolveMeterAnnualConsumptionKwh } from "../services/meterAnnualConsumption.service.js";

function meterDb({ subscription = null, annualBill = null, isDefault = false } = {}) {
  const meter = {
    id: "meter-1", lead_id: "lead-1", organization_id: "org-1", is_default: isDefault,
    electricity_subscription_ttc_month: subscription,
    electricity_annual_bill_ttc: annualBill,
  };
  const lead = { id: "lead-1", organization_id: "org-1" };
  const writes = [];
  return {
    meter, lead, writes,
    async query(sql, args) {
      if (/^\s*SELECT \* FROM lead_meters/.test(sql)) return { rows: [{ ...meter }] };
      if (/^\s*UPDATE (lead_meters|leads) SET/.test(sql)) {
        const target = /^\s*UPDATE lead_meters/.test(sql) ? meter : lead;
        writes.push({ sql, args });
        const assignment = sql.match(/electricity_subscription_ttc_month = \$(\d+)/);
        if (assignment) target.electricity_subscription_ttc_month = args[Number(assignment[1]) - 1];
        const annualAssignment = sql.match(/electricity_annual_bill_ttc = \$(\d+)/);
        if (annualAssignment) target.electricity_annual_bill_ttc = args[Number(annualAssignment[1]) - 1];
        return { rows: [] };
      }
      throw new Error(`Unexpected mocked database query: ${sql}`);
    },
  };
}

test("current subscription preserves unknown, zero and monthly cents, rejects invalid amounts", () => {
  assert.equal(normalizeElectricitySubscriptionTtcMonth(null), null);
  assert.equal(normalizeElectricitySubscriptionTtcMonth(""), null);
  assert.equal(normalizeElectricitySubscriptionTtcMonth(0), 0);
  assert.equal(normalizeElectricitySubscriptionTtcMonth("17.42"), 17.42);
  for (const raw of [-1, Infinity, NaN, true, {}, "invalid", 100000000]) {
    assert.throws(() => normalizeElectricitySubscriptionTtcMonth(raw), { code: "VALIDATION" });
  }
});

test("editing a secondary meter saves and reloads its subscription without changing the lead", async () => {
  const db = meterDb();
  const saved = await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_subscription_ttc_month: 17.42 });
  assert.equal(saved.electricity_subscription_ttc_month, 17.42);
  assert.equal(db.lead.electricity_subscription_ttc_month, undefined);
  assert.deepEqual(db.writes[0].args.slice(-3), ["meter-1", "lead-1", "org-1"]);
  await assert.rejects(
    updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_subscription_ttc_month: -5 }),
    { code: "VALIDATION" },
  );
  assert.equal(db.meter.electricity_subscription_ttc_month, 17.42);
});

test("default meter synchronization preserves a free subscription and clearing it", async () => {
  const db = meterDb({ subscription: 20, isDefault: true });
  await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_subscription_ttc_month: 0 });
  assert.equal(db.meter.electricity_subscription_ttc_month, 0);
  assert.equal(db.lead.electricity_subscription_ttc_month, 0);
  await syncDefaultMeterFromLeadRow(db, { ...db.lead, electricity_subscription_ttc_month: 12.34 });
  assert.equal(db.meter.electricity_subscription_ttc_month, 12.34);
  await syncLeadFlatFromMeterRow(db, { ...db.meter, electricity_subscription_ttc_month: null });
  assert.equal(db.lead.electricity_subscription_ttc_month, null);
});

test("selected meter subscription overrides default lead and reaches snapshot and engine", () => {
  for (const amount of [null, 0, 18.75]) {
    const energyLead = hydrateLeadWithDefaultMeterFields(
      { electricity_subscription_ttc_month: 99 },
      { electricity_subscription_ttc_month: amount },
    );
    const snapshot = buildMeterSnapshotRecord({ energyLead, meterRow: { id: "selected" }, resolvedSelectedMeterId: "selected" });
    assert.equal(snapshot.electricity_subscription_ttc_month, amount);
    const { form } = buildLegacyPayloadFromSolarNext({ lead: energyLead, consommation: {}, installation: {}, options: {} });
    assert.equal(form.params.current_supplier_subscription_ttc_month, amount);
  }
  assert.match(buildMeterCalcDiffLinesFr(
    { electricity_subscription_ttc_month: null },
    { electricity_subscription_ttc_month: 0 },
  ).join("\n"), /Abonnement électricité TTC modifié/);
});

test("selected meter facts remain unknown rather than inherit simulation defaults", () => {
  const cases = [
    [{}, { current_meter_power_kva: null, current_tariff_type: null }],
    [{ meter_power_kva: "12", tariff_type: "hp_hc", hp_hc: false }, { current_meter_power_kva: 12, current_tariff_type: "hp_hc" }],
    [{ meter_power_kva: 6, hp_hc: true }, { current_meter_power_kva: 6, current_tariff_type: "HPHC" }],
    [{ meter_power_kva: 6, hp_hc: false }, { current_meter_power_kva: 6, current_tariff_type: null }],
    [{ meter_power_kva: 6, tariff_type: "base", hp_hc: false }, { current_meter_power_kva: 6, current_tariff_type: "base" }],
    [{ meter_power_kva: 9, hp_hc: null }, { current_meter_power_kva: 9, current_tariff_type: null }],
  ];
  for (const [meter, expected] of cases) {
    const facts = buildCurrentMeterContractInputs(meter);
    assert.deepEqual(facts, expected);
    const { form } = buildLegacyPayloadFromSolarNext({
      lead: { puissance_kva: 9, hp_hc: false, ...facts }, consommation: {}, installation: {}, options: {},
    });
    assert.equal(form.params.current_meter_power_kva, expected.current_meter_power_kva);
    assert.equal(form.params.current_tariff_type, expected.current_tariff_type);
    const result = resolveCurrentElectricityContract({ form });
    const shouldEstimate = expected.current_meter_power_kva != null && expected.current_tariff_type != null;
    assert.equal(result.subscription_is_estimate, shouldEstimate);
    if (!shouldEstimate) assert.equal(result.supplier_subscription_ttc_per_year, null);
  }
});

test("selected meter facts supersede the lead and never persist a derived subscription", () => {
  const selected = hydrateLeadWithDefaultMeterFields(
    { meter_power_kva: 18, tariff_type: "tempo", electricity_subscription_ttc_month: 99 },
    { meter_power_kva: 6, tariff_type: "base", electricity_subscription_ttc_month: null },
  );
  const facts = buildCurrentMeterContractInputs(selected);
  const { form } = buildLegacyPayloadFromSolarNext({
    lead: { ...selected, ...facts }, consommation: {}, installation: {}, options: {},
  });
  const result = resolveCurrentElectricityContract({ form });
  assert.equal(result.supplier_subscription_ttc_per_year, 190.32);
  assert.equal(result.provenance.subscription.reference.meter_kva, 6);
  assert.equal(selected.electricity_subscription_ttc_month, null);
  assert.equal(form.params.current_supplier_subscription_ttc_month, null);
});

test("legacy API payloads retain their explicit power and tariff when fact keys are absent", () => {
  const { form } = buildLegacyPayloadFromSolarNext({
    lead: { puissance_kva: 9, tariff_type: "base" }, consommation: {}, installation: {}, options: {},
  });
  assert.equal(Object.hasOwn(form.params, "current_meter_power_kva"), false);
  assert.equal(Object.hasOwn(form.params, "current_tariff_type"), false);
  assert.equal(resolveCurrentElectricityContract({ form }).supplier_subscription_ttc_per_year, 238.56);
});

test("customer Base tariff wins over older project and organization prices", () => {
  assert.equal(resolveCurrentMeterTariffKwh({
    meter: { tariff_type: "base", elec_price_base_eur_kwh: "0.13" },
    explicitPriceKwh: 0.35, defaultPriceKwh: 0.27,
  }), 0.13);
  assert.equal(resolveCurrentMeterTariffKwh({ meter: {}, explicitPriceKwh: 0.35, defaultPriceKwh: 0.27 }), 0.35);
  assert.equal(resolveCurrentMeterTariffKwh({ meter: {}, defaultPriceKwh: 0.27 }), 0.27);
});

test("active HP/HC prices win over a stale Base price while the flat fallback remains explicit", () => {
  assert.equal(resolveCurrentMeterTariffKwh({
    meter: { hp_hc: true, elec_price_base_eur_kwh: 0.4, elec_price_hp_eur_kwh: 0.3, elec_price_hc_eur_kwh: 0.13 },
    explicitPriceKwh: 0.5, defaultPriceKwh: 0.6,
  }), 0.24333);
});

test("migration adds nullable subscriptions without inventing customer amounts", () => {
  const columns = [];
  up({ addColumns: (table, definition) => columns.push({ table, definition }) });
  assert.deepEqual(columns.map((entry) => entry.table), ["leads", "lead_meters"]);
  for (const { definition } of columns) {
    assert.equal(definition.electricity_subscription_ttc_month.notNull, false);
    assert.equal(definition.electricity_subscription_ttc_month.default, undefined);
  }
});

test("C68 periods reach current contract params independently of the future BV schedule", () => {
  const currentPeriods = [{ start: "22:30", end: "06:30" }];
  for (const energyProfile of [
    { contract: { plage_hc: "HC (22H30-6H30)" } },
    { contract: { off_peak_periods: currentPeriods, plage_hc: "HC (23H-7H)" } },
    { engine: { contract_summary: "HP/HC (22H30-6H30) — 18 kVA — 230/400 V" } },
  ]) {
    const current = resolveCurrentMeterOffPeakPeriods(energyProfile);
    assert.deepEqual(current, currentPeriods);
    for (const futureOption of ["BASE", "HPHC"]) {
      const { form } = buildLegacyPayloadFromSolarNext({
        lead: { current_off_peak_periods: current, supplier_name: "EDF" },
        consommation: {}, installation: {}, options: {},
        virtual_battery_input: { contract_type: futureOption, off_peak_periods: [{ start: "13:00", end: "17:00" }] },
      });
      assert.deepEqual(form.params.current_off_peak_periods, currentPeriods);
      assert.deepEqual(form.params.off_peak_periods, currentPeriods);
      assert.equal(form.params.supplier_name, "EDF");
      assert.deepEqual(form.virtual_battery_input.off_peak_periods, [{ start: "13:00", end: "17:00" }]);
    }
  }
  assert.equal(resolveCurrentMeterOffPeakPeriods({}), null);
});

test("annual bill preserves null and zero, rounds cents, and rejects invalid amounts", () => {
  for (const raw of [null, "", " "]) assert.equal(normalizeElectricityAnnualBillTtc(raw), null);
  assert.equal(normalizeElectricityAnnualBillTtc(0), 0);
  assert.equal(normalizeElectricityAnnualBillTtc("2400.125"), 2400.13);
  for (const raw of [-1, Infinity, NaN, true, {}, "invalid", 10000000000]) {
    assert.throws(() => normalizeElectricityAnnualBillTtc(raw), { code: "VALIDATION" });
  }
});

test("annual bill saves and reloads only the edited meter, preserving manual amounts on profile import", async () => {
  const db = meterDb({ subscription: 20 });
  for (const amount of [2400.12, 0, null]) {
    const saved = await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_annual_bill_ttc: amount });
    assert.equal(saved.electricity_annual_bill_ttc, amount);
    assert.equal(saved.electricity_subscription_ttc_month, 20);
    assert.equal(db.lead.electricity_annual_bill_ttc, undefined);
  }
  await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_annual_bill_ttc: 2400 });
  await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { energy_profile: { engine: { annual_kwh: 10000 } } });
  assert.equal(db.meter.electricity_annual_bill_ttc, 2400);
  await assert.rejects(updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_annual_bill_ttc: -1 }), { code: "VALIDATION" });
  assert.equal(db.meter.electricity_annual_bill_ttc, 2400);
});

test("annual bill synchronizes both ways for the default meter, including clear and zero", async () => {
  const db = meterDb({ annualBill: 2400, isDefault: true });
  await updateLeadMeter(db, "meter-1", "lead-1", "org-1", { electricity_annual_bill_ttc: 0 });
  assert.equal(db.lead.electricity_annual_bill_ttc, 0);
  await syncDefaultMeterFromLeadRow(db, { ...db.lead, electricity_annual_bill_ttc: 2500 });
  assert.equal(db.meter.electricity_annual_bill_ttc, 2500);
  await syncLeadFlatFromMeterRow(db, { ...db.meter, electricity_annual_bill_ttc: null });
  assert.equal(db.lead.electricity_annual_bill_ttc, null);
});

test("selected meter annual bill and its own consumption reach snapshot and contract params", () => {
  for (const amount of [null, 0, 2400]) {
    const energyLead = hydrateLeadWithDefaultMeterFields(
      { electricity_annual_bill_ttc: 9000, consumption_annual_kwh: 50000 },
      { electricity_annual_bill_ttc: amount, electricity_subscription_ttc_month: 20, consumption_annual_kwh: 10000 },
    );
    const snapshot = buildMeterSnapshotRecord({ energyLead, meterRow: { id: "selected" }, resolvedSelectedMeterId: "selected" });
    const annualKwh = resolveMeterAnnualConsumptionKwh({ meter: energyLead });
    const { form } = buildLegacyPayloadFromSolarNext({
      lead: energyLead, consommation: { annuelle_kwh: annualKwh }, installation: {}, options: {},
    });
    assert.equal(snapshot.electricity_annual_bill_ttc, amount);
    assert.equal(form.params.electricity_annual_bill_ttc, amount);
    assert.equal(form.params.current_supplier_subscription_ttc_month, 20);
    assert.equal(form.conso.annuelle_kwh, 10000);
  }
});

test("active monthly and imported annual consumption supersede stale annual input", () => {
  const meter = { consumption_mode: "MONTHLY", consumption_annual_kwh: 50000, consumption_annual_calculated_kwh: 12000 };
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter, monthlyKwh: Array(12).fill(1000) }), 12000);
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter, monthlyKwh: Array(12).fill(null) }), 12000);
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter: { ...meter, consumption_mode: "ANNUAL" } }), 50000);
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter: { ...meter, consumption_mode: "PDL" }, profileAnnualKwh: 10000 }), 10000);
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter: { ...meter, consumption_annual_calculated_kwh: null } }), null);
  assert.equal(resolveMeterAnnualConsumptionKwh({ meter, monthlyKwh: Array(12).fill(0) }), 0);
});

test("annual bill migration is idempotent and adds no invented amount", () => {
  const columns = [];
  annualBillUp({ addColumns: (table, definition, options) => columns.push({ table, definition, options }) });
  assert.deepEqual(columns.map((entry) => entry.table), ["leads", "lead_meters"]);
  for (const { definition, options } of columns) {
    assert.equal(definition.electricity_annual_bill_ttc.notNull, false);
    assert.equal(definition.electricity_annual_bill_ttc.default, undefined);
    assert.equal(options.ifNotExists, true);
  }
});
