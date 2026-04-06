/**
 * Résolveur de hauteurs depuis le runtime calpinage.
 *
 * Lecture seule sur `window.getHeightAtXY`, exposé par `pans-bundle.js`
 * via `CalpinagePans.getHeightAtXY()` (lui-même basé sur `fitPlane()`).
 *
 * Aucune dépendance au state React, aucun effet de bord.
 * Si le runtime n'est pas chargé → `undefined` (le builder 3D tombera sur `defaultHeightM`).
 *
 * Référence : `frontend/calpinage/pans-bundle.js` lignes 1175-1194
 *   getHeightAtXY(panId, xPx, yPx, state) → plane.a*xM + plane.b*yM + plane.c
 *
 * Moteur officiel de résolution Z (avec source + confiance) :
 *   `../core/heightResolver.ts` — resolveHeightAtXY() / resolveHeightAtXYDetailed()
 */
export {
  resolveHeightAtXYDetailed,
  buildRuntimeContext,
  HEIGHT_SOURCE_CONFIDENCE,
  type HeightResolutionResult,
  type HeightResolverContext,
  type HeightStateContext,
} from "../core/heightResolver";

/**
 * Signature de `window.getHeightAtXY` telle qu'exposée par pans-bundle.js.
 * Retourne la hauteur interpolée (m) au point (xPx, yPx) sur le pan `panId`
 * via `CalpinagePans.fitPlane()` (moindres carrés sur les sommets h-valués du pan).
 */
type GetHeightAtXYFn = (panId: string, xPx: number, yPx: number) => number | null | undefined;

declare global {
  interface Window {
    getHeightAtXY?: GetHeightAtXYFn;
  }
}

/**
 * Retourne la hauteur (m) au point image (xPx, yPx) sur le pan `panId`.
 * Délègue à `window.getHeightAtXY` — disponible uniquement si `pans-bundle.js` est chargé.
 *
 * @returns hauteur en mètres, ou `undefined` si :
 *   - `window.getHeightAtXY` n'est pas défini (bundle non chargé)
 *   - la valeur retournée est `null`, `undefined`, ou non-finie
 *   - une exception est levée (défense en profondeur)
 */
export function resolveHeightAtPx(panId: string, xPx: number, yPx: number): number | undefined {
  const fn = typeof window !== "undefined" ? window.getHeightAtXY : undefined;
  if (typeof fn !== "function") return undefined;
  try {
    const h = fn(panId, xPx, yPx);
    if (h == null || !Number.isFinite(h)) return undefined;
    return h;
  } catch {
    // Si pans-bundle n'a pas encore initialisé son état interne → défense silencieuse.
    return undefined;
  }
}

/**
 * Indique si le résolveur de hauteurs runtime est disponible.
 * Utile pour avertir l'utilisateur qu'on tombe en mode "toiture plate" (fallback).
 *
 * @example
 * if (!isRuntimeHeightResolverAvailable()) {
 *   console.warn("Hauteurs non disponibles — vérifier que pans-bundle.js est chargé.");
 * }
 */
export function isRuntimeHeightResolverAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.getHeightAtXY === "function";
}
