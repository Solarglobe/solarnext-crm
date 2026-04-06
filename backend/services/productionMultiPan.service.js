/**
 * Production par pan (multi-pente réel).
 * Réutilise pvgisService.computeProductionMonthlyForOrientation par pan.
 * Zéro recalcul shading : utilise pan.shadingCombinedPct uniquement.
 */

import * as pvgisService from "./pvgisService.js";

const DEV_LOG = process.env.NODE_ENV !== "production";

/**
 * Calcule la production annuelle et mensuelle par pan puis consolidée.
 *
 * @param {object} opts
 * @param {object} opts.site - { lat, lon }
 * @param {object} opts.settings - settings (pricing, pvtech, components)
 * @param {Array<{ id: string, azimuth: number, tilt: number, panelCount: number, shadingCombinedPct?: number }>} opts.pans - roof.pans (structure officielle)
 * @param {number} [opts.moduleWp] - Puissance module Wc (défaut: settings.pricing.kit_panel_power_w ou 485)
 * @param {object} [opts.pv_inverter] - Même bloc que form.pv_inverter (euro_efficiency_pct pour factorAC / pvgisService)
 * @returns {Promise<{ byPan: Array<{ panId: string, annualKwh: number, monthlyKwh: number[], annualKwhBeforeShading?: number, monthlyBeforeShading?: number[] }>, annualKwh: number, monthlyKwh: number[] }>}
 */
export async function computeProductionMultiPan(opts) {
  const { site, settings = {}, pans } = opts;
  const moduleWp = Number(opts.moduleWp ?? settings.pricing?.kit_panel_power_w ?? 485) || 485;
  const pvInverter = opts.pv_inverter && typeof opts.pv_inverter === "object" ? opts.pv_inverter : null;

  if (!Array.isArray(pans) || pans.length === 0) {
    const empty12 = Array(12).fill(0);
    return {
      byPan: [],
      annualKwh: 0,
      monthlyKwh: empty12,
    };
  }

  const ctx = {
    site: { lat: site.lat, lon: site.lon },
    settings,
    ...(pvInverter ? { form: { pv_inverter: pvInverter } } : {}),
  };

  const byPan = [];
  let monthlyKwhSum = Array(12).fill(0);
  let annualKwhTotal = 0;

  for (const pan of pans) {
    const panId = pan.id ?? "";
    const azimuth = typeof pan.azimuth === "number" && Number.isFinite(pan.azimuth) ? pan.azimuth : 180;
    const tilt = typeof pan.tilt === "number" && Number.isFinite(pan.tilt) ? pan.tilt : 30;
    const panelCount = Math.max(0, Math.floor(Number(pan.panelCount) || 0));
    const shadingPct = Math.max(0, Math.min(100, Number(pan.shadingCombinedPct) || 0));
    const multiplier = 1 - shadingPct / 100;

    const kwpPan = (panelCount * moduleWp) / 1000;

    const raw = await pvgisService.computeProductionMonthlyForOrientation(ctx, azimuth, tilt);
    const monthlyBeforeShading = (raw.monthly_kwh || []).map((v) => v * kwpPan);
    const annualBeforeShading = (raw.annual_kwh || 0) * kwpPan;

    const monthlyKwh = monthlyBeforeShading.map((v) => v * multiplier);
    const annualKwh = annualBeforeShading * multiplier;

    byPan.push({
      panId,
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
    byPan,
    annualKwh,
    monthlyKwh,
  };
}

function round(val, d = 2) {
  return Math.round(val * 10 ** d) / 10 ** d;
}
