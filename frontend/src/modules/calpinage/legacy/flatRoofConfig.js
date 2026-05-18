/**
 * flatRoofConfig.js — Configuration toiture plate (module ES natif).
 *
 * Extrait de calpinage.module.js (strangler fig — Phase 1).
 * Remplace les deux copies dupliquées :
 *   - module-level `__safeNormalizeFlatRoofConfig` (ligne ~146, fallback export)
 *   - closure-level `normalizeFlatRoofConfig`      (ligne ~5287, 20+ appels internes)
 *
 * Contraintes :
 *   - Aucune dépendance à window.* — fonctions pures uniquement.
 *   - Interface identique aux deux copies supprimées — aucun appelant ne change.
 *   - Testable unitairement via __tests__/flatRoofConfig.test.js.
 */

// ── Constantes ────────────────────────────────────────────────────────────────

/** Inter-rangées toit plat fixée à 55 cm (produit SolarNext V1). */
export const FLAT_ROOF_ROW_SPACING_CM = 55;

/** Inter-rangées toit plat en millimètres (identique à FLAT_ROOF_ROW_SPACING_CM × 10). */
export const FLAT_ROOF_ROW_SPACING_MM = 550;

// ── Config par défaut (interne) ───────────────────────────────────────────────

const DEFAULT_FLAT_ROOF_CONFIG = {
  supportTiltDeg: 10,
  layoutOrientation: "portrait",
  setbackRoofEdgeCm: 60,
  setbackObstacleCm: 60,
  rowSpacingCm: FLAT_ROOF_ROW_SPACING_CM,
  colSpacingCm: 2,
};

// ── Fonctions exportées ───────────────────────────────────────────────────────

/**
 * Normalise la configuration toit plat d'un pan.
 *
 * Fonction pure : ne lit pas window.*, ne produit aucun effet de bord.
 * Valeurs invalides ou absentes → fallback sur DEFAULT_FLAT_ROOF_CONFIG.
 *
 * @param {unknown} fc - Objet de configuration brut (depuis CALPINAGE_STATE ou sauvegarde).
 * @returns {{ supportTiltDeg: 5|10|15, layoutOrientation: "portrait"|"landscape",
 *             setbackRoofEdgeCm: number, setbackObstacleCm: number,
 *             rowSpacingCm: number, rowSpacingMm: number,
 *             colSpacingCm: number, rowSpacingManual: boolean }}
 */
export function normalizeFlatRoofConfig(fc) {
  fc = fc && typeof fc === "object" ? fc : {};
  const st = Number(fc.supportTiltDeg);
  const supportTiltDeg = (st === 5 || st === 10 || st === 15)
    ? st
    : DEFAULT_FLAT_ROOF_CONFIG.supportTiltDeg;
  const lo = (fc.layoutOrientation != null ? String(fc.layoutOrientation) : "").toLowerCase();
  const layoutOrientation = (lo === "landscape" || lo === "paysage") ? "landscape" : "portrait";
  function numCm(k, def) {
    const v = Number(fc[k]);
    return Number.isFinite(v) && v >= 0 ? v : def;
  }
  return {
    supportTiltDeg,
    layoutOrientation,
    setbackRoofEdgeCm: numCm("setbackRoofEdgeCm", DEFAULT_FLAT_ROOF_CONFIG.setbackRoofEdgeCm),
    setbackObstacleCm: numCm("setbackObstacleCm", DEFAULT_FLAT_ROOF_CONFIG.setbackObstacleCm),
    rowSpacingCm: FLAT_ROOF_ROW_SPACING_CM,
    rowSpacingMm: FLAT_ROOF_ROW_SPACING_MM,
    colSpacingCm: numCm("colSpacingCm", DEFAULT_FLAT_ROOF_CONFIG.colSpacingCm),
    rowSpacingManual: fc.rowSpacingManual === true,
  };
}

/**
 * Inter-rangées toit plat selon l'inclinaison support.
 * La valeur est figée à FLAT_ROOF_ROW_SPACING_CM (55 cm) quel que soit l'angle —
 * le paramètre `tiltDeg` est réservé pour une future graduation par inclinaison.
 *
 * @param {number} _tiltDeg - Inclinaison support en degrés (ignorée, réservé).
 * @returns {number} Espacement inter-rangées en cm.
 */
export function getAutoRowSpacingCmFromTilt(_tiltDeg) {
  return FLAT_ROOF_ROW_SPACING_CM;
}
