/* === SHADING_SYNC_GENERATED_BEGIN ===
 * NE PAS MODIFIER À LA MAIN — source : shared/shading/
 * Gouvernance : docs/shading-governance.md
 * Régénérer : npm run sync:calpinage-shading-from-shared
 * === SHADING_SYNC_GENERATED_END ===
 */

/**
 * === SHADING SOURCE OF TRUTH — HORIZON MASK SAMPLING ===
 * Seule source métier éditable pour isSunBlockedByHorizonMask*, sampleHorizonElevationDeg.
 * frontend/calpinage/shading/horizonMaskSampler.js = GÉNÉRÉ (bannière SHADING_SYNC_*).
 * Sync : npm run sync:calpinage-shading-from-shared — docs/shading-governance.md
 *
 * CP-FAR-C-08 — Interpolation alignée backend (horizonMaskCore.interpolateHorizonElevation).
 */

"use strict";

/**
 * Normalise azimuth dans [0, 360).
 * @param {number} azDeg
 * @returns {number}
 */
function normalizeAzimuth(azDeg) {
  var az = ((azDeg % 360) + 360) % 360;
  return az;
}

function clampHorizonElevDeg(e) {
  if (typeof e !== "number" || !Number.isFinite(e)) return 0;
  return Math.max(-5, Math.min(90, e));
}

/**
 * Interpolation pour masque backend: Array<{az, elev}>.
 * Alignée sur backend/services/horizon/horizonMaskCore.js interpolateHorizonElevation.
 * @param {Array<{az: number, elev: number}>} mask
 * @param {number} azDeg
 * @returns {number}
 */
function interpolateObjectMask(mask, azDeg) {
  if (!mask || mask.length === 0) return 0;
  var az = normalizeAzimuth(azDeg);
  if (mask.length === 1) return clampHorizonElevDeg(mask[0].elev != null ? mask[0].elev : 0);
  var step = mask[1].az - mask[0].az;
  if (step <= 0) step = 360 / mask.length;
  var idx = az / step;
  var i0 = Math.floor(idx) % mask.length;
  var i1 = (i0 + 1) % mask.length;
  var az0 = mask[i0].az;
  var az1 = mask[i1].az;
  if (i1 === 0) az1 = 360;
  var denom = az1 - az0;
  var t = denom === 0 || !Number.isFinite(denom) ? 0 : (az - az0) / denom;
  var e0 = clampHorizonElevDeg(mask[i0].elev != null ? mask[i0].elev : 0);
  var e1 = clampHorizonElevDeg(mask[i1].elev != null ? mask[i1].elev : 0);
  return clampHorizonElevDeg(e0 + t * (e1 - e0));
}

/**
 * Interpolation pour masque tableau de nombres (index = azimuth / stepDeg).
 * stepDeg = 1 et length 360: a0 = floor(az), a1 = (a0+1) % 360, t = az - a0, elev = (1-t)*mask[a0] + t*mask[a1].
 * @param {number[]} values
 * @param {number} azDeg
 * @param {number} stepDeg
 * @returns {number}
 */
function interpolateFlatMask(values, azDeg, stepDeg) {
  if (!values || values.length === 0) return 0;
  var az = normalizeAzimuth(azDeg);
  var N = values.length;
  var step = stepDeg > 0 ? stepDeg : 360 / N;
  var index = az / step;
  var i0 = Math.floor(index) % N;
  var i1 = (i0 + 1) % N;
  var t = index - Math.floor(index);
  var v0 = clampHorizonElevDeg(typeof values[i0] === "number" ? values[i0] : 0);
  var v1 = clampHorizonElevDeg(typeof values[i1] === "number" ? values[i1] : 0);
  return clampHorizonElevDeg((1 - t) * v0 + t * v1);
}

/**
 * Pas angulaire explicite sur un objet masque (hors tableau elevations legacy).
 */
function pickStepDegOnHorizonObject(horizonMask) {
  if (horizonMask.stepDeg != null) return Number(horizonMask.stepDeg);
  if (horizonMask.step_deg != null) return Number(horizonMask.step_deg);
  return 0;
}

/**
 * Résout tableau + pas pour tous formats consommés (backend API, legacy convertHorizonToMask).
 * Priorité : mask > values > elevations (évite collisions si plusieurs clés présentes).
 * @returns {{ arr: Array, stepDeg: number, kind: string }|null}
 */
function getEffectiveHorizonArray(horizonMask) {
  if (horizonMask == null) return null;
  if (Array.isArray(horizonMask)) {
    return { arr: horizonMask, stepDeg: 0, kind: "array" };
  }
  if (typeof horizonMask !== "object") return null;

  var mask = horizonMask.mask;
  if (Array.isArray(mask) && mask.length > 0) {
    return { arr: mask, stepDeg: pickStepDegOnHorizonObject(horizonMask), kind: "mask" };
  }
  var values = horizonMask.values;
  if (Array.isArray(values) && values.length > 0) {
    return { arr: values, stepDeg: pickStepDegOnHorizonObject(horizonMask), kind: "values" };
  }
  var elevArr = horizonMask.elevations;
  if (Array.isArray(elevArr) && elevArr.length > 0) {
    var sd =
      horizonMask.azimuthStepDeg != null
        ? Number(horizonMask.azimuthStepDeg)
        : horizonMask.stepDeg != null
          ? Number(horizonMask.stepDeg)
          : horizonMask.step_deg != null
            ? Number(horizonMask.step_deg)
            : 0;
    var stepUse = sd > 0 && Number.isFinite(sd) ? sd : 360 / elevArr.length;
    return { arr: elevArr, stepDeg: stepUse, kind: "elevations" };
  }
  return null;
}

/**
 * Détecte le format du masque et retourne l'élévation interpolée.
 * Formes supportées:
 * - { mask: Array<{az, elev}> } (backend)
 * - { mask: number[], stepDeg?: number } ou { values: number[], stepDeg?: number }
 * - { azimuthStepDeg, elevations } (legacy calpinage convertHorizonToMask)
 * - Array direct: number[] (step = 360/length) ou Array<{az, elev}>
 *
 * @param {object|Array} horizonMask - Masque au format backend ou dérivé
 * @param {number} azimuthDeg - Azimut en degrés
 * @returns {number} Élévation horizon en degrés
 */
function sampleHorizonElevationDeg(horizonMask, azimuthDeg) {
  if (horizonMask == null) return 0;

  var eff = getEffectiveHorizonArray(horizonMask);
  if (!eff || !eff.arr || eff.arr.length === 0) return 0;

  var arr = eff.arr;
  var isObjectMask =
    arr.length > 0 &&
    typeof arr[0] === "object" &&
    arr[0] !== null &&
    ("az" in arr[0] || "elev" in arr[0]);
  if (isObjectMask) {
    return interpolateObjectMask(arr, azimuthDeg);
  }

  var stepDeg = eff.stepDeg > 0 ? eff.stepDeg : 360 / arr.length;
  return interpolateFlatMask(arr, azimuthDeg, stepDeg);
}

/**
 * Indique si le soleil est masqué par l'horizon (règle alignée backend).
 * Backend: aboveHorizon = elDeg >= horizonElev → bloqué si elDeg < horizonElev (strict <).
 * Nuit (sunElevationDeg <= 0) : considéré bloqué (pas de contribution).
 *
 * @param {object|Array|null|undefined} horizonMask - Masque ou absent
 * @param {number} azimuthDeg - Azimut soleil
 * @param {number} sunElevationDeg - Élévation soleil
 * @returns {boolean} true si le soleil est bloqué par l'horizon
 */
function isSunBlockedByHorizonMask(horizonMask, azimuthDeg, sunElevationDeg) {
  if (sunElevationDeg <= 0) return true;
  if (horizonMask == null) return false;
  var horizonElev = sampleHorizonElevationDeg(horizonMask, azimuthDeg);
  return sunElevationDeg < horizonElev;
}

/** Log unique pour fallback horizonMask manquant (throttlé) */
var _fallbackLogged = false;
function logFallbackOnce() {
  if (_fallbackLogged) return;
  _fallbackLogged = true;
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[SHADING] horizonMask missing → fallback legacy behavior");
  }
}

/**
 * Version safe pour l'appelant: si horizonMask absent, retourne false (pas bloqué) et log une fois.
 * À utiliser dans computeAnnualShadingLoss.
 */
function isSunBlockedByHorizonMaskSafe(horizonMask, azimuthDeg, sunElevationDeg) {
  var eff = getEffectiveHorizonArray(horizonMask);
  if (!eff || !eff.arr || eff.arr.length === 0) {
    logFallbackOnce();
    return false;
  }
  return isSunBlockedByHorizonMask(horizonMask, azimuthDeg, sunElevationDeg);
}

/**
 * Log comparatif (dev only), une fois par run si window.SHADING_DEBUG === true.
 * Log: format résolu, stepDeg, N, 3 samples (0°, 90°, 180°).
 */
function logDebugSampler(horizonMask) {
  if (typeof window === "undefined" || !window.SHADING_DEBUG) return;
  if (!horizonMask) return;
  var eff = getEffectiveHorizonArray(horizonMask);
  if (!eff || !eff.arr || eff.arr.length === 0) {
    if (typeof console !== "undefined" && console.log) {
      console.log("[SHADING_DEBUG] horizonMask format=none usableSamples=0 (masque absent ou non reconnu)");
    }
    return;
  }

  var arr = eff.arr;
  var N = arr.length;
  var isObject = N > 0 && typeof arr[0] === "object" && arr[0] != null && ("az" in arr[0] || "elev" in arr[0]);
  var stepDeg =
    isObject && N >= 2
      ? arr[1].az - arr[0].az
      : eff.stepDeg > 0
        ? eff.stepDeg
        : 360 / N;

  var s0 = sampleHorizonElevationDeg(horizonMask, 0);
  var s90 = sampleHorizonElevationDeg(horizonMask, 90);
  var s180 = sampleHorizonElevationDeg(horizonMask, 180);
  if (typeof console !== "undefined" && console.log) {
    console.log(
      "[SHADING_DEBUG] horizonMask format=" +
        eff.kind +
        " stepDeg=" +
        (typeof stepDeg === "number" && Number.isFinite(stepDeg) ? stepDeg.toFixed(3) : String(stepDeg)) +
        " N=" +
        N +
        " samples(0°,90°,180°)=" +
        [s0, s90, s180].map(function (n) { return n.toFixed(2); }).join(",")
    );
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sampleHorizonElevationDeg: sampleHorizonElevationDeg,
    isSunBlockedByHorizonMask: isSunBlockedByHorizonMask,
    isSunBlockedByHorizonMaskSafe: isSunBlockedByHorizonMaskSafe,
    logDebugSampler: logDebugSampler,
  };
}
if (typeof window !== "undefined") {
  window.__SHADING_HORIZON_MASK_SAMPLER__ = {
    sampleHorizonElevationDeg: sampleHorizonElevationDeg,
    isSunBlockedByHorizonMask: isSunBlockedByHorizonMask,
    isSunBlockedByHorizonMaskSafe: isSunBlockedByHorizonMaskSafe,
    logDebugSampler: logDebugSampler,
  };
}
