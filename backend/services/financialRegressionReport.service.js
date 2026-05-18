import { pool } from "../config/db.js";
import { FINANCIAL_ENGINE_VERSION } from "../constants/engineVersion.js";

const DEFAULT_KEYS = Object.freeze([
  "capex_ttc",
  "capex_net",
  "roi_years",
  "irr_pct",
  "lcoe_eur_kwh",
  "economie_an1",
  "gain_25a",
]);

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function relativeDiffPct(before, after) {
  const a = asNumber(before);
  const b = asNumber(after);
  if (a == null || b == null) return a === b ? 0 : Infinity;
  if (a === 0) return b === 0 ? 0 : Infinity;
  return Math.abs((b - a) / a) * 100;
}

export function compareFinancialScenarioResults(before = {}, after = {}, options = {}) {
  const tolerancePct = options.tolerancePct ?? 0.01;
  const keys = options.keys ?? DEFAULT_KEYS;
  const diffs = [];

  for (const key of keys) {
    const beforeValue = asNumber(before[key]);
    const afterValue = asNumber(after[key]);
    const diffPct = relativeDiffPct(beforeValue, afterValue);
    if (diffPct > tolerancePct) {
      diffs.push({ key, before: beforeValue, after: afterValue, diff_pct: diffPct });
    }
  }

  return {
    affected: diffs.length > 0,
    tolerance_pct: tolerancePct,
    diffs,
  };
}

export function buildFinancialRegressionReport(rows = [], recomputedByScenarioId = {}, options = {}) {
  const fromVersion = options.fromVersion ?? null;
  const toVersion = options.toVersion ?? FINANCIAL_ENGINE_VERSION;
  const affected = [];

  for (const row of rows) {
    const key = row.id ?? `${row.study_version_id}:${row.scenario_id}`;
    const after = recomputedByScenarioId[key] ?? recomputedByScenarioId[row.scenario_id] ?? null;
    if (!after) continue;

    const comparison = compareFinancialScenarioResults(row.results || {}, after, options);
    if (comparison.affected) {
      affected.push({
        financial_scenario_id: row.id ?? null,
        study_id: row.study_id ?? null,
        study_version_id: row.study_version_id ?? null,
        scenario_id: row.scenario_id ?? null,
        previous_engine_version: row.engine_version ?? null,
        new_engine_version: toVersion,
        diffs: comparison.diffs,
      });
    }
  }

  return {
    from_engine_version: fromVersion,
    to_engine_version: toVersion,
    scanned_count: rows.length,
    affected_count: affected.length,
    message: `${affected.length} scenarios affectes par la mise a jour du moteur ${fromVersion ?? "ancienne version"} -> ${toVersion}`,
    affected,
  };
}

export async function generateFinancialRegressionReport({
  organizationId,
  fromVersion,
  recomputeScenario,
  limit = 500,
  tolerancePct = 0.01,
}) {
  if (!organizationId) throw new Error("organizationId requis");
  if (typeof recomputeScenario !== "function") throw new Error("recomputeScenario requis");

  const params = [organizationId];
  let versionFilter = "";
  if (fromVersion) {
    params.push(fromVersion);
    versionFilter = ` AND engine_version = $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, organization_id, study_id, study_version_id, scenario_id,
            engine_version, input_params, results
       FROM financial_scenarios
      WHERE organization_id = $1${versionFilter}
      ORDER BY updated_at DESC
      LIMIT $${params.length}`,
    params
  );

  const recomputed = {};
  for (const row of rows) {
    recomputed[row.id] = await recomputeScenario(row);
  }

  return buildFinancialRegressionReport(rows, recomputed, {
    fromVersion,
    toVersion: FINANCIAL_ENGINE_VERSION,
    tolerancePct,
  });
}

