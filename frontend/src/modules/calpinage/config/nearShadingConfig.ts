/**
 * Configuration partagée du near shading frontend.
 *
 * NEAR_SHADING_SAMPLING : grille d'échantillonnage des panneaux PV utilisée
 * par le moteur de raycast frontend (buildPvPanels3D, buildSamplingGrid).
 *
 * Aligné sur le backend nearShadingCore.cjs (GRID_SIZE: 3, soit 3×3 = 9 points).
 * Modifier cette valeur réduit la divergence frontend/backend sur le calcul de perte.
 *
 * ⚠️  Ne PAS modifier nearShadingCore.cjs (backend legacy) — source de vérité backend.
 */
export const NEAR_SHADING_SAMPLING = { nx: 3, ny: 3 } as const;
