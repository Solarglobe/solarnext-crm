/**
 * RuntimeHeightResolver — implémentation Phase 1/2 de HeightResolver.
 *
 * Wrap `window.getHeightAtXY(panId, xPx, yPx)` et
 * `window.__calpinage_hitTestPan__(pt)` pour fournir des hauteurs Z
 * aux moteurs extraits (pvPlacementEngine, roofGeometryEngine) sans
 * qu'ils dépendent directement des globals window legacy.
 *
 * Contrat :
 *   - `window.getHeightAtXY` retourne `number | null` (API officielle legacy).
 *   - `window.__calpinage_hitTestPan__` retourne `{ id: string } | null`.
 *   - Si l'un ou l'autre est absent, les méthodes retournent un fallback sûr.
 *
 * Ne PAS importer ce fichier depuis les interfaces (dépendance circulaire).
 * Utiliser la factory `createRuntimeHeightResolver()` pour l'injection.
 *
 * @module engine/runtime/RuntimeHeightResolver
 */

import type { HeightResolution, HeightResolver } from "../interfaces/HeightResolver";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES LOCAUX — shape minimale des globals window legacy
// ─────────────────────────────────────────────────────────────────────────────

/** Shape minimale de window.getHeightAtXY telle qu'exposée par calpinage.module.js. */
type WindowGetHeightAtXY = (panId: string, xPx: number, yPx: number) => number | null;

/** Shape minimale de window.__calpinage_hitTestPan__ exposé par calpinage.module.js. */
type WindowHitTestPan = (pt: { x: number; y: number }) => { id: string } | null;

/** Extension de Window pour les globals legacy calpinage. */
interface CalpinageLegacyWindow extends Window {
  getHeightAtXY?: WindowGetHeightAtXY;
  __calpinage_hitTestPan__?: WindowHitTestPan;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_RESOLUTION: HeightResolution = {
  heightM: 0,
  source: "fallback",
  reliable: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résolveur de hauteurs Z qui délègue vers les globals window legacy.
 *
 * Ordre de résolution pour `getHeightAtImagePoint` :
 *   1. Si `panId` est fourni → appel direct `window.getHeightAtXY(panId, x, y)` (source: "runtime").
 *   2. Sinon → hit-test via `window.__calpinage_hitTestPan__({x, y})` puis
 *      `window.getHeightAtXY(pan.id, x, y)` (source: "runtime").
 *   3. Si l'un des globals est absent ou retourne null → fallback (source: "fallback").
 *
 * `getVertexHeight` retourne toujours `null` dans cette implémentation :
 *   les IDs de sommets n'ont pas de lookup direct dans la runtime legacy (Phase 1/2).
 *   La StoreHeightResolver (Phase 3+) couvrira ce cas.
 */
export class RuntimeHeightResolver implements HeightResolver {
  // ── isRuntimeAvailable ──────────────────────────────────────────────────

  /**
   * true si `window.getHeightAtXY` est disponible au moment de l'appel.
   * La propriété est recalculée à chaque accès (le global peut être monté
   * après l'instanciation du resolver).
   */
  get isRuntimeAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof (window as CalpinageLegacyWindow).getHeightAtXY === "function"
    );
  }

  // ── getHeightAtImagePoint ────────────────────────────────────────────────

  /**
   * Hauteur Z en un point image (xPx, yPx).
   *
   * @param xPx   — coordonnée X pixel (origine haut-gauche, +x droite)
   * @param yPx   — coordonnée Y pixel (origine haut-gauche, +y bas)
   * @param panId — ID du pan porteur (améliore la précision si connu)
   * @returns HeightResolution avec source et fiabilité
   */
  getHeightAtImagePoint(xPx: number, yPx: number, panId?: string): HeightResolution {
    if (typeof window === "undefined") return FALLBACK_RESOLUTION;

    const w = window as CalpinageLegacyWindow;

    if (typeof w.getHeightAtXY !== "function") return FALLBACK_RESOLUTION;

    // Chemin rapide : panId fourni par le consommateur
    if (panId !== undefined) {
      return this._resolveViaGetHeightAtXY(w.getHeightAtXY, panId, xPx, yPx);
    }

    // Chemin hit-test : panId inconnu — chercher le pan sous le point
    if (typeof w.__calpinage_hitTestPan__ === "function") {
      const hit = this._safeHitTest(w.__calpinage_hitTestPan__, xPx, yPx);
      if (hit !== null) {
        return this._resolveViaGetHeightAtXY(w.getHeightAtXY, hit.id, xPx, yPx);
      }
    }

    return FALLBACK_RESOLUTION;
  }

  // ── getVertexHeight ──────────────────────────────────────────────────────

  /**
   * La runtime legacy n'expose pas de lookup par ID de sommet.
   * Retourne toujours `null` — la StoreHeightResolver (Phase 3+) couvrira ce cas.
   *
   * @param _vertexId — identifiant stable du sommet (non utilisé dans cette implémentation)
   */
  getVertexHeight(_vertexId: string): HeightResolution | null {
    return null;
  }

  // ── helpers privés ───────────────────────────────────────────────────────

  private _resolveViaGetHeightAtXY(
    fn: WindowGetHeightAtXY,
    panId: string,
    xPx: number,
    yPx: number,
  ): HeightResolution {
    try {
      const raw = fn(panId, xPx, yPx);
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return { heightM: raw, source: "runtime", reliable: true };
      }
    } catch {
      // defensive : le global peut lever si le state interne est corrompu
    }
    return FALLBACK_RESOLUTION;
  }

  private _safeHitTest(
    fn: WindowHitTestPan,
    xPx: number,
    yPx: number,
  ): { id: string } | null {
    try {
      return fn({ x: xPx, y: yPx });
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée une instance prête à l'emploi de RuntimeHeightResolver.
 *
 * Usage dans les moteurs :
 *   ```ts
 *   import { createRuntimeHeightResolver } from "../runtime/RuntimeHeightResolver";
 *   const resolver = createRuntimeHeightResolver();
 *   const h = resolver.getHeightAtImagePoint(x, y, pan.id);
 *   ```
 */
export function createRuntimeHeightResolver(): HeightResolver {
  return new RuntimeHeightResolver();
}
