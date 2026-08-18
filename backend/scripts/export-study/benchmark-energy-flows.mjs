#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, "results");

const hourlyPath = path.resolve(
  process.cwd(),
  process.argv[2] || "backend/scripts/export-study/results/SGS-2026-0137-hourly-benchmark.json"
);
const snapshotPath = path.resolve(
  process.cwd(),
  process.argv[3] || "backend/scripts/export-study/results/SGS-2026-0137-snapshot.json"
);

const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const KPI_ALIASES = Object.freeze({
  production_kwh: ["production_kwh"],
  consumption_kwh: ["consumption_kwh"],
  autoconsumption_kwh: ["autoconsumption_kwh", "total_pv_used_on_site_kwh", "energy_solar_used_kwh"],
  surplus_injected_kwh: ["surplus_kwh", "exported_kwh", "surplus_to_virtual_or_grid_kwh"],
  grid_import_kwh: ["grid_import_kwh", "energy_grid_import_kwh", "import_kwh"],
  self_consumption_pct: ["self_consumption_pct", "pv_self_consumption_pct"],
  self_sufficiency_pct: ["self_production_pct", "site_autonomy_pct", "energy_independence_pct", "solar_coverage_pct"],
});

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function pct(part, total) {
  return total > 0 ? (part / total) * 100 : null;
}

function assertHourly(values, label) {
  if (!Array.isArray(values) || values.length !== 8760) {
    throw new Error(`${label} must be an array of 8760 values`);
  }
  return values.map((value, index) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${label}[${index}] is invalid`);
    }
    return n;
  });
}

function monthRanges() {
  const ranges = [];
  let start = 0;
  for (let i = 0; i < DAYS_IN_MONTH.length; i++) {
    const end = start + DAYS_IN_MONTH[i] * 24;
    ranges.push({ month: i + 1, start, end });
    start = end;
  }
  return ranges;
}

function computeFlows(production, consumption, start = 0, end = production.length) {
  let productionKwh = 0;
  let consumptionKwh = 0;
  let autoconsumptionKwh = 0;
  let surplusInjectedKwh = 0;
  let gridImportKwh = 0;

  for (let h = start; h < end; h++) {
    const pv = production[h];
    const load = consumption[h];
    productionKwh += pv;
    consumptionKwh += load;
    autoconsumptionKwh += Math.min(pv, load);
    surplusInjectedKwh += Math.max(0, pv - load);
    gridImportKwh += Math.max(0, load - pv);
  }

  return {
    production_kwh: round(productionKwh, 6),
    consumption_kwh: round(consumptionKwh, 6),
    autoconsumption_kwh: round(autoconsumptionKwh, 6),
    surplus_injected_kwh: round(surplusInjectedKwh, 6),
    grid_import_kwh: round(gridImportKwh, 6),
    self_consumption_pct: round(pct(autoconsumptionKwh, productionKwh), 6),
    self_sufficiency_pct: round(pct(autoconsumptionKwh, consumptionKwh), 6),
  };
}

function getNumber(obj, key) {
  const value = obj?.[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findStoredKpi(energy, canonicalKey) {
  const aliases = KPI_ALIASES[canonicalKey] || [];
  const found = [];
  for (const alias of aliases) {
    const value = getNumber(energy, alias);
    if (value != null) found.push({ alias, value });
  }
  const uniqueValues = [...new Set(found.map((f) => round(f.value, 6)))];
  return {
    canonical_key: canonicalKey,
    aliases_checked: aliases,
    found,
    selected: found.length === 1 || uniqueValues.length === 1 ? found[0] : null,
    status: found.length === 0
      ? "missing"
      : found.length === 1
        ? "selected"
        : uniqueValues.length === 1
          ? "selected_multiple_aliases_same_value"
          : "ambiguous",
  };
}

function scenarioUsesBattery(scenario) {
  const id = String(scenario?.id || scenario?.scenario_type || "").toUpperCase();
  const assumptions = scenario?.assumptions || {};
  const hardware = scenario?.hardware || {};
  const explicitPhysical =
    assumptions.battery_enabled === true ||
    hardware.battery_id != null ||
    Number(hardware.battery_units || 0) > 0 ||
    Number(hardware.battery_usable_kwh || 0) > 0;
  const explicitVirtual =
    assumptions.virtual_enabled === true ||
    Number(hardware.virtual_battery_capacity_kwh || 0) > 0 ||
    scenario?.battery_virtual != null ||
    scenario?.virtual_battery_8760 != null;
  return (
    id.includes("BATTERY") ||
    explicitPhysical ||
    explicitVirtual
  );
}

function scenarioUsesV2h(scenario) {
  const id = String(scenario?.id || scenario?.scenario_type || "").toUpperCase();
  return id.includes("V2H") || scenario?.assumptions?.vehicle_v2h_enabled === true || scenario?.vehicle_v2h != null;
}

function scenarioUsesPiloting(scenario) {
  return (
    scenario?.scenario_uses_piloted_profile === true ||
    scenario?.assumptions?.scenario_uses_piloted_profile === true ||
    scenario?.solar_piloting_enabled === true ||
    Array.isArray(scenario?.usages_pilotables) && scenario.usages_pilotables.length > 0
  );
}

function selectComparableScenario(snapshot, targetKwc) {
  const scenarios = Array.isArray(snapshot?.results?.scenarios_v2) ? snapshot.results.scenarios_v2 : [];
  const evaluated = scenarios.map((scenario) => {
    const kwc = getNumber(scenario?.hardware, "kwc");
    const battery = scenarioUsesBattery(scenario);
    const v2h = scenarioUsesV2h(scenario);
    const piloting = scenarioUsesPiloting(scenario);
    const kwcMatches = kwc != null && Math.abs(kwc - targetKwc) <= 0.001;
    const comparable = !battery && !v2h && !piloting && kwcMatches;
    return {
      id: scenario?.id ?? scenario?.scenario_type ?? null,
      label: scenario?.label ?? null,
      kwc,
      battery,
      v2h,
      piloting,
      kwc_matches_12kwc: kwcMatches,
      comparable,
      scenario,
    };
  });
  const candidates = evaluated.filter((item) => item.comparable);
  return {
    evaluated: evaluated.map(({ scenario, ...rest }) => rest),
    selected: candidates.length === 1 ? candidates[0] : null,
    status: candidates.length === 0 ? "none" : candidates.length === 1 ? "selected" : "ambiguous",
  };
}

function compareKpis(benchmark, scenario) {
  const energy = scenario?.energy || {};
  const out = {};
  const warnings = [];
  for (const key of Object.keys(KPI_ALIASES)) {
    const lookup = findStoredKpi(energy, key);
    const benchmarkValue = benchmark[key];
    let comparison = null;
    if ((lookup.status === "selected" || lookup.status === "selected_multiple_aliases_same_value") && benchmarkValue != null) {
      const stored = lookup.selected.value;
      const abs = benchmarkValue - stored;
      comparison = {
        benchmark_value: round(benchmarkValue, 6),
        stored_value: round(stored, 6),
        abs_diff: round(abs, 6),
        rel_diff_pct: stored !== 0 ? round((abs / stored) * 100, 6) : null,
      };
      if (lookup.status === "selected_multiple_aliases_same_value") {
        warnings.push(`${key}: plusieurs alias presents avec la meme valeur (${lookup.found.map((f) => f.alias).join(", ")}); alias retenu: ${lookup.selected.alias}.`);
      }
    } else if (lookup.status === "ambiguous") {
      warnings.push(`${key}: plusieurs alias presents (${lookup.found.map((f) => f.alias).join(", ")}), comparaison non retenue.`);
    } else if (lookup.status === "missing") {
      warnings.push(`${key}: aucun champ stocke trouve (${lookup.aliases_checked.join(", ")}).`);
    }
    out[key] = { ...lookup, comparison };
  }
  return { fields: out, warnings };
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function renderReport(result) {
  const selected = result.comparable_scenario.selected;
  const comparisonLines = Object.entries(result.comparison.fields).map(([key, data]) => {
    if (!data.comparison) return `- ${key}: non compare (${data.status})`;
    return `- ${key}: alias \`${data.selected.alias}\`, benchmark=${data.comparison.benchmark_value}, stocke=${data.comparison.stored_value}, ecart=${data.comparison.abs_diff} (${data.comparison.rel_diff_pct} %)`;
  });
  return `# Benchmark flux energie ${result.export_metadata.study_reference}

## Statut

- Statut: ${result.status}
- Scenario comparable: ${selected ? `${selected.id} (${selected.label || "sans label"})` : "aucun"}
- Methode: PV + consommation horaires, sans batterie/V2H/pilotage

## Bilan annuel benchmark

- Production: ${result.annual.production_kwh} kWh
- Consommation: ${result.annual.consumption_kwh} kWh
- Autoconsommation: ${result.annual.autoconsumption_kwh} kWh
- Taux autoconsommation: ${result.annual.self_consumption_pct} %
- Autosuffisance: ${result.annual.self_sufficiency_pct} %
- Surplus injecte: ${result.annual.surplus_injected_kwh} kWh
- Import reseau: ${result.annual.grid_import_kwh} kWh

## Comparaison stockee

${comparisonLines.join("\n")}

## Champs absents ou ambigus

${result.comparison.warnings.length ? result.comparison.warnings.map((w) => `- ${w}`).join("\n") : "- Aucun avertissement de champ."}

## Avertissements de definition

${result.definition_warnings.length ? result.definition_warnings.map((w) => `- ${w}`).join("\n") : "- Aucun avertissement de definition."}
`;
}

async function main() {
  const hourlyBenchmark = JSON.parse(await fs.readFile(hourlyPath, "utf8"));
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  const studyRef = hourlyBenchmark?.export_metadata?.study_reference || snapshot?.export_metadata?.study_reference || "SGS-2026-0137";
  const production = assertHourly(hourlyBenchmark?.production?.hourly_8760_kwh, "production.hourly_8760_kwh");
  const consumption = assertHourly(hourlyBenchmark?.consumption?.hourly_8760_kwh, "consumption.hourly_8760_kwh");
  const annual = computeFlows(production, consumption);
  const monthly = monthRanges().map((r) => ({ month: r.month, ...computeFlows(production, consumption, r.start, r.end) }));
  const targetKwc = Number(snapshot?.pv_system?.total_power_kwc);
  const comparable = selectComparableScenario(snapshot, targetKwc);
  const selectedScenario = comparable.selected?.scenario || null;
  const comparison = selectedScenario ? compareKpis(annual, selectedScenario) : { fields: {}, warnings: ["Aucun scenario comparable unique trouve."] };
  const definitionWarnings = [
    "Benchmark calcule sans batterie, sans V2H et sans pilotage: comparaison limitee aux champs energetiques de meme definition apparente.",
    "Le surplus benchmark correspond a max(PV-consommation, 0) avant toute batterie virtuelle ou valorisation contractuelle.",
    "L'import reseau benchmark correspond a max(consommation-PV, 0) avant batterie, credits ou pilotage.",
  ];

  const result = {
    status: comparable.status === "selected" ? "success" : "warning",
    export_metadata: {
      study_reference: studyRef,
      generated_at: new Date().toISOString(),
      hourly_benchmark_file: hourlyPath,
      snapshot_file: snapshotPath,
      no_database_access: true,
      no_vps_access: true,
      no_battery_or_v2h_recalculation: true,
    },
    annual,
    monthly,
    comparable_scenario: {
      status: comparable.status,
      evaluated: comparable.evaluated,
      selected: comparable.selected ? {
        id: comparable.selected.id,
        label: comparable.selected.label,
        kwc: comparable.selected.kwc,
      } : null,
    },
    comparison,
    definition_warnings: definitionWarnings,
  };

  const outputJson = path.join(RESULTS_DIR, `${studyRef}-energy-flow-benchmark.json`);
  const outputReport = path.join(RESULTS_DIR, `${studyRef}-energy-flow-benchmark-report.md`);
  await fs.writeFile(outputJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(outputReport, renderReport(result), "utf8");

  console.log(JSON.stringify({
    status: result.status,
    selected_scenario: result.comparable_scenario.selected,
    output_json: outputJson,
    output_report: outputReport,
    output_json_sha256: await sha256(outputJson),
    output_report_sha256: await sha256(outputReport),
    annual: result.annual,
    comparison_warnings: result.comparison.warnings,
    definition_warnings: result.definition_warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
