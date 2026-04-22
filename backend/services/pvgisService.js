// ======================================================================
// SMARTPITCH — PVGIS SERVICE (Solarglobe 2025)
// ----------------------------------------------------------------------
// ✔ PVGIS ERA5 loss=0 → DC brut après corrections température + IAM déjà appliquées par PVGIS
// ✔ factorAC = η_onduleur × (1-câblage) × (1-salissures) × (1-mismatch) × (1-disponibilité)
// ✔ η_onduleur : euro_efficiency_pct réel de la fiche technique onduleur
// ✔ Pertes fixes résidentiel FR : câblage 1.5%, salissures 2.5%, mismatch 1%, disponibilité 0.5%
// ✔ Température et IAM : déjà dans PVGIS ERA5 — aucun double comptage
// ======================================================================

import fetch from "node-fetch";
import { round } from "./utils/helpers.js";
import {
  L_CABLE,
  L_SOIL,
  L_MISMATCH,
  L_AVAIL,
  DEFAULT_INVERTER_EFFICIENCY,
  FALLBACK_NATIONAL_MONTHLY_DC,
  FALLBACK_NATIONAL_ANNUAL_DC_REF,
  PVGIS_FALLBACK_LAT_MIN,
  PVGIS_FALLBACK_LAT_MAX,
  PVGIS_FALLBACK_LON_DEFAULT,
  PVGIS_FALLBACK_LON_MIN,
  PVGIS_FALLBACK_LON_MAX,
  PVGIS_FALLBACK_DC_KWH_KWP_ZONE_A,
  PVGIS_FALLBACK_DC_KWH_KWP_NORTH,
  PVGIS_FALLBACK_DC_KWH_KWP_NORTH_MID,
  PVGIS_FALLBACK_DC_KWH_KWP_CENTER,
  PVGIS_FALLBACK_DC_KWH_KWP_SW,
  PVGIS_FALLBACK_DC_KWH_KWP_SE,
  PVGIS_FETCH_TIMEOUT_MS,
  PVGIS_DEFAULT_TILT_DEG,
} from "./core/engineConstants.js";

/**
 * Calcule le factorAC (PR partiel hors température et IAM déjà dans PVGIS).
 * Utilise le rendement euro réel de l'onduleur sélectionné si disponible.
 * @param {object} ctx — contexte calcul (ctx.form.pv_inverter.euro_efficiency_pct)
 * @returns {{ factorAC: number, etaInv: number, source: string }}
 */
function _computeFactorAC(ctx) {
  if (!ctx?.form?.pv_inverter?.euro_efficiency_pct) {
    console.warn("[ENGINE WARNING] Using default inverter efficiency (0.965)");
  }
  const rawEuroEff = ctx?.form?.pv_inverter?.euro_efficiency_pct;
  const etaInv =
    rawEuroEff != null && Number.isFinite(Number(rawEuroEff)) && Number(rawEuroEff) > 50
      ? Number(rawEuroEff) / 100
      : DEFAULT_INVERTER_EFFICIENCY; // défaut : onduleur string résidentiel moderne

  const factorAC = etaInv * (1 - L_CABLE) * (1 - L_SOIL) * (1 - L_MISMATCH) * (1 - L_AVAIL);
  const source = rawEuroEff != null ? "fiche-technique" : "défaut-0.965";

  return { factorAC, etaInv, source };
}

/** Exposé pour tests unitaires (factor AC multi-pan / mono). */
export function computeFactorACForTests(ctx) {
  return _computeFactorAC(ctx);
}

/**
 * Cible DC kWh/kWp/an pour le fallback API PVGIS KO — grosses zones FR (lat/lon), ordre des tests important.
 * Hors périmètre métro approximatif → référence nationale (comportement historique).
 */
function getFallbackAnnualDcKwhPerKwp(lat, lon) {
  const ref = FALLBACK_NATIONAL_ANNUAL_DC_REF;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return ref;
  if (lat < PVGIS_FALLBACK_LAT_MIN || lat > PVGIS_FALLBACK_LAT_MAX) return ref;
  const lonN = typeof lon === "number" && Number.isFinite(lon) ? lon : PVGIS_FALLBACK_LON_DEFAULT;
  if (lonN < PVGIS_FALLBACK_LON_MIN || lonN > PVGIS_FALLBACK_LON_MAX) return ref;

  if (lat >= 41 && lat <= 43.5 && lonN >= 8 && lonN <= 10) return PVGIS_FALLBACK_DC_KWH_KWP_ZONE_A;
  if (lat >= 49.2) return PVGIS_FALLBACK_DC_KWH_KWP_NORTH;
  if (lat >= 48.0) return PVGIS_FALLBACK_DC_KWH_KWP_NORTH_MID;
  if (lat >= 45.5) return PVGIS_FALLBACK_DC_KWH_KWP_CENTER;
  if (lat < 45.5 && lonN < 3.5) return PVGIS_FALLBACK_DC_KWH_KWP_SW;
  if (lat < 45.5) return PVGIS_FALLBACK_DC_KWH_KWP_SE;
  return ref;
}

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("PVGIS timeout")), ms)
  );
}

export async function computeProductionMonthly(ctx) {
  const { lat, lon, orientation, inclinaison } = ctx.site;
  const aspect = convertOrientation(orientation);
  const tilt = inclinaison || PVGIS_DEFAULT_TILT_DEG;

  // ===================================================================
  // 0) PVGIS URL — aucune perte (loss=0)
  // ===================================================================
  const url =
    `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?` +
    `lat=${lat}&lon=${lon}` +
    `&angle=${tilt}` +
    `&aspect=${aspect}` +
    `&peakpower=1` +
    `&loss=0` +
    `&mountingplace=building` +
    `&raddatabase=PVGIS-ERA5` +
    `&outputformat=json`;

  console.log("🔎 PVcalc URL:", url);

  let js = null;

  try {
    const res = await Promise.race([fetch(url), timeout(PVGIS_FETCH_TIMEOUT_MS)]);
    if (!res.ok) {
      console.error("❌ PVGIS HTTP ERROR:", res.status);
      throw new Error("PVGIS HTTP " + res.status);
    }
    js = await res.json();
  } catch (err) {
    console.error("❌ PVGIS FETCH ERROR:", err);
    return fallbackPV(ctx);
  }

  const months = js?.outputs?.monthly?.fixed;
  if (!months || months.length !== 12) {
    console.error("❌ PVGIS monthly invalid:", js?.outputs?.monthly);
    return fallbackPV(ctx);
  }

  // ===================================================================
  // 1) EXTRACTION BRUTE DC (E_m)
  // ===================================================================
  const monthly_raw_kwh = months.map(m => {
    const val = Number(m?.E_m ?? 0);
    return val > 0 ? round(val, 0) : 0;
  });

  const annual_raw_kwh = monthly_raw_kwh.reduce((a, b) => a + b, 0);

  // ===================================================================
  // 2) CALCUL DU FACTEUR AC — rendement onduleur réel + pertes fixes
  // ===================================================================
  const { factorAC, etaInv, source: facSource } = _computeFactorAC(ctx);

  console.log(
    `⚡ FACTEUR AC = ${factorAC.toFixed(4)}` +
    ` | η_inv=${(etaInv * 100).toFixed(2)}% (${facSource})` +
    ` câblage=${(L_CABLE * 100).toFixed(1)}%` +
    ` salissures=${(L_SOIL * 100).toFixed(1)}%` +
    ` mismatch=${(L_MISMATCH * 100).toFixed(1)}%` +
    ` dispo=${(L_AVAIL * 100).toFixed(1)}%`
  );

  // ===================================================================
  // 3) CONVERSION DC → AC
  // ===================================================================
  const monthly_ac_kwh = monthly_raw_kwh.map(v =>
    round(v * factorAC, 0)
  );

  const annual_ac_kwh = monthly_ac_kwh.reduce((a, b) => a + b, 0);

  return {
    monthly_raw_kwh,
    annual_raw_kwh,
    monthly_kwh: monthly_ac_kwh,
    annual_kwh: annual_ac_kwh,
    factorAC,
    source: "PVGIS-PVcalc-ERA5+Solarglobe"
  };
}

// ======================================================================
// FALLBACK — valeurs premium en cas d'échec API
// ======================================================================
function fallbackPV(ctx) {
  console.warn("[ENGINE WARNING] Using PVGIS fallback data (national profile)");

  const site = ctx.site || {};
  const annualDcTarget = getFallbackAnnualDcKwhPerKwp(site.lat, site.lon);
  const scaleDc = annualDcTarget / FALLBACK_NATIONAL_ANNUAL_DC_REF;
  let base_raw = FALLBACK_NATIONAL_MONTHLY_DC.map((v) => Math.round(v * scaleDc));
  const sumDc = base_raw.reduce((a, b) => a + b, 0);
  const driftDc = annualDcTarget - sumDc;
  if (driftDc !== 0 && base_raw.length === 12) {
    const idxMax = base_raw.indexOf(Math.max(...base_raw));
    base_raw[idxMax] = Math.max(0, base_raw[idxMax] + driftDc);
  }
  const annual_raw_kwh = base_raw.reduce((a, b) => a + b, 0);

  const { factorAC } = _computeFactorAC(ctx);

  const base_ac = base_raw.map(v => Math.round(v * factorAC));
  const annual_ac_kwh = base_ac.reduce((a, b) => a + b, 0);

  return {
    monthly_raw_kwh: base_raw,
    annual_raw_kwh,
    monthly_kwh: base_ac,
    annual_kwh: annual_ac_kwh,
    factorAC,
    source: "FALLBACK-ZoneFR"
  };
}

// ======================================================================
// ORIENTATION → PVGIS ASPECT
// ======================================================================
function convertOrientation(o) {
  if (!o) return 0;
  const t = o.toUpperCase().trim();

  const map = {
    N: 180,
    NE: -135,
    E: -90,
    SE: -45,
    S: 0,
    SW: 45,
    W: 90,
    NW: 135
  };

  return map[t] ?? 0;
}

/** Azimut degrés (0=N, 90=E, 180=S) → PVGIS aspect (0=South, 90=West, -90=East). */
function azimuthDegToPvgisAspect(azimuthDeg) {
  if (typeof azimuthDeg !== "number" || !Number.isFinite(azimuthDeg)) return 0;
  let aspect = 180 - azimuthDeg;
  if (aspect > 180) aspect -= 360;
  if (aspect < -180) aspect += 360;
  return aspect;
}

// ======================================================================
// MULTI-PAN — Production pour une orientation (azimuth/tilt) donnée
// Réutilise le même moteur que computeProductionMonthly (1 kWp, sans shading).
// ======================================================================

/**
 * Production mensuelle pour un pan (1 kWp, sans ombrage).
 * Utilisé par computeProductionMultiPan pour chaque pan.
 * @param {object} ctx - Contexte (site.lat, site.lon, settings)
 * @param {number} azimuthDeg - Azimut pan en degrés (0=N, 180=S)
 * @param {number} tiltDeg - Inclinaison pan en degrés
 * @returns {Promise<{ monthly_kwh: number[], annual_kwh: number, monthly_raw_kwh: number[], annual_raw_kwh: number }>}
 */
export async function computeProductionMonthlyForOrientation(ctx, azimuthDeg, tiltDeg) {
  const lat = ctx.site?.lat;
  const lon = ctx.site?.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fallbackPVForOrientation(ctx, azimuthDeg, tiltDeg);
  }
  const aspect = azimuthDegToPvgisAspect(azimuthDeg);
  const tilt = typeof tiltDeg === "number" && Number.isFinite(tiltDeg) ? tiltDeg : PVGIS_DEFAULT_TILT_DEG;

  const url =
    `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?` +
    `lat=${lat}&lon=${lon}` +
    `&angle=${tilt}` +
    `&aspect=${aspect}` +
    `&peakpower=1` +
    `&loss=0` +
    `&mountingplace=building` +
    `&raddatabase=PVGIS-ERA5` +
    `&outputformat=json`;

  let js = null;
  try {
    const res = await Promise.race([fetch(url), timeout(PVGIS_FETCH_TIMEOUT_MS)]);
    if (!res.ok) throw new Error("PVGIS HTTP " + res.status);
    js = await res.json();
  } catch (err) {
    return fallbackPVForOrientation(ctx, azimuthDeg, tiltDeg);
  }

  const months = js?.outputs?.monthly?.fixed;
  if (!months || months.length !== 12) {
    return fallbackPVForOrientation(ctx, azimuthDeg, tiltDeg);
  }

  const monthly_raw_kwh = months.map(m => {
    const val = Number(m?.E_m ?? 0);
    return val > 0 ? round(val, 0) : 0;
  });
  const annual_raw_kwh = monthly_raw_kwh.reduce((a, b) => a + b, 0);

  const { factorAC } = _computeFactorAC(ctx);

  const monthly_ac_kwh = monthly_raw_kwh.map(v => round(v * factorAC, 0));
  const annual_ac_kwh = monthly_ac_kwh.reduce((a, b) => a + b, 0);

  return {
    monthly_raw_kwh,
    annual_raw_kwh,
    monthly_kwh: monthly_ac_kwh,
    annual_kwh: annual_ac_kwh,
  };
}

function fallbackPVForOrientation(ctx, azimuthDeg, tiltDeg) {
  const out = fallbackPV(ctx);
  return {
    monthly_raw_kwh: out.monthly_raw_kwh,
    annual_raw_kwh: out.annual_raw_kwh,
    monthly_kwh: out.monthly_kwh,
    annual_kwh: out.annual_kwh,
  };
}
