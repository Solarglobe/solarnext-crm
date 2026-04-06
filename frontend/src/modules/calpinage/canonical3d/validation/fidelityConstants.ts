/**
 * Seuils pour la validation de fidélité 2D brut → scène 3D (`validate2DTo3DCoherence`, bloc fidélité).
 * Règles lisibles — pas de magie dans le validateur.
 */

/** Jaccard(id) minimum pan source ↔ patches scène en dessous duquel on émet une ERROR « divergence forte ». */
export const FIDELITY_PATCH_JACCARD_ERROR_BELOW = 0.15;

/** Jaccard en dessous duquel on émet un WARNING « alignement faible ». */
export const FIDELITY_PATCH_JACCARD_WARN_BELOW = 0.55;

/**
 * Ratio acceptable entre Σ aires pans 3D (m²) et aire emprise toit source (px² × mpp²).
 * Hors de [min,max] → WARNING emprise globale.
 */
export const FIDELITY_ROOF_AREA_RATIO_MIN = 0.22;
export const FIDELITY_ROOF_AREA_RATIO_MAX = 4.5;

/** Part minimale des ids source (pans / obstacles / panneaux) devant être retrouvés en scène avant WARNING couverture. */
export const FIDELITY_SOURCE_COVERAGE_WARN_BELOW = 0.85;

/** Panneaux : ratio aire bbox centres (approx) vs emprise pans — détection grossière de dispersion. */
export const FIDELITY_PANEL_LAYOUT_AREA_RATIO_WARN_ABOVE = 2.2;
