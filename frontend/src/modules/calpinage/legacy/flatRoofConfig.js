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

import { getMountingSystemById, buildMountingSystemSnapshot } from "./flatRoofMountingSystems.js";

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

  function numCm(k, def) {
    const v = Number(fc[k]);
    return Number.isFinite(v) && v >= 0 ? v : def;
  }

  // ── LOT A — MATÉRIEL DE POSE : branche système fabricant ────────────────────
  // Un système K2/ESDEC sélectionné (mountingSystemId) pilote inclinaison,
  // orientation, inter-rangées et marges par défaut. Les systèmes désactivés
  // (est-ouest, enabled:false) sont refusés ici → jamais appliqués au moteur.
  const system = getMountingSystemById(fc.mountingSystemId);
  if (system && system.enabled === true) {
    const st = Number(fc.supportTiltDeg);
    const supportTiltDeg = system.tiltOptionsDeg.indexOf(st) !== -1 ? st : system.defaultTiltDeg;
    const loRaw = (fc.layoutOrientation != null ? String(fc.layoutOrientation) : "").toLowerCase();
    const loNorm = (loRaw === "landscape" || loRaw === "paysage") ? "landscape" : "portrait";
    const layoutOrientation =
      system.orientationOptions.indexOf(loNorm) !== -1 ? loNorm : system.defaultOrientation;
    const rowSpacingCm = system.defaultRowSpacingCm; // V1 : imposé par le système (modes libres au Lot B)
    return {
      supportTiltDeg,
      layoutOrientation,
      setbackRoofEdgeCm: numCm("setbackRoofEdgeCm", system.defaultSetbackRoofEdgeCm),
      setbackObstacleCm: numCm("setbackObstacleCm", system.defaultSetbackObstacleCm),
      rowSpacingCm,
      rowSpacingMm: rowSpacingCm * 10,
      colSpacingCm: numCm("colSpacingCm", DEFAULT_FLAT_ROOF_CONFIG.colSpacingCm),
      rowSpacingManual: false,
      mountingSystemId: system.id,
      // Snapshot figé pour la persistance étude → devis / PDF (Lot D)
      mountingSystem: buildMountingSystemSnapshot(system, supportTiltDeg),
    };
  }

  // ── Branche legacy (aucun système) : comportement historique STRICTEMENT inchangé ──
  // Rétrocompat anciennes études : 5/10/15° acceptés (5° conservé uniquement ici),
  // inter-rangées figée 55 cm.
  const st = Number(fc.supportTiltDeg);
  const supportTiltDeg = (st === 5 || st === 10 || st === 15)
    ? st
    : DEFAULT_FLAT_ROOF_CONFIG.supportTiltDeg;
  const lo = (fc.layoutOrientation != null ? String(fc.layoutOrientation) : "").toLowerCase();
  const layoutOrientation = (lo === "landscape" || lo === "paysage") ? "landscape" : "portrait";
  return {
    supportTiltDeg,
    layoutOrientation,
    setbackRoofEdgeCm: numCm("setbackRoofEdgeCm", DEFAULT_FLAT_ROOF_CONFIG.setbackRoofEdgeCm),
    setbackObstacleCm: numCm("setbackObstacleCm", DEFAULT_FLAT_ROOF_CONFIG.setbackObstacleCm),
    rowSpacingCm: FLAT_ROOF_ROW_SPACING_CM,
    rowSpacingMm: FLAT_ROOF_ROW_SPACING_MM,
    colSpacingCm: numCm("colSpacingCm", DEFAULT_FLAT_ROOF_CONFIG.colSpacingCm),
    rowSpacingManual: fc.rowSpacingManual === true,
    mountingSystemId: null,
    mountingSystem: null,
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
