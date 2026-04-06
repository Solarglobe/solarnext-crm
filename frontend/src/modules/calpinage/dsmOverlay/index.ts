/**
 * CP-DSM-016 — DSM Visual Overlay Premium
 * DSM overlay only — not the official shading source of truth (docs/dsm-overlay-governance.md).
 */

export {
  createDsmOverlayManager,
  getDsmOverlayManager,
  resolveAnnualProductionKwhForShadingOverlay,
} from "./dsmOverlayManager";
export { normalizeHorizonData, drawHorizonRadar, getHoverPoint } from "./horizonRadar";
export { drawRoofHeatmap } from "./roofHeatmap";
// @ts-expect-error — modules JS sans déclaration
export { buildShadingSummary } from "./buildShadingSummary";
// @ts-expect-error — modules JS sans déclaration
export { getDominantDirection } from "./dominantDirection";
