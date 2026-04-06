// ======================================================
// SOURCE DE VÉRITÉ UNIQUE — DIMENSIONS PANNEAUX (SolarGlobe)
// - Utilisé par l'UI DP6 (frontend/dp-tool)
// - Utilisé par le rendu PDF DP6 (backend/pdf/render)
// ======================================================
(function (global) {
  "use strict";

  // ✅ DÉCISION FIGÉE (NON NÉGOCIABLE)
  // Dimensions panneaux = 1800 × 1130 mm
  const PANEL_DIMENSIONS = Object.freeze({
    width_mm: 1130,
    height_mm: 1800,
  });

  // Expose en global (browser) + support environnement JS générique
  global.PANEL_DIMENSIONS = PANEL_DIMENSIONS;
})(typeof window !== "undefined" ? window : globalThis);

