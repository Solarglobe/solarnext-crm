/**
 * Mapping image px → plan horizontal WORLD (ENU, Z up).
 *
 * Convention officielle documentée : `docs/architecture/3d-world-convention.md`
 * Point d’ancrage API : `canonical3d/core/worldConvention.ts` ; contrat unifié 2D/3D : `canonical3d/world/unifiedWorldFrame.ts`.
 *
 * Hypothèse explicite :
 * - Sans rotation nord : Est = +X_world = +x_px * mpp ; Nord = +Y_world = -y_px * mpp
 *   (le « haut » de l’image, y diminuant, correspond au nord).
 * - `northAngleDeg` applique une rotation autour de l’axe Z monde **après** le mapping de base (même sens partout : toit, sol, UV).
 * - Texture satellite : `flipY = false` dans le viewer (évite double inversion vs flip Y implicite WebGL + canvas).
 */

/**
 * @returns (x,y) en mètres dans le plan horizontal WORLD (Z sera ajouté séparément).
 */
export function imagePxToWorldHorizontalM(
  xPx: number,
  yPx: number,
  metersPerPixel: number,
  northAngleDeg: number
): { x: number; y: number } {
  const x0 = xPx * metersPerPixel;
  const y0 = -yPx * metersPerPixel;
  const rad = (northAngleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x0 * cos - y0 * sin,
    y: x0 * sin + y0 * cos,
  };
}

/**
 * Inverse strict de `imagePxToWorldHorizontalM` : plan horizontal ENU (m) → pixels image (origine haut-gauche, +y bas).
 */
export function worldHorizontalMToImagePx(
  xM: number,
  yM: number,
  metersPerPixel: number,
  northAngleDeg: number
): { xPx: number; yPx: number } {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel === 0) {
    return { xPx: NaN, yPx: NaN };
  }
  const rad = (northAngleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x0 = xM * cos + yM * sin;
  const y0 = -xM * sin + yM * cos;
  return {
    xPx: x0 / metersPerPixel,
    yPx: -y0 / metersPerPixel,
  };
}
