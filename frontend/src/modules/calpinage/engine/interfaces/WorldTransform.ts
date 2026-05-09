/**
 * Phase A — Interface de découplage : transformation image ↔ monde.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : encapsuler les deux paramètres de conversion pixel → ENU
 * (metersPerPixel + northAngleDeg) sous un type nommé, réutilisable dans
 * PanContext et PanelPlacementInput sans répéter les champs.
 *
 * Fonctions de conversion : canonical3d/builder/worldMapping.ts
 *   - imagePxToWorldHorizontalM(xPx, yPx, mpp, northAngleDeg)
 *   - worldHorizontalMToImagePx(xM, yM, mpp, northAngleDeg)
 *
 * Source legacy :
 *   - CALPINAGE_STATE.roof.scale.metersPerPixel
 *   - CALPINAGE_STATE.roof.roof.north.angleDeg
 *
 * Invariant : metersPerPixel > 0 (non nul, non négatif, non NaN).
 */
export interface WorldTransform {
  /**
   * Échelle image → monde : mètres par pixel.
   * Strictement > 0.
   */
  readonly metersPerPixel: number;

  /**
   * Angle (degrés) de rotation du haut de l'image vers le nord géographique.
   * 0 = haut image = nord. Sens horaire positif (convention calpinage).
   */
  readonly northAngleDeg: number;
}
