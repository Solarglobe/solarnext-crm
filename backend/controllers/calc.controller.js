// ======================================================================
// SMARTPITCH V-LIGHT — Contrôleur principal
// ======================================================================
import {
  CALC_ENGINE_VERSION,
  P2_PROVIDER_CODES,
  VB_CAPACITY_MIN_KWH,
  ENERGY_BALANCE_CONSO_TOLERANCE_KWH,
  ENERGY_BALANCE_PROD_TOLERANCE_KWH,
} from "../services/calc/calc.constants.js";

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
  ENGINE_ERROR_PANEL_REQUIRED,
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
  simulateVirtualBattery8760Rollover,
  aggregateVirtualBatteryMonthly,
  resolveVirtualBatteryCapacityKwh,
  resolveVirtualBatteryCreditRolloverEnabled,
} from "../services/virtualBattery8760.service.js";
import { simulateVirtualBattery8760Unbounded } from "../services/virtualBatteryUnboundedSim.service.js";
import {
  computeVirtualBatteryP2Finance,
  computeVirtualBatteryBusiness,
  resolveP2ContractType,
} from "../services/virtualBatteryP2Finance.service.js";
import { resolveP2VirtualBatterySimulationCapacityKwh } from "../services/virtualBatteryP2CapacityResolve.service.js";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import { attachNormalizedEnergyKpiFields } from "../services/energyKpisNormalize.service.js";
import * as financeService from "../services/financeService.js";
import * as impactService from "../services/impactService.js";
import {
  resolveRetailElectricityKwhPrice,
  resolveOaRateForKwc,
  mergeOrgEconomicsPartial,
} from "../services/economicsResolve.service.js";
import { CalcEngineValidationError, CALC_INVALID_8760_PROFILE } from "../services/calcEngineErrors.js";
import { buildCalcResponse } from "../services/calc/calcResponseBuilder.js";
import { computeElectricalValidation } from "../electrical/electricalValidation.js";
import { computeHorizonFarLoss } from "../shading/horizonMaskEngine.js";
import { buildFarShadingSunSamples } from "../services/shading/calpinageShading.service.js";
import { computeRowToRowShading } from "../shading/rowToRowShading.js";
import { computeBifacialGain } from "../shading/bifacialGain.js";
import { fetchTMY } from "../weather/fetchTMY.js";
import { computeCellTemperature } from "../weather/cellTemperature.js";
import {
  buildCalculationConfidenceFromCalc,
  finalizeCalculationConfidence,
} from "../services/calculationConfidence.service.js";
import {
  attachAntiOversellToScenarios,
  isCommercialUnboundedVirtualBatteryAllowed,
  markVirtualBatteryUnboundedBlocked,
} from "../services/antiOversell.service.js";

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
  try {
    // ======================================================================
    // SECTION 1 — Parsing & validation des inputs HTTP
    // Responsabilité future : InputParserUseCase
    // ======================================================================
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

    // ======================================================================
    // SECTION 2 — Résolution catalogue (panel, onduleur, batterie physique)
    // Responsabilité future : CatalogueResolverUseCase + PvRepository
    // ======================================================================
    if (form.panel_input && typeof form.panel_input === "object") {
      form.panel_input = await applyPanelPowerFromCatalog(pool, form.panel_input);
    }
    if (form.pv_inverter && typeof form.pv_inverter === "object") {
      form.pv_inverter = await resolvePvInverterEngineFields(pool, null, form.pv_inverter);
    }
    // Même chaîne que solarnextPayloadBuilder : technique batterie = pv_batteries si UUID actif (idempotent si déjà mergé).
    // IMPORTANT : si battery_input._catalog_merged === true, solarnextPayloadBuilder a déjà fait le merge
    // ET appliqué le multiplicateur qty (multi-batteries). On skip ce bloc pour éviter d'écraser
    // la capacité/puissance totale avec les valeurs unitaires du catalogue.
    if (form.battery_input && typeof form.battery_input === "object" && !form.battery_input._catalog_merged) {
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

    // ------------------------------------------------------------
    // 0) Contexte global
    // ------------------------------------------------------------
    const ctx = buildContext(form, settings);
    ctx.form = form;
    if (
      solarnextPayloadForLog?.shading_commercial_audit &&
      typeof solarnextPayloadForLog.shading_commercial_audit === "object"
    ) {
      ctx.meta = {
        ...ctx.meta,
        shading_commercial_audit: solarnextPayloadForLog.shading_commercial_audit,
      };
    }
    ctx.finance_input = form?.finance_input ?? null;
    ctx.battery_input = form?.battery_input ?? null;
    ctx.virtual_battery_input = form?.virtual_battery_input ?? null;

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

    // ======================================================================
    // SECTION 3 — Consommation 8760h
    // Sources par priorité : CSV uploadé > hourly_prebuilt > manual > national
    // Responsabilité future : ConsumptionLoaderUseCase
    // ======================================================================
// ------------------------------------------------------------
// 1) CONSOMMATION 8760h — Si un CSV existe (upload ou csv_path résolu backend), le moteur l'utilise obligatoirement (aucun profil synthétique).
// ------------------------------------------------------------
const csvPath =
  req.file?.path ||
  form?.conso?.csv_path ||
  null;

// Fusion conso + params (pour envoyer puissance_kva) — form.params garanti objet après parsing
const mergedConso = {
  ...form.conso,
  ...form.params
};

const studyId = form?.studyId ?? req.body?.studyId ?? null;
const versionId = form?.versionId ?? req.body?.versionId ?? null;
const leadId = form?.lead_id ?? form?.leadId ?? req.body?.leadId ?? null;
// Chargement : ordre 1 CSV, 2 hourly_prebuilt, 3 manual, 4 national. CSV prioritaire sur tout.
const _consoBase = consumptionService.loadConsumption(mergedConso, csvPath);
const conso = consumptionService.applyEquipmentShape(_consoBase, mergedConso, Boolean(csvPath));

// Conso injectée dans ctx = source unique pour scenarioBuilderV2 (hourly + annual_kwh = SUM(hourly))
const load8760Sum = (conso.hourly || []).reduce((a, b) => a + (Number(b) || 0), 0);
const annualExact = load8760Sum;
if (Math.abs(load8760Sum - (conso.annual_kwh ?? 0)) >= 0.1) {
  console.warn("CONSO_COHERENCE: |sum(hourly) - annual_kwh| >= 0.1", { sum_hourly: load8760Sum, annual_kwh: conso.annual_kwh });
}

// Valeurs utilisées par scenarioBuilderV2 : hourly et annual_kwh = SUM(hourly)
ctx.conso = {
  hourly: conso.hourly,
  annual_kwh: annualExact,
  clamped: conso.hourly
};

// META
ctx.meta.conso_annuelle_kwh = annualExact;
ctx.meta.engine_consumption_source = conso.engine_consumption_source ?? "UNKNOWN";

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

    // ======================================================================
    // SECTION 4 — Production PV + clipping onduleur
    // Sources : PVGIS mono-pan ou multi-pan ; clipping AC post-branche
    // Responsabilité future : PvProductionUseCase + PvgisRepository
    // ======================================================================
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
      const resolvedModuleWp = resolvePanelPowerWc(form?.panel_input);
      if (resolvedModuleWp == null) {
        console.error("[ENGINE ERROR] Missing panel in study");
        throw new Error(ENGINE_ERROR_PANEL_REQUIRED);
      }
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
      const installedKwcMp =
        maxPanelsMp > 0
          ? computeInstalledKwcRounded2(maxPanelsMp, resolvedModuleWp)
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
    } else {
      const pvMonthly = await pvgisService.computeProductionMonthly(ctx);

      const rawMonoShading = form.shadingLossPct;
      const shadingLossPctNum =
        rawMonoShading == null || rawMonoShading === ""
          ? null
          : Number(rawMonoShading);
      if (
        shadingLossPctNum != null &&
        !isNaN(shadingLossPctNum) &&
        shadingLossPctNum > 0
      ) {
        const multiplier = 1 - Math.max(0, Math.min(100, shadingLossPctNum)) / 100;
        if (pvMonthly.monthly_kwh && Array.isArray(pvMonthly.monthly_kwh)) {
          pvMonthly.monthly_kwh = pvMonthly.monthly_kwh.map(v => v * multiplier);
        }
        if (typeof pvMonthly.annual_kwh === "number") {
          pvMonthly.annual_kwh = pvMonthly.annual_kwh * multiplier;
        }
      }

      const kwc = resolveKwcMono(form);
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

    // ------------------------------------------------------------
    // FAR SHADING — correction masque d'horizon (form.horizonMask)
    // Actif uniquement si le frontend envoie form.horizonMask (fetché par useHorizonMaskFetch).
    // No-op si horizonMask absent, GPS invalide ou calcul de perte = 0.
    // Appliqué APRÈS clipping onduleur, AVANT pilotage.
    // ------------------------------------------------------------
    {
      const rawHm = form.horizonMask;
      const lat = Number(ctx.site?.lat);
      const lon = Number(ctx.site?.lon);
      const maskIsValid =
        rawHm &&
        Array.isArray(rawHm.mask) &&
        rawHm.mask.length > 0 &&
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lon) && lon >= -180 && lon <= 180;

      if (maskIsValid) {
        const stepDeg =
          typeof rawHm.step_deg === "number" && rawHm.step_deg > 0
            ? rawHm.step_deg
            : 2;
        const engineMask = {
          azimuthStepDeg: stepDeg,
          elevations: rawHm.mask.map((p) =>
            typeof p.elev === "number" && Number.isFinite(p.elev) ? p.elev : 0
          ),
        };
        const sunSamples = buildFarShadingSunSamples(lat, lon);
        const farLossFraction = computeHorizonFarLoss(sunSamples, engineMask);
        const farLossPct = Math.round(farLossFraction * 10000) / 100; // 2 decimal %

        if (farLossFraction > 0 && ctx.pv) {
          const multiplier = 1 - farLossFraction;
          if (Array.isArray(ctx.pv.monthly)) {
            ctx.pv.monthly = ctx.pv.monthly.map((v) => (Number(v) || 0) * multiplier);
          }
          if (typeof ctx.pv.total_kwh === "number") {
            ctx.pv.total_kwh = Math.round(ctx.pv.total_kwh * multiplier * 100) / 100;
          }
          if (typeof ctx.pv.total_raw_kwh === "number") {
            ctx.pv.total_raw_kwh = Math.round(ctx.pv.total_raw_kwh * multiplier * 100) / 100;
          }
          if (Array.isArray(ctx.pv.hourly)) {
            ctx.pv.hourly = ctx.pv.hourly.map((h) => (Number(h) || 0) * multiplier);
          }
          ctx.pv.far_shading_loss_pct = farLossPct;
          ctx.pv.far_shading_source = rawHm.source ?? "RELIEF_ONLY";
        }
      }
    }

    // ------------------------------------------------------------
    // ROW-TO-ROW SHADING — ombrage inter-rangées
    // Actif uniquement si tous les pans ont pitchM ET panelHeightM valides.
    // Moyenne pondérée par panelCount sur l'ensemble des pans.
    // No-op silencieux si champs absents ou GPS invalide.
    // Appliqué APRÈS far shading, AVANT pilotage.
    // ------------------------------------------------------------
    {
      const pans = form.roof?.pans;
      const lat = Number(ctx.site?.lat);
      const lon = Number(ctx.site?.lon);
      const gpsValid =
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lon) && lon >= -180 && lon <= 180;

      const eligiblePans = Array.isArray(pans)
        ? pans.filter(
            (p) =>
              p &&
              Number.isFinite(Number(p.pitchM)) && Number(p.pitchM) > 0 &&
              Number.isFinite(Number(p.panelHeightM)) && Number(p.panelHeightM) > 0 &&
              Number.isFinite(Number(p.tilt)) &&
              Number.isFinite(Number(p.azimuth))
          )
        : [];

      if (gpsValid && eligiblePans.length > 0 && ctx.pv) {
        // Pondération par panelCount (défaut 1 si absent)
        const totalWeight = eligiblePans.reduce(
          (acc, p) => acc + (Number(p.panelCount) > 0 ? Number(p.panelCount) : 1),
          0
        );

        // shadingFactor8760 pondéré : moyenne pondérée des facteurs horaires
        const weighted8760 = new Array(8760).fill(0);
        let weightedLossPct = 0;
        let weightedPitchMin = 0;
        let weightedPitchActual = 0;

        for (const pan of eligiblePans) {
          const panWeight = (Number(pan.panelCount) > 0 ? Number(pan.panelCount) : 1) / totalWeight;
          let result;
          try {
            result = computeRowToRowShading({
              tiltDeg: Number(pan.tilt),
              azimuthDeg: Number(pan.azimuth),
              pitchM: Number(pan.pitchM),
              panelHeightM: Number(pan.panelHeightM),
              latitudeDeg: lat,
              longitudeDeg: lon,
            });
          } catch (e) {
            // Pan invalide → skip silencieux
            continue;
          }

          for (let h = 0; h < 8760; h++) {
            weighted8760[h] += result.shadingFactor8760[h] * panWeight;
          }
          weightedLossPct += result.annualLossPct * panWeight;
          weightedPitchMin += result.pitchMinRecommendedM * panWeight;
          weightedPitchActual += Number(pan.pitchM) * panWeight;
        }

        // Arrondi à 2 décimales
        weightedLossPct = Math.round(weightedLossPct * 100) / 100;
        weightedPitchMin = Math.round(weightedPitchMin * 100) / 100;
        weightedPitchActual = Math.round(weightedPitchActual * 100) / 100;

        if (weightedLossPct > 0) {
          // Appliquer le multiplicateur horaire individuellement
          if (Array.isArray(ctx.pv.hourly)) {
            ctx.pv.hourly = ctx.pv.hourly.map(
              (h, i) => (Number(h) || 0) * (1 - weighted8760[i])
            );
          }
          // Recalculer monthly et totaux depuis le profil horaire corrigé
          if (Array.isArray(ctx.pv.monthly) && Array.isArray(ctx.pv.hourly)) {
            // Facteur de correction global = 1 - weightedLossPct/100
            const globalMultiplier = 1 - weightedLossPct / 100;
            ctx.pv.monthly = ctx.pv.monthly.map((v) => (Number(v) || 0) * globalMultiplier);
            if (typeof ctx.pv.total_kwh === "number") {
              ctx.pv.total_kwh = Math.round(ctx.pv.total_kwh * globalMultiplier * 100) / 100;
            }
            if (typeof ctx.pv.total_raw_kwh === "number") {
              ctx.pv.total_raw_kwh = Math.round(ctx.pv.total_raw_kwh * globalMultiplier * 100) / 100;
            }
          }
          ctx.pv.row_to_row_shading_loss_pct = weightedLossPct;
          ctx.pv.row_to_row_pitch_min_m = weightedPitchMin;
        }

        // Toujours stocker dans ctx.meta pour que le frontend affiche le warning
        if (!ctx.meta) ctx.meta = {};
        ctx.meta.row_to_row = {
          loss_pct: weightedLossPct,
          pitch_min_m: weightedPitchMin,
          pitch_actual_m: weightedPitchActual,
        };
      }
    }

    // ------------------------------------------------------------
    // BIFACIAL GAIN — gain face arrière panneaux bifaciaux
    // Actif uniquement si form.bifacial.isBifacial === true.
    // Feature flag : ENABLE_BIFACIAL côté frontend (no-op si absent).
    // Appliqué APRÈS row-to-row shading, AVANT pilotage.
    // ------------------------------------------------------------
    {
      const bf = form.bifacial;
      if (bf?.isBifacial === true && ctx.pv) {
        try {
          const result = computeBifacialGain({
            bifacialityFactor: Number(bf.bifacialityFactor ?? 0.70),
            albedo: Number(bf.albedo ?? 0.20),
            tiltDeg: Number(bf.tiltDeg ?? form.roof?.pans?.[0]?.tilt ?? 20),
            pitchM: bf.pitchM != null ? Number(bf.pitchM) : undefined,
            panelHeightM: bf.panelHeightM != null ? Number(bf.panelHeightM) : undefined,
          });

          if (result.gainFactor > 1) {
            const gf = result.gainFactor;
            if (Array.isArray(ctx.pv.hourly)) {
              ctx.pv.hourly = ctx.pv.hourly.map((h) => (Number(h) || 0) * gf);
            }
            if (Array.isArray(ctx.pv.monthly)) {
              ctx.pv.monthly = ctx.pv.monthly.map((v) => (Number(v) || 0) * gf);
            }
            if (typeof ctx.pv.total_kwh === "number") {
              ctx.pv.total_kwh = Math.round(ctx.pv.total_kwh * gf * 100) / 100;
            }
            if (typeof ctx.pv.total_raw_kwh === "number") {
              ctx.pv.total_raw_kwh = Math.round(ctx.pv.total_raw_kwh * gf * 100) / 100;
            }
            ctx.pv.bifacial_gain_pct = result.gainPct;
            ctx.pv.bifacial_gain_kwh = Math.round((ctx.pv.total_kwh / gf) * (gf - 1) * 10) / 10;
          }

          if (!ctx.meta) ctx.meta = {};
          ctx.meta.bifacial = {
            gain_pct: result.gainPct,
            gain_factor: result.gainFactor,
            warning: result.warning,
          };
        } catch (e) {
          // Paramètres invalides → skip silencieux
        }
      }
    }

    // ------------------------------------------------------------
    // TMY — Simulation yield horaire + P50/P90
    // Asynchrone, avec fallback silencieux si PVGIS indisponible.
    // Ne remplace PAS ctx.pv — enrichit ctx.tmy et ctx.meta.tmy.
    // ------------------------------------------------------------
    {
      const lat = Number(ctx.site?.lat);
      const lon = Number(ctx.site?.lon);
      const gpsValid = Number.isFinite(lat) && Number.isFinite(lon);

      if (gpsValid && ctx.pv) {
        try {
          const tmyData = await fetchTMY(lat, lon);
          if (tmyData) {
            // Paramètres thermiques panneau (fallback si non renseignés)
            const noct = Number(form.panel?.noct ?? form.panel_noct ?? 45);
            const tempCoeff = Number(form.panel?.tempCoeffPmax ?? form.panel_temp_coeff ?? -0.40);

            const { corrFactor8760, avgCorrFactor } = computeCellTemperature({
              ghi8760: tmyData.ghi8760,
              tAir8760: tmyData.tAir8760,
              noct,
              tempCoeff,
            });

            // Production horaire TMY corrigée thermiquement
            // Ratio irradiance TMY vs production existante pour estimer la production horaire
            const totalGhi = tmyData.ghi8760.reduce((a, b) => a + b, 0);
            const kwh8760 = tmyData.ghi8760.map((g, h) => {
              if (totalGhi === 0 || g <= 0) return 0;
              // Utiliser la production existante normalisée par l'irradiance TMY
              const baseH = ctx.pv.hourly?.[h] ?? 0;
              return baseH * corrFactor8760[h];
            });

            // Agrégation mensuelle
            const monthly12 = Array(12).fill(0);
            const hoursPerMonth = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];
            let hCursor = 0;
            for (let m = 0; m < 12; m++) {
              for (let h = 0; h < hoursPerMonth[m]; h++) {
                monthly12[m] += kwh8760[hCursor++] || 0;
              }
              monthly12[m] = Math.round(monthly12[m] * 10) / 10;
            }

            const totalKwhP50 = Math.round(kwh8760.reduce((a, b) => a + b, 0) * 10) / 10;
            // P90 = P50 × (1 - 1.28 × σ), σ = 5% (variabilité typique France)
            const sigmaRelative = 0.05;
            const totalKwhP90 = Math.round(totalKwhP50 * (1 - 1.28 * sigmaRelative) * 10) / 10;
            const p90Monthly = monthly12.map(
              (v) => Math.round(v * (1 - 1.28 * sigmaRelative) * 10) / 10
            );

            ctx.tmy = {
              totalKwhP50,
              totalKwhP90,
              monthly12P50: monthly12,
              monthly12P90: p90Monthly,
              avgThermalCorrFactor: Math.round(avgCorrFactor * 10000) / 10000,
              noct,
              tempCoeff,
            };
            if (!ctx.meta) ctx.meta = {};
            ctx.meta.tmy = {
              p50_kwh: totalKwhP50,
              p90_kwh: totalKwhP90,
              monthly_p50: monthly12,
              monthly_p90: p90Monthly,
              thermal_correction_pct: Math.round((avgCorrFactor - 1) * 10000) / 100,
            };
          }
        } catch (e) {
          // TMY non disponible — pas bloquant
          console.warn('[TMY] Erreur fetch/calcul:', e.message);
        }
      }
    }

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
    ctx.pilotage_stats = pilotage.stats;


    // ======================================================================
    // SECTION 5 — Calcul des scénarios énergie
    // Scénarios : BASE · BATTERY_PHYSICAL · BATTERY_VIRTUAL · BATTERY_HYBRID
    // Responsabilité future : ScenarioBuilderUseCase (4 sous-use-cases)
    // ======================================================================
    // ------------------------------------------------------------
    // 5) CALCUL PRINCIPAL (BASE + BATTERY_PHYSICAL si batterie valide)
    // ------------------------------------------------------------
    const scenarios = await buildBaseScenarioOnly(ctx);

    const baseScenario = scenarios.BASE;
    baseScenario.scenario_uses_piloted_profile = false;
    addEnergyKpisToScenario(baseScenario, ctx);

    const batteryEnabled = ctx.battery_input?.enabled === true && Number(ctx.battery_input?.capacity_kwh) > 0;
    /** Résultat physique 8760h conservé pour le scénario HYBRID (accès depuis le bloc BATTERY_HYBRID). */
    let battPhysicalResult = null;

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
          batteryScenario.scenario_uses_piloted_profile = Array.isArray(ctx.conso_p_pilotee);
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
          battPhysicalResult = batt; // conservé pour BATTERY_HYBRID
          scenarios.BATTERY_PHYSICAL = batteryScenario;

          const sumAuto = monthlyBatt.reduce((a, m) => a + m.auto_kwh, 0);
          const sumSurplus = monthlyBatt.reduce((a, m) => a + m.surplus_kwh, 0);
          const battLosses = batteryScenario.energy.battery_losses_kwh ?? 0;
          if (process.env.NODE_ENV !== "production" && Math.abs((batteryScenario.energy.auto + batteryScenario.energy.surplus + battLosses) - batteryScenario.energy.prod) > ENERGY_BALANCE_CONSO_TOLERANCE_KWH) {
            console.warn("BATTERY MONTHLY INCONSISTENT: auto+surplus+losses=", batteryScenario.energy.auto + batteryScenario.energy.surplus + battLosses, "prod=", batteryScenario.energy.prod);
          }
          if (process.env.NODE_ENV !== "production" && (Math.abs(sumAuto - batt.auto_kwh) > ENERGY_BALANCE_CONSO_TOLERANCE_KWH || Math.abs(sumSurplus - batt.surplus_kwh) > ENERGY_BALANCE_CONSO_TOLERANCE_KWH)) {
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
      virtualScenario.scenario_uses_piloted_profile = Array.isArray(ctx.conso_p_pilotee);

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
        const useP2 = providerRaw && P2_PROVIDER_CODES.has(String(providerRaw).toUpperCase());

        const meterKva = Number(ctx.site?.puissance_kva ?? ctx.form?.params?.puissance_kva ?? 9);
        const installedKwc =
          baseScenario.kwc ??
          baseScenario.metadata?.kwc ??
          ctx.pv?.kwc ??
          resolveKwcMono(ctx.form);

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
            const selectedCapForCommercialGate = resolveVirtualBatteryCapacityKwh(vbInput);
            const resolvedP2Capacity = resolveP2VirtualBatterySimulationCapacityKwh({
              vbInput,
              ctx,
              providerCodeUpper: pc,
              requiredCapacityKwhFromUnbounded: requiredCap,
              allowPhysicalBatteryFallback: false,
            });
            if (
              resolvedP2Capacity.capacity_kwh == null &&
              selectedCapForCommercialGate == null &&
              !isCommercialUnboundedVirtualBatteryAllowed(ctx)
            ) {
              virtualScenario._virtualBatteryP2 = {
                required_capacity_kwh: requiredCap,
                provider_tier_status: "BLOCKED_UNBOUNDED_COMMERCIAL",
                capacity_auto_from_unbounded: true,
              };
              markVirtualBatteryUnboundedBlocked(virtualScenario, "virtual_battery_unbounded_disabled");
              console.warn("[BATTERY_VIRTUAL] VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE");
            }
            if (!virtualScenario._skipped && pc === "MYLIGHT_MYSMARTBATTERY") {
              const selectedContractualCap = resolveVirtualBatteryCapacityKwh(vbInput);
              if (selectedContractualCap != null && selectedContractualCap > 0) {
                simCapacityKwh = selectedContractualCap;
                vbSim = simulateVirtualBattery8760({
                  pv_hourly: ctx.pv.hourly,
                  conso_hourly: consoHourlyVirtual,
                  config: { ...vbInput, capacity_kwh: simCapacityKwh },
                });
                const saturationRisk =
                  Number(requiredCap) > 0 && Number(simCapacityKwh) > 0 && Number(requiredCap) > Number(simCapacityKwh);
                virtualScenario._virtualBatteryP2 = {
                  required_capacity_kwh: requiredCap,
                  selected_capacity_kwh: simCapacityKwh,
                  simulation_capacity_kwh: simCapacityKwh,
                  provider_tier_status: "OK",
                  ...(saturationRisk
                    ? {
                        saturation_warning: true,
                        saturation_warning_message:
                          `Capacité recommandée (${requiredCap} kWh) supérieure à la capacité contractuelle choisie (${simCapacityKwh} kWh) : risque de saturation et surplus non valorisé.`,
                      }
                    : {}),
                };
                if (saturationRisk) {
                  virtualScenario.p2_notes = [
                    ...(Array.isArray(virtualScenario.p2_notes) ? virtualScenario.p2_notes : []),
                    `Risque de saturation : capacité choisie ${simCapacityKwh} kWh < capacité recommandée ${requiredCap} kWh.`,
                  ];
                }
              } else {
                simCapacityKwh = resolvedP2Capacity.capacity_kwh ?? Math.max(requiredCap, VB_CAPACITY_MIN_KWH);
                vbSim = simulateVirtualBattery8760({
                  pv_hourly: ctx.pv.hourly,
                  conso_hourly: consoHourlyVirtual,
                  config: { ...vbInput, capacity_kwh: simCapacityKwh },
                });
                virtualScenario._virtualBatteryP2 = {
                  required_capacity_kwh: requiredCap,
                  selected_capacity_kwh: simCapacityKwh,
                  simulation_capacity_kwh: simCapacityKwh,
                  provider_tier_status: "OK",
                  auto_selected_capacity_from_required: true,
                  capacity_source: resolvedP2Capacity.source ?? "required_capacity",
                };
              }
            } else if (!virtualScenario._skipped) {
              simCapacityKwh = resolvedP2Capacity.capacity_kwh ?? Math.max(requiredCap, VB_CAPACITY_MIN_KWH);
              vbSim = simulateVirtualBattery8760({
                pv_hourly: ctx.pv.hourly,
                conso_hourly: consoHourlyVirtual,
                config: { ...vbInput, capacity_kwh: simCapacityKwh },
              });
              // RISQUE 1 : capacité auto-résolue au maximum théorique (unbounded).
              // Le palier contractuel réel (URBAN_SOLAR / MYBATTERY) peut être inférieur.
              // finance_warnings contient VB_CAPACITY_AUTO_UNBOUNDED pour alerter l'intégrateur.
              virtualScenario._virtualBatteryP2 = {
                required_capacity_kwh: requiredCap,
                simulation_capacity_kwh: simCapacityKwh,
                capacity_auto_from_unbounded: true,
                capacity_source: resolvedP2Capacity.source ?? "required_capacity",
              };
              if (!Array.isArray(virtualScenario.finance_warnings)) virtualScenario.finance_warnings = [];
              virtualScenario.finance_warnings.push("VB_CAPACITY_AUTO_UNBOUNDED");
              if (process.env.NODE_ENV !== "production") {
                console.warn(`[BATTERY_VIRTUAL] capacité P2 auto depuis sim unbounded (${String(providerRaw)}) : ${requiredCap.toFixed(1)} kWh — palier contractuel non configuré`);
              }
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
              if (!isCommercialUnboundedVirtualBatteryAllowed(ctx)) {
                virtualScenario._virtualBatteryP2 = {
                  required_capacity_kwh: Number(ub.required_capacity_kwh),
                  provider_tier_status: "BLOCKED_UNBOUNDED_COMMERCIAL",
                  capacity_auto_from_unbounded: true,
                };
                markVirtualBatteryUnboundedBlocked(virtualScenario, "virtual_battery_unbounded_disabled");
                console.warn("[BATTERY_VIRTUAL] VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE");
              } else {
                vbConfig.capacity_kwh = Math.max(Number(ub.required_capacity_kwh), VB_CAPACITY_MIN_KWH);
              }
              // RISQUE 1 : capacité auto-résolue au maximum théorique (unbounded).
              // La capacité contractuelle réelle du fournisseur peut être inférieure.
              if (!Array.isArray(virtualScenario.finance_warnings)) virtualScenario.finance_warnings = [];
              if (!virtualScenario._skipped) virtualScenario.finance_warnings.push("VB_CAPACITY_AUTO_UNBOUNDED");
              if (!virtualScenario._skipped) virtualScenario._vb_capacity_auto_from_unbounded = true;
              if (!virtualScenario._skipped && process.env.NODE_ENV !== "production") {
                console.warn(`[BATTERY_VIRTUAL] capacité auto depuis sim unbounded : ${vbConfig.capacity_kwh.toFixed(1)} kWh — capacity_kwh non configurée`);
              }
            }
          }
          if (!virtualScenario._skipped) {
            vbSim = simulateVirtualBattery8760({
              pv_hourly: ctx.pv.hourly,
              conso_hourly: consoHourlyVirtual,
              config: vbConfig,
            });
          }
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
          const vbYear1Sim = vbSim;
          const rolloverEnabled = resolveVirtualBatteryCreditRolloverEnabled(vbInput);
          let vbRollover = null;
          if (rolloverEnabled) {
            vbRollover = simulateVirtualBattery8760Rollover({
              pv_hourly: ctx.pv.hourly,
              conso_hourly: consoHourlyVirtual,
              config: {
                ...vbInput,
                capacity_kwh: vbSim.virtual_battery_capacity_kwh ?? resolveVirtualBatteryCapacityKwh(vbInput),
              },
              years: 10,
            });
            if (vbRollover?.ok) {
              vbSim = vbRollover.stabilized;
            }
          }
          const vbStabilizedSim = vbSim;
          virtualScenario.virtual_battery_rollover = buildVirtualBatteryRolloverMeta({
            enabled: rolloverEnabled && vbRollover?.ok,
            rollover: vbRollover?.ok ? vbRollover : null,
            year1: vbYear1Sim,
            stabilized: vbStabilizedSim,
          });

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
            autoconsumption_kwh: vbSim.auto_kwh,
            direct_self_consumption_kwh: autoBase,
            battery_discharge_kwh: used_credit_kwh,
            total_pv_used_on_site_kwh: vbSim.auto_kwh,
            exported_kwh: vbSim.surplus_kwh,
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
          virtualScenario.autoconsumption_kwh = vbSim.auto_kwh;
          virtualScenario.self_consumption_pct =
            production > 0 ? Math.round((vbSim.auto_kwh / production) * 10000) / 100 : 0;
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
          virtualScenario.year1 = virtualScenario.virtual_battery_rollover?.year1 ?? null;
          virtualScenario.stabilized = virtualScenario.virtual_battery_rollover?.stabilized ?? null;
          virtualScenario.convergence_year = virtualScenario.virtual_battery_rollover?.convergence_year ?? 1;
          virtualScenario.virtual_credit_start_kwh = virtualScenario.virtual_battery_rollover?.virtual_credit_start_kwh ?? 0;
          virtualScenario.virtual_credit_end_kwh = virtualScenario.virtual_battery_rollover?.virtual_credit_end_kwh ?? remaining_credit_kwh;

          virtualScenario._virtualBattery8760 = {
            virtual_battery_capacity_kwh: vbSim.virtual_battery_capacity_kwh,
            virtual_battery_credit_start_kwh: vbSim.virtual_battery_credit_start_kwh,
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
              selectedCapacityKwh:
                virtualScenario._virtualBatteryP2?.selected_capacity_kwh ??
                virtualScenario._virtualBatteryP2?.simulation_capacity_kwh ??
                null,
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

          // RISQUE 2 : coût VB = 0 → scénario apparaît gratuit, gains non tempérés par un abonnement.
          // Avertit l'intégrateur sans bloquer le scénario.
          if (subscriptionAnnual === 0) {
            if (!Array.isArray(virtualScenario.finance_warnings)) virtualScenario.finance_warnings = [];
            virtualScenario.finance_warnings.push("VB_COST_UNCONFIGURED");
            if (process.env.NODE_ENV !== "production") {
              console.warn("[BATTERY_VIRTUAL] coût annuel VB = 0 — abonnement/frais non configurés ; le scénario VB peut apparaître artificiellement avantageux");
            }
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

    // -----------------------------------------------------------------------
    // BATTERY_HYBRID — Batterie physique PUIS batterie virtuelle sur surplus résiduel.
    // Condition : batterie physique simulée avec succès ET batterie virtuelle activée.
    // Principe : la VB ne voit que le surplus que la batterie physique n'a pas absorbé.
    // -----------------------------------------------------------------------
    if (battPhysicalResult !== null && ctx.virtual_battery_input?.enabled === true) {
      const consoHourlyHybrid = ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped;
      const hasSurplus8760H = Array.isArray(battPhysicalResult.surplus_hourly) && battPhysicalResult.surplus_hourly.length === 8760;
      const hasConso8760H = Array.isArray(consoHourlyHybrid) && consoHourlyHybrid.length === 8760;

      const hybridScenario = JSON.parse(JSON.stringify(scenarios.BATTERY_PHYSICAL));
      hybridScenario.name = "BATTERY_HYBRID";
      hybridScenario._v2 = true;
      hybridScenario.scenario_uses_piloted_profile = Array.isArray(ctx.conso_p_pilotee);

      if (!hasSurplus8760H || !hasConso8760H) {
        hybridScenario._skipped = true;
        hybridScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "hybrid_skipped_no_profiles" };
        scenarios.BATTERY_HYBRID = hybridScenario;
      } else {
        // Profils résiduels après batterie physique
        // surplusHourly = ce qui n'a pas été absorbé par la physique → crédit VB
        // importHourly  = ce qui n'a pas été couvert par la physique → offset VB
        const surplusAfterPhysical = battPhysicalResult.surplus_hourly;
        const importAfterPhysical = consoHourlyHybrid.map(
          (c, h) => Math.max(0, (c || 0) - (battPhysicalResult.auto_hourly[h] || 0))
        );

        const vbInputH = ctx.virtual_battery_input || {};
        const providerRawH = vbInputH.provider_code || vbInputH.provider;
        const useP2H = providerRawH && P2_PROVIDER_CODES.has(String(providerRawH).toUpperCase());
        const meterKvaH = Number(ctx.site?.puissance_kva ?? ctx.form?.params?.puissance_kva ?? 9);
        const installedKwcH = scenarios.BATTERY_PHYSICAL.kwc ?? scenarios.BATTERY_PHYSICAL.metadata?.kwc ?? ctx.pv?.kwc ?? resolveKwcMono(ctx.form);
        const tariffKwhH = resolveRetailElectricityKwhPrice(ctx);
        const oaRateH = resolveOaRateForKwc(ctx, installedKwcH);
        const contractTypeH = resolveP2ContractType(vbInputH, ctx);

        // Capacité requise sur le surplus résiduel (plus petite que pour VB pure)
        const unboundedH = simulateVirtualBattery8760Unbounded({
          pv_hourly: surplusAfterPhysical,
          conso_hourly: importAfterPhysical,
        });

        if (!unboundedH.ok) {
          hybridScenario._skipped = true;
          hybridScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "hybrid_vb_unbounded_failed" };
          scenarios.BATTERY_HYBRID = hybridScenario;
        } else {
          const requiredCapH = unboundedH.required_capacity_kwh;
          const selectedContractCapH = resolveVirtualBatteryCapacityKwh(vbInputH);
          const resolvedP2CapacityH = useP2H
            ? resolveP2VirtualBatterySimulationCapacityKwh({
                vbInput: vbInputH,
                ctx,
                providerCodeUpper: String(providerRawH).toUpperCase(),
                requiredCapacityKwhFromUnbounded: requiredCapH,
                allowPhysicalBatteryFallback: false,
              })
            : { capacity_kwh: null, source: null };
          // La gate commerciale ne s'applique qu'aux fournisseurs P2 (cohérent avec BATTERY_VIRTUAL
          // qui applique cette restriction uniquement dans le bloc if (useP2)).
          // Pour les non-P2, on utilise Math.max(requiredCapH, VB_CAPACITY_MIN_KWH) comme simCapacity.
          if (
            useP2H &&
            resolvedP2CapacityH.capacity_kwh == null &&
            selectedContractCapH == null &&
            !isCommercialUnboundedVirtualBatteryAllowed(ctx)
          ) {
            hybridScenario._virtualBatteryP2 = {
              required_capacity_kwh: requiredCapH,
              provider_tier_status: "BLOCKED_UNBOUNDED_COMMERCIAL",
              capacity_auto_from_unbounded: true,
            };
            markVirtualBatteryUnboundedBlocked(hybridScenario, "hybrid_virtual_battery_unbounded_disabled");
            scenarios.BATTERY_HYBRID = hybridScenario;
            console.warn("[BATTERY_HYBRID] VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE");
          }
          if (!hybridScenario._skipped) {
          const simCapacityKwhH = selectedContractCapH != null && selectedContractCapH > 0
            ? selectedContractCapH
            : resolvedP2CapacityH.capacity_kwh ?? Math.max(requiredCapH, VB_CAPACITY_MIN_KWH);

          const vbSimH = simulateVirtualBattery8760({
            pv_hourly: surplusAfterPhysical,
            conso_hourly: importAfterPhysical,
            config: { ...vbInputH, capacity_kwh: simCapacityKwhH },
          });

          if (!vbSimH.ok) {
            hybridScenario._skipped = true;
            hybridScenario.finance = { roi_years: null, irr: null, lcoe: null, cashflows: null, note: "hybrid_vb_sim_failed" };
            scenarios.BATTERY_HYBRID = hybridScenario;
          } else {
            // Bilans énergie hybride — SANS double comptage
            const vbYear1SimH = vbSimH;
            const rolloverEnabledH = resolveVirtualBatteryCreditRolloverEnabled(vbInputH);
            let vbRolloverH = null;
            let vbSimHEffective = vbSimH;
            if (rolloverEnabledH) {
              vbRolloverH = simulateVirtualBattery8760Rollover({
                pv_hourly: surplusAfterPhysical,
                conso_hourly: importAfterPhysical,
                config: { ...vbInputH, capacity_kwh: simCapacityKwhH },
                years: 10,
              });
              if (vbRolloverH?.ok) {
                vbSimHEffective = vbRolloverH.stabilized;
              }
            }
            hybridScenario.virtual_battery_rollover = buildVirtualBatteryRolloverMeta({
              enabled: rolloverEnabledH && vbRolloverH?.ok,
              rollover: vbRolloverH?.ok ? vbRolloverH : null,
              year1: vbYear1SimH,
              stabilized: vbSimHEffective,
            });

            const vbCreditsUsed = vbSimHEffective.virtual_battery_total_discharged_kwh ?? 0;
            const hybridAutoKwh = battPhysicalResult.auto_kwh + vbCreditsUsed;
            const hybridImportKwh = vbSimHEffective.grid_import_kwh;
            const hybridSurplusKwh = vbSimHEffective.virtual_battery_overflow_export_kwh ?? vbSimHEffective.surplus_kwh ?? 0;
            const hybridCredited = vbSimHEffective.virtual_battery_total_charged_kwh ?? 0;
            const hybridRemainingCredit = vbSimHEffective.virtual_battery_credit_end_kwh ?? 0;

            const baseScenarioH = scenarios.BASE;
            const production = baseScenarioH.energy?.production_kwh ?? baseScenarioH.energy?.prod ?? baseScenarioH.prod_kwh ?? 0;
            const consumption = baseScenarioH.energy?.consumption_kwh ?? baseScenarioH.energy?.conso ?? baseScenarioH.conso_kwh ?? 0;
            const physicalDischargeKwh = battPhysicalResult.annual_discharge_kwh ?? 0;
            const physicalAutoKwh = battPhysicalResult.auto_kwh ?? 0;
            const physicalImportKwh = battPhysicalResult.grid_import_kwh ?? 0;
            const physicalExportKwh = battPhysicalResult.surplus_kwh ?? 0;
            const physicalLossesKwh = battPhysicalResult.battery_losses_kwh ?? 0;
            const directSelfConsumptionKwh = Math.max(0, physicalAutoKwh - physicalDischargeKwh);
            const hybridPvProducedUsedKwh = Math.max(
              0,
              Math.min(production, consumption, production - hybridSurplusKwh - physicalLossesKwh)
            );
            const hybridSiteSolarOrCreditUsedKwh = Math.max(0, Math.min(consumption, consumption - hybridImportKwh));

            // Agrégation mensuelle hybride (auto = physique + crédits VB utilisés)
            const hybridAutoHourly = battPhysicalResult.auto_hourly.map(
              (a, h) => a + (vbSimHEffective.virtual_battery_hourly_discharge_kwh[h] || 0)
            );
            const hybridSurplusHourly = vbSimHEffective.virtual_battery_hourly_overflow_export_kwh ?? Array(8760).fill(0);
            const monthlyHybrid = aggregateMonthly(ctx.pv.hourly, consoHourlyHybrid, {
              auto_hourly: hybridAutoHourly,
              surplus_hourly: hybridSurplusHourly,
              batt_discharge_hourly: battPhysicalResult.batt_discharge_hourly.map(
                (d, h) => d + (vbSimHEffective.virtual_battery_hourly_discharge_kwh[h] || 0)
              ),
            });

            // Abonnement VB calculé sur le surplus résiduel (Option A)
            let subscriptionAnnualH;
            if (useP2H) {
              const p2WrapH = computeVirtualBatteryP2Finance({
                providerCode: providerRawH,
                contractType: contractTypeH,
                installedKwc: installedKwcH,
                meterKva: meterKvaH,
                vbSim: vbSimHEffective,
                unboundedRequiredCapacityKwh: requiredCapH,
                selectedCapacityKwh: simCapacityKwhH,
                hourlyDischargeKwh: vbSimHEffective.virtual_battery_hourly_discharge_kwh,
                hphcHourlyIsHp: contractTypeH === "HPHC" ? vbInputH.hphc_hourly_slot_is_hp ?? null : null,
                tariffElectricityPerKwh: tariffKwhH,
                oaRatePerKwh: oaRateH,
                virtual_battery_settings: ctx.settings?.pv?.virtual_battery ?? null,
              });
              hybridScenario.virtual_battery_finance = p2WrapH.virtual_battery_finance;
              hybridScenario.virtual_battery_business = computeVirtualBatteryBusiness({
                virtual_battery_finance: p2WrapH.virtual_battery_finance,
                baseImportKwh: battPhysicalResult.grid_import_kwh,
                virtImportKwh: hybridImportKwh,
                baseOverflowOrSurplusKwh: battPhysicalResult.surplus_kwh,
                virtOverflowKwh: hybridSurplusKwh,
                tariffElectricityPerKwh: tariffKwhH,
                oaRatePerKwh: oaRateH,
                includeActivationInVirtualYear1: false,
                annual_virtual_discharge_kwh: vbSimHEffective.virtual_battery_total_discharged_kwh,
              });
              subscriptionAnnualH = Number(p2WrapH.annual_recurring_provider_cost_ttc) || 0;
              hybridScenario._virtualBatteryQuote = {
                annual_cost_ttc: subscriptionAnnualH,
                annual_cost_ht: null,
                net_gain_annual: null,
                detail: { p2: true, recurring_annual_ttc: p2WrapH.annual_recurring_provider_cost_ttc },
              };
            } else {
              const creditResultH = {
                ok: true,
                billable_import_kwh: hybridImportKwh,
                credited_kwh: hybridCredited,
                used_credit_kwh: vbCreditsUsed,
                remaining_credit_kwh: hybridRemainingCredit,
              };
              const costDetailH = computeVirtualBatteryAnnualCost({ creditResult: creditResultH, config: vbInputH });
              subscriptionAnnualH = vbInputH?.annual_subscription_ttc ?? costDetailH?.annual_cost_ttc ?? 0;
              hybridScenario._virtualBatteryQuote = {
                annual_cost_ttc: costDetailH.annual_cost_ttc,
                annual_cost_ht: null,
                net_gain_annual: null,
                detail: costDetailH,
              };
            }

            hybridScenario.energy = {
              prod: production,
              auto: hybridAutoKwh,
              surplus: hybridSurplusKwh,
              import: hybridImportKwh,
              conso: consumption,
              battery_losses_kwh: physicalLossesKwh,
              production_kwh: production,
              consumption_kwh: consumption,
              autoconsumption_kwh: hybridPvProducedUsedKwh,
              total_pv_used_on_site_kwh: hybridPvProducedUsedKwh,
              energy_solar_used_kwh: hybridPvProducedUsedKwh,
              site_solar_or_credit_used_kwh: hybridSiteSolarOrCreditUsedKwh,
              direct_self_consumption_kwh: directSelfConsumptionKwh,
              physical_battery_discharge_kwh: physicalDischargeKwh,
              virtual_battery_discharge_kwh: vbCreditsUsed,
              battery_discharge_kwh: physicalDischargeKwh + vbCreditsUsed,
              physical_auto_kwh: physicalAutoKwh,
              physical_grid_import_kwh: physicalImportKwh,
              physical_grid_export_kwh: physicalExportKwh,
              import_kwh: hybridImportKwh,
              billable_import_kwh: hybridImportKwh,
              surplus_kwh: hybridSurplusKwh,
              grid_import_kwh: hybridImportKwh,
              grid_export_kwh: hybridSurplusKwh,
              credited_kwh: hybridCredited,
              used_credit_kwh: vbCreditsUsed,
              restored_kwh: vbCreditsUsed,
              remaining_credit_kwh: hybridRemainingCredit,
              overflow_export_kwh: hybridSurplusKwh,
              virtual_battery_overflow_export_kwh: hybridSurplusKwh,
              monthly: monthlyHybrid.map(m => ({
                prod: m.prod_kwh, conso: m.conso_kwh, auto: m.auto_kwh,
                surplus: m.surplus_kwh, import: m.import_kwh, batt: m.batt_kwh,
              })),
              hourly: null,
            };

            hybridScenario.prod_kwh = production;
            hybridScenario.auto_kwh = hybridAutoKwh;
            hybridScenario.surplus_kwh = hybridSurplusKwh;
            hybridScenario.conso_kwh = consumption;
            hybridScenario.import_kwh = hybridImportKwh;
            hybridScenario.billable_import_kwh = hybridImportKwh;
            hybridScenario.credited_kwh = hybridCredited;
            hybridScenario.used_credit_kwh = vbCreditsUsed;
            // Taux d'autoconsommation (auto / production) et couverture solaire (auto / conso) — cohérents avec BATTERY_PHYSICAL et BATTERY_VIRTUAL
            hybridScenario.self_consumption_pct = production > 0
              ? Math.round((hybridPvProducedUsedKwh / production) * 10000) / 100
              : 0;
            hybridScenario.self_production_pct = consumption > 0
              ? Math.round((hybridPvProducedUsedKwh / consumption) * 10000) / 100
              : 0;
            hybridScenario.autoproduction_kwh = hybridPvProducedUsedKwh;

            hybridScenario.battery_virtual = {
              enabled: true,
              capacity_simulated_kwh: simCapacityKwhH,
              annual_charge_kwh: hybridCredited,
              annual_discharge_kwh: vbCreditsUsed,
              annual_throughput_kwh: hybridCredited + vbCreditsUsed,
              credited_kwh: hybridCredited,
              restored_kwh: vbCreditsUsed,
              overflow_export_kwh: hybridSurplusKwh,
              cycles_equivalent: simCapacityKwhH > 0 ? vbCreditsUsed / simCapacityKwhH : null,
            };
            hybridScenario.year1 = hybridScenario.virtual_battery_rollover?.year1 ?? null;
            hybridScenario.stabilized = hybridScenario.virtual_battery_rollover?.stabilized ?? null;
            hybridScenario.convergence_year = hybridScenario.virtual_battery_rollover?.convergence_year ?? 1;
            hybridScenario.virtual_credit_start_kwh = hybridScenario.virtual_battery_rollover?.virtual_credit_start_kwh ?? 0;
            hybridScenario.virtual_credit_end_kwh = hybridScenario.virtual_battery_rollover?.virtual_credit_end_kwh ?? hybridRemainingCredit;
            hybridScenario._virtualBattery8760 = {
              virtual_battery_capacity_kwh: vbSimHEffective.virtual_battery_capacity_kwh,
              virtual_battery_credit_start_kwh: vbSimHEffective.virtual_battery_credit_start_kwh,
              virtual_battery_credit_end_kwh: vbSimHEffective.virtual_battery_credit_end_kwh,
              virtual_battery_total_charged_kwh: vbSimHEffective.virtual_battery_total_charged_kwh,
              virtual_battery_total_discharged_kwh: vbSimHEffective.virtual_battery_total_discharged_kwh,
              virtual_battery_overflow_export_kwh: vbSimHEffective.virtual_battery_overflow_export_kwh,
              virtual_battery_hourly_charge_kwh: vbSimHEffective.virtual_battery_hourly_charge_kwh,
              virtual_battery_hourly_discharge_kwh: vbSimHEffective.virtual_battery_hourly_discharge_kwh,
              virtual_battery_hourly_credit_balance_kwh: vbSimHEffective.virtual_battery_hourly_credit_balance_kwh,
              virtual_battery_hourly_overflow_export_kwh: vbSimHEffective.virtual_battery_hourly_overflow_export_kwh,
              virtual_battery_hourly_grid_import_kwh: vbSimHEffective.virtual_battery_hourly_grid_import_kwh,
              hourly_charge: vbSimHEffective.virtual_battery_hourly_charge_kwh,
              hourly_discharge: vbSimHEffective.virtual_battery_hourly_discharge_kwh,
              hourly_state: vbSimHEffective.virtual_battery_hourly_credit_balance_kwh,
            };

            hybridScenario._virtualBatteryP2 = {
              required_capacity_kwh: requiredCapH,
              simulation_capacity_kwh: simCapacityKwhH,
              provider_tier_status: "OK",
              capacity_source: resolvedP2CapacityH.source ?? "required_capacity",
              note: "capacity_reduced_by_physical_battery",
            };

            // CAPEX = PV + batterie physique (abonnement VB = OPEX uniquement)
            const baseCapexTtcH = ctx.finance_input?.capex_ttc ?? 0;
            const batteryPhysicalPriceTtcH = ctx.finance_input?.battery_physical_price_ttc ?? 0;
            hybridScenario.capex_ttc =
              (Number.isFinite(Number(baseCapexTtcH)) ? Number(baseCapexTtcH) : 0) +
              (Number.isFinite(Number(batteryPhysicalPriceTtcH)) ? Number(batteryPhysicalPriceTtcH) : 0);

            hybridScenario.costs = { battery_virtual_annual_cost: subscriptionAnnualH };

            addEnergyKpisToScenario(hybridScenario, ctx);
            scenarios.BATTERY_HYBRID = hybridScenario;
          }
        }
      }
    }


    for (const _sk of Object.keys(scenarios)) {
      attachNormalizedEnergyKpiFields(scenarios[_sk]);
    }

    // ======================================================================
    // SECTION 6 — Finance · impact CO₂ · construction réponse HTTP
    // calcResponseBuilder.js (ÉTAPE 2 DDD) déjà extrait — fonction pure testable.
    // Responsabilité future : FinanceUseCase · ImpactUseCase
    // ======================================================================
    // ------------------------------------------------------------
    // 6) FINANCE (CAPEX 100 % devis / finance_input, pas de pricing moteur)
    // ------------------------------------------------------------

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
    attachAntiOversellToScenarios(ctx, scenariosFinal);

    // Contrôle équilibre énergétique : CONSOMMATION = auto + import ; PRODUCTION = auto + surplus
    for (const [key, sc] of Object.entries(scenariosFinal)) {
      if (!sc) continue;

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

      // ----------------------------------
      // CONSOMMATION CHECK
      // ----------------------------------
      const consCheck = auto + importGrid;
      if (Number.isFinite(consumption) && Number.isFinite(consCheck) && Math.abs(consCheck - consumption) > ENERGY_BALANCE_CONSO_TOLERANCE_KWH) {
        console.warn("ENERGY BALANCE ERROR — CONSUMPTION", key, { consumption, auto, importGrid, auto_plus_import: consCheck });
      }

      // ----------------------------------
      // PRODUCTION CHECK (BATTERY_PHYSICAL: production = auto + surplus + battery_losses)
      // ----------------------------------
      const batteryLosses = (key === "BATTERY_PHYSICAL" && (sc.energy?.battery_losses_kwh != null)) ? Number(sc.energy.battery_losses_kwh) : 0;
      const prodCheck = auto + surplus + batteryLosses;
      if (Number.isFinite(production) && Number.isFinite(prodCheck) && Math.abs(prodCheck - production) > ENERGY_BALANCE_PROD_TOLERANCE_KWH) {
        console.warn("ENERGY_BALANCE_ERROR", key, { production, auto, surplus, battery_losses: batteryLosses, auto_plus_surplus_plus_losses: prodCheck });
      }
    }


    // ------------------------------------------------------------
    // 8) IMPACT
    // ------------------------------------------------------------
    const impact = await impactService.computeImpact(ctx, scenariosFinal);

    // ------------------------------------------------------------
    // 9) JSON FINAL
    // ------------------------------------------------------------
  const ctxFinal = buildCalcResponse({ ctx, form, conso, annualExact, pilotage, scenariosFinal, finance, impact });

  if (process.env.NODE_ENV !== "production" && process.env.DEBUG_FINAL_SCENARIOS_V2 === "1") {
    console.log("=== FINAL scenarios_v2 ===");
    console.log(JSON.stringify(ctxFinal.scenarios_v2, null, 2));
  }

    // ------------------------------------------------------------
    // 10) VALIDATION ÉLECTRIQUE (string sizing, DC/AC, MPPT)
    // Moteur pur — jamais bloquant, toujours présent dans la réponse.
    // ------------------------------------------------------------
    try {
      ctxFinal.electricalValidation = computeElectricalValidation(form);
    } catch (_elecErr) {
      ctxFinal.electricalValidation = { status: "neutral", checks: [], error: _elecErr?.message };
    }

    return res.json(ctxFinal);

  }
  } catch (err) {
    console.error("❌ ERREUR SMARTPITCH :", err);
    if (err instanceof CalcEngineValidationError && err.code === CALC_INVALID_8760_PROFILE) {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        meta: err.meta ?? {},
        calculation_confidence: finalizeCalculationConfidence({
          blocking_warnings: [CALC_INVALID_8760_PROFILE],
          non_blocking_warnings: [],
          assumptions: {
            consumption_source: err.meta?.consumption_source ?? null,
            production_source: null,
            pvgis_fallback_used: false,
            enedis_profile_used: false,
            maintenance_pct: null,
            elec_growth_pct: null,
            horizon_years: null,
            oa_rate_source: null,
            battery_cost_configured: null,
            shading_source: null,
          },
        }),
      });
    }
    return res.status(500).json({
      error: "Erreur interne SmartPitch",
      details: err.message
    });
  }
}

// ======================================================================
// BATTERY_VIRTUAL — structure stable avant merge finance / mapScenarioToV2
// ======================================================================
function summarizeVirtualBatteryYear(result) {
  if (!result || typeof result !== "object") return null;
  const production = Number(result._balance?.sum_pv ?? result.prod_kwh ?? 0);
  const consumption = Number(result._balance?.sum_load ?? 0);
  const auto = Number(result.auto_kwh ?? 0);
  const gridImport = Number(result.grid_import_kwh ?? 0);
  return {
    autoconsumption_kwh: result.auto_kwh ?? null,
    autoconsumption_pct:
      production > 0 ? Math.round((auto / production) * 10000) / 100 : null,
    autonomy_pct:
      consumption > 0 ? Math.round(((consumption - gridImport) / consumption) * 10000) / 100 : null,
    import_kwh: result.grid_import_kwh ?? null,
    export_kwh: result.surplus_kwh ?? null,
    credited_kwh: result.virtual_battery_total_charged_kwh ?? null,
    used_credit_kwh: result.virtual_battery_total_discharged_kwh ?? null,
    virtual_credit_start_kwh: result.virtual_battery_credit_start_kwh ?? 0,
    virtual_credit_end_kwh: result.virtual_battery_credit_end_kwh ?? 0,
  };
}

function buildVirtualBatteryRolloverMeta({ enabled, rollover, year1, stabilized }) {
  return {
    credit_rollover_enabled: enabled === true,
    convergence_year: rollover?.convergence_year ?? 1,
    converged: rollover?.converged ?? true,
    years_simulated: rollover?.years ?? 1,
    virtual_credit_start_kwh: stabilized?.virtual_battery_credit_start_kwh ?? 0,
    virtual_credit_end_kwh: stabilized?.virtual_battery_credit_end_kwh ?? 0,
    year1: summarizeVirtualBatteryYear(year1),
    stabilized: summarizeVirtualBatteryYear(stabilized),
    yearly: Array.isArray(rollover?.yearly) ? rollover.yearly : null,
  };
}

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
function resolveKwcMono(form) {
  const forced = Number(form?.forcage?.puissance_kwc || 0);
  if (Number.isFinite(forced) && forced > 0) return forced;
  const explicit = Number(form?.system_kwc ?? form?.maison?.system_kwc ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const panelPowerFromDevis = resolvePanelPowerWc(form?.panel_input);
  if (panelPowerFromDevis == null) {
    console.error("[ENGINE ERROR] Missing panel in study");
    throw new Error(ENGINE_ERROR_PANEL_REQUIRED);
  }
  const maxPanels = Number(form?.maison?.panneaux_max || 0);
  if (maxPanels > 0) {
    return Math.round((maxPanels * panelPowerFromDevis) / 1000 * 100) / 100;
  }
  console.error("[ENGINE ERROR] Missing panel in study");
  throw new Error(ENGINE_ERROR_PANEL_REQUIRED);
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

  const rawSettings = settings && typeof settings === "object" ? settings : {};
  const rawEconomics =
    rawSettings.economics && typeof rawSettings.economics === "object" ? rawSettings.economics : null;
  const mergedEconomics = mergeOrgEconomicsPartial(
    rawEconomics
  );

  return {
    meta: {
      version: CALC_ENGINE_VERSION,
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

    pricing: rawSettings.pricing || {},
    economics: mergedEconomics,
    /** financeService / economicsResolve lisent ctx.settings.economics — obligatoire pour primes, OA, etc. */
    settings: {
      ...rawSettings,
      pricing: rawSettings.pricing || {},
      economics: mergedEconomics,
      economics_raw: rawEconomics,
    },
    organization_settings:
      rawSettings?.organization_settings && typeof rawSettings.organization_settings === "object"
        ? rawSettings.organization_settings
        : {
            virtual_battery_activation_cost_ttc: null,
          },
  };
}
