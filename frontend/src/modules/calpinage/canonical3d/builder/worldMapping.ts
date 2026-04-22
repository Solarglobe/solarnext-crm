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

/**
 * Longueur horizontale (m) entre deux points image — **même loi** que le toit 3D (`imagePxToWorldHorizontalM`).
 * À utiliser pour toute cote 2D exprimée en mètres (Niveau 1 / charte fidélité).
 */
export function segmentHorizontalLengthMFromImagePx(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  metersPerPixel: number,
  northAngleDeg: number,
): number {
  const aw = imagePxToWorldHorizontalM(a.x, a.y, metersPerPixel, northAngleDeg);
  const bw = imagePxToWorldHorizontalM(b.x, b.y, metersPerPixel, northAngleDeg);
  return Math.hypot(bw.x - aw.x, bw.y - aw.y);
}

/**
 * Aire horizontale monde (m²) d’un polygone dont les sommets sont en pixels image.
 * Chaîne unique : projection `imagePxToWorldHorizontalM` puis shoelace XY (Niveau 3 / charte fidélité).
 * Équivaut à `aire_px² × mpp²` pour notre transformée linéaire (|det| = mpp²), mais une seule voie de calcul.
 */
export function polygonHorizontalAreaM2FromImagePx(
  ring: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  metersPerPixel: number,
  northAngleDeg: number,
): number {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return 0;
  if (!ring || ring.length < 3) return 0;
  const north = Number.isFinite(northAngleDeg) ? northAngleDeg : 0;
  const pts: { x: number; y: number }[] = ring.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length > 1) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a.x === b.x && a.y === b.y) pts.pop();
  }
  if (pts.length < 3) return 0;
  const w = pts.map((p) => imagePxToWorldHorizontalM(p.x, p.y, metersPerPixel, north));
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    const j = (i + 1) % w.length;
    s += w[i]!.x * w[j]!.y - w[j]!.x * w[i]!.y;
  }
  return Math.abs(s) * 0.5;
}
