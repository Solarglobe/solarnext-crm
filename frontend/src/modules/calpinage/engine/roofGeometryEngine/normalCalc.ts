/**
 * Phase 3 — Calcul de normale de surface (méthode de Newell).
 *
 * Wrapper sur canonical3d/builder/planePolygon3d adapté aux types Phase A
 * (Vec3, WorldCorner3D de PanContext.ts).
 * Aucune référence à window.* ni à calpinageRuntime.
 */

import type { Vec3, WorldCorner3D } from "../interfaces/PanContext";
import {
  newellNormalUnnormalized,
  orientExteriorNormalTowardSky,
} from "../../canonical3d/builder/planePolygon3d";
import { normalize3 } from "../../canonical3d/utils/math3";

const UP_WORLD: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * Normale unitaire sortante (vers le ciel) d'un pan de toiture.
 *
 * Utilise la méthode de Newell sur le polygone 3D monde (ENU, Z up).
 * Oriente vers le ciel (dot(n, up) >= 0).
 *
 * @param cornersWorld — ≥ 3 sommets en repère monde ENU (m)
 * @returns normale unitaire, ou null si polygone dégénéré (colinéaire, < 3 pts)
 */
export function computeRoofFaceNormal(cornersWorld: readonly WorldCorner3D[]): Vec3 | null {
  if (cornersWorld.length < 3) return null;
  const nRaw = newellNormalUnnormalized(cornersWorld);
  const nLen = Math.hypot(nRaw.x, nRaw.y, nRaw.z);
  if (!Number.isFinite(nLen) || nLen < 1e-10) return null;
  const exterior = orientExteriorNormalTowardSky(nRaw, UP_WORLD);
  return normalize3(exterior);
}
