/**
 * Phase 3 — Implémentations concrètes de HeightResolver.
 *
 * RuntimeHeightResolver  : délègue à window.getHeightAtXY via CalpinageRuntime.
 *   - Encapsule la logique fitPlane / ridge / trait déjà dans le legacy JS.
 *   - Seul fichier de roofGeometryEngine couplé au runtime ; les autres sont purs.
 *
 * FallbackHeightResolver : hauteur constante configurable.
 *   - Tests unitaires, SSR, runtime non disponible.
 *   - source "fallback", reliable = false.
 */

import type { HeightResolution, HeightResolver } from "../interfaces/HeightResolver";
import { getCalpinageRuntime } from "../../runtime/calpinageRuntime";

// ─────────────────────────────────────────────────────────────────────────────
// RuntimeHeightResolver
// ─────────────────────────────────────────────────────────────────────────────

const RUNTIME_FALLBACK: HeightResolution = {
  heightM: 0,
  source: "fallback",
  reliable: false,
};

/**
 * HeightResolver branché sur window.getHeightAtXY via CalpinageRuntime (Phase 2).
 *
 * Doit être instancié uniquement dans des contextes navigateur avec le runtime
 * legacy chargé (registerCalpinageRuntime() appelé). En SSR ou test : utiliser
 * FallbackHeightResolver.
 */
export class RuntimeHeightResolver implements HeightResolver {
  readonly isRuntimeAvailable: boolean;

  constructor() {
    this.isRuntimeAvailable = getCalpinageRuntime() !== null;
  }

  getHeightAtImagePoint(xPx: number, yPx: number, panId?: string): HeightResolution {
    const fn = getCalpinageRuntime()?.getHeightAtXY();
    if (!fn) return RUNTIME_FALLBACK;
    try {
      const h = fn(panId ?? "", xPx, yPx);
      if (h == null || !Number.isFinite(h)) return RUNTIME_FALLBACK;
      return { heightM: h, source: "runtime", reliable: true };
    } catch {
      return RUNTIME_FALLBACK;
    }
  }

  getVertexHeight(_vertexId: string): HeightResolution | null {
    // Pas de lookup par vertexId dans le runtime legacy.
    // Disponible dans store path (Phase 4+) via StoreHeightResolver.
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FallbackHeightResolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HeightResolver qui retourne une hauteur constante.
 * Utilisé dans les tests unitaires et en SSR (aucune dépendance au runtime).
 */
export class FallbackHeightResolver implements HeightResolver {
  readonly isRuntimeAvailable = false;

  private readonly _resolution: HeightResolution;

  constructor(readonly constantHeightM = 3.0) {
    this._resolution = { heightM: constantHeightM, source: "fallback", reliable: false };
  }

  getHeightAtImagePoint(_xPx: number, _yPx: number, _panId?: string): HeightResolution {
    return this._resolution;
  }

  getVertexHeight(_vertexId: string): HeightResolution | null {
    return this._resolution;
  }
}
