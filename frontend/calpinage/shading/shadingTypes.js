/**
 * Utilitaires pour le module shading (calpinage).
 * Pas d'exposition globale (window.*). Export UMD/CommonJS uniquement.
 */

/** @param {number} deg - Angle en degrés */
function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

/** @param {number} rad - Angle en radians */
function rad2deg(rad) {
  return (rad * 180) / Math.PI;
}

/** @param {number} x - Valeur à clamper entre 0 et 1 */
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { deg2rad, rad2deg, clamp01 };
}
