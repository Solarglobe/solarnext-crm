/**
 * Configuration globale du module calpinage.
 *
 * Constantes paramétrables centralisées ici pour éviter les magic numbers
 * dispersés dans le code moteur.
 *
 * ⚠️  Modifier cette valeur impacte la validation de pente dans le moteur de
 * placement (placementSlopeGuard.ts) et l'alerte Phase2Sidebar.
 */
export const CALPINAGE_CONFIG = {
  /**
   * Pente maximale (degrés) autorisée pour le placement de panneaux PV.
   * Au-delà, Math.cos(slopeRad) → ~0 → projectedZ = ±Infinity / NaN.
   * Le moteur de placement lève QUASI_VERTICAL_FACE si ce seuil est dépassé.
   */
  maxSlopeDeg: 75,
} as const;
