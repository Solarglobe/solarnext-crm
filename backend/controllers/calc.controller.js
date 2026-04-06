// ======================================================================
// SMARTPITCH V-LIGHT — Contrôleur principal (Version PRO V12 - corrigé)
// ======================================================================
console.log(">>> CONTROLLER CHARGED OK (V12-PATCHED) <<<");

import { pool } from "../config/db.js";
import { applyPanelPowerFromCatalog } from "../services/pv/resolvePanelFromDb.service.js";
import { resolvePvInverterEngineFields } from "../services/pv/resolveInverterFromDb.service.js";
import { applyPhysicalBatteryTechnicalFromCatalog } from "../services/pv/resolveBatteryFromDb.service.js";
import * as pvgisService from "../services/pvgisService.js";
import * as consumptionService from "../services/consumptionService.js";
import * as solarModelService from "../services/solarModelService.js";
import { buildLegacyPayloadFromSolarNext } from "../services/solarnextAdapter.service.js";
import { computeProductionMultiPan } from "../services/productionMultiPan.service.js";
import {
  resolvePanelPowerWc,
  computeInstalledKwcRounded2,
} from "../utils/resolvePanelPowerWc.js";

import { buildPilotedProfile } from "../services/pilotageService.js";
import { resolvePilotageBudgetFromEquipment } from "../services/pilotageBudgetFromEquipment.service.js";
import { aggregateMonthly } from "../services/monthlyAggregator.js";

import { buildScenario } from "../services/scenarioService.js";
import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { simulateBattery8760 } from "../services/batteryService.js";
import { computeVirtualBatteryAnnualCost } from "../services/virtualBatteryCreditModel.service.js";
import {
  simulateVirtualBattery8760,
  aggregateVirtualBatteryMonthly,
  resolveVirtualBatteryCapacityKwh,
} from "../services/virtualBattery8760.service.js";
import { simulateVirtualBattery8760Unbounded } from "../services/virtualBatteryUnboundedSim.service.js";
import {
  computeVirtualBatteryP2Finance,
  computeVirtualBatteryBusiness,
  selectMySmartTier,
  resolveP2ContractType,
} from "../services/virtualBatteryP2Finance.service.js";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import * as financeService from "../services/financeService.js";
import * as impactService from "../services/impactService.js";
import {
  resolveRetailElectricityKwhPrice,
  resolveOaRateForKwc,
  mergeOrgEconomicsPartial,
} from "../services/economicsResolve.service.js";

function round(n, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

/**
 * Ajoute les KPI énergétiques additionnels au scénario (sans modifier la logique existante).
 * Utilise import_kwh, consumption_kwh, surplus_kwh et les prix du moteur (electricity_price, oa_price).
 */
function addEnergyKpisToScenario(scenario, ctx) {
  const import_kwh = scenario.energy?.import ?? scenario.import_kwh ?? scenario.energy?.import_kwh ?? 0;
  const consumption_kwh = scenario.energy?.conso ?? scenario.conso_kwh ?? scenario.energy?.consumption_kwh ?? 0;
  const surplus_kwh = scenario.energy?.surplus ?? scenario.surplus_kwh ?? 0;
  const electricity_price = resolveRetailElectricityKwhPrice(ctx);
  const kwc = scenario.metadata?.kwc ?? scenario.kwc ?? ctx.pv?.kwc ?? 0;
  const oa_price = resolveOaRateForKwc(ctx, kwc);

  const energy_independence_pct =
    consumption_kwh > 0 ? (1 - import_kwh / consumption_kwh) * 100 : 0;
  const residual_bill_eur = import_kwh * electricity_price;
  const surplus_revenue_eur = surplus_kwh * oa_price;

  scenario.energy_independence_pct = round(energy_independence_pct, 2);
  scenario.residual_bill_eur = round(residual_bill_eur, 2);
  scenario.surplus_revenue_eur = round(surplus_revenue_eur, 2);
}

// ======================================================================
// 🌞 CONTRÔLEUR PRINCIPAL
// ======================================================================
export async function calculateSmartpitch(req, res) {
  const devLog = process.env.NODE_ENV !== "production";
  if (devLog) {
    console.log(">> ROUTE /api/calc HIT");
    console.log("REQ.FILE =", req.file);
  } else {
    console.log("[calc] POST /api/calc");
  }

  try {
    let form, settings;
    let solarnextPayloadForLog = null;

    if (req.body.solarnext_payload) {
      solarnextPayloadForLog =
        typeof req.body.solarnext_payload === "string"
          ? JSON.parse(req.body.solarnext_payload)
          : req.body.solarnext_payload;
      const adapted = buildLegacyPayloadFromSolarNext(solarnextPayloadForLog);
      form = adapted.form;
      settings = adapted.settings;
    } else {
      form =
        typeof req.body.form === "string"
          ? JSON.parse(req.body.form)
          : req.body.form || {};
      settings =
        typeof req.body.settings === "string"
          ? JSON.parse(req.body.settings)
          : req.body.settings || {};
    }

    if (!form || typeof form !== "object") {
      console.error("[SMARTPITCH ERROR] Missing params", { someObject: form });
      throw new Error("SMARTPITCH_PARAMS_MISSING");
    }
    if (!form.params || typeof form.params !== "object") {
      form.params = {};
    }
    if (settings == null || typeof settings !== "object") {
      settings = {};
    }

    if (form.panel_input && typeof form.panel_input === "object") {
      form.panel_input = await applyPanelPowerFromCatalog(pool, form.panel_input);
    }
    if (form.pv_inverter && typeof form.pv_inverter === "object") {
      form.pv_inverter = await resolvePvInverterEngineFields(pool, null, form.pv_inverter);
    }
    // Même chaîne que solarnextPayloadBuilder : technique batterie = pv_batteries si UUID actif (idempotent si déjà mergé).
    if (form.battery_input && typeof form.battery_input === "object") {
      const bi = form.battery_input;
      const physicalConfig = {
        enabled: bi.enabled === true,
        batteryId: bi.battery_id ?? bi.batteryId ?? bi.id ?? null,
        battery_id: bi.battery_id ?? bi.batteryId ?? bi.id ?? null,
        product_snapshot:
          bi.product_snapshot && typeof bi.product_snapshot === "object" ? bi.product_snapshot : null,
      };
      form.battery_input = await applyPhysicalBatteryTechnicalFromCatalog(pool, physicalConfig, bi);
    }

    const payload = solarnextPayloadForLog || req.body || {};
    console.log("[SMARTPITCH INPUT]", {
      hasPayload: !!payload,
      hasConso: !!payload?.conso,
      hasProduction: !!payload?.production,
      hasCalpinage: !!payload?.calpinage,
    });

    // ===== DEBUG SOLARNEXT (jamais de dump form/settings en production — RGPD) =====
    if (devLog) {
      console.log("\n\n==============================");
      console.log("===== FORM JSON START =====");
      try {
        console.log(JSON.stringify(form, null, 2));
      } catch (e) {
        console.log("FORM stringify failed");
      }
      console.log("===== FORM JSON END =====");
      console.log("==============================\n");

      console.log("\n\n==============================");
      console.log("===== SETTINGS JSON START =====");
      try {
        console.log(JSON.stringify(settings, null, 2));
      } catch (e) {
        console.log("SETTINGS stringify failed");
      }
      console.log("===== SETTINGS JSON END =====");
      console.log("==============================\n");
    } else {
      console.log("[calc] payload reçu (prod): solarnext_payload=", Boolean(req.body.solarnext_payload));
    }

// ===== FIN DEBUG =====

    // ------------------------------------------------------------
    // 0) Contexte global
    // ------------------------------------------------------------
    const ctx = buildContext(form, settings);
    ctx.form = form;
    ctx.finance_input = form?.finance_input ?? null;
    ctx.battery_input = form?.battery_input ?? null;
    ctx.virtual_battery_input = form?.virtual_battery_input ?? null;
    console.log("STEP 0 OK — Contexte construit");
    console.log("[D2] battery_input.enabled =", ctx.battery_input?.enabled);
    console.log("[D2] battery_input.capacity_kwh =", ctx.battery_input?.capacity_kwh);
    console.log("[D2] virtual_battery_input.enabled =", ctx.virtual_battery_input?.enabled);

    // ------------------------------------------------------------
    // FORÇAGE — Version PRO unifiée (Pipeline identique au normal)
    // ------------------------------------------------------------

    // 1) Puissance forcée (kWc)
    const force_kwc = Number(form?.forcage?.puissance_kwc || 0);

    // 2) Prix forcés
    const force_prix_sans = Number(form?.forcage?.prix_force_sans || 0);
    const force_prix_avec = Number(form?.forcage?.prix_force_avec || 0);

    // 3) Respect strict
    const force_respect = Boolean(form?.forcage?.respecter);

    // 4) Batterie forcée ?
    const force_batt =
      form?.forcage?.batterie === true ||
      form?.forcage?.batterie === "oui" ||
      form?.forcage?.batterie === "Oui" ||
      form?.forcage?.batterie === "OUI";

    // 5) Capacité forcée batterie
    const force_batt_kwh = Number(form?.forcage?.capacite_batterie || 0);

    // 6) Contexte forçage
    ctx.force = {
      active: force_respect && (force_kwc > 0 || force_prix_sans > 0 || force_prix_avec > 0),
      kwc: force_kwc,
      prix_sans: force_prix_sans,
      prix_avec: force_prix_avec,
      batterie: {
        active: force_batt,
        kwh: force_batt_kwh
      }
    };

    if (devLog) {
      console.log("FORCAGE CONTEXTE =", ctx.force);
    }

// ------------------------------------------------------------
// 1) CONSOMMATION 8760h — Si un CSV existe (upload ou csv_path résolu backend), le moteur l'utilise obligatoirement (aucun profil synthétique).
// ------------------------------------------------------------
const csvPath =
  req.file?.path ||
  form?.conso?.csv_path ||
  null;

// Log temporaire — décision source conso (répété ici pour traçabilité dans les logs calc)
if (devLog) {
  console.log(JSON.stringify({
    tag: "CONSO_SOURCE_DECISION",
    source: csvPath ? "CSV" : "SYNTHETIC",
    csvPath: csvPath ?? null,
  }));
  console.log(JSON.stringify({
    tag: "DEBUG CSV RECEIVED BY CALC",
    csvPath: csvPath ?? null,
  }));
  console.log("DEBUG_CALC_CSV_PATH", csvPath);
  if (!csvPath && form?.conso) {
    console.log(JSON.stringify({
      tag: "CALC_CSV_PATH_NULL",
      has_conso: true,
      csv_path_from_form: form.conso.csv_path ?? null,
      conso_keys: Object.keys(form.conso || {}),
    }));
  }
} else {
  console.log(JSON.stringify({
    tag: "CONSO_SOURCE_DECISION",
    source: csvPath ? "CSV" : "SYNTHETIC",
  }));
}

// Fusion conso + params (pour envoyer puissance_kva) — form.params garanti objet après parsing
const mergedConso = {
  ...form.conso,
  ...form.params
};

const studyId = form?.studyId ?? req.body?.studyId ?? null;
const versionId = form?.versionId ?? req.body?.versionId ?? null;
const leadId = form?.lead_id ?? form?.leadId ?? req.body?.leadId ?? null;
if (devLog) {
  console.log(JSON.stringify({
    tag: "DEBUG_CALC_BEFORE_LOAD_CONSUMPTION",
    studyId,
    versionId,
    leadId,
    csvPath,
  }));
} else {
  console.log(JSON.stringify({
    tag: "DEBUG_CALC_BEFORE_LOAD_CONSUMPTION",
    studyId,
    versionId,
    leadId,
    hasCsv: Boolean(csvPath),
  }));
}

// Chargement : ordre 1 CSV, 2 hourly_prebuilt, 3 manual, 4 national. CSV prioritaire sur tout.
const _consoBase = consumptionService.loadConsumption(mergedConso, csvPath);
const conso = consumptionService.applyEquipmentShape(_consoBase, mergedConso, Boolean(csvPath));

// Conso injectée dans ctx = source unique pour scenarioBuilderV2 (hourly + annual_kwh = SUM(hourly))
const load8760Sum = (conso.hourly || []).reduce((a, b) => a + (Number(b) || 0), 0);
const annualExact = load8760Sum;
if (process.env.NODE_ENV !== "production") {
  console.log("DEBUG_FINAL_CONSUMPTION_USED", annualExact);
}
if (Math.abs(load8760Sum - (conso.annual_kwh ?? 0)) >= 0.1) {
  console.warn("CONSO_COHERENCE: |sum(hourly) - annual_kwh| >= 0.1");
  if (devLog) {
    console.warn({
      sum_hourly: load8760Sum,
      annual_kwh: conso.annual_kwh
    });
  }
}

// Valeurs utilisées par scenarioBuilderV2 : hourly et annual_kwh = SUM(hourly)
ctx.conso = {
  hourly: conso.hourly,
  annual_kwh: annualExact,
  clamped: conso.hourly
};

// META
ctx.meta.conso_annuelle_kwh = annualExact;

if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
  const h = ctx.conso.hourly || [];
  const sumH = h.reduce((a, b) => a + b, 0);
  const minH = h.length ? Math.min(...h) : null;
  const maxH = h.length ? Math.max(...h) : null;
  const meanH = h.length ? sumH / h.length : null;
  console.log(JSON.stringify({
    tag: "TRACE_CTX_CONSO",
    hourly_length: h.length,
    sum_hourly: sumH,
    min_kwh: minH,
    max_kwh: maxH,
    mean_kwh: meanH,
    annual_kwh: ctx.conso.annual_kwh,
    first5_kwh: h.slice(0, 5),
    last5_kwh: h.slice(-5),
  }));
}

if (devLog) {
  console.log("LOAD_8760_SUM =", load8760Sum);
  console.log("STEP 1 OK — Conso 8760 chargée (" + annualExact + " kWh)");
} else {
  console.log("STEP 1 OK — Conso 8760 chargée");
}


    // ------------------------------------------------------------
    // 2) PRODUCTION PV MENSUELLE (mono-pan ou multi-pan)
    // ------------------------------------------------------------
    // Ombrage : une seule application sur la courbe PV.
    // - Mono-pan (pas de form.roof.pans) : form.shadingLossPct (payload installation.shading_loss_pct)
    //   appliqué une fois sur le mensuel PVGIS (voir branche else ci-dessous).
    // - Multi-pan : uniquement pan.shadingCombinedPct dans computeProductionMultiPan (pas de
    //   multiplication par form.shadingLossPct — évite double pénalisation). Le scalaire
    //   shading_loss_pct du payload sert de KPI aligné moyenne pondérée (buildSolarNextPayload).
    const roofPans = form.roof?.pans;
    const useMultiPan = Array.isArray(roofPans) && roofPans.length > 0;

    let productionMultiPan = null;

    if (useMultiPan) {
      // moduleWp : puissance réelle du panneau (résolution unifiée), sinon settings (rétrocompatible)
      const resolvedModuleWp = resolvePanelPowerWc(form?.panel_input) ?? undefined;
      const multiResult = await computeProductionMultiPan({
        site: ctx.site,
        settings: ctx.settings,
        pans: roofPans,
        moduleWp: resolvedModuleWp,
        pv_inverter: form.pv_inverter,
      });
      productionMultiPan = multiResult;
      const pvHourly = solarModelService.buildHourlyPV(multiResult.monthlyKwh, ctx);
      const maxPanelsMp = Math.floor(Number(form?.maison?.panneaux_max || 0));
      const panelWcMp = resolvePanelPowerWc(form?.panel_input);
      const installedKwcMp =
        panelWcMp != null && maxPanelsMp > 0
          ? computeInstalledKwcRounded2(maxPanelsMp, panelWcMp)
          : null;
      ctx.pv = {
        hourly: pvHourly,
        monthly_raw: multiResult.monthlyKwh,
        monthly: multiResult.monthlyKwh,
        total_raw_kwh: multiResult.annualKwh,
        total_kwh: multiResult.annualKwh,
        source: "PVGIS-MultiPan+HourlyModelAC",
        fromMultiPan: true,
        ...(installedKwcMp != null ? { kwc: installedKwcMp, panelsCount: maxPanelsMp } : {}),
      };
      ctx.productionMultiPan = productionMultiPan;
      if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
        const pvH = ctx.pv.hourly || [];
        const sumPv = pvH.reduce((a, b) => a + b, 0);
        console.log(JSON.stringify({
          tag: "TRACE_CTX_PV",
          source: "multiPan",
          hourly_length: pvH.length,
          sum_hourly: sumPv,
          total_kwh: ctx.pv.total_kwh,
          first5_kwh: pvH.slice(0, 5),
          last5_kwh: pvH.slice(-5),
          monthly: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly : null,
          monthly_sum: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly.reduce((a, b) => a + b, 0) : null,
        }));
      }
      console.log("STEP 2 OK — PV multi-pan (pans =", roofPans.length, ")");
    } else {
      const pvMonthly = await pvgisService.computeProductionMonthly(ctx);
      console.log("STEP 2 OK — PV mensuel (source =", pvMonthly.source, ")");

      const shadingLossPct = Number(form.shadingLossPct || 0);
      if (!isNaN(shadingLossPct) && shadingLossPct > 0) {
        const multiplier = 1 - Math.max(0, Math.min(100, shadingLossPct)) / 100;
        if (pvMonthly.monthly_kwh && Array.isArray(pvMonthly.monthly_kwh)) {
          pvMonthly.monthly_kwh = pvMonthly.monthly_kwh.map(v => v * multiplier);
        }
        if (typeof pvMonthly.annual_kwh === "number") {
          pvMonthly.annual_kwh = pvMonthly.annual_kwh * multiplier;
        }
      }

      const kwc = resolveKwcMono(form, ctx.settings);
      const monthly_total = (pvMonthly.monthly_kwh || []).map((v) => (Number(v) || 0) * kwc);
      const pvHourly = solarModelService.buildHourlyPV(monthly_total, ctx);
      const annual_total = monthly_total.reduce((a, b) => a + b, 0);
      ctx.pv = {
        hourly: pvHourly,
        kwc,
        monthly_raw: pvMonthly.monthly_raw_kwh,
        monthly: monthly_total,
        total_raw_kwh: pvMonthly.annual_raw_kwh != null ? pvMonthly.annual_raw_kwh * kwc : null,
        total_kwh: annual_total,
        source: pvMonthly.source + "+HourlyModelAC",
      };
      if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
        const pvH = ctx.pv.hourly || [];
        const sumPv = pvH.reduce((a, b) => a + b, 0);
        console.log(JSON.stringify({
          tag: "TRACE_CTX_PV",
          source: "mono",
          hourly_length: pvH.length,
          sum_hourly: sumPv,
          total_kwh: ctx.pv.total_kwh,
          first5_kwh: pvH.slice(0, 5),
          last5_kwh: pvH.slice(-5),
          monthly: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly : null,
          monthly_sum: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly.reduce((a, b) => a + b, 0) : null,
        }));
      }
    }

    // ------------------------------------------------------------
    // Clipping onduleur : écrêtage de la production horaire à la puissance nominale AC totale.
    // Appliqué après les deux branches (multi-pan et mono) sur ctx.pv.hourly.
    // Sans effet si pv_inverter.inverter_nominal_kw_total est absent ou nul (rétrocompatible).
    // ------------------------------------------------------------
    const _inverterNominalKwTotal = form?.pv_inverter?.inverter_nominal_kw_total;
    if (
      _inverterNominalKwTotal != null &&
      Number.isFinite(Number(_inverterNominalKwTotal)) &&
      Number(_inverterNominalKwTotal) > 0 &&
      Array.isArray(ctx.pv?.hourly)
    ) {
      const _cap = Number(_inverterNominalKwTotal);
      let _clippedKwh = 0;
      ctx.pv.hourly = ctx.pv.hourly.map((h) => {
        const hh = Number(h) || 0;
        if (hh > _cap) {
          _clippedKwh += hh - _cap;
          return _cap;
        }
        return hh;
      });
      if (_clippedKwh > 0.1) {
        ctx.pv.clipped_kwh = Math.round(_clippedKwh * 10) / 10;
        if (process.env.NODE_ENV !== "production") {
          console.log(`[INVERTER CLIPPING] nominalKw=${_cap} clipped=${_clippedKwh.toFixed(1)} kWh`);
        }
      }
      ctx.pv.total_kwh = Math.round(ctx.pv.hourly.reduce((a, b) => a + b, 0) * 100) / 100;
    }

    // ------------------------------------------------------------
    // 3) PRODUCTION PV HORAIRE (déjà rempli ci-dessus)
    // ------------------------------------------------------------
    console.log("STEP 3 OK — PV horaire AC généré");

    // ------------------------------------------------------------
    // 4) PILOTAGE
    // PILOTAGE_BUDGET_MODE=legacy (défaut) → parts 35/20/10 inchangées.
    // PILOTAGE_BUDGET_MODE=equipment_prudent → budget dérivé des équipements (plafonné).
    // ------------------------------------------------------------
    const pilotageBudget = resolvePilotageBudgetFromEquipment(mergedConso, {});
    const pilotage = buildPilotedProfile(
      conso.hourly,
      ctx.pv.hourly,
      pilotageBudget ? { pilotageBudget } : {}
    );
    ctx.conso_p_pilotee = pilotage.conso_pilotee_hourly;

    console.log("STEP 4 OK — Pilotage équilibré appliqué");

    // ------------------------------------------------------------
    // 5) CALCUL PRINCIPAL (BASE + BATTERY_PHYSICAL si batterie valide)
    // ------------------------------------------------------------
    function sanitizeForD3Log(obj, maxArrayLen = 5) {
      if (obj == null) return obj;
      if (Array.isArray(obj)) {
        if (obj.length > maxArrayLen) return `[Array(${obj.length})]`;
        return obj.map((v) => sanitizeForD3Log(v, maxArrayLen));
      }
      if (typeof obj === "object") {
        const out = {};
        for (const k of Object.keys(obj)) out[k] = sanitizeForD3Log(obj[k], maxArrayLen);
        return out;
      }
      return obj;
    }
    if (devLog) {
      console.log("[D3] ctx payload =", JSON.stringify(sanitizeForD3Log(ctx), null, 2));
      console.log("DEBUG_CALC_INPUT", {
        payload_conso: ctx.conso?.annual_kwh,
        hourly_len: ctx.conso?.hourly?.length
      });
    }
    console.log("STEP 5 — Calcul BASE…");
    const scenarios = await buildBaseScenarioOnly(ctx);
    console.log("STEP 5 OK — Calcul BASE généré");

    const baseScenario = scenarios.BASE;
    addEnergyKpisToScenario(baseScenario, ctx);

    const batteryEnabled = ctx.battery_input?.enabled === true && Number(ctx.battery_input?.capacity_kwh) > 0;

    if (batteryEnabled) {
      const consoHourly = ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped;
      const hasConso8760 = Array.isArray(consoHourly) && consoHourly.length === 8760;

      if (!hasConso8760) {
        const skipped = JSON.parse(JSON.stringify(baseScenario));
        skipped.name = "BATTERY_PHYSICAL";
        skipped.battery = true;
        skipped.batterie = true;
        skipped._v2 = true;
        skipped._skipped = true;
        skipped.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "battery_skipped" };
        skipped.capex_ttc = null;
        skipped.roi_years = null;
        skipped.irr_pct = null;
        skipped.flows = null;
        scenarios.BATTERY_PHYSICAL = skipped;
      } else {
        const batt = simulateBattery8760({
          pv_hourly: ctx.pv.hourly,
          conso_hourly: consoHourly,
          battery: ctx.battery_input,
        });

        if (!batt.ok) {
          const skipped = JSON.parse(JSON.stringify(baseScenario));
          skipped.name = "BATTERY_PHYSICAL";
          skipped.battery = true;
          skipped.batterie = true;
          skipped._v2 = true;
          skipped._skipped = true;
          skipped.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "battery_skipped" };
          skipped.capex_ttc = null;
          skipped.roi_years = null;
          skipped.irr_pct = null;
          skipped.flows = null;
          scenarios.BATTERY_PHYSICAL = skipped;
        } else {
          // Monthly exclusivement à partir des flux post-batterie (auto_hourly, surplus_hourly) + PV/conso inchangés
          const monthlyBatt = aggregateMonthly(ctx.pv.hourly, consoHourly, batt);
          const batteryScenario = JSON.parse(JSON.stringify(baseScenario));
          batteryScenario.name = "BATTERY_PHYSICAL";
          batteryScenario.battery = {
            enabled: true,
            annual_charge_kwh: batt.annual_charge_kwh,
            annual_discharge_kwh: batt.annual_discharge_kwh,
            annual_throughput_kwh: batt.annual_throughput_kwh,
            equivalent_cycles: batt.equivalent_cycles,
            daily_cycles_avg: batt.daily_cycles_avg,
            battery_utilization_rate: batt.battery_utilization_rate,
          };
          batteryScenario.batterie = true;
          batteryScenario._v2 = true;

          const batteryLossesKwh = batt.battery_losses_kwh ?? 0;
          batteryScenario.energy = {
            prod: baseScenario.energy.prod,
            auto: batt.auto_kwh,
            surplus: batt.surplus_kwh,
            import: batt.grid_import_kwh ?? 0,
            conso: baseScenario.energy.conso,
            battery_losses_kwh: batteryLossesKwh,
            monthly: monthlyBatt.map(m => ({
              prod: m.prod_kwh,
              conso: m.conso_kwh,
              auto: m.auto_kwh,
              surplus: m.surplus_kwh,
              import: m.import_kwh,
              batt: m.batt_kwh,
            })),
            hourly: null,
          };

          batteryScenario.prod_kwh = baseScenario.energy.prod;
          batteryScenario.auto_kwh = batt.auto_kwh;
          batteryScenario.surplus_kwh = batt.surplus_kwh;
          batteryScenario.conso_kwh = baseScenario.conso_kwh;
          batteryScenario.monthly = monthlyBatt;
          batteryScenario.annual = {
            prod_kwh: baseScenario.energy.prod,
            conso_kwh: baseScenario.conso_kwh,
            auto_kwh: batt.auto_kwh,
            surplus_kwh: batt.surplus_kwh,
          };

          const baseCapexTtc = ctx.finance_input?.capex_ttc ?? 0;
          const batteryPhysicalPriceTtc = ctx.finance_input?.battery_physical_price_ttc ?? 0;
          batteryScenario.capex_ttc =
            (baseCapexTtc != null && Number.isFinite(Number(baseCapexTtc)) ? Number(baseCapexTtc) : 0) +
            (batteryPhysicalPriceTtc != null && Number.isFinite(Number(batteryPhysicalPriceTtc)) ? Number(batteryPhysicalPriceTtc) : 0);
          addEnergyKpisToScenario(batteryScenario, ctx);
          scenarios.BATTERY_PHYSICAL = batteryScenario;

          const sumAuto = monthlyBatt.reduce((a, m) => a + m.auto_kwh, 0);
          const sumSurplus = monthlyBatt.reduce((a, m) => a + m.surplus_kwh, 0);
          const tol = 5;
          const battLosses = batteryScenario.energy.battery_losses_kwh ?? 0;
          if (process.env.NODE_ENV !== "production" && Math.abs((batteryScenario.energy.auto + batteryScenario.energy.surplus + battLosses) - batteryScenario.energy.prod) > tol) {
            console.warn("BATTERY MONTHLY INCONSISTENT: auto+surplus+losses=", batteryScenario.energy.auto + batteryScenario.energy.surplus + battLosses, "prod=", batteryScenario.energy.prod);
          }
          if (process.env.NODE_ENV !== "production" && (Math.abs(sumAuto - batt.auto_kwh) > tol || Math.abs(sumSurplus - batt.surplus_kwh) > tol)) {
            console.warn("BATTERY MONTHLY SUM MISMATCH: Σmonthly.auto=", sumAuto, "energy.auto=", batt.auto_kwh, "| Σmonthly.surplus=", sumSurplus, "energy.surplus=", batt.surplus_kwh);
          }
          if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
            const prodP = batteryScenario.energy.prod;
            const consoP = batteryScenario.energy.conso;
            const autoP = batt.auto_kwh;
            const surplusP = batt.surplus_kwh;
            const importP = batt.grid_import_kwh ?? 0;
            const idConso = Math.abs((autoP + importP) - consoP);
            const idProd = Math.abs((autoP + surplusP) - prodP);
            console.log(JSON.stringify({
              tag: "TRACE_SCENARIO_BATT_PHYSICAL",
              prodKwh: prodP,
              consoKwh: consoP,
              autoKwh: autoP,
              surplusKwh: surplusP,
              importKwh: importP,
              identity_abs_auto_plus_import_minus_conso: idConso,
              identity_abs_auto_plus_surplus_minus_pv: idProd,
            }));
          }
        }
      }
    }

    if (ctx.virtual_battery_input?.enabled === true) {
      const virtualScenario = JSON.parse(JSON.stringify(baseScenario));
      virtualScenario.name = "BATTERY_VIRTUAL";
      virtualScenario.battery = "virtual";
      virtualScenario.batterie = "virtual";
      virtualScenario._v2 = true;

      const consoHourlyVirtual = ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped;
      const hasConso8760Vb = Array.isArray(consoHourlyVirtual) && consoHourlyVirtual.length === 8760;
      const hasPv8760Vb = Array.isArray(ctx.pv?.hourly) && ctx.pv.hourly.length === 8760;

      if (!hasConso8760Vb || !hasPv8760Vb) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("BATTERY_VIRTUAL: profils 8760h requis (conso + PV) — scénario ignoré");
        }
        virtualScenario._virtualBatteryQuote = null;
        virtualScenario._skipped = true;
        virtualScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "virtual_battery_skipped" };
        virtualScenario.energy_independence_pct = null;
        virtualScenario.residual_bill_eur = null;
        virtualScenario.surplus_revenue_eur = null;
      } else {
        const vbInput = ctx.virtual_battery_input || {};
        const providerRaw = vbInput.provider_code || vbInput.provider;
        const P2_PROVIDERS = new Set(["URBAN_SOLAR", "MYLIGHT_MYBATTERY", "MYLIGHT_MYSMARTBATTERY"]);
        const useP2 = providerRaw && P2_PROVIDERS.has(String(providerRaw).toUpperCase());

        const meterKva = Number(ctx.site?.puissance_kva ?? ctx.form?.params?.puissance_kva ?? 9);
        const installedKwc =
          baseScenario.kwc ??
          baseScenario.metadata?.kwc ??
          ctx.pv?.kwc ??
          resolveKwcMono(ctx.form, ctx.settings);

        let vbSim = null;

        if (useP2) {
          const unbounded = simulateVirtualBattery8760Unbounded({
            pv_hourly: ctx.pv.hourly,
            conso_hourly: consoHourlyVirtual,
          });
          if (!unbounded.ok) {
            if (process.env.NODE_ENV !== "production") {
              console.warn("BATTERY_VIRTUAL P2: simulation sans plafond refusée —", unbounded.reason);
            }
            virtualScenario._virtualBatteryQuote = null;
            virtualScenario._skipped = true;
            virtualScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "virtual_battery_skipped" };
            virtualScenario.energy_independence_pct = null;
            virtualScenario.residual_bill_eur = null;
            virtualScenario.surplus_revenue_eur = null;
            vbSim = null;
          } else {
            const requiredCap = unbounded.required_capacity_kwh;
            const pc = String(providerRaw).toUpperCase();
            let simCapacityKwh;
            if (pc === "MYLIGHT_MYSMARTBATTERY") {
              const tierPick = selectMySmartTier(requiredCap);
              if (!tierPick.ok) {
                virtualScenario.provider_tier_status = "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY";
                virtualScenario.virtual_battery_finance = null;
                virtualScenario.virtual_battery_business = null;
                virtualScenario._virtualBatteryQuote = null;
                virtualScenario._skipped = true;
                virtualScenario._p2_skip_reason = "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY";
                virtualScenario.p2_notes = [
                  `Capacité utile requise ${requiredCap} kWh : aucun palier MySmart catalogue ≥ besoin (plafond 10 000 kWh). Aucune simulation contractuelle, aucun abonnement ni montant tarifaire calculé.`,
                ];
                virtualScenario._virtualBatteryP2 = {
                  required_capacity_kwh: requiredCap,
                  provider_tier_status: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY",
                  diagnostic_unbounded_non_contractual: {
                    required_capacity_kwh: unbounded.required_capacity_kwh,
                    virtual_battery_total_charged_kwh: unbounded.virtual_battery_total_charged_kwh,
                    virtual_battery_total_discharged_kwh: unbounded.virtual_battery_total_discharged_kwh,
                    virtual_battery_overflow_export_kwh: unbounded.virtual_battery_overflow_export_kwh,
                    disclaimer:
                      "Valeurs indicatives profil sans palier contractuel — ne pas présenter comme offre chiffrée.",
                  },
                };
                virtualScenario.finance = {
                  roi_years: null,
                  irr: null,
                  lcoe: null,
                  cashflows: null,
                  note: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY",
                };
                virtualScenario.energy_independence_pct = null;
                virtualScenario.residual_bill_eur = null;
                virtualScenario.surplus_revenue_eur = null;
                vbSim = null;
              } else {
                simCapacityKwh = tierPick.selected_capacity_kwh;
                vbSim = simulateVirtualBattery8760({
                  pv_hourly: ctx.pv.hourly,
                  conso_hourly: consoHourlyVirtual,
                  config: { ...vbInput, capacity_kwh: simCapacityKwh },
                });
                virtualScenario._virtualBatteryP2 = {
                  required_capacity_kwh: requiredCap,
                  simulation_capacity_kwh: simCapacityKwh,
                  provider_tier_status: "OK",
                };
              }
            } else {
              simCapacityKwh = Math.max(requiredCap, 1e-9);
              vbSim = simulateVirtualBattery8760({
                pv_hourly: ctx.pv.hourly,
                conso_hourly: consoHourlyVirtual,
                config: { ...vbInput, capacity_kwh: simCapacityKwh },
              });
              virtualScenario._virtualBatteryP2 = {
                required_capacity_kwh: requiredCap,
                simulation_capacity_kwh: simCapacityKwh,
              };
            }
          }
        } else {
          let vbConfig = { ...(ctx.virtual_battery_input || {}) };
          if (resolveVirtualBatteryCapacityKwh(vbConfig) == null) {
            const physCap =
              ctx.battery_input?.enabled === true && ctx.battery_input?.capacity_kwh != null
                ? Number(ctx.battery_input.capacity_kwh)
                : null;
            if (physCap != null && physCap > 0) {
              vbConfig.capacity_kwh = physCap;
            }
          }
          if (resolveVirtualBatteryCapacityKwh(vbConfig) == null) {
            const ub = simulateVirtualBattery8760Unbounded({
              pv_hourly: ctx.pv.hourly,
              conso_hourly: consoHourlyVirtual,
            });
            if (ub.ok && Number(ub.required_capacity_kwh) > 0) {
              vbConfig.capacity_kwh = Math.max(Number(ub.required_capacity_kwh), 1e-9);
            }
          }
          vbSim = simulateVirtualBattery8760({
            pv_hourly: ctx.pv.hourly,
            conso_hourly: consoHourlyVirtual,
            config: vbConfig,
          });
        }

        if (!virtualScenario._skipped && (!vbSim || !vbSim.ok)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("BATTERY_VIRTUAL: simulation 8760h refusée —", vbSim?.reason);
          }
          virtualScenario._virtualBatteryQuote = null;
          virtualScenario._skipped = true;
          virtualScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "virtual_battery_skipped" };
          virtualScenario.energy_independence_pct = null;
          virtualScenario.residual_bill_eur = null;
          virtualScenario.surplus_revenue_eur = null;
        } else if (!virtualScenario._skipped) {
          const monthlyVirt = aggregateMonthly(ctx.pv.hourly, consoHourlyVirtual, vbSim);
          const billableMonthly = aggregateVirtualBatteryMonthly(
            vbSim.virtual_battery_hourly_grid_import_kwh,
            vbSim.virtual_battery_hourly_charge_kwh,
            vbSim.virtual_battery_hourly_discharge_kwh,
            vbSim.virtual_battery_hourly_credit_balance_kwh
          );

          const creditResult = {
            ok: true,
            billable_import_kwh: vbSim.grid_import_kwh,
            credited_kwh: vbSim.virtual_battery_total_charged_kwh,
            used_credit_kwh: vbSim.virtual_battery_total_discharged_kwh,
            remaining_credit_kwh: vbSim.virtual_battery_credit_end_kwh,
            billable_monthly: billableMonthly,
            lost_kwh: 0,
          };

          const production = baseScenario.energy?.production_kwh ?? baseScenario.energy?.prod ?? baseScenario.prod_kwh ?? 0;
          const consumption = baseScenario.energy?.consumption_kwh ?? baseScenario.energy?.conso ?? baseScenario.conso_kwh ?? 0;
          const autoBase = baseScenario.energy?.autoconsumption_kwh ?? baseScenario.energy?.auto ?? baseScenario.auto_kwh ?? 0;

          const credited_kwh = creditResult.credited_kwh ?? 0;
          const billable_import_kwh = creditResult.billable_import_kwh ?? 0;
          const used_credit_kwh = creditResult.used_credit_kwh ?? 0;
          const remaining_credit_kwh = creditResult.remaining_credit_kwh ?? 0;

          const autoproduction_kwh = autoBase + used_credit_kwh;
          const autoconsumption_kwh = autoBase;
          const self_consumption_pct = production > 0 ? (autoconsumption_kwh / production) * 100 : 0;
          const self_production_pct = consumption > 0 ? (autoproduction_kwh / consumption) * 100 : 0;

          const contractType = resolveP2ContractType(vbInput, ctx);
          const tariffKwh = resolveRetailElectricityKwhPrice(ctx);
          const oaRate = resolveOaRateForKwc(ctx, installedKwc);

          let subscriptionAnnual;

          virtualScenario.energy = {
            ...(virtualScenario.energy || {}),
            prod: baseScenario.energy.prod,
            auto: vbSim.auto_kwh,
            surplus: vbSim.surplus_kwh,
            import: billable_import_kwh,
            conso: baseScenario.energy.conso,
            monthly: monthlyVirt.map(m => ({
              prod: m.prod_kwh,
              conso: m.conso_kwh,
              auto: m.auto_kwh,
              surplus: m.surplus_kwh,
              import: m.import_kwh,
              batt: m.batt_kwh,
            })),
            hourly: null,
            production_kwh: production,
            consumption_kwh: consumption,
            autoconsumption_kwh: autoconsumption_kwh,
            autoproduction_kwh: autoproduction_kwh,
            import_kwh: billable_import_kwh,
            surplus_kwh: vbSim.surplus_kwh,
            credited_kwh,
            used_credit_kwh,
            remaining_credit_kwh,
            billable_import_kwh,
            billable_monthly: creditResult.billable_monthly,
            virtual_battery_overflow_export_kwh: vbSim.virtual_battery_overflow_export_kwh,
            restored_kwh: used_credit_kwh,
            overflow_export_kwh: vbSim.virtual_battery_overflow_export_kwh ?? 0,
            grid_import_kwh: billable_import_kwh,
            grid_export_kwh: vbSim.surplus_kwh ?? 0,
          };
          virtualScenario.energy.import = billable_import_kwh;
          virtualScenario.billable_import_kwh = billable_import_kwh;
          virtualScenario.credited_kwh = credited_kwh;
          virtualScenario.used_credit_kwh = used_credit_kwh;
          virtualScenario.remaining_credit_kwh = remaining_credit_kwh;
          virtualScenario.billable_monthly = creditResult.billable_monthly;
          virtualScenario.import_kwh = billable_import_kwh;
          virtualScenario.autoproduction_kwh = autoproduction_kwh;
          virtualScenario.autoconsumption_kwh = autoconsumption_kwh;
          virtualScenario.self_consumption_pct = Math.round(self_consumption_pct * 100) / 100;
          virtualScenario.self_production_pct = Math.round(self_production_pct * 100) / 100;
          virtualScenario.prod_kwh = baseScenario.energy.prod;
          virtualScenario.auto_kwh = vbSim.auto_kwh;
          virtualScenario.surplus_kwh = vbSim.surplus_kwh;
          virtualScenario.conso_kwh = baseScenario.conso_kwh;
          virtualScenario.monthly = monthlyVirt;
          virtualScenario.annual = {
            prod_kwh: baseScenario.energy.prod,
            conso_kwh: baseScenario.conso_kwh,
            auto_kwh: vbSim.auto_kwh,
            surplus_kwh: vbSim.surplus_kwh,
          };
          const vbCapKwh =
            vbSim.virtual_battery_capacity_kwh ??
            ctx.virtual_battery_input?.capacity_kwh ??
            virtualScenario._virtualBatteryP2?.simulation_capacity_kwh ??
            null;
          const vbCharged = vbSim.virtual_battery_total_charged_kwh ?? 0;
          const vbDischarged = vbSim.virtual_battery_total_discharged_kwh ?? 0;
          virtualScenario.battery_virtual = {
            enabled: true,
            capacity_simulated_kwh: vbCapKwh,
            annual_charge_kwh: vbCharged,
            annual_discharge_kwh: vbDischarged,
            annual_throughput_kwh: vbCharged + vbDischarged,
            credited_kwh: vbCharged,
            restored_kwh: vbDischarged,
            overflow_export_kwh: vbSim.virtual_battery_overflow_export_kwh ?? 0,
            cycles_equivalent:
              vbCapKwh > 0 && Number.isFinite(vbDischarged)
                ? vbDischarged / vbCapKwh
                : null,
          };

          virtualScenario._virtualBattery8760 = {
            virtual_battery_capacity_kwh: vbSim.virtual_battery_capacity_kwh,
            virtual_battery_credit_end_kwh: vbSim.virtual_battery_credit_end_kwh,
            virtual_battery_total_charged_kwh: vbSim.virtual_battery_total_charged_kwh,
            virtual_battery_total_discharged_kwh: vbSim.virtual_battery_total_discharged_kwh,
            virtual_battery_overflow_export_kwh: vbSim.virtual_battery_overflow_export_kwh,
            virtual_battery_hourly_charge_kwh: vbSim.virtual_battery_hourly_charge_kwh,
            virtual_battery_hourly_discharge_kwh: vbSim.virtual_battery_hourly_discharge_kwh,
            virtual_battery_hourly_credit_balance_kwh: vbSim.virtual_battery_hourly_credit_balance_kwh,
            virtual_battery_hourly_overflow_export_kwh: vbSim.virtual_battery_hourly_overflow_export_kwh,
            virtual_battery_hourly_grid_import_kwh: vbSim.virtual_battery_hourly_grid_import_kwh,
            hourly_charge: vbSim.virtual_battery_hourly_charge_kwh,
            hourly_discharge: vbSim.virtual_battery_hourly_discharge_kwh,
            hourly_state: vbSim.virtual_battery_hourly_credit_balance_kwh,
          };

          if (useP2) {
            const p2Wrap = computeVirtualBatteryP2Finance({
              providerCode: providerRaw,
              contractType,
              installedKwc,
              meterKva,
              vbSim,
              unboundedRequiredCapacityKwh: virtualScenario._virtualBatteryP2?.required_capacity_kwh ?? 0,
              hourlyDischargeKwh: vbSim.virtual_battery_hourly_discharge_kwh,
              hphcHourlyIsHp: contractType === "HPHC" ? vbInput.hphc_hourly_slot_is_hp ?? null : null,
              tariffElectricityPerKwh: tariffKwh,
              oaRatePerKwh: oaRate,
              virtual_battery_settings: ctx.settings?.pv?.virtual_battery ?? null,
            });
            virtualScenario.virtual_battery_finance = p2Wrap.virtual_battery_finance;
            const baseImp = baseScenario?.energy?.import ?? baseScenario?.import_kwh ?? 0;
            const baseSur = baseScenario?.energy?.surplus ?? baseScenario?.surplus_kwh ?? 0;
            virtualScenario.virtual_battery_business = computeVirtualBatteryBusiness({
              virtual_battery_finance: p2Wrap.virtual_battery_finance,
              baseImportKwh: baseImp,
              virtImportKwh: vbSim.grid_import_kwh,
              baseOverflowOrSurplusKwh: baseSur,
              virtOverflowKwh: vbSim.virtual_battery_overflow_export_kwh,
              tariffElectricityPerKwh: tariffKwh,
              oaRatePerKwh: oaRate,
              includeActivationInVirtualYear1: false,
              annual_virtual_discharge_kwh: vbSim.virtual_battery_total_discharged_kwh,
            });
            virtualScenario.virtual_battery_overflow_export_kwh = vbSim.virtual_battery_overflow_export_kwh;
            const p2RecurringTtc = Number(p2Wrap.annual_recurring_provider_cost_ttc) || 0;
            subscriptionAnnual = p2RecurringTtc;
            virtualScenario._virtualBatteryQuote = {
              annual_cost_ttc: subscriptionAnnual,
              annual_cost_ht: null,
              net_gain_annual: null,
              detail: {
                p2: true,
                recurring_annual_ttc: p2Wrap.annual_recurring_provider_cost_ttc,
                activation_fee_ttc: p2Wrap.annual_activation_fee_ttc_only,
              },
            };
          } else {
            const costDetail = computeVirtualBatteryAnnualCost({
              creditResult,
              config: ctx.virtual_battery_input,
            });
            subscriptionAnnual =
              ctx.virtual_battery_input?.annual_subscription_ttc ?? costDetail?.annual_cost_ttc ?? 0;
            virtualScenario._virtualBatteryQuote = {
              annual_cost_ttc: costDetail.annual_cost_ttc,
              annual_cost_ht: null,
              net_gain_annual: null,
              detail: costDetail,
            };
          }

          const p2ActivationTtc =
            useP2 && virtualScenario.virtual_battery_finance
              ? Number(virtualScenario.virtual_battery_finance.annual_activation_fee_ttc || 0) || 0
              : 0;

          const pickVbCapexPart = (v) => {
            const n = v != null ? Number(v) : NaN;
            return Number.isFinite(n) && n > 0 ? n : 0;
          };

          let virtualBatteryCapex =
            pickVbCapexPart(vbInput.activation_cost_ttc) ||
            pickVbCapexPart(ctx.organization_settings?.virtual_battery_activation_cost_ttc) ||
            0;

          if (virtualBatteryCapex <= 0 && p2ActivationTtc > 0) {
            virtualBatteryCapex = p2ActivationTtc;
          }

          const subscriptionOnlyVirtual = virtualBatteryCapex <= 0;

          if (subscriptionOnlyVirtual) {
            virtualScenario.capex_ttc = 0;
            virtualScenario._virtual_battery_activation_in_capex = false;
          } else {
            virtualScenario.capex_ttc = virtualBatteryCapex;
            virtualScenario._virtual_battery_activation_in_capex = useP2 && p2ActivationTtc > 0;
          }

          virtualScenario.costs = { battery_virtual_annual_cost: subscriptionAnnual };

          if (devLog) {
            console.log("DEBUG_VIRTUAL_IMPORT", {
              energy_import: virtualScenario.energy.import,
              import_kwh: virtualScenario.import_kwh,
              billable_import_kwh: virtualScenario.billable_import_kwh
            });
            console.log("[VIRTUAL_BATTERY] annual_subscription =", subscriptionAnnual);
            console.log("[VIRTUAL_BATTERY] credited_kwh =", credited_kwh);
            console.log("[VIRTUAL_BATTERY] billable_import =", billable_import_kwh);
          }
          addEnergyKpisToScenario(virtualScenario, ctx);

          if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
            const importPhysicalKwh = baseScenario?.energy?.import ?? baseScenario?.import_kwh ?? 0;
            const deltaBillable = (importPhysicalKwh || 0) - (billable_import_kwh || 0);
            console.log(JSON.stringify({
              tag: "TRACE_SCENARIO_BATT_VIRTUAL",
              importPhysicalKwh,
              billableImportKwh: billable_import_kwh,
              creditedKwh: credited_kwh,
              usedCreditKwh: used_credit_kwh,
              remaining_credit_kwh: remaining_credit_kwh,
              overflow_export_kwh: vbSim.virtual_battery_overflow_export_kwh,
              deltaBillable,
            }));
          }
        }
      }
      normalizeBatteryVirtualScenarioForPersistence(virtualScenario, baseScenario);
      if (process.env.NODE_ENV !== "production" && process.env.DEBUG_BV_CALC === "1") {
        console.log("=== BV CALC RESULT ===");
        console.log({
          skipped: virtualScenario._skipped,
          energy: virtualScenario.energy,
          finance: virtualScenario.finance,
          battery_virtual: virtualScenario.battery_virtual,
        });
      }
      scenarios.BATTERY_VIRTUAL = virtualScenario;
    }

    console.log("[D2] SCENARIO GENERATED:", Object.keys(scenarios).join(", "));
    console.log("[D3] battery enabled =", ctx.battery_input?.enabled);
    console.log("[D3] battery capacity =", ctx.battery_input?.capacity_kwh);
    console.log("[D3] virtual battery =", ctx.virtual_battery_input?.enabled);
    console.log("[D3] scenarios generated =", Object.keys(scenarios));

    // ------------------------------------------------------------
    // 6) FINANCE (CAPEX 100 % devis / finance_input, pas de pricing moteur)
    // ------------------------------------------------------------
    console.log("STEP 6 — Finance…");

    if (!ctx.form || typeof ctx.form !== "object") {
      console.error("[SMARTPITCH ERROR] Missing params", { someObject: ctx.form });
      throw new Error("SMARTPITCH_PARAMS_MISSING");
    }
    if (!ctx.form.params || typeof ctx.form.params !== "object") {
      console.error("[SMARTPITCH ERROR] Missing params", { someObject: ctx.form });
      throw new Error("SMARTPITCH_PARAMS_MISSING");
    }
    if (!ctx.form.params.tarif_kwh && ctx.form.params.tarif_actuel) {
      ctx.form.params.tarif_kwh = ctx.form.params.tarif_actuel;
    }

    const finance = await financeService.computeFinance(ctx, scenarios);
    const scenariosFinal = mergeFinanceIntoScenarios(scenarios, finance.scenarios);

    // Contrôle équilibre énergétique : CONSOMMATION = auto + import ; PRODUCTION = auto + surplus
    for (const [key, sc] of Object.entries(scenariosFinal)) {
      if (!sc) continue;

      if (devLog) {
        console.log("DEBUG_SCENARIO_CONSUMPTION", key, {
          conso_kwh: sc.conso_kwh,
          energy_conso: sc.energy?.conso
        });
      }

      const consumption =
        sc.conso_kwh ?? sc.energy?.conso ?? 0;

      const auto =
        sc.energy?.auto ??
        sc.autoconsumption_kwh ??
        sc.auto_kwh ??
        0;

      const importGrid =
        sc.energy?.import ??
        sc.import_kwh ??
        0;

      const production =
        sc.energy?.prod ??
        sc.energy?.production ??
        sc.prod_kwh ??
        sc.production_kwh ??
        0;

      const surplus =
        sc.energy?.surplus ??
        sc.surplus_kwh ??
        0;

      if (devLog) {
        console.warn("SCENARIO ENERGY SUMMARY", key, {
          consumption,
          production,
          auto,
          importGrid,
          surplus
        });
      }

      // ----------------------------------
      // CONSOMMATION CHECK
      // ----------------------------------
      const consCheck = auto + importGrid;
      if (Number.isFinite(consumption) && Number.isFinite(consCheck) && Math.abs(consCheck - consumption) > 5) {
        console.warn("ENERGY BALANCE ERROR — CONSUMPTION", key);
        if (devLog) {
          console.warn({
            consumption,
            auto,
            importGrid,
            auto_plus_import: consCheck
          });
        }
      }

      // ----------------------------------
      // PRODUCTION CHECK (BATTERY_PHYSICAL: production = auto + surplus + battery_losses)
      // ----------------------------------
      const batteryLosses = (key === "BATTERY_PHYSICAL" && (sc.energy?.battery_losses_kwh != null)) ? Number(sc.energy.battery_losses_kwh) : 0;
      const prodCheck = auto + surplus + batteryLosses;
      if (Number.isFinite(production) && Number.isFinite(prodCheck) && Math.abs(prodCheck - production) > 1) {
        console.warn("ENERGY_BALANCE_ERROR", key);
        if (devLog) {
          console.warn({ production, auto, surplus, battery_losses: batteryLosses, auto_plus_surplus_plus_losses: prodCheck });
        }
      }
    }

    console.log("STEP 6 OK — Finance OK");

    // ------------------------------------------------------------
    // 8) IMPACT
    // ------------------------------------------------------------
    console.log("STEP 8 — Impact CO₂…");
    const impact = await impactService.computeImpact(ctx, scenariosFinal);

    // ------------------------------------------------------------
    // 9) JSON FINAL
    // ------------------------------------------------------------
  const production = ctx.productionMultiPan
    ? {
        byPan: ctx.productionMultiPan.byPan,
        annualKwh: ctx.productionMultiPan.annualKwh,
        monthlyKwh: ctx.productionMultiPan.monthlyKwh,
      }
    : (ctx.pv?.monthly && ctx.pv?.total_kwh != null
        ? {
            byPan: [],
            annualKwh: ctx.pv.total_kwh,
            monthlyKwh: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly : [],
          }
        : null);

const ctxWithProduction = { ...ctx, production };
if (devLog) {
  console.log("=== RAW SCENARIOS BEFORE MAPPER ===");
  console.log(Object.keys(scenariosFinal));
  console.log(scenariosFinal.BATTERY_VIRTUAL);
}
const scenariosV2 = Object.values(scenariosFinal)
  .filter((sc) => sc._v2 === true)
  .map((sc) => mapScenarioToV2(sc, ctxWithProduction));
console.log("[D2] scenarios avant mapping (scenariosFinal keys):", Object.keys(scenariosFinal).length, Object.keys(scenariosFinal).join(", "));
console.log("[D2] scenarios après mapping (scenarios_v2 length):", scenariosV2.length);

const ctxFinal = {
  meta: ctx.meta,
  site: ctx.site,
  erpnext_lead_id: form?.erpnext_lead_id || null, // 👈 AJOUT UNIQUE
  house: {
    ...ctx.house,
    conso_annuelle_kwh: annualExact
  },
  conso: {
    ...conso,
    annual_kwh: annualExact
  },
  pv: ctx.pv,
  production,
  pilotage: pilotage.stats,
  scenarios: scenariosFinal,
  scenarios_v2: scenariosV2,
  finance,
  impact,
  settings: ctx.settings
};

if (process.env.NODE_ENV !== "production" && process.env.DEBUG_FINAL_SCENARIOS_V2 === "1") {
  console.log("=== FINAL scenarios_v2 ===");
  console.log(JSON.stringify(ctxFinal.scenarios_v2, null, 2));
} else {
  const ids = (ctxFinal.scenarios_v2 || []).map((s) => s?.id ?? s?.name).filter(Boolean);
  console.log("[calc] scenarios_v2 summary:", { count: ids.length, ids: ids.join(",") });
}

    console.log("===== JSON FINAL SMARTPITCH (V12-PATCHED) =====");

    return res.json(ctxFinal);

  } catch (err) {
    console.error("❌ ERREUR SMARTPITCH :", err);
    return res.status(500).json({
      error: "Erreur interne SmartPitch",
      details: err.message
    });
  }
}

// ======================================================================
// BATTERY_VIRTUAL — structure stable avant merge finance / mapScenarioToV2
// ======================================================================
function normalizeBatteryVirtualScenarioForPersistence(virtualScenario, baseScenario) {
  const baseEn = baseScenario?.energy || {};
  const baseProd =
    baseEn.production_kwh ?? baseEn.prod ?? baseScenario?.prod_kwh ?? 0;
  const baseConso =
    baseEn.consumption_kwh ?? baseEn.conso ?? baseScenario?.conso_kwh ?? 0;
  const baseAuto =
    baseEn.autoconsumption_kwh ?? baseEn.auto ?? baseScenario?.auto_kwh ?? 0;
  const baseSur = baseEn.surplus ?? baseScenario?.surplus_kwh ?? 0;
  const baseImp = baseEn.import ?? baseScenario?.import_kwh ?? 0;

  const vCapex =
    virtualScenario.capex_ttc != null && Number.isFinite(Number(virtualScenario.capex_ttc))
      ? Number(virtualScenario.capex_ttc)
      : null;
  /* BV : CAPEX dédié (activation / config) — pas d’héritage BASE pour ne pas fusionner avec l’installation PV */
  virtualScenario.capex_ttc = vCapex != null ? vCapex : 0;

  if (virtualScenario._skipped === true) {
    virtualScenario.energy = {
      ...(virtualScenario.energy || {}),
      prod: baseEn.prod ?? baseProd,
      auto: baseEn.auto ?? baseAuto,
      surplus: baseEn.surplus ?? baseSur,
      import: baseImp,
      conso: baseEn.conso ?? baseConso,
      production_kwh: baseProd,
      consumption_kwh: baseConso,
      autoconsumption_kwh: baseAuto,
      autoproduction_kwh: baseAuto,
      surplus_kwh: baseSur,
      import_kwh: baseImp,
      billable_import_kwh: baseImp,
      grid_import_kwh: baseImp,
      grid_export_kwh: baseSur,
      credited_kwh: 0,
      used_credit_kwh: 0,
      restored_kwh: 0,
      remaining_credit_kwh: 0,
      overflow_export_kwh: 0,
      virtual_battery_overflow_export_kwh: 0,
    };
    virtualScenario.import_kwh = baseImp;
    virtualScenario.billable_import_kwh = baseImp;
    virtualScenario.credited_kwh = 0;
    virtualScenario.used_credit_kwh = 0;
    virtualScenario.battery_virtual = {
      enabled: false,
      capacity_simulated_kwh: virtualScenario._virtualBatteryP2?.simulation_capacity_kwh ?? null,
      annual_charge_kwh: 0,
      annual_discharge_kwh: 0,
      annual_throughput_kwh: 0,
      credited_kwh: 0,
      restored_kwh: 0,
      overflow_export_kwh: 0,
      cycles_equivalent: null,
    };
    if (virtualScenario._virtualBattery8760 == null) virtualScenario._virtualBattery8760 = null;
    return;
  }

  const e = virtualScenario.energy || {};
  const bv0 = virtualScenario.battery_virtual || {};
  const credited = Number(e.credited_kwh ?? bv0.credited_kwh ?? bv0.annual_charge_kwh ?? 0);
  const discharged = Number(
    e.used_credit_kwh ?? e.restored_kwh ?? bv0.restored_kwh ?? bv0.annual_discharge_kwh ?? 0
  );
  const billable = Number(
    e.billable_import_kwh ?? e.import_kwh ?? virtualScenario.billable_import_kwh ?? 0
  );
  const overflow = Number(
    e.overflow_export_kwh ??
      e.virtual_battery_overflow_export_kwh ??
      bv0.overflow_export_kwh ??
      0
  );
  const surplusV = Number(e.surplus_kwh ?? virtualScenario.surplus_kwh ?? baseSur);

  virtualScenario.energy = {
    ...e,
    autoconsumption_kwh: e.autoconsumption_kwh ?? baseAuto,
    surplus_kwh: surplusV,
    import_kwh: billable,
    billable_import_kwh: billable,
    credited_kwh: credited,
    used_credit_kwh: discharged,
    restored_kwh: discharged,
    overflow_export_kwh: overflow,
    virtual_battery_overflow_export_kwh: e.virtual_battery_overflow_export_kwh ?? overflow,
    grid_import_kwh: e.grid_import_kwh ?? billable,
    grid_export_kwh: e.grid_export_kwh ?? surplusV,
  };
  virtualScenario.credited_kwh = credited;
  virtualScenario.used_credit_kwh = discharged;
  virtualScenario.billable_import_kwh = billable;
  virtualScenario.import_kwh = billable;

  const vb = virtualScenario.battery_virtual;
  if (vb && vb.enabled === true) {
    const cap = vb.capacity_simulated_kwh;
    const ch = Number(vb.annual_charge_kwh ?? credited);
    const dis = Number(vb.annual_discharge_kwh ?? discharged);
    virtualScenario.battery_virtual = {
      ...vb,
      annual_charge_kwh: ch,
      annual_discharge_kwh: dis,
      annual_throughput_kwh: ch + dis,
      credited_kwh: vb.credited_kwh ?? ch,
      restored_kwh: vb.restored_kwh ?? dis,
      overflow_export_kwh: vb.overflow_export_kwh ?? overflow,
      cycles_equivalent:
        cap > 0 && Number.isFinite(dis) ? dis / cap : vb.cycles_equivalent ?? null,
    };
  }

  const vb8760 = virtualScenario._virtualBattery8760;
  if (vb8760 && typeof vb8760 === "object") {
    virtualScenario._virtualBattery8760 = {
      ...vb8760,
      hourly_charge:
        vb8760.hourly_charge ?? vb8760.virtual_battery_hourly_charge_kwh ?? [],
      hourly_discharge:
        vb8760.hourly_discharge ?? vb8760.virtual_battery_hourly_discharge_kwh ?? [],
      hourly_state:
        vb8760.hourly_state ?? vb8760.virtual_battery_hourly_credit_balance_kwh ?? [],
    };
  }
}

// ======================================================================
// MERGE FINANCE + SCÉNARIOS
// ======================================================================
function mergeFinanceIntoScenarios(priced, finance) {
  const out = {};
  for (const key of Object.keys(priced)) {
    out[key] = { ...priced[key], ...finance[key] };
  }
  return out;
}

// ======================================================================
// CALCUL PRINCIPAL UNIQUE (BASE) — Scenario Builder V2
// ======================================================================
async function buildBaseScenarioOnly(ctx) {
  const baseV2 = buildScenarioBaseV2(ctx);
  return { BASE: baseV2 };
}

// ======================================================================
// kWc mode mono (pour scaling PV 1 kWp → total installation)
// ======================================================================
function resolveKwcMono(form, settings) {
  const forced = Number(form?.forcage?.puissance_kwc || 0);
  if (Number.isFinite(forced) && forced > 0) return forced;
  const explicit = Number(form?.system_kwc ?? form?.maison?.system_kwc ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const pricing = settings?.pricing || {};
  // Priorité 1 : puissance réelle du panneau sélectionné dans le devis (injectée par solarnextPayloadBuilder)
  // Priorité 2 : kit_panel_power_w org settings (fallback rétrocompatible)
  const panelPowerFromDevis = resolvePanelPowerWc(form?.panel_input);
  const panelWp =
    panelPowerFromDevis != null
      ? panelPowerFromDevis
      : Number(pricing.kit_panel_power_w || 485);
  const maxPanels = Number(form?.maison?.panneaux_max || 0);
  if (maxPanels > 0) return Math.round((maxPanels * panelWp) / 1000 * 100) / 100;
  return 1;
}

// ======================================================================
// CONTEXTE GLOBAL
// ======================================================================
function buildContext(form, settings) {
  const take = (o, p, fb) => p.split(".").reduce((a, k) => a?.[k], o) ?? fb;

  const normalize = (v) => {
    if (v === null || v === undefined) return null;
    return Number(String(v).replace(",", "."));
  };

  return {
    meta: {
      version: "SmartPitch V-LIGHT V12-PATCHED",
      generated_at: new Date().toISOString(),
      client_nom: take(form, "client.nom", "—"),
      client_ville: take(form, "client.ville", "—")
    },

    site: {
      lat: normalize(take(form, "client.lat", take(form, "client.latitude", null))),

      lon: normalize(take(form, "client.lon", take(form, "client.longitude", null))),
      orientation: take(form, "maison.orientation", "S"),
      inclinaison: Number(take(form, "maison.inclinaison", 30)),
      reseau_type: take(form, "params.reseau_type", "mono"),
      puissance_kva: Number(take(form, "params.puissance_kva", 9))
    },

    house: {
      surface_m2: Number(
        take(form, "maison.surface_m2", 120)
      ),
      isolation: take(form, "maison.isolation", "standard"),
      etages: Number(take(form, "maison.etages", 1))
    },

    pricing: settings.pricing || {},
    economics: mergeOrgEconomicsPartial(
      settings.economics && typeof settings.economics === "object" ? settings.economics : null
    ),
    organization_settings:
      settings?.organization_settings && typeof settings.organization_settings === "object"
        ? settings.organization_settings
        : {
            virtual_battery_activation_cost_ttc: null,
          },
  };
}