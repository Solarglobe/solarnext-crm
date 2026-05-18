#!/usr/bin/env node
/**
 * Import massif catalogue PV officiel CER/CEC.
 *
 * Sources publiques, mises a jour en mai 2026:
 * - PV modules: https://cer.gov.au/document/cec-approved-pv-modules-0
 * - Inverters:  https://cer.gov.au/document/cec-approved-inverters-0
 * - Batteries:  https://cer.gov.au/document/cec-approved-solar-batteries-0
 *
 * Les listes CER/CEC sont fiables pour l'identite/certification, mais elles ne
 * contiennent pas toutes les dimensions physiques. Les modules importes sans
 * dimensions reelles sont donc marques shading_compatible=false.
 */

import "../config/register-local-env.js";
import { parse } from "csv-parse/sync";
import { pool } from "../config/db.js";

const SOURCES = {
  panels: "https://cer.gov.au/document/cec-approved-pv-modules-0",
  inverters: "https://cer.gov.au/document/cec-approved-inverters-0",
  batteries: "https://cer.gov.au/document/cec-approved-solar-batteries-0",
};

const SOURCE_NAME = "Clean Energy Regulator / Clean Energy Council approved products";
const SOURCE_URL = "https://cer.gov.au/RET/Forms-and-resources/Forms-and-resources-for-agents-and-installers";
const VERIFIED_AT = "2026-05-15";

const limit = Number(process.env.PV_CATALOG_IMPORT_LIMIT || 0);
const dryRun = process.argv.includes("--dry-run");

function clean(value) {
  return String(value ?? "").replace(/\uFFFD/g, "").trim();
}

function maybeNumber(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseRows(csv) {
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    trim: true,
  });
}

function inferPanelPowerWc(model) {
  const matches = clean(model).match(/\b([3-7]\d{2})\b/g) ?? [];
  const powers = matches.map(Number).filter((n) => n >= 300 && n <= 750);
  return powers.at(-1) ?? 0;
}

function parseDateAu(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isExpired(value) {
  const iso = parseDateAu(value);
  if (!iso) return false;
  return new Date(`${iso}T00:00:00Z`) < new Date("2026-05-01T00:00:00Z");
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telechargement impossible ${url}: HTTP ${res.status}`);
  return res.text();
}

async function importPanels(client, rows) {
  let imported = 0;
  for (const row of rows.slice(0, limit || rows.length)) {
    const brand = clean(row["Licensee/Certificate Holder"]);
    const model = clean(row["Model Number"]);
    if (!brand || !model || isExpired(row["Expiry Date"])) continue;
    const power = inferPanelPowerWc(model);
    await client.query(
      `INSERT INTO pv_panels (
        name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct,
        width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years,
        warranty_performance_years, certificate_iec, shading_compatible,
        source_name, source_url, datasheet_url, image_url, last_verified_at,
        data_confidence, status, is_favorite, active
      )
      VALUES (
        $1, $2, $3, $4, false, $5, 0,
        1, 1, NULL, NULL, NULL,
        NULL, $6, false,
        $7, $8, NULL, NULL, $9,
        0.82, 'active', false, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        last_verified_at = EXCLUDED.last_verified_at,
        certificate_iec = COALESCE(pv_panels.certificate_iec, EXCLUDED.certificate_iec),
        data_confidence = GREATEST(COALESCE(pv_panels.data_confidence, 0), EXCLUDED.data_confidence),
        updated_at = now()`,
      [
        `${brand} ${model}`,
        brand,
        model,
        model.includes("TOPCon") ? "TOPCon" : null,
        power,
        model.match(/IEC\s?61215[- ]?2021/i) ? "IEC 61215-2021" : "CEC approved PV module",
        SOURCE_NAME,
        SOURCE_URL,
        VERIFIED_AT,
      ]
    );
    imported += 1;
  }
  return imported;
}

async function importInverters(client, rows) {
  let imported = 0;
  for (const row of rows.slice(0, limit || rows.length)) {
    const brand = clean(row.Manufacturer);
    const model = clean(row["Model Number"]);
    const series = clean(row.Series);
    const powerKw = maybeNumber(row["AC Power (kW)"]);
    if (!brand || !model || !powerKw || isExpired(row["Expiry date"])) continue;
    const isMicro = powerKw <= 1.5 || /micro/i.test(`${series} ${model}`);
    await client.query(
      `INSERT INTO pv_inverters (
        name, brand, model_ref, inverter_type, inverter_family, nominal_power_kw,
        nominal_va, phases, mppt_count, inputs_per_mppt, modules_per_inverter,
        mppt_min_v, mppt_max_v, max_input_current_a, max_dc_power_kw,
        euro_efficiency_pct, compatible_battery, monitoring_integrated,
        source_name, source_url, datasheet_url, image_url, last_verified_at,
        data_confidence, status, is_favorite, active
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, NULL, NULL, NULL, $8,
        NULL, NULL, NULL, NULL,
        NULL, false, false,
        $9, $10, NULL, NULL, $11,
        0.84, 'active', false, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        nominal_power_kw = EXCLUDED.nominal_power_kw,
        nominal_va = EXCLUDED.nominal_va,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = GREATEST(COALESCE(pv_inverters.data_confidence, 0), EXCLUDED.data_confidence),
        updated_at = now()`,
      [
        `${brand} ${model}`,
        brand,
        model,
        isMicro ? "micro" : "string",
        isMicro ? "MICRO" : "CENTRAL",
        powerKw,
        Math.round(powerKw * 1000),
        isMicro ? 1 : null,
        SOURCE_NAME,
        SOURCE_URL,
        VERIFIED_AT,
      ]
    );
    imported += 1;
  }
  return imported;
}

async function importBatteries(client, rows) {
  let imported = 0;
  for (const row of rows.slice(0, limit || rows.length)) {
    const holder = clean(row["Manufacturer/Certificate Holder Account"]);
    const brand = clean(row["Brand Name"]) || holder;
    const model = clean(row["Model Number"]);
    const series = clean(row.Series);
    const usable = maybeNumber(row["Usable Capacity (kWh)"]) ?? maybeNumber(row["Nominal Battery Capacity (kWh)"]);
    if (!brand || !model || !usable || isExpired(row["CEC Expiry Date"])) continue;
    await client.query(
      `INSERT INTO pv_batteries (
        name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw,
        max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct,
        cycle_life, chemistry, scalable, max_modules, max_system_charge_kw,
        max_system_discharge_kw, warranty_years, source_name, source_url,
        datasheet_url, image_url, last_verified_at, data_confidence,
        status, is_favorite, active, default_price_ht, purchase_price_ht
      )
      VALUES (
        $1, $2, $3, $4, NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL, false, NULL, NULL,
        NULL, NULL, $5, $6,
        NULL, NULL, $7, 0.82,
        'active', false, true, NULL, NULL
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        usable_kwh = EXCLUDED.usable_kwh,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = GREATEST(COALESCE(pv_batteries.data_confidence, 0), EXCLUDED.data_confidence),
        updated_at = now()`,
      [
        `${brand} ${series ? `${series} ` : ""}${model}`.trim(),
        brand,
        model,
        usable,
        SOURCE_NAME,
        SOURCE_URL,
        VERIFIED_AT,
      ]
    );
    imported += 1;
  }
  return imported;
}

async function main() {
  console.log("Import catalogue PV officiel CER/CEC...");
  const [panelCsv, inverterCsv, batteryCsv] = await Promise.all([
    fetchCsv(SOURCES.panels),
    fetchCsv(SOURCES.inverters),
    fetchCsv(SOURCES.batteries),
  ]);
  const panelRows = parseRows(panelCsv);
  const inverterRows = parseRows(inverterCsv);
  const batteryRows = parseRows(batteryCsv);

  if (dryRun) {
    console.log({
      panels_available: panelRows.length,
      inverters_available: inverterRows.length,
      batteries_available: batteryRows.length,
      limit: limit || null,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const panels = await importPanels(client, panelRows);
    const inverters = await importInverters(client, inverterRows);
    const batteries = await importBatteries(client, batteryRows);
    await client.query("COMMIT");
    console.log(`OK: ${panels} panneaux, ${inverters} onduleurs, ${batteries} batteries importes.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
