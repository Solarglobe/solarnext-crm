/**
 * === SHADING OFFICIAL NODE ENTRY (facade) ===
 * Pas de logique ici : re-export de shadingEngineCore.cjs uniquement.
 * Tests backend / alignement horizon : préférer ce fichier ou shadingEngineCore.cjs.
 * @see shadingEngineCore.cjs — docs/shading-governance.md
 */
const core = require("./shadingEngineCore.cjs");

module.exports = {
  computeAnnualShadingLoss: core.computeAnnualShadingLoss,
  getAnnualSunVectors: core.getAnnualSunVectors,
  normalizeObstacles: core.normalizeObstacles,
  computeShadowRayDirection: core.computeShadowRayDirection,
  isPanelPointShadedByObstacle: core.isPanelPointShadedByObstacle,
};
