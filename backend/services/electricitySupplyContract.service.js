/**
 * Pure resolution of the existing electricity contract and the future BV supply.
 * Storage/restitution prices are deliberately excluded from electricity purchases.
 * Missing customer prices can be explicitly estimated from a bill or software
 * assumptions. These never become the future supplier's electricity offer.
 */
import { resolveUrbanSolarTariffsForDate, urbanSolarTariffReferenceDate } from "../../shared/urbanSolarVirtualBatteryTariffs2026.js";
import { resolveKnownCurrentOffPeakPeriods } from "./pv/hphcMask.service.js";
import { ORG_ECONOMICS_ENGINE_DEFAULTS } from "../config/orgEconomics.common.js";
import { resolveCurrentElectricitySubscription } from "../../shared/currentElectricitySubscription.js";

const MYLIGHT_SOURCE_URL = "https://cdn.prod.website-files.com/65f08fc6f2c52e2310a49dcb/6a60e0055e390a31283b72da_2f4b15b9a34655d2d2e7124cfa11c7ff_GRILLE%20TOUS%20TARIFS%20aout-2026.pdf";

// Official PDF, page 3: general offer for NEW Enedis customers, 01/08/2026.
// Page 4's different HP/HC prices apply to existing customers and are not used.
export const MYLIGHT_ELECTRICITY_SUPPLY_2026_08_01 = Object.freeze({
  effectiveDate: "2026-08-01",
  sourceLabel: "mylight150 — fourniture d'électricité — nouveaux clients Enedis — 01/08/2026, page 3",
  sourceUrl: MYLIGHT_SOURCE_URL,
  priceBaseSmall: 0.2001,
  priceBaseLarge: 0.1985,
  priceHp: 0.2386,
  priceHc: 0.1406,
  subscriptionBaseTtcMonth: Object.freeze({ 3: 12.13, 6: 15.86, 9: 19.88, 12: 23.76, 15: 27.40, 18: 31.14, 24: 39.14, 30: 46.47, 36: 53.88 }),
  subscriptionHphcTtcMonth: Object.freeze({ 6: 17.48, 9: 21.91, 12: 26.19, 15: 30.20, 18: 34.33, 24: 43.14, 30: 51.22, 36: 59.38 }),
});

function numberOrNull(value) {
  if (value == null || typeof value === "boolean" || typeof value === "object" || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function firstValue(...values) {
  return values.find((v) => v != null && v !== "") ?? null;
}

function firstNumber(...values) {
  for (const v of values) {
    const n = numberOrNull(v);
    if (n != null) return n;
  }
  return null;
}

function annualFromMonthly(value) {
  const n = numberOrNull(value);
  return n == null ? null : Math.round(n * 1200) / 100;
}

function normalizeType(value) {
  const token = String(value ?? "").trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (token === "BASE") return "BASE";
  if (["HPHC", "HEURESPLEINESHEURESCREUSES"].includes(token)) return "HPHC";
  return null;
}

function periodsOrNull(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const validTime = (v) => typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!value.every((v) => validTime(v?.start) && validTime(v?.end) && v.start !== v.end)) return null;
  return value.map(({ start, end }) => ({ start, end }));
}

function finish(contract, extraMissing = [], unsupported = false) {
  const priceFields = contract.contract_type === "BASE"
    ? ["price_base_eur_kwh"]
    : contract.contract_type === "HPHC"
      ? ["price_hp_eur_kwh", "price_hc_eur_kwh"]
      : ["contract_type"];
  const energyComplete = contract.contract_type != null && priceFields.every((k) => contract[k] != null);
  const missing = [...extraMissing, ...priceFields.filter((k) => contract[k] == null)];
  if (contract.supplier_subscription_ttc_per_year == null) missing.push("supplier_subscription_ttc_per_year");
  if (contract.contract_type === "HPHC" && !contract.off_peak_periods) missing.push("off_peak_periods");
  const missingFields = [...new Set(missing)];
  return {
    ...contract,
    energy_pricing_complete: energyComplete && !unsupported && !extraMissing.includes("meter_kva"),
    status: unsupported ? "UNSUPPORTED" : missingFields.length ? "INCOMPLETE" : "COMPLETE",
    missingFields,
  };
}

function hasInput(value) {
  return value != null && !(typeof value === "string" && value.trim() === "");
}

/** Historical annual consumption, before simulation of future equipment. */
function currentAnnualConsumption(ctx, lead, read) {
  const profile = lead.energy_profile ?? ctx.energy_profile ?? {};
  const conso = ctx.form?.conso ?? ctx.form?.consommation ?? ctx.consommation ?? {};
  const annual = [
    ["form.conso.annuelle_kwh", ctx.form?.conso?.annuelle_kwh],
    ["lead.consumption_annual_kwh", read("consumption_annual_kwh")],
    ["lead.consumption_annual_calculated_kwh", read("consumption_annual_calculated_kwh")],
    ["energy_profile.engine.annual_kwh", profile.engine?.annual_kwh],
    ["energy_profile.summary.annual_kwh", profile.summary?.annual_kwh],
    ["current_consumption_annual_kwh", read("current_consumption_annual_kwh")],
    ["consommation.annuelle_kwh", conso.annuelle_kwh],
  ];
  for (const [source, raw] of annual) {
    if (!hasInput(raw)) continue;
    const kwh = numberOrNull(raw);
    return { kwh: kwh != null && kwh > 0 ? kwh : null, source, invalid: kwh == null || kwh <= 0 };
  }
  // Only complete kWh series can stand for an annual bill. No scaling of a
  // partial year, raw power values, or ctx.conso (which includes future loads).
  const series = [
    ["form.conso.monthly_kwh_ref", conso.monthly_kwh_ref, [12]],
    ["form.conso.mensuelle", conso.mensuelle, [12]],
    ["current_consumption_monthly_kwh", read("current_consumption_monthly_kwh"), [12]],
    ["form.conso.hourly", conso.hourly, [8760, 8784]],
    ["energy_profile.engine.hourly", profile.engine?.hourly, [8760, 8784]],
    ["energy_profile.hourly", profile.hourly, [8760, 8784]],
  ];
  let invalidSource = null;
  for (const [source, values, lengths] of series) {
    if (!hasInput(values)) continue;
    if (!Array.isArray(values) || !lengths.includes(values.length)) { invalidSource ??= source; continue; }
    const numbers = Array.from(values, numberOrNull);
    if (numbers.some((value) => value == null)) { invalidSource ??= source; continue; }
    const kwh = numbers.reduce((sum, value) => sum + value, 0);
    if (kwh > 0 && Number.isFinite(kwh)) return { kwh, source, invalid: false };
    invalidSource ??= source;
  }
  return { kwh: null, source: invalidSource, invalid: invalidSource != null };
}

/**
 * Current contract only: exact customer prices, then annual energy-bill average,
 * then a labelled software estimate. The BV option never changes the baseline.
 * params.tarif_kwh is deliberately excluded: it may contain a study override.
 */
export function resolveCurrentElectricityContract(ctx = {}) {
  const params = ctx.form?.params ?? ctx.params ?? {};
  const lead = ctx.form?.lead ?? ctx.lead ?? {};
  const energyProfile = lead.energy_profile ?? ctx.energy_profile ?? {};
  const meterContract = energyProfile.contract ?? {};
  const read = (key) => firstValue(params[key], lead[key], ctx[key]);
  const readOwned = (key) => {
    const owner = [params, lead, ctx].find((value) => Object.hasOwn(value, key));
    return { provided: owner != null, value: owner?.[key] };
  };
  const typeRaw = firstValue(read("tariff_type"), meterContract.tariff_type);
  let contractType = normalizeType(typeRaw);
  const hpHc = read("hp_hc");
  if (typeRaw == null) {
    if (hpHc === true || hpHc === "oui" || hpHc === "OUI" || hpHc === "true") contractType = "HPHC";
    else if (hpHc === false || hpHc === "non" || hpHc === "false") contractType = "BASE";
    else if (firstNumber(read("elec_price_base_eur_kwh")) != null) contractType = "BASE";
    else if (firstNumber(read("elec_price_hp_eur_kwh")) != null && firstNumber(read("elec_price_hc_eur_kwh")) != null) contractType = "HPHC";
  }
  const offPeak = periodsOrNull(firstValue(read("current_off_peak_periods"), read("off_peak_periods")))
    ?? resolveKnownCurrentOffPeakPeriods(energyProfile);
  const subscriptionYearRaw = read("current_supplier_subscription_ttc_year");
  const subscriptionMonthRaw = firstValue(read("current_supplier_subscription_ttc_month"), read("electricity_subscription_ttc_month"));
  const currentPower = readOwned("current_meter_power_kva");
  const currentTariff = readOwned("current_tariff_type");
  const subscription = resolveCurrentElectricitySubscription({
    monthly: subscriptionMonthRaw,
    annual: subscriptionYearRaw,
    meterKva: currentPower.provided ? currentPower.value : firstNumber(read("puissance_kva"), read("meter_power_kva")),
    tariffType: currentTariff.provided ? currentTariff.value : typeRaw,
    // An explicit null option must not fall back to the simulation's false flag.
    hpHc: currentTariff.provided ? undefined : hpHc,
  });
  const subscriptionAnnual = subscription.annual;
  const provenance = {
    kind: "CURRENT_LEAD", source_label: "Prix exacts du contrat actuel saisis dans la fiche compteur", price_basis: "TTC",
    original_contract_type: contractType ?? (typeRaw == null ? null : String(typeRaw)),
    original_tariff_type: typeRaw,
    valuation_mode: contractType === "HPHC" ? "HOURLY_HPHC" : contractType === "BASE" ? "BASE" : "UNSUPPORTED",
    subscription,
  };
  const common = {
    provider_code: firstValue(read("supplier_name"), meterContract.supplier_name),
    contract_type: contractType,
    meter_kva: currentPower.provided ? numberOrNull(currentPower.value) : firstNumber(read("puissance_kva"), read("meter_power_kva")),
    price_base_eur_kwh: contractType === "BASE" ? firstNumber(read("elec_price_base_eur_kwh")) : null,
    price_hp_eur_kwh: contractType === "HPHC" ? firstNumber(read("elec_price_hp_eur_kwh")) : null,
    price_hc_eur_kwh: contractType === "HPHC" ? firstNumber(read("elec_price_hc_eur_kwh")) : null,
    supplier_subscription_ttc_per_year: subscriptionAnnual,
    subscription_is_estimate: subscription.isEstimate,
    subscription_includes_autoproducer_contribution: false,
    off_peak_periods: contractType === "HPHC" ? offPeak : null,
    source: "CURRENT_LEAD",
    effective_date: firstValue(read("electricity_tariff_effective_date"), meterContract.tariff_effective_date),
    pricing_quality: subscription.isEstimate ? "ESTIMATION" : "EXACT", is_estimate: subscription.isEstimate,
    provenance,
  };
  const exact = contractType === "BASE" ? common.price_base_eur_kwh != null
    : contractType === "HPHC" && common.price_hp_eur_kwh != null && common.price_hc_eur_kwh != null;
  const subscriptionErrors = subscription.invalid ? ["current_supplier_subscription_ttc_invalid"] : [];
  if (exact) return finish(common, subscriptionErrors);

  const billRaw = read("electricity_annual_bill_ttc");
  const billProvided = hasInput(billRaw);
  const annualBill = numberOrNull(billRaw);
  const consumption = currentAnnualConsumption(ctx, lead, read);
  const errors = [...subscriptionErrors];
  if (billProvided && annualBill == null) errors.push("annual_bill_ttc_invalid");
  if (annualBill != null && subscriptionAnnual != null && annualBill < subscriptionAnnual) errors.push("annual_bill_below_subscription");
  if (billProvided && consumption.invalid) errors.push("annual_consumption_kwh_invalid");
  if (errors.length) {
    return finish({
      ...common, pricing_quality: "INCOMPLETE",
      provenance: { ...provenance, source_label: "Données de facture à corriger", input_errors: errors },
    }, errors);
  }

  const fallbackReasons = ["current_electricity_prices_incomplete"];
  if (typeRaw != null && contractType == null) fallbackReasons.push("unsupported_original_tariff");
  const averageBase = {
    ...common,
    contract_type: "BASE", price_hp_eur_kwh: null, price_hc_eur_kwh: null,
    // Retain the meter's schedule for resolving future HP/HC supply; BASE
    // average valuation itself does not depend on this schedule.
    off_peak_periods: offPeak,
    pricing_quality: "ESTIMATION", is_estimate: true,
  };
  if (annualBill != null && subscriptionAnnual != null && consumption.kwh != null) {
    const averagePrice = (annualBill - subscriptionAnnual) / consumption.kwh;
    if (!Number.isFinite(averagePrice)) {
      return finish({ ...common, pricing_quality: "INCOMPLETE", provenance: { ...provenance, input_errors: ["annual_bill_energy_price_invalid"] } }, ["annual_bill_energy_price_invalid"]);
    }
    return finish({
      ...averageBase,
      price_base_eur_kwh: averagePrice,
      source: "ANNUAL_BILL_AVERAGE",
      provenance: {
        ...provenance, kind: "ANNUAL_BILL_AVERAGE", valuation_mode: "AVERAGE", is_estimate: true,
        source_label: "Estimation au prix moyen énergie de la facture annuelle, abonnement retiré",
        annual_bill_ttc: annualBill,
        annual_subscription_ttc: subscriptionAnnual,
        annual_energy_bill_ttc: annualBill - subscriptionAnnual,
        annual_consumption_kwh: consumption.kwh,
        annual_consumption_source: consumption.source,
        period_alignment: "ASSUMED_SAME_ANNUAL_PERIOD",
        fallback_reasons: fallbackReasons,
      },
    });
  }
  if (billProvided && subscriptionAnnual == null) fallbackReasons.push("current_supplier_subscription_ttc_missing");
  if (billProvided && consumption.kwh == null) fallbackReasons.push("annual_consumption_kwh_missing");
  if (!billProvided) fallbackReasons.push("annual_bill_ttc_missing");
  const softwareRaw = ctx.settings?.economics?.price_eur_kwh;
  const softwarePrice = numberOrNull(softwareRaw);
  const engineDefault = numberOrNull(ORG_ECONOMICS_ENGINE_DEFAULTS.price_eur_kwh);
  if (hasInput(softwareRaw) && softwarePrice == null) fallbackReasons.push("software_electricity_price_invalid");
  return finish({
    ...averageBase,
    price_base_eur_kwh: softwarePrice ?? engineDefault,
    source: "SOFTWARE_ESTIMATE", effective_date: null,
    provenance: {
      ...provenance, kind: "SOFTWARE_ESTIMATE", valuation_mode: "AVERAGE", is_estimate: true,
      source_label: softwarePrice != null ? "Estimation au prix du kWh TTC paramétré dans le logiciel" : "Estimation au prix du kWh par défaut du logiciel",
      software_price_source: softwarePrice != null ? "settings.economics.price_eur_kwh" : "ORG_ECONOMICS_ENGINE_DEFAULTS.price_eur_kwh",
      software_price_is_official_current_tariff: false,
      fallback_reasons: fallbackReasons,
    },
  });
}

function objectOrNull(value) {
  if (typeof value === "string") {
    try { return objectOrNull(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function findRow(grid, contractType, meterKva) {
  const segments = grid?.segments;
  const code = contractType === "HPHC" ? "PART_HPHC" : "PART_BASE";
  const normalizedCode = contractType === "HPHC" ? "PARTICULIER_HPHC" : "PARTICULIER_BASE";
  const segment = Array.isArray(segments)
    ? segments.find((s) => [code, normalizedCode].includes(s.segmentCode))
    : segments?.[normalizedCode] ?? segments?.[code];
  if (!segment) return null;
  const rows = segment.rowsByKva;
  if (rows && Object.prototype.hasOwnProperty.call(rows, String(meterKva))) return rows[String(meterKva)];
  const kvaRows = segment.kvaRows ?? segment.pricing?.kvaRows;
  return Array.isArray(kvaRows) ? kvaRows.find((r) => Number(r.kva) === meterKva) ?? null : null;
}

function hasExplicitSupply(row) {
  return row && (row.electricitySupply != null || row.electricity_supply != null || [
    "electricity_base_ttc_per_kwh", "electricity_hp_ttc_per_kwh", "electricity_hc_ttc_per_kwh", "abonnement_fixed_month_ttc",
  ].some((key) => Object.prototype.hasOwnProperty.call(row, key)));
}

function firstExplicit(candidates, convert = numberOrNull) {
  for (const [object, key, transform = convert] of candidates) {
    // An absent/undefined property is an unset override. Explicit null is a
    // deliberate unknown and must not be replaced by a published price.
    if (object && Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) return { value: transform(object[key]) };
  }
  return null;
}

function explicitSupply(row) {
  const supply = objectOrNull(row?.electricitySupply ?? row?.electricity_supply) ?? row;
  const fields = {
    price_base_eur_kwh: firstExplicit([[supply, "electricity_base_ttc_per_kwh"], [supply, "price_base_eur_kwh"]]),
    price_hp_eur_kwh: firstExplicit([[supply, "electricity_hp_ttc_per_kwh"], [supply, "price_hp_eur_kwh"]]),
    price_hc_eur_kwh: firstExplicit([[supply, "electricity_hc_ttc_per_kwh"], [supply, "price_hc_eur_kwh"]]),
    supplier_subscription_ttc_per_year: firstExplicit([
      [supply, "supplier_subscription_ttc_per_year"],
      [supply, "supplier_subscription_ttc_month", annualFromMonthly],
      [row, "abonnement_fixed_month_ttc", annualFromMonthly],
      [row, "subscription_fixed_ttc", annualFromMonthly],
      [row?.subscriptionFixed, "ttc", annualFromMonthly],
    ]),
    subscription_includes_autoproducer_contribution: firstExplicit([
      [supply, "subscription_includes_autoproducer_contribution"],
      [row, "abonnement_includes_contribution"],
      [row?.subscriptionFixed, "includesAutoproducerContribution"],
    ], (value) => value === true),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, entry]) => entry != null).map(([field, entry]) => [field, entry.value]));
}

function publishedSupply(common) {
  const { provider_code: provider, contract_type: type, meter_kva: kva } = common;
  const isUrban = provider === "URBAN_SOLAR";
  const isMylight = ["MYLIGHT_MYBATTERY", "MYLIGHT_MYSMARTBATTERY"].includes(provider);
  if (!isUrban && !isMylight) return null;
  const rates = isUrban ? resolveUrbanSolarTariffsForDate(common.tariff_reference_date) : MYLIGHT_ELECTRICITY_SUPPLY_2026_08_01;
  if (!rates) return null;
  const subscriptions = isUrban
    ? rates.supplierSubscriptionTtcPerMonth[type === "HPHC" ? "hphc" : "base"]
    : type === "HPHC" ? rates.subscriptionHphcTtcMonth : rates.subscriptionBaseTtcMonth;
  const availableKva = kva != null && Object.prototype.hasOwnProperty.call(subscriptions, String(kva));
  return {
    ...common,
    price_base_eur_kwh: type === "BASE" && availableKva
      ? isUrban ? rates.electricityTtcPerKwh.baseByKva[kva] : kva <= 6 ? rates.priceBaseSmall : rates.priceBaseLarge
      : null,
    price_hp_eur_kwh: type === "HPHC" && availableKva ? isUrban ? rates.electricityTtcPerKwh.hp : rates.priceHp : null,
    price_hc_eur_kwh: type === "HPHC" && availableKva ? isUrban ? rates.electricityTtcPerKwh.hc : rates.priceHc : null,
    supplier_subscription_ttc_per_year: availableKva ? annualFromMonthly(subscriptions[kva]) : null,
    subscription_includes_autoproducer_contribution: isUrban && rates.supplierSubscriptionIncludesAutoproducerContribution,
    source: "PROVIDER_CATALOG",
    effective_date: rates.effectiveDate,
    tariff_edition_id: rates.id ?? null,
    provenance: {
      kind: "PROVIDER_CATALOG", price_basis: "TTC", source_label: rates.sourceLabel,
      source_url: isUrban ? rates.sourceUrls[type === 'HPHC' ? 'hphc' : 'base'] : rates.sourceUrl,
      tariff_edition_id: rates.id ?? null,
      tariff_case: isUrban ? "PARTICULIER" : "NEW_ENEDIS_CUSTOMER",
    },
  };
}

/**
 * Supply for a BV or hybrid scenario. settings accepts the whole organisation
 * settings object, {pv:{virtual_battery}}, or the virtual_battery object itself.
 * providerConfig/tariffGrid can be passed from an already loaded catalogue row;
 * this module performs no I/O. Only explicit electricity TTC fields override the
 * built-in dated offer field by field; absence uses the catalogue, explicit null
 * remains unknown. Legacy `virtualEnergy`/restitution values are not supply.
 */
export function resolveVirtualElectricityContract({
  providerCode, contractType, meterKva, settings = null,
  providerConfig = null, tariffGrid = null, offPeakPeriods = null,
  tariffReferenceDate = null,
} = {}) {
  const provider = String(providerCode ?? "").trim().toUpperCase() || null;
  const type = normalizeType(contractType);
  const kva = firstNumber(meterKva);
  const grids = settings?.pv?.virtual_battery ?? settings?.virtual_battery ?? settings;
  const config = objectOrNull(providerConfig) ?? objectOrNull(grids?.providers?.[provider]);
  const catalog = objectOrNull(tariffGrid) ?? objectOrNull(config?.tariff_grid_json) ?? config;
  const orgRow = findRow(config, type, kva);
  const catalogRow = findRow(catalog, type, kva);
  const row = hasExplicitSupply(orgRow) ? orgRow : hasExplicitSupply(catalogRow) ? catalogRow : null;
  const directSupply = hasExplicitSupply(config) ? config : null;
  const referenceDate = provider === 'URBAN_SOLAR' ? urbanSolarTariffReferenceDate(tariffReferenceDate) : null;
  const candidateSupply = row ?? directSupply;
  const candidateMetadata = objectOrNull(candidateSupply?.electricitySupply ?? candidateSupply?.electricity_supply) ?? candidateSupply;
  const candidateDate = firstValue(candidateMetadata?.effective_date, candidateMetadata?.effectiveDate, catalog?.effectiveDate, config?.effectiveDate);
  // An organisation override cannot move a future published offer into the past.
  // An undated override can supplement a known edition, but cannot create history.
  const supplyRow = provider !== 'URBAN_SOLAR' || (candidateDate ? urbanSolarTariffReferenceDate(candidateDate) <= referenceDate : resolveUrbanSolarTariffsForDate(referenceDate)) ? candidateSupply : null;
  const common = {
    provider_code: provider, contract_type: type, meter_kva: kva,
    tariff_reference_date: referenceDate,
    price_base_eur_kwh: null, price_hp_eur_kwh: null, price_hc_eur_kwh: null,
    supplier_subscription_ttc_per_year: null,
    subscription_includes_autoproducer_contribution: false,
    off_peak_periods: type === "HPHC" ? periodsOrNull(offPeakPeriods) : null,
    source: "MISSING_PROVIDER_SUPPLY", effective_date: null,
    provenance: { kind: "MISSING_PROVIDER_SUPPLY", price_basis: "TTC" },
  };
  const missing = [];
  if (!provider) missing.push("provider_code");
  if (kva == null || kva <= 0) missing.push("meter_kva");
  const published = publishedSupply(common);
  if (supplyRow) {
    const metadata = objectOrNull(supplyRow.electricitySupply ?? supplyRow.electricity_supply) ?? supplyRow;
    const disabled = supplyRow.enabled === false || config?.enabled === false || config?.is_active === false;
    const overrides = explicitSupply(supplyRow);
    if (!disabled && Object.keys(overrides).length === 0 && published) {
      return finish(published, published.supplier_subscription_ttc_per_year == null ? [...missing, "meter_kva"] : missing, type == null);
    }
    const values = disabled ? common : { ...(published ?? common), ...overrides };
    const fieldSources = Object.fromEntries([
      "price_base_eur_kwh", "price_hp_eur_kwh", "price_hc_eur_kwh", "supplier_subscription_ttc_per_year",
    ].map((field) => [field, Object.prototype.hasOwnProperty.call(overrides, field) ? "PROVIDER_ORG" : published ? "PROVIDER_CATALOG" : "MISSING_PROVIDER_SUPPLY"]));
    return finish({
      ...values,
      price_base_eur_kwh: type === "BASE" ? values.price_base_eur_kwh ?? null : null,
      price_hp_eur_kwh: type === "HPHC" ? values.price_hp_eur_kwh ?? null : null,
      price_hc_eur_kwh: type === "HPHC" ? values.price_hc_eur_kwh ?? null : null,
      source: "PROVIDER_ORG",
      effective_date: firstValue(metadata.effective_date, metadata.effectiveDate, catalog?.effectiveDate, config?.effectiveDate),
      provenance: {
        kind: "PROVIDER_ORG", price_basis: "TTC",
        source_label: firstValue(metadata.sourceLabel, catalog?.sourceLabel, config?.sourceLabel, "Grille de fourniture de l'organisation"),
        source_url: firstValue(metadata.sourceUrl, catalog?.sourceUrl, config?.sourceUrl),
        field_sources: fieldSources,
        catalogue: published ? { ...published.provenance, effective_date: published.effective_date } : null,
      },
    }, [...missing, ...(disabled ? ["provider_supply_enabled"] : [])], type == null);
  }
  if (!published) return finish(common, [...missing, "provider_supply_tariff"], type == null);
  if (published.supplier_subscription_ttc_per_year == null) missing.push("meter_kva");
  return finish(published, missing, type == null);
}
