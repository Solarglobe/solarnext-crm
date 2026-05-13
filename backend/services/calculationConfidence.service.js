/**
 * Agrège le niveau de confiance du calcul et les avertissements bloquants / non bloquants.
 */

import {
  mergeOrgEconomicsPartial,
  overlayFormEconomics,
  resolveElectricityGrowthPctFromOrg,
} from "./economicsResolve.service.js";

const BLOCKING = new Set([
  "CALC_INVALID_8760_PROFILE",
  "PVGIS_FALLBACK_USED",
  "VB_COST_UNCONFIGURED_BLOCK_PDF",
  "VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE",
]);

/**
 * @param {object} params
 * @param {string[]} params.blocking_warnings
 * @param {string[]} params.non_blocking_warnings
 * @param {object} params.assumptions
 * @returns {{ level: string, blocking_warnings: string[], non_blocking_warnings: string[], assumptions: object }}
 */
export function finalizeCalculationConfidence({
  blocking_warnings = [],
  non_blocking_warnings = [],
  assumptions = {},
}) {
  const bw = Array.from(new Set((blocking_warnings || []).filter(Boolean)));
  const nbw = Array.from(new Set((non_blocking_warnings || []).filter(Boolean)));

  let level = "HIGH";
  if (bw.length > 0) {
    level = "BLOCKED";
  } else {
    const lowSignals = [
      assumptions?.pvgis_fallback_used === true,
      assumptions?.enedis_profile_used === false,
      Number(assumptions?.maintenance_pct) === 0,
      assumptions?.elec_growth_missing === true,
      Number(assumptions?.elec_growth_pct) > 3,
      Number(assumptions?.oversell_risk_score) >= 70,
    ].filter(Boolean).length;
    if (
      Number(assumptions?.oversell_risk_score) >= 70 ||
      lowSignals >= 2 ||
      (assumptions?.pvgis_fallback_used && assumptions?.enedis_profile_used === false)
    ) {
      level = "LOW";
    } else if (
      assumptions?.enedis_profile_used === false ||
      assumptions?.pvgis_fallback_used === true ||
      Number(assumptions?.maintenance_pct) === 0 ||
      assumptions?.elec_growth_missing === true ||
      Number(assumptions?.elec_growth_pct) > 3 ||
      Number(assumptions?.oversell_risk_score) >= 40
    ) {
      level = "MEDIUM";
    }
  }

  return {
    level,
    blocking_warnings: bw,
    non_blocking_warnings: nbw,
    assumptions: { ...assumptions },
  };
}

export function isPdfBlockedByConfidence(confidence) {
  if (!confidence || typeof confidence !== "object") return false;
  if (confidence.level === "BLOCKED") return true;
  const bw = confidence.blocking_warnings;
  if (!Array.isArray(bw) || bw.length === 0) return false;
  return bw.some((w) => BLOCKING.has(String(w)));
}

/**
 * Construit calculation_confidence après un calcul complet (ctx + scénarios mergés finance).
 * @param {object} ctx — contexte moteur (form, settings, pv, virtual_battery_input, meta…)
 * @param {Record<string, object>} scenariosFinal — scénarios après merge finance
 */
export function buildCalculationConfidenceFromCalc(ctx, scenariosFinal = {}) {
  const blocking = [];
  const nonBlocking = [];

  const pvSrc = String(ctx?.pv?.source ?? "");
  const pvgisFallback = /fallback/i.test(pvSrc);
  if (pvgisFallback) {
    blocking.push("PVGIS_FALLBACK_USED");
  }

  const consoSrc = ctx?.meta?.engine_consumption_source ?? "UNKNOWN";
  const enedisProfileUsed = /^CSV_HOURLY/i.test(String(consoSrc));

  const form = ctx?.form || {};
  const econ = overlayFormEconomics(
    mergeOrgEconomicsPartial(ctx?.settings?.economics),
    form.economics
  );
  const elecGrowth = resolveElectricityGrowthPctFromOrg(
    ctx?.settings?.economics_raw ?? ctx?.settings?.economics,
    { context: "calculationConfidence", log: false }
  );

  if (Number(econ.maintenance_pct) === 0) {
    nonBlocking.push("MAINTENANCE_PCT_ZERO");
  }
  if (Number(elecGrowth.elec_growth_pct) > 3) {
    nonBlocking.push("ELEC_GROWTH_OVER_3_PCT");
  }
  if (elecGrowth.missing) {
    nonBlocking.push("ELEC_GROWTH_MISSING");
  }
  if (Number(econ.horizon_years) > 20) {
    nonBlocking.push("HORIZON_LONG_PROJECTION_NOTE");
  }
  nonBlocking.push("PRIME_ELIGIBILITY_NOT_CONFIRMED");

  const vbSc = scenariosFinal.BATTERY_VIRTUAL;
  if (ctx?.virtual_battery_input?.enabled === true && vbSc && !vbSc._skipped) {
    const fw = vbSc.finance_warnings;
    if (Array.isArray(fw) && fw.includes("VB_COST_UNCONFIGURED")) {
      blocking.push("VB_COST_UNCONFIGURED_BLOCK_PDF");
    }
  }
  const hasUnboundedCommercialBlock = Object.values(scenariosFinal || {}).some((sc) => {
    const flags = [
      ...(Array.isArray(sc?.finance_warnings) ? sc.finance_warnings : []),
      ...(Array.isArray(sc?.anti_oversell_flags) ? sc.anti_oversell_flags : []),
    ];
    return flags.includes("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE");
  });
  if (hasUnboundedCommercialBlock) {
    blocking.push("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE");
  }

  let oversellRiskScore = 0;
  const antiOversellFlags = [];
  for (const sc of Object.values(scenariosFinal)) {
    if (!sc) continue;
    oversellRiskScore = Math.max(oversellRiskScore, Number(sc.oversell_risk_score) || 0);
    for (const flag of Array.isArray(sc.anti_oversell_flags) ? sc.anti_oversell_flags : []) {
      if (flag && !antiOversellFlags.includes(flag)) antiOversellFlags.push(flag);
    }
    if (sc._skipped) continue;
    const fw = sc.finance_warnings;
    if (!Array.isArray(fw)) continue;
    for (const w of fw) {
      if (w && !nonBlocking.includes(w)) nonBlocking.push(w);
    }
  }

  const shadingSrc = ctx?.form?.installation?.shading ?? ctx?.shading ?? {};
  const vbWarnings = Array.isArray(vbSc?.finance_warnings) ? vbSc.finance_warnings : [];
  const assumptions = {
    consumption_source: consoSrc,
    production_source: pvSrc || null,
    pvgis_fallback_used: pvgisFallback,
    enedis_profile_used: enedisProfileUsed,
    synthetic_consumption_profile: !enedisProfileUsed,
    maintenance_pct: Number(econ.maintenance_pct),
    elec_growth_pct: Number(elecGrowth.elec_growth_pct),
    elec_growth_source: elecGrowth.source,
    elec_growth_missing: elecGrowth.missing,
    horizon_years: Number(econ.horizon_years),
    oa_rate_source: "organization_defaults_and_bracket",
    battery_cost_configured: !(
      ctx?.virtual_battery_input?.enabled === true &&
      vbSc &&
      !vbSc._skipped &&
      vbWarnings.includes("VB_COST_UNCONFIGURED")
    ),
    oversell_risk_score: oversellRiskScore,
    anti_oversell_flags: antiOversellFlags,
    shading_source: shadingSrc.farSource ?? shadingSrc.far_source ?? null,
  };

  return finalizeCalculationConfidence({
    blocking_warnings: blocking,
    non_blocking_warnings: nonBlocking,
    assumptions,
  });
}
