/**
 * Configuration globale du module calpinage.
 *
 * Constantes paramétrables centralisées ici pour éviter les magic numbers
 * dispersés dans le code moteur.
 *
 * Consommateurs connus :
 *   - placementSlopeGuard.ts  → maxSlopeDeg
 *   - roofClustering.ts       → clusterEpsilonDeg, minClusterFaceAreaM2
 */
export const CALPINAGE_CONFIG = {
  /**
   * Pente maximale (degrés) autorisée pour le placement de panneaux PV.
   * Au-delà, Math.cos(slopeRad) → ~0 → projectedZ = ±Infinity / NaN.
   * Le moteur de placement lève QUASI_VERTICAL_FACE si ce seuil est dépassé.
   */
  maxSlopeDeg: 75,

  /**
   * Tolérance angulaire (degrés) du clustering de plans de toiture.
   * Deux faces dont l'angle entre normales est ≤ clusterEpsilonDeg sont regroupées.
   *
   * ⚠️  Réduire ce seuil augmente le nombre de clusters et peut créer des micro-faces
   * parasites. Combiner avec minClusterFaceAreaM2 pour les filtrer.
   *
   * Valeur historique legacy : 15°. Ramenée à 8° pour une granularité plus fine.
   */
  clusterEpsilonDeg: 8,

  /**
   * Surface projetée minimale (m²) d'une face pour être conservée après clustering.
   * Les faces avec projectedHorizontalAreaM2 < minClusterFaceAreaM2 sont filtrées
   * par filterTinyFaces() (micro-faces parasites dues à la réduction de l'epsilon).
   */
  minClusterFaceAreaM2: 0.5,
} as const;

/** Type dérivé de CALPINAGE_CONFIG — à utiliser dans les signatures de fonctions. */
export type CalpinageConfig = typeof CALPINAGE_CONFIG;
