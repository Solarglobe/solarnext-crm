import test from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentElectricityContract, resolveVirtualElectricityContract } from "../services/electricitySupplyContract.service.js";

const periods = [{ start: "22:30", end: "06:30" }];
const currentCtx = () => ({
  form: { params: {
    tariff_type: "hp_hc", hp_hc: true, supplier_name: "EDF", puissance_kva: 9,
    elec_price_hp_eur_kwh: 0.30, elec_price_hc_eur_kwh: 0.13,
    current_supplier_subscription_ttc_month: 20, current_off_peak_periods: periods,
  } },
});

test("current contract preserves EDF prices and reference when BV option changes", () => {
  const ctx = currentCtx();
  const baseline = resolveCurrentElectricityContract(ctx);
  ctx.virtual_battery_input = { provider_code: "URBAN_SOLAR", contract_type: "BASE", off_peak_periods: [{ start: "12:00", end: "20:00" }] };
  assert.deepEqual(resolveCurrentElectricityContract(ctx), baseline);
  assert.equal(baseline.status, "COMPLETE");
  assert.equal(baseline.price_hp_eur_kwh, 0.30);
  assert.equal(baseline.price_hc_eur_kwh, 0.13);
  assert.equal(baseline.supplier_subscription_ttc_per_year, 240);
});

test("exact current BASE beats software and project prices; missing prices use labelled software estimate", () => {
  const ctx = { form: { params: { tarif_kwh: 0.99 }, lead: { tariff_type: "base", elec_price_base_eur_kwh: 0.17, electricity_subscription_ttc_month: 12 } }, settings: { economics: { price_eur_kwh: 0.88 } } };
  assert.equal(resolveCurrentElectricityContract(ctx).price_base_eur_kwh, 0.17);
  delete ctx.form.lead.elec_price_base_eur_kwh;
  const missing = resolveCurrentElectricityContract(ctx);
  assert.equal(missing.price_base_eur_kwh, 0.88);
  assert.equal(missing.source, "SOFTWARE_ESTIMATE");
  assert.equal(missing.is_estimate, true);
  assert.equal(missing.pricing_quality, "ESTIMATION");
});

test("current missing subscription is explicit and does not erase known energy prices", () => {
  const ctx = currentCtx();
  delete ctx.form.params.current_supplier_subscription_ttc_month;
  ctx.form.params.current_meter_power_kva = null;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.energy_pricing_complete, true);
  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(result.missingFields, ["supplier_subscription_ttc_per_year"]);
});

test("known meter estimates only the missing subscription while preserving exact HP/HC prices", () => {
  const ctx = currentCtx();
  delete ctx.form.params.current_supplier_subscription_ttc_month;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.source, "CURRENT_LEAD");
  assert.equal(result.price_hp_eur_kwh, 0.30);
  assert.equal(result.price_hc_eur_kwh, 0.13);
  assert.equal(result.supplier_subscription_ttc_per_year, 238.56);
  assert.equal(result.subscription_is_estimate, true);
  assert.equal(result.is_estimate, true);
  assert.equal(result.provenance.subscription.source, "EDF_REFERENCE_ESTIMATE");
  assert.equal(result.provenance.subscription.reference.effective_date, "2026-08-01");
  assert.equal(result.provenance.subscription.reference.tariff_type, "HPHC");
});

test("an explicit unknown customer power or option blocks the simulation defaults", () => {
  for (const facts of [
    { current_meter_power_kva: null, current_tariff_type: "BASE" },
    { current_meter_power_kva: 9, current_tariff_type: null },
    { current_meter_power_kva: 9, current_tariff_type: "UNKNOWN" },
    { current_meter_power_kva: 7, current_tariff_type: "BASE" },
  ]) {
    const ctx = { form: { params: { puissance_kva: 9, hp_hc: false, tariff_type: "base", elec_price_base_eur_kwh: 0.17, ...facts } } };
    const result = resolveCurrentElectricityContract(ctx);
    assert.equal(result.supplier_subscription_ttc_per_year, null, JSON.stringify(facts));
    assert.equal(result.subscription_is_estimate, false);
    assert.equal(result.provenance.subscription.source, "MISSING");
    assert.equal(result.price_base_eur_kwh, 0.17);
    assert.equal(result.status, "INCOMPLETE");
  }
});

test("manual subscription and zero override the reference and invalid input is never replaced", () => {
  for (const amount of [0, 12.34]) {
    const ctx = currentCtx();
    ctx.form.params.current_supplier_subscription_ttc_month = amount;
    const result = resolveCurrentElectricityContract(ctx);
    assert.equal(result.supplier_subscription_ttc_per_year, Math.round(amount * 1200) / 100);
    assert.equal(result.subscription_is_estimate, false);
    assert.equal(result.is_estimate, false);
    assert.equal(result.provenance.subscription.source, "CURRENT_LEAD");
  }
  for (const amount of [-1, "invalid", true]) {
    const ctx = currentCtx();
    ctx.form.params.current_supplier_subscription_ttc_month = amount;
    const result = resolveCurrentElectricityContract(ctx);
    assert.equal(result.supplier_subscription_ttc_per_year, null);
    assert.equal(result.subscription_is_estimate, false);
    assert.equal(result.status, "INCOMPLETE");
    assert.ok(result.missingFields.includes("current_supplier_subscription_ttc_invalid"));
  }
});

test("special contracts never become exact BASE/HPHC: estimation preserves original option", () => {
  for (const tariff_type of ["tempo", "Base+Pointe"]) {
    const ctx = currentCtx();
    ctx.form.params.tariff_type = tariff_type;
    const result = resolveCurrentElectricityContract(ctx);
    assert.equal(result.source, "SOFTWARE_ESTIMATE");
    assert.equal(result.is_estimate, true);
    assert.equal(result.price_hp_eur_kwh, null);
    assert.equal(result.provenance.original_tariff_type, tariff_type);
    assert.ok(result.provenance.fallback_reasons.includes("unsupported_original_tariff"));
  }
});

function billCtx() {
  return {
    form: {
      params: { tariff_type: "hp_hc", electricity_annual_bill_ttc: 1440, electricity_subscription_ttc_month: 20, current_off_peak_periods: periods },
      conso: { annuelle_kwh: 6000 },
    },
    settings: { economics: { price_eur_kwh: 0.25 } },
  };
}

test("annual bill average subtracts subscription and keeps reference consumption before future loads", () => {
  const ctx = billCtx();
  ctx.form.lead = { consumption_annual_kwh: 8000 };
  ctx.conso = { total_kwh: 12000, hourly: new Array(8760).fill(12000 / 8760) };
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(result.is_estimate, true);
  assert.equal(result.contract_type, "BASE");
  assert.equal(result.price_base_eur_kwh, 0.20);
  assert.equal(result.price_hp_eur_kwh, null);
  assert.equal(result.supplier_subscription_ttc_per_year, 240);
  assert.equal(result.provenance.annual_consumption_kwh, 6000);
  assert.equal(result.provenance.annual_consumption_source, "form.conso.annuelle_kwh");
  assert.equal(result.provenance.original_contract_type, "HPHC");
  assert.deepEqual(result.off_peak_periods, periods);
  assert.equal(result.price_base_eur_kwh * 6000 + result.supplier_subscription_ttc_per_year, 1440);
});

test("annual bill average subtracts the estimated subscription and preserves its reference", () => {
  const ctx = billCtx();
  delete ctx.form.params.electricity_subscription_ttc_month;
  ctx.form.params.current_meter_power_kva = 9;
  ctx.form.params.current_tariff_type = "HPHC";
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(result.supplier_subscription_ttc_per_year, 238.56);
  assert.equal(result.price_base_eur_kwh, (1440 - 238.56) / 6000);
  assert.equal(result.provenance.annual_subscription_ttc, 238.56);
  assert.equal(result.provenance.annual_consumption_kwh, 6000);
  assert.equal(result.provenance.period_alignment, "ASSUMED_SAME_ANNUAL_PERIOD");
  assert.equal(result.provenance.subscription.source, "EDF_REFERENCE_ESTIMATE");
  assert.equal(result.provenance.subscription.reference.meter_kva, 9);
  assert.equal(result.subscription_is_estimate, true);
  assert.equal(result.status, "COMPLETE");
  ctx.form.params.electricity_annual_bill_ttc = 200;
  const invalid = resolveCurrentElectricityContract(ctx);
  assert.equal(invalid.status, "INCOMPLETE");
  assert.ok(invalid.missingFields.includes("annual_bill_below_subscription"));
});

test("Tempo estimates its own subscription and keeps energy as an annual average", () => {
  const ctx = billCtx();
  delete ctx.form.params.electricity_subscription_ttc_month;
  ctx.form.params.tariff_type = "tempo";
  ctx.form.params.current_tariff_type = "tempo";
  ctx.form.params.current_meter_power_kva = 9;
  ctx.form.params.hp_hc = true;
  ctx.form.params.elec_price_base_eur_kwh = 0.99;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.supplier_subscription_ttc_per_year, 236.40);
  assert.equal(result.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(result.provenance.original_tariff_type, "tempo");
  assert.equal(result.provenance.subscription.reference.tariff_type, "TEMPO");
  assert.equal(result.price_base_eur_kwh, (1440 - 236.40) / 6000);
  assert.equal(result.price_hp_eur_kwh, null);
  assert.equal(result.price_hc_eur_kwh, null);
});

test("exact customer prices take priority over annual bill and software assumptions", () => {
  const ctx = billCtx();
  ctx.form.params.elec_price_hp_eur_kwh = 0.30;
  ctx.form.params.elec_price_hc_eur_kwh = 0.13;
  const exact = resolveCurrentElectricityContract(ctx);
  assert.equal(exact.source, "CURRENT_LEAD");
  assert.equal(exact.is_estimate, false);
  assert.equal(exact.price_hp_eur_kwh, 0.30);
  assert.equal(exact.price_hc_eur_kwh, 0.13);
  assert.equal(exact.pricing_quality, "EXACT");
  ctx.form.params.tariff_type = "base";
  ctx.form.params.elec_price_base_eur_kwh = 0.17;
  assert.equal(resolveCurrentElectricityContract(ctx).price_base_eur_kwh, 0.17);
});

test("a single HP price never gets a silent synthetic HC price", () => {
  const ctx = billCtx();
  ctx.form.params.elec_price_hp_eur_kwh = 0.30;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(result.price_base_eur_kwh, 0.20);
  assert.equal(result.price_hp_eur_kwh, null);
  assert.equal(result.price_hc_eur_kwh, null);
  delete ctx.form.params.electricity_annual_bill_ttc;
  const software = resolveCurrentElectricityContract(ctx);
  assert.equal(software.source, "SOFTWARE_ESTIMATE");
  assert.equal(software.price_base_eur_kwh, 0.25);
  assert.equal(software.price_hp_eur_kwh, null);
  assert.equal(software.price_hc_eur_kwh, null);
});

test("subscription aliases produce the same annual bill average", () => {
  const ctx = billCtx();
  delete ctx.form.params.electricity_subscription_ttc_month;
  ctx.form.params.current_supplier_subscription_ttc_month = 20;
  assert.equal(resolveCurrentElectricityContract(ctx).price_base_eur_kwh, 0.20);
});

test("annual, calculated annual, and historical profile totals have documented priority", () => {
  const ctx = billCtx();
  delete ctx.form.conso.annuelle_kwh;
  ctx.form.lead = { consumption_annual_kwh: 6000, consumption_annual_calculated_kwh: 8000, energy_profile: { engine: { annual_kwh: 10000 }, summary: { annual_kwh: 12000 } } };
  assert.equal(resolveCurrentElectricityContract(ctx).provenance.annual_consumption_kwh, 6000);
  delete ctx.form.lead.consumption_annual_kwh;
  assert.equal(resolveCurrentElectricityContract(ctx).provenance.annual_consumption_kwh, 8000);
  delete ctx.form.lead.consumption_annual_calculated_kwh;
  assert.equal(resolveCurrentElectricityContract(ctx).provenance.annual_consumption_kwh, 10000);
  delete ctx.form.lead.energy_profile.engine.annual_kwh;
  assert.equal(resolveCurrentElectricityContract(ctx).provenance.annual_consumption_kwh, 12000);
});

test("complete monthly and historical hourly kWh can provide the annual denominator", () => {
  const ctx = billCtx();
  delete ctx.form.conso.annuelle_kwh;
  ctx.form.conso.mensuelle = new Array(12).fill(500);
  assert.equal(resolveCurrentElectricityContract(ctx).price_base_eur_kwh, 0.20);
  delete ctx.form.conso.mensuelle;
  ctx.form.conso.hourly = new Array(8760).fill(1);
  const hourly = resolveCurrentElectricityContract(ctx);
  assert.equal(hourly.provenance.annual_consumption_kwh, 8760);
  assert.equal(hourly.price_base_eur_kwh, 1200 / 8760);
});

test("only transformed consumption available does not fabricate a bill average", () => {
  const ctx = billCtx();
  delete ctx.form.conso.annuelle_kwh;
  ctx.conso = { total_kwh: 12000, hourly: new Array(8760).fill(1) };
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.source, "SOFTWARE_ESTIMATE");
  assert.ok(result.provenance.fallback_reasons.includes("annual_consumption_kwh_missing"));
});

test("unknown subscription never turns the whole annual bill into a per-kWh price", () => {
  const ctx = billCtx();
  delete ctx.form.params.electricity_subscription_ttc_month;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.source, "SOFTWARE_ESTIMATE");
  assert.equal(result.price_base_eur_kwh, 0.25);
  assert.equal(result.supplier_subscription_ttc_per_year, null);
  assert.equal(result.status, "INCOMPLETE");
  assert.ok(result.missingFields.includes("supplier_subscription_ttc_per_year"));
});

test("invalid bill, subscription, consumption and bill below subscription cannot be hidden by software fallback", () => {
  const cases = [
    [(ctx) => { ctx.form.params.electricity_annual_bill_ttc = -1; }, "annual_bill_ttc_invalid"],
    [(ctx) => { ctx.form.params.electricity_annual_bill_ttc = "invalid"; }, "annual_bill_ttc_invalid"],
    [(ctx) => { ctx.form.params.electricity_annual_bill_ttc = 200; }, "annual_bill_below_subscription"],
    [(ctx) => { ctx.form.params.electricity_subscription_ttc_month = -20; }, "current_supplier_subscription_ttc_invalid"],
    [(ctx) => { ctx.form.conso.annuelle_kwh = 0; }, "annual_consumption_kwh_invalid"],
    [(ctx) => { ctx.form.conso.annuelle_kwh = -1; }, "annual_consumption_kwh_invalid"],
    [(ctx) => { delete ctx.form.conso.annuelle_kwh; ctx.form.conso.mensuelle = [500, 500]; }, "annual_consumption_kwh_invalid"],
  ];
  for (const [mutate, expected] of cases) {
    const ctx = billCtx();
    mutate(ctx);
    const result = resolveCurrentElectricityContract(ctx);
    assert.equal(result.status, "INCOMPLETE", expected);
    assert.equal(result.energy_pricing_complete, false, expected);
    assert.ok(result.missingFields.includes(expected));
  }
});

test("a bill consisting only of a known subscription permits a zero energy average", () => {
  const ctx = billCtx();
  ctx.form.params.electricity_annual_bill_ttc = 240;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.price_base_eur_kwh, 0);
  assert.equal(result.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(result.status, "COMPLETE");
});

test("software engine fallback is labelled as an assumption, not an official current tariff", () => {
  const result = resolveCurrentElectricityContract({ form: { params: {} } });
  assert.equal(result.source, "SOFTWARE_ESTIMATE");
  assert.equal(result.price_base_eur_kwh, 0.1952);
  assert.equal(result.provenance.software_price_source, "ORG_ECONOMICS_ENGINE_DEFAULTS.price_eur_kwh");
  assert.equal(result.provenance.software_price_is_official_current_tariff, false);
  assert.equal(result.is_estimate, true);
  assert.equal(result.supplier_subscription_ttc_per_year, null);
});

test("current annual bill and software fallbacks never alter a virtual supplier's prices", () => {
  const ctx = billCtx();
  const args = { providerCode: "MYLIGHT_MYBATTERY", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods };
  const virtual = resolveVirtualElectricityContract(args);
  resolveCurrentElectricityContract(ctx);
  ctx.settings.economics.price_eur_kwh = 0.99;
  delete ctx.form.params.electricity_annual_bill_ttc;
  resolveCurrentElectricityContract(ctx);
  assert.deepEqual(resolveVirtualElectricityContract(args), virtual);
});

test("explicit current contract type wins over inconsistent HP/HC checkbox", () => {
  const ctx = currentCtx();
  ctx.form.params.tariff_type = "base";
  ctx.form.params.elec_price_base_eur_kwh = 0.18;
  const result = resolveCurrentElectricityContract(ctx);
  assert.equal(result.contract_type, "BASE");
  assert.equal(result.price_base_eur_kwh, 0.18);
  assert.equal(result.price_hp_eur_kwh, null);
  ctx.form.params.tariff_type = "hp_hc";
  ctx.form.params.hp_hc = false;
  assert.equal(resolveCurrentElectricityContract(ctx).contract_type, "HPHC");
});

test("current HC window comes from current C68, never future periods or BV settings", () => {
  const ctx = currentCtx();
  delete ctx.form.params.current_off_peak_periods;
  ctx.form.lead = { energy_profile: { contract: { plage_hc: "HC (22H30-6H30)", future_off_peak_periods: [{ start: "01:00", end: "09:00" }] } } };
  const result = resolveCurrentElectricityContract(ctx);
  assert.deepEqual(result.off_peak_periods, periods);
});

test("current exact HP/HC contract recovers its imported hours from an engine-only legacy profile", () => {
  const ctx = currentCtx();
  delete ctx.form.params.current_off_peak_periods;
  ctx.form.lead = { energy_profile: { engine: { contract_summary: "HP/HC (22H30-6H30) — 18 kVA — 230/400 V" } } };
  ctx.virtual_battery_input = { contract_type: "HPHC", off_peak_periods: [{ start: "01:00", end: "09:00" }] };
  const result = resolveCurrentElectricityContract(ctx);
  assert.deepEqual(result.off_peak_periods, periods);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.price_hp_eur_kwh, 0.3);
  assert.equal(result.price_hc_eur_kwh, 0.13);
  ctx.form.lead.energy_profile.engine.contract_summary = "HP/HC — 18 kVA";
  const unknown = resolveCurrentElectricityContract(ctx);
  assert.equal(unknown.off_peak_periods, null);
  assert.equal(unknown.status, "INCOMPLETE");
  assert.ok(unknown.missingFields.includes("off_peak_periods"));
});

test("annual bill average keeps recovered meter hours available to a future HP/HC supplier", () => {
  const ctx = billCtx();
  delete ctx.form.params.current_off_peak_periods;
  ctx.form.lead = { energy_profile: { engine: { contract_summary: "HP/HC (22H30-6H30) — 18 kVA — 230/400 V" } } };
  const current = resolveCurrentElectricityContract(ctx);
  assert.equal(current.source, "ANNUAL_BILL_AVERAGE");
  assert.equal(current.contract_type, "BASE");
  assert.deepEqual(current.off_peak_periods, periods);
  const future = resolveVirtualElectricityContract({ providerCode: "URBAN_SOLAR", contractType: "HPHC", meterKva: 18, offPeakPeriods: current.off_peak_periods });
  assert.equal(future.status, "COMPLETE");
  assert.equal(future.price_hp_eur_kwh, 0.2142);
  assert.equal(future.price_hc_eur_kwh, 0.1589);
  assert.deepEqual(future.off_peak_periods, periods);
});

test("Urban supply uses its HP/HC purchases and fixed subscription including contribution", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "URBAN_SOLAR", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.price_hp_eur_kwh, 0.2142);
  assert.equal(result.price_hc_eur_kwh, 0.1589);
  assert.equal(result.supplier_subscription_ttc_per_year, 257.76);
  assert.equal(result.subscription_includes_autoproducer_contribution, true);
  assert.equal(result.effective_date, "2026-08-01");
});

test("Urban BASE resolves exact published kVA and never nearest-power guess", () => {
  assert.equal(resolveVirtualElectricityContract({ providerCode: "URBAN_SOLAR", contractType: "BASE", meterKva: 6 }).price_base_eur_kwh, 0.2001);
  assert.equal(resolveVirtualElectricityContract({ providerCode: "URBAN_SOLAR", contractType: "BASE", meterKva: 9 }).price_base_eur_kwh, 0.1985);
  for (const meterKva of [null, "", 0, 8, 37]) {
    const result = resolveVirtualElectricityContract({ providerCode: "URBAN_SOLAR", contractType: "BASE", meterKva });
    assert.equal(result.energy_pricing_complete, false);
    assert.ok(result.missingFields.includes("meter_kva"));
  }
});

test("Urban custom supply keeps the published contribution inclusion unless explicitly overridden", () => {
  const providerConfig = { electricitySupply: { price_base_eur_kwh: 0.19, supplier_subscription_ttc_per_year: 240 } };
  const args = { providerCode: "URBAN_SOLAR", contractType: "BASE", meterKva: 9, providerConfig };
  assert.equal(resolveVirtualElectricityContract(args).subscription_includes_autoproducer_contribution, true);
  providerConfig.electricitySupply.subscription_includes_autoproducer_contribution = false;
  assert.equal(resolveVirtualElectricityContract(args).subscription_includes_autoproducer_contribution, false);
});

test("both MyLight storage offers use official new-customer supply, not restitution or old-customer prices", () => {
  for (const providerCode of ["MYLIGHT_MYBATTERY", "MYLIGHT_MYSMARTBATTERY"]) {
    const result = resolveVirtualElectricityContract({ providerCode, contractType: "HPHC", meterKva: 9, offPeakPeriods: periods });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.price_hp_eur_kwh, 0.2386);
    assert.equal(result.price_hc_eur_kwh, 0.1406);
    assert.equal(result.supplier_subscription_ttc_per_year, 262.92);
    assert.equal(result.provenance.tariff_case, "NEW_ENEDIS_CUSTOMER");
    assert.ok(result.provenance.source_url.endsWith("aout-2026.pdf"));
  }
});

test("MyLight BASE supports 3 kVA; unavailable 3 kVA HP/HC stays incomplete", () => {
  const base = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "BASE", meterKva: 3 });
  assert.equal(base.price_base_eur_kwh, 0.2001);
  assert.equal(base.supplier_subscription_ttc_per_year, 145.56);
  const hphc = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "HPHC", meterKva: 3, offPeakPeriods: periods });
  assert.equal(hphc.energy_pricing_complete, false);
  assert.equal(hphc.price_hp_eur_kwh, null);
});

test("explicit organisation supply overrides catalogue and preserves TTC values", () => {
  const settings = { pv: { virtual_battery: { providers: { MYLIGHT_MYBATTERY: {
    effectiveDate: "2026-09-01", sourceLabel: "Offre contractuelle vérifiée",
    segments: { PARTICULIER_HPHC: { rowsByKva: { 9: {
      enabled: true, electricity_hp_ttc_per_kwh: 0.25, electricity_hc_ttc_per_kwh: 0.12,
      abonnement_fixed_month_ttc: 22, restitution_hp_ttc_per_kwh: 0.09,
    } } } },
  } } } } };
  const before = JSON.stringify(settings);
  const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods, settings });
  assert.equal(result.price_hp_eur_kwh, 0.25);
  assert.equal(result.price_hc_eur_kwh, 0.12);
  assert.equal(result.supplier_subscription_ttc_per_year, 264);
  assert.equal(result.source, "PROVIDER_ORG");
  assert.equal(result.effective_date, "2026-09-01");
  assert.equal(JSON.stringify(settings), before);
});

test("HP-only override preserves official HC and subscription with per-field provenance", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods, providerConfig: { electricitySupply: { price_hp_eur_kwh: 0.21 } } });
  assert.equal(result.price_hp_eur_kwh, 0.21);
  assert.equal(result.price_hc_eur_kwh, 0.1406);
  assert.equal(result.supplier_subscription_ttc_per_year, 262.92);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.provenance.field_sources.price_hp_eur_kwh, "PROVIDER_ORG");
  assert.equal(result.provenance.field_sources.price_hc_eur_kwh, "PROVIDER_CATALOG");
  assert.equal(result.provenance.catalogue.effective_date, "2026-08-01");
});

test("subscription-only override preserves official purchase prices", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "BASE", meterKva: 9, providerConfig: { segments: { PARTICULIER_BASE: { rowsByKva: { 9: { abonnement_fixed_month_ttc: 15 } } } } } });
  assert.equal(result.source, "PROVIDER_ORG");
  assert.equal(result.supplier_subscription_ttc_per_year, 180);
  assert.equal(result.price_base_eur_kwh, 0.1985);
  assert.equal(result.status, "COMPLETE");
});

test("explicit null or invalid purchase prices remain incomplete while absent fields use the catalogue", () => {
  for (const price of [null, "", -1, false, "invalid"]) {
    const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods, providerConfig: { electricitySupply: { price_hp_eur_kwh: price } } });
    assert.equal(result.price_hp_eur_kwh, null);
    assert.equal(result.price_hc_eur_kwh, 0.1406);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.energy_pricing_complete, false);
    assert.ok(result.missingFields.includes("price_hp_eur_kwh"));
  }
});

test("explicit zero prices and subscription are valid and are not replaced", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "BASE", meterKva: 9, providerConfig: { electricitySupply: { price_base_eur_kwh: 0, supplier_subscription_ttc_per_year: 0 } } });
  assert.equal(result.price_base_eur_kwh, 0);
  assert.equal(result.supplier_subscription_ttc_per_year, 0);
  assert.equal(result.status, "COMPLETE");
});

test("clearing row overrides or an entire supply block restores the exact published contract", () => {
  const args = { providerCode: "MYLIGHT_MYBATTERY", contractType: "BASE", meterKva: 9 };
  const baseline = resolveVirtualElectricityContract(args);
  const row = { abonnement_fixed_month: 14.46, restitution_energy_eur_per_kwh: 0.07925, electricity_base_ttc_per_kwh: 0.18, abonnement_fixed_month_ttc: 15 };
  const providerConfig = { segments: { PARTICULIER_BASE: { rowsByKva: { 9: row } } } };
  assert.equal(resolveVirtualElectricityContract({ ...args, providerConfig }).price_base_eur_kwh, 0.18);
  delete row.electricity_base_ttc_per_kwh;
  delete row.abonnement_fixed_month_ttc;
  assert.deepEqual(resolveVirtualElectricityContract({ ...args, providerConfig }), baseline);
  assert.deepEqual(resolveVirtualElectricityContract({ ...args, providerConfig: { electricitySupply: {} } }), baseline);
});

test("legacy MyLight HT subscription defaults never override the published supply", () => {
  for (const [providerCode, fixedHt] of [["MYLIGHT_MYBATTERY", 14.46], ["MYLIGHT_MYSMARTBATTERY", 0]]) {
    const result = resolveVirtualElectricityContract({ providerCode, contractType: "BASE", meterKva: 9, providerConfig: { segments: { PARTICULIER_BASE: { rowsByKva: { 9: { abonnement_fixed_month: fixedHt, restitution_energy_eur_per_kwh: 0.07925, reseau_eur_per_kwh: 0.0484 } } } } } });
    assert.equal(result.price_base_eur_kwh, 0.1985);
    assert.equal(result.supplier_subscription_ttc_per_year, 238.56);
    assert.equal(result.source, "PROVIDER_CATALOG");
  }
});

test("legacy restitution and virtualEnergy fields never become supply prices", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "MYLIGHT_MYBATTERY", contractType: "BASE", meterKva: 9, tariffGrid: { segments: [{ segmentCode: "PART_BASE", pricing: { kvaRows: [{ kva: 9, virtualEnergy: { ttc: 0.079 }, restitution_energy_ttc_per_kwh: 0.11, subscriptionFixed: { ttc: 1 } }] } }] } });
  assert.equal(result.price_base_eur_kwh, 0.1985);
  assert.equal(result.supplier_subscription_ttc_per_year, 238.56);
  assert.equal(result.source, "PROVIDER_CATALOG");
});

test("catalogue JSON explicit electricity supply is supported for custom providers", () => {
  const tariffGrid = JSON.stringify({ effectiveDate: "2026-09-01", segments: [{ segmentCode: "PART_BASE", pricing: { kvaRows: [{ kva: 9, electricitySupply: { price_base_eur_kwh: 0.18 }, subscriptionFixed: { ttc: 15 } }] } }] });
  const result = resolveVirtualElectricityContract({ providerCode: "CUSTOM", contractType: "BASE", meterKva: 9, tariffGrid });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.price_base_eur_kwh, 0.18);
  assert.equal(result.supplier_subscription_ttc_per_year, 180);
});

test("unknown provider and disabled explicit supply expose missing state", () => {
  const unknown = resolveVirtualElectricityContract({ providerCode: "UNKNOWN", contractType: "BASE", meterKva: 9 });
  assert.equal(unknown.status, "INCOMPLETE");
  assert.equal(unknown.energy_pricing_complete, false);
  const disabled = resolveVirtualElectricityContract({ providerCode: "CUSTOM", contractType: "BASE", meterKva: 9, providerConfig: { enabled: false, electricitySupply: { price_base_eur_kwh: 0.18 } } });
  assert.equal(disabled.energy_pricing_complete, false);
  assert.ok(disabled.missingFields.includes("provider_supply_enabled"));
});

test("unknown provider sparse override cannot borrow the MyLight or Urban catalogue", () => {
  const result = resolveVirtualElectricityContract({ providerCode: "UNKNOWN", contractType: "HPHC", meterKva: 9, offPeakPeriods: periods, providerConfig: { electricitySupply: { price_hp_eur_kwh: 0.21 } } });
  assert.equal(result.price_hp_eur_kwh, 0.21);
  assert.equal(result.price_hc_eur_kwh, null);
  assert.equal(result.supplier_subscription_ttc_per_year, null);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.energy_pricing_complete, false);
});
