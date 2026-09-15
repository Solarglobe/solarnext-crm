import {buildPanHourly} from './pvHourlyModel.service.js';
import {getPvgisHourlyReference} from './pvgisHourly.service.js';
import {calendarForLength,bindCalendar,monthlySums} from './energyCalendar.service.js';
/**
 * Production par pan (multi-pente réel).
 * Réutilise pvgisService.computeProductionMonthlyForOrientation par pan.
 * Ombrage appliqué une seule fois depuis la perte globale attestée ; absence = exclusion.
 */

import * as pvgisService from "./pvgisService.js";
import { ENGINE_ERROR_PANEL_REQUIRED } from "../utils/resolvePanelPowerWc.js";

const DEV_LOG = process.env.NODE_ENV !== "production";

/**
 * Calcule la production annuelle et mensuelle par pan puis consolidée.
 *
 * @param {object} opts
 * @param {object} opts.site - { lat, lon }
 * @param {object} opts.settings - settings (pricing, pvtech, components)
 * @param {Array<{ id: string, azimuth: number, tilt: number, panelCount: number, powerKwc?: number, shadingCombinedPct?: number }>} opts.pans - roof.pans (structure officielle)
 * @param {number} opts.moduleWp - Puissance module Wc (obligatoire si pans non vides — issu du panneau catalogue / panel_input)
 * @param {object} [opts.pv_inverter] - Même bloc que form.pv_inverter (euro_efficiency_pct pour factorAC / pvgisService)
 * @param {number|null} [opts.globalShadingLossPct] - Perte d'ombrage globale officielle a appliquer apres PVGIS pan par pan.
 * @returns {Promise<{ byPan: Array<{ panId: string, annualKwh: number, monthlyKwh: number[], annualKwhBeforeShading?: number, monthlyBeforeShading?: number[] }>, annualKwh: number, monthlyKwh: number[] }>}
 */
export async function computeProductionMultiPan(opts) {
  const { site, settings = {}, pans } = opts;
  const moduleWp = Number(opts.moduleWp);
  const pvInverter = opts.pv_inverter && typeof opts.pv_inverter === "object" ? opts.pv_inverter : null;
  const globalShadingLossPct = typeof opts.globalShadingLossPct === 'number'
    && Number.isFinite(opts.globalShadingLossPct) && opts.globalShadingLossPct >= 0 && opts.globalShadingLossPct <= 100
    ? opts.globalShadingLossPct : null;
  const hasGlobalShadingLoss = globalShadingLossPct !== null;

  if (!Array.isArray(pans) || pans.length === 0) {
    const empty12 = Array(12).fill(0);
    return {
      byPan: [],
      annualKwh: 0,
      monthlyKwh: empty12,
    };
  }

  if (!Number.isFinite(moduleWp) || moduleWp <= 50) {
    console.error("[ENGINE ERROR] Missing panel in study");
    throw new Error(ENGINE_ERROR_PANEL_REQUIRED);
  }

  const ctx = {
    site: { lat: site.lat, lon: site.lon },
    settings:{...settings,calculation_offline:opts.offline===true},
    ...(pvInverter ? { form: { pv_inverter: pvInverter } } : {}),
  };

  const calendar=opts.calendar??calendarForLength();
  const hourlySum=Array(calendar.length).fill(0);
  const byPan = [];
  let monthlyKwhSum = Array(12).fill(0);
  let annualKwhTotal = 0;

  for (const pan of pans) {
    const panId = pan.id ?? "";
    const azimuth = typeof pan.azimuth === "number" && Number.isFinite(pan.azimuth) ? pan.azimuth : 180;
    const tilt = typeof pan.tilt === "number" && Number.isFinite(pan.tilt) ? pan.tilt : 30;
    const panelCount = Math.max(0, Math.floor(Number(pan.panelCount) || 0));
    const shadingPct = hasGlobalShadingLoss
      ? globalShadingLossPct
      : null;
    const multiplier = shadingPct == null ? 1 : 1 - shadingPct / 100;

    const panPowerKwc = Number(pan.powerKwc ?? pan.power_kwc);
    const kwpPan = Number.isFinite(panPowerKwc) && panPowerKwc > 0
      ? panPowerKwc
      : (panelCount * moduleWp) / 1000;

    const raw = await pvgisService.computeProductionMonthlyForOrientation(ctx, azimuth, tilt);
    const monthlyBeforeShading = (raw.monthly_kwh || []).map((v) => v * kwpPan);
    const annualBeforeShading = (raw.annual_kwh || 0) * kwpPan;

    const hourlyShade = null; // Current certified global loss is applied exactly once to each monthly reference.
    const expectedMonthly = hourlyShade ? monthlyBeforeShading : monthlyBeforeShading.map(v=>v*multiplier);
    const hourlyReference=await getPvgisHourlyReference({latitude:site.lat,longitude:site.lon,azimuth,tilt,reference_year:settings.pv?.pvgis_reference_year??2020},{offline:opts.offline===true});
    const hourly=buildPanHourly({monthly_kwh:expectedMonthly,latitude:site.lat,longitude:site.lon,azimuth,tilt,calendar,pvgis_hourly:hourlyReference.hourly,shading_hourly:hourlyShade});
    const monthlyKwh=monthlySums(hourly,calendar);
    const annualKwh=monthlyKwh.reduce((a,b)=>a+b,0);
    hourly.forEach((v,i)=>hourlySum[i]+=v);

    byPan.push({
      panId, shadingLossPct: shadingPct, shadingApplied: hasGlobalShadingLoss,
      monthly_source:raw.source??'PVGIS_MONTHLY_AC',monthly_reference:raw.reference??null,
      hourly_data_hash:hourlyReference.data_hash??null,
      hourly_source:hourlyReference.source,
      hourly_reference_key:hourlyReference.key,
      hourly_reference_request:hourlyReference.request,
      hourly_warning:hourlyReference.warning??null,
      azimuth,tilt,power_kwc:kwpPan,
      annualKwh: round(annualKwh, 2),
      monthlyKwh: monthlyKwh.map((v) => round(v, 2)),
      annualKwhBeforeShading: round(annualBeforeShading, 2),
      monthlyBeforeShading: monthlyBeforeShading.map((v) => round(v, 2)),
    });

    for (let m = 0; m < 12; m++) {
      monthlyKwhSum[m] = (monthlyKwhSum[m] || 0) + (monthlyKwh[m] || 0);
    }
    annualKwhTotal += annualKwh;
  }

  const monthlyKwh = monthlyKwhSum.map((v) => round(v, 2));
  const annualKwh = round(annualKwhTotal, 2);

  if (DEV_LOG) {
    console.log(`MULTIPAN_PROD: pans=${pans.length} annual=${annualKwh.toFixed(1)}`);
  }

  return {
    byPan, shadingLossPct: hasGlobalShadingLoss ? globalShadingLossPct : null, shadingApplied: hasGlobalShadingLoss,
    annualKwh,
    monthlyKwh,
    hourly:bindCalendar(hourlySum,calendar),
    calendar,
  };
}

function round(val, d = 2) {
  return Math.round(val * 10 ** d) / 10 ** d;
}
