/**
 * resolveImgH.ts — Lecture robuste de la hauteur image source pour les couches Konva.
 *
 * PROBLÈME :
 *   Les couches Konva lisent `CALPINAGE_STATE.roof.image.height` pour convertir les
 *   coordonnées image-space → world-space (y_world = imgH - y_img).
 *   Si ce champ est absent ou vaut 0 (timing : image pas encore chargée, ou phase non initialisée),
 *   la couche retourne null → seul le canvas legacy (contours rouges) reste visible.
 *
 * SOLUTION — chaîne de fallback :
 *   1. `CALPINAGE_STATE.roof.image.height`        (source primaire)
 *   2. `window.CALPINAGE_PV_PANELS_DATA.imgH`     (moteur panels — fiable en phase PV_LAYOUT)
 *   3. `CALPINAGE_STATE.roof.scale.canvasHeight`  (dimensions canvas parfois stockées dans scale)
 *   0 si aucune source ne donne une valeur positive.
 */
export function resolveImgH(): number {
  const w = window as unknown as Record<string, unknown>;

  // Source 1 : CALPINAGE_STATE.roof.image.height (valeur officielle)
  const st = w["CALPINAGE_STATE"] as
    | { roof?: { image?: { height?: number }; scale?: { canvasHeight?: number } } }
    | null
    | undefined;
  const h1 = st?.roof?.image?.height;
  if (typeof h1 === "number" && h1 > 0) return h1;

  // Source 2 : CALPINAGE_PV_PANELS_DATA.imgH (moteur panneau — toujours synchronisé avec imgH)
  const pvData = w["CALPINAGE_PV_PANELS_DATA"] as { imgH?: number } | null | undefined;
  const h2 = pvData?.imgH;
  if (typeof h2 === "number" && h2 > 0) return h2;

  // Source 3 : CALPINAGE_STATE.roof.scale.canvasHeight (présent dans certains états)
  const h3 = st?.roof?.scale?.canvasHeight;
  if (typeof h3 === "number" && h3 > 0) return h3;

  return 0;
}
