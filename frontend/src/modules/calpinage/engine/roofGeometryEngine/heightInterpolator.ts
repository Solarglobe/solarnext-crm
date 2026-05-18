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
import {
  buildIndex,
  query,
  nearestPoint,
  type Point3D,
  type SpatialIndex,
} from "../../canonical3d/builder/spatialIndex";

// ─────────────────────────────────────────────────────────────────────────────
// RuntimeHeightResolver
// ─────────────────────────────────────────────────────────────────────────────

const RUNTIME_FALLBACK: HeightResolution = {
  heightM: 0,
  source: "fallback",
  reliable: false,
  reason: "RUNTIME_NOT_MOUNTED",
};

/**
 * Flag module pour éviter le spam console sur le chemin hot (résolution par pan).
 * Réinitialisé uniquement lors d'un rechargement de module (HMR ou reload complet).
 */
let _runtimeNotMountedWarnedOnce = false;

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
    if (!fn) {
      if (import.meta.env.DEV && !_runtimeNotMountedWarnedOnce) {
        _runtimeNotMountedWarnedOnce = true;
        console.warn(
          "[RuntimeHeightResolver] RUNTIME_NOT_MOUNTED — getHeightAtXY() indisponible.\n" +
          "Fallback Z=0 appliqué sur tous les sommets → toiture plate silencieuse.\n" +
          "Cause probable : registerCalpinageRuntime() non appelé avant la reconstruction 3D.\n" +
          "Ce warning n'est affiché qu'une fois par session.",
          { xPx, yPx, panId },
        );
      }
      return RUNTIME_FALLBACK;
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// PointCloudHeightInterpolator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rayon de recherche par défaut (m) pour IDW dans le nuage de points.
 * Couvre ~5 cellules de CELL_SIZE=2m de chaque côté — suffisant pour les nuages IGN typiques.
 */
const DEFAULT_QUERY_RADIUS_M = 10;

/**
 * Interpolateur de hauteur IGN basé sur un nuage de points 3D avec index spatial.
 *
 * PERFORMANCE :
 *   - buildIndex() : O(n) une seule fois, appelé dans le constructeur et setPointCloud().
 *   - getHeightAtXY() / getElevation() : O(k) où k ≈ points dans le voisinage (grille 2m).
 *   - Sur 10 000 points : 1 000 appels < 100ms (vs > 3s en O(n) sans index).
 *
 * MÉMOIRE :
 *   - setPointCloud() assigne null à l'ancien index avant reconstruction → GC libère l'ancienne grille.
 *
 * INTERPOLATION :
 *   - IDW (Inverse Distance Weighting) pondéré par 1/d² sur les points dans le rayon.
 *   - Si aucun point dans le rayon → fallback nearestPoint() (O(n), rare en pratique).
 *   - Si nuage vide → null.
 */
export class PointCloudHeightInterpolator {
  private _index: SpatialIndex | null = null;
  private _points: readonly Point3D[] = [];

  constructor(points: readonly Point3D[] = []) {
    this.setPointCloud(points);
  }

  /**
   * Remplace le nuage de points et reconstruit l'index spatial.
   * L'ancien index est déréférencé avant la reconstruction (libération GC).
   */
  setPointCloud(points: readonly Point3D[]): void {
    this._index = null; // déréférence l'ancien index → éligible au GC
    this._points = points;
    this._index = points.length > 0 ? buildIndex(points) : null;
  }

  /**
   * Hauteur interpolée (IDW) au point monde (x, y).
   *
   * @param x      — coordonnée Est (m, repère ENU)
   * @param y      — coordonnée Nord (m, repère ENU)
   * @param radius — rayon de recherche (m), défaut 10m
   * @returns      hauteur interpolée (m) ou null si nuage vide
   */
  getHeightAtXY(x: number, y: number, radius = DEFAULT_QUERY_RADIUS_M): number | null {
    if (!this._index) return null;

    const candidates = query(this._index, { x, y }, radius);
    if (candidates.length > 0) return this._idw(candidates, x, y);

    // Fallback : point le plus proche (hors rayon — ex. requête très excentrée)
    const nearest = nearestPoint(this._index, { x, y });
    return nearest?.z ?? null;
  }

  /**
   * Alias de getHeightAtXY() — interface compatible avec les consommateurs historiques.
   */
  getElevation(x: number, y: number, radius = DEFAULT_QUERY_RADIUS_M): number | null {
    return this.getHeightAtXY(x, y, radius);
  }

  /** Nombre de points dans le nuage courant. */
  get pointCount(): number {
    return this._points.length;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Interpolation Inverse Distance Weighting (IDW, puissance 2).
   * Retourne z du point exactement coïncident si d² < 1e-12.
   */
  private _idw(pts: readonly Point3D[], x: number, y: number): number {
    let wSum = 0;
    let wzSum = 0;
    for (const p of pts) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) return p.z; // coïncidence exacte → valeur directe
      const w = 1 / d2;
      wSum += w;
      wzSum += w * p.z;
    }
    return wSum > 0 ? wzSum / wSum : pts[0]!.z;
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
