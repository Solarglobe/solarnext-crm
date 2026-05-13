import { normalizeEquipmentBuckets } from "./equipmentNormalize.service.js";

const CSV_HOURLY_RE = /^CSV_HOURLY/i;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function add(flagMap, code, points) {
  if (code) flagMap.set(code, Math.max(flagMap.get(code) ?? 0, points));
}

function scenarioId(sc) {
  return sc?.name ?? sc?.id ?? sc?.scenario_type ?? "BASE";
}

function isVirtualLike(sc) {
  const id = scenarioId(sc);
  return id === "BATTERY_VIRTUAL" || id === "BATTERY_HYBRID";
}

function isBatteryLike(sc) {
  const id = scenarioId(sc);
  return id === "BATTERY_PHYSICAL" || id === "BATTERY_VIRTUAL" || id === "BATTERY_HYBRID";
}

function profileKey(ctx) {
  return String(
    ctx?.form?.conso?.profil ??
      ctx?.form?.params?.profil ??
      ctx?.conso?.profil ??
      ctx?.meta?.consumption_profile ??
      ""
  ).toLowerCase();
}

function isResidential(ctx) {
  const ct = String(
    ctx?.form?.lead?.customer_type ??
      ctx?.form?.customer_type ??
      ctx?.lead?.customer_type ??
      "PERSON"
  ).toUpperCase();
  return ct !== "PRO" && ct !== "COMPANY";
}

function equipmentSignals(ctx) {
  const merged = {
    ...(ctx?.form?.conso || {}),
    ...(ctx?.form?.params || {}),
  };
  const { actuels, avenir } = normalizeEquipmentBuckets(merged);
  const items = [...(actuels?.items || []), ...(avenir?.items || [])];
  let veDay = false;
  let ballonPilote = false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind || "").toLowerCase();
    if (kind === "ve" && String(item.mode_charge || "").toLowerCase() === "jour") veDay = true;
    if (kind === "ballon" && String(item.mode_charge || "").toLowerCase() === "pilote") ballonPilote = true;
  }
  return { veDay, ballonPilote };
}

export function isCommercialUnboundedVirtualBatteryAllowed(ctx = {}) {
  if (ctx?.virtual_battery_input?.allow_unbounded_for_commercial === true) return true;
  if (ctx?.virtual_battery_input?.allow_unbounded_for_debug === true) return true;
  if (ctx?.form?.debug?.allow_virtual_battery_unbounded === true) return true;
  if (ctx?.form?.admin_technical?.allow_virtual_battery_unbounded === true) return true;
  if (process.env.ALLOW_VB_UNBOUNDED_COMMERCIAL === "1") return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.DEBUG_BV_UNBOUNDED === "1") return true;
  return false;
}

export function markVirtualBatteryUnboundedBlocked(scenario, reason = "virtual_battery_unbounded_disabled") {
  if (!scenario || typeof scenario !== "object") return scenario;
  scenario._skipped = true;
  scenario._virtualBatteryQuote = null;
  scenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: reason };
  scenario.energy_independence_pct = null;
  scenario.residual_bill_eur = null;
  scenario.surplus_revenue_eur = null;
  scenario.finance_warnings = Array.from(new Set([
    ...(Array.isArray(scenario.finance_warnings) ? scenario.finance_warnings : []),
    "VB_CAPACITY_AUTO_UNBOUNDED",
    "VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE",
  ]));
  scenario.anti_oversell_flags = Array.from(new Set([
    ...(Array.isArray(scenario.anti_oversell_flags) ? scenario.anti_oversell_flags : []),
    "VB_CAPACITY_AUTO_UNBOUNDED",
    "VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE",
  ]));
  scenario.oversell_risk_score = 100;
  scenario._vb_unbounded_disabled_for_commercial_use = true;
  return scenario;
}

export function assessScenarioAntiOversell(ctx = {}, scenario = {}) {
  const flags = new Map();
  const consoSource = String(ctx?.meta?.engine_consumption_source ?? "UNKNOWN");
  const synthetic = !CSV_HOURLY_RE.test(consoSource);
  const profile = profileKey(ctx);
  const residential = isResidential(ctx);
  const virtualLike = isVirtualLike(scenario);
  const piloted = scenario.scenario_uses_piloted_profile === true;
  const e = scenario.energy || {};
  const production = num(e.production_kwh ?? e.prod ?? scenario.prod_kwh);
  const consumption = num(e.consumption_kwh ?? e.conso ?? scenario.conso_kwh);
  const auto = num(e.autoconsumption_kwh ?? e.auto ?? scenario.auto_kwh);
  const gridImport = num(e.billable_import_kwh ?? e.grid_import_kwh ?? e.import_kwh ?? e.import ?? scenario.import_kwh);
  const pvSelfPct = num(e.pv_self_consumption_pct) ?? (production > 0 && auto != null ? (auto / production) * 100 : null);
  const autonomyPct = num(e.site_autonomy_pct) ?? (consumption > 0 && gridImport != null ? ((consumption - gridImport) / consumption) * 100 : null);
  const { veDay, ballonPilote } = equipmentSignals(ctx);

  if (synthetic) add(flags, "SYNTHETIC_CONSUMPTION_PROFILE", 15);
  if (piloted) add(flags, "PILOTED_PROFILE_USED", 20);
  if (virtualLike) add(flags, "VIRTUAL_BATTERY_USED", 30);
  if (virtualLike && veDay) add(flags, "VE_DAY_WITH_VIRTUAL_BATTERY", 15);
  if (virtualLike && ballonPilote) add(flags, "BALLON_PILOTED_WITH_VIRTUAL_BATTERY", 10);
  if (virtualLike && piloted && ["teletravail", "remote_work"].includes(profile)) add(flags, "TELETRAVAIL_PILOTAGE_VIRTUAL_BATTERY", 15);
  if (residential && profile === "pro") add(flags, "PRO_PROFILE_ON_RESIDENTIAL_LEAD", 20);

  if (!isBatteryLike(scenario) && synthetic && residential) {
    if (autonomyPct != null && autonomyPct > 60) add(flags, "RESIDENTIAL_BASE_AUTONOMY_OVER_60_SYNTHETIC", 30);
    if (pvSelfPct != null && pvSelfPct > 70) add(flags, "RESIDENTIAL_BASE_PV_SELF_CONSUMPTION_OVER_70_SYNTHETIC", 30);
  }
  if (virtualLike) {
    if (autonomyPct != null && autonomyPct > 85) add(flags, "VB_AUTONOMY_OVER_85", 35);
    if (consumption > 0 && gridImport != null && gridImport / consumption < 0.05) add(flags, "VB_IMPORT_NEAR_ZERO", 35);
    const p2 = scenario._virtualBatteryP2 || {};
    if (
      p2.capacity_auto_from_unbounded === true ||
      p2.auto_selected_capacity_from_required === true ||
      scenario._vb_capacity_auto_from_unbounded === true ||
      scenario._vb_unbounded_disabled_for_commercial_use === true
    ) {
      add(flags, "VB_CAPACITY_AUTO_UNBOUNDED", 100);
    }
  }
  if (synthetic && piloted && virtualLike && (autonomyPct == null || autonomyPct > 80)) {
    add(flags, "TOO_PERFECT_SYNTHETIC_PILOTAGE_VB_COMBINATION", 30);
  }

  return {
    anti_oversell_flags: Array.from(flags.keys()),
    oversell_risk_score: Math.min(100, Array.from(flags.values()).reduce((a, b) => a + b, 0)),
  };
}

export function attachAntiOversellToScenarios(ctx = {}, scenarios = {}) {
  for (const [key, sc] of Object.entries(scenarios || {})) {
    if (!sc || typeof sc !== "object") continue;
    const assessment = assessScenarioAntiOversell(ctx, sc);
    sc.anti_oversell_flags = Array.from(new Set([
      ...(Array.isArray(sc.anti_oversell_flags) ? sc.anti_oversell_flags : []),
      ...assessment.anti_oversell_flags,
    ]));
    sc.oversell_risk_score = Math.max(Number(sc.oversell_risk_score) || 0, assessment.oversell_risk_score);
    if (sc.anti_oversell_flags.length > 0) {
      sc.finance_warnings = Array.from(new Set([
        ...(Array.isArray(sc.finance_warnings) ? sc.finance_warnings : []),
        ...sc.anti_oversell_flags,
      ]));
      console.warn("[ANTI_OVERSELL]", key, {
        oversell_risk_score: sc.oversell_risk_score,
        anti_oversell_flags: sc.anti_oversell_flags,
      });
    }
  }
  return scenarios;
}
